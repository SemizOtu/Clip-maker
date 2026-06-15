"""Chat tekrarından heyecan sinyali çıkarımı.

Mantık: yalnızca "yoğun chat" değil, "aniden patlayan chat" dikkat çekici
anı işaret eder. Mesaj yoğunluğu + hype kalıpları (kahkaha, şaşkınlık,
klip çağrıları, emote spam) + farklı kullanıcı + tekrar/kopyala-yapıştır
sinyalleri birleştirilir, yerel ortalamaya göre patlama (burst) eklenir,
sonra dayanıklı z-skoru alınır. Son olarak chat'in olaya göre gecikmesi
telafi edilir (sinyal birkaç saniye öne kaydırılır).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from clipmaker.kick_api import ChatMessage

# (kalıp, ağırlık) — Türkçe + evrensel yayın kültürü kalıpları
HYPE_PATTERNS: list[tuple[re.Pattern, float]] = [
    # kahkaha
    (re.compile(r"(?:ha){3,}|(?:he){3,}|(?:ah){3,}|(?:js){2,}|(?:sj){2,}|(?:kj){2,}|(?:jsk){2,}|asd(?:as|f){1,}|x[dD]{2,}|\blmaoo*\b|\blo+l\b|\baaa+\b", re.I), 1.0),
    # emote kültürü
    (re.compile(r"\b(?:kekw|omegalul|lulw?|icant|kek|pepelaugh|kappa|sadge|aware|copium)\b", re.I), 1.2),
    # heyecan (EN)
    (re.compile(r"\b(?:pog(?:gers|champ|u)?|lets?\s*go+|insane|holy|no\s*way|nah+|wtf|omg|crazy|sheesh|actual(?:ly)?|clipped)\b", re.I), 1.0),
    # heyecan / tepki (TR)
    (re.compile(r"\b(?:oha+|off+|vay\s*be|yok\s*artık|inanılmaz|inanilmaz|efsane|müthiş|muthis|kral|baba|adamsın|adamsin|helal|bravo|nasıl\s*ya|nasil\s*ya|beyler|rezalet|kepazelik|valla+|vallah|aq|amk|panpa|reis|hocam)\b", re.I), 1.2),
    # klip çağrısı — en güçlü sinyal
    (re.compile(r"\b(?:clip\s*(?:it|that)?|klip(?:le|lik|leyin|lendi|leyelim)?|kliple|montaj(?:lık|lik)?)\b", re.I), 2.2),
    # şaşkınlık/soru patlaması
    (re.compile(r"\b(?:ne(?:e+|\s*oldu|\s*ya|\s*lan)|naptın|naptin|gördün\s*mü|gordun\s*mu)\b", re.I), 0.9),
    # tek başına W / L / + (onay/katılım)
    (re.compile(r"^\s*(?:[wW]{1,3}|\+\d*|o7|F)\s*$"), 1.0),
    # yoğun ünlem/soru
    (re.compile(r"[?!]{3,}"), 0.7),
]

# Kick mesajlarında emote'lar [emote:12345:isim] biçiminde gömülü gelir
EMOTE_RE = re.compile(r"\[emote:\d+:([A-Za-z0-9_]+)\]")
HYPE_EMOTE_RE = re.compile(r"kekw|lul|omegalul|pog|icant|kek|laugh|hype|fire|w\b|clap|cry|skull", re.I)
URL_RE = re.compile(r"https?://|www\.", re.I)
WS_RE = re.compile(r"\s+")

# Bot/sistem bildirimleri (insan tepkisi değil; sinyali şişirir, klip değildir)
BOT_USERNAMES = {"botrix", "kickbot", "nightbot", "streamelements", "streamlabs",
                 "moobot", "wizebot", "fossabot", "kick"}
SYSTEM_CONTENT_RE = re.compile(
    r"thanks?\s+for\s+the\s+follow|is\s+now\s+live|has\s+gifted|gifted\s+\d+|"
    r"\bhas\s+subscribed\b|just\s+subscribed|\bhas\s+resubscribed\b|"
    r"has\s+accepted\s+the\s+duel|has\s+declined\s+the\s+duel|"
    r"\bhas\s+(?:won|lost|challenged|redeemed)\b|is\s+hosting|raiding\s+with|"
    r"welcome\s+to\s+the\s+stream|açıldı\s*!?\s*$|takip\s+ettiği\s+için\s+teşekkür",
    re.I,
)


def message_hype_score(content: str) -> float:
    """Tek bir mesajın 'hype' katkısını hesaplar."""
    if not content:
        return 0.0
    score = 0.0
    for pattern, weight in HYPE_PATTERNS:
        if pattern.search(content):
            score += weight
    emotes = EMOTE_RE.findall(content)
    # emote spam: ilk emote tam, sonrakiler azalan katkı (tek emote yağmuru şişmesin)
    for i, name in enumerate(emotes):
        base = 1.0 if HYPE_EMOTE_RE.search(name) else 0.4
        score += base * (1.0 if i == 0 else 0.5)
    # BÜYÜK HARF bağırışı
    stripped = EMOTE_RE.sub("", content)
    letters = [c for c in stripped if c.isalpha()]
    if len(letters) >= 5:
        upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
        if upper_ratio > 0.8:
            score += 0.8
    return score


def is_noise_message(content: str) -> bool:
    """Sinyale girmemesi gereken mesajlar: bot komutları, linkler, sistem bildirimleri."""
    s = (content or "").strip()
    if not s:
        return True
    if s.startswith(("!", "/")):       # bot komutu
        return True
    if URL_RE.search(s) and len(s.split()) <= 2:  # yalnızca link
        return True
    if SYSTEM_CONTENT_RE.search(s):    # takip/abone/düello/raid bildirimi
        return True
    return False


def is_bot_or_noise(username: str, content: str) -> bool:
    """Bot kullanıcısı ya da gürültü mesajı mı? (sinyale ve jüriye girmemeli)"""
    if (username or "").strip().lower() in BOT_USERNAMES:
        return True
    return is_noise_message(content)


def normalize_text(content: str) -> str:
    """Tekrar/kopyala-yapıştır tespiti için mesajı sadeleştirir."""
    s = EMOTE_RE.sub(lambda g: g.group(1).lower(), content or "")
    return WS_RE.sub(" ", s.strip().lower())


@dataclass
class ChatSignal:
    bucket_s: float
    counts: np.ndarray            # mesaj sayısı / pencere (gürültü filtreli)
    hype: np.ndarray              # hype puanı / pencere
    unique_senders: np.ndarray    # farklı kullanıcı / pencere
    repeat: np.ndarray            # kopyala-yapıştır / tekrar yoğunluğu / pencere
    raw: np.ndarray               # birleşik ham skor (+ patlama bileşeni)
    z: np.ndarray                 # dayanıklı z-skoru (yumuşatılmış, gecikme telafili)
    lag_s: float = 0.0
    messages: list = field(default_factory=list, repr=False)

    def top_messages(self, start_s: float, end_s: float, k: int = 5) -> list[dict]:
        """Pencere içindeki en dikkat çekici mesajları döndürür (rapor için).

        Gecikme telafisi nedeniyle gerçek tepkiler klibin biraz sonrasında
        olabileceğinden pencereyi sağ tarafa doğru biraz genişletiriz.
        """
        lo, hi = start_s, end_s + self.lag_s + self.bucket_s
        window = [m for m in self.messages
                  if lo <= m.offset_s <= hi and not is_bot_or_noise(m.username, m.content)]
        window.sort(key=lambda m: message_hype_score(m.content), reverse=True)
        out = []
        for m in window[:k]:
            text = EMOTE_RE.sub(lambda g: f":{g.group(1)}:", m.content).strip()
            if text:
                out.append({"t": round(m.offset_s, 1), "user": m.username, "text": text[:120]})
        return out


def analyze_chat(
    messages: list[ChatMessage],
    duration_s: float,
    bucket_s: float = 5.0,
    lag_s: float = 4.0,
) -> Optional[ChatSignal]:
    """Mesaj listesini pencereli sinyale dönüştürür. Mesaj yoksa None.

    lag_s: chat'in olaya göre ortalama gecikmesi (yayın gecikmesi + insan
    tepki süresi + yazma). Sinyal bu kadar saniye öne kaydırılır ki klip,
    chat tepkisinin değil tepkiyi doğuran *anın* üzerine otursun.
    """
    if not messages or duration_s <= 0:
        return None
    n = max(1, math.ceil(duration_s / bucket_s))
    counts = np.zeros(n)
    hype = np.zeros(n)
    senders: list[set] = [set() for _ in range(n)]
    bucket_texts: list[dict] = [dict() for _ in range(n)]  # normalize metin -> adet

    for m in messages:
        b = int(m.offset_s // bucket_s)
        if not (0 <= b < n):
            continue
        if is_bot_or_noise(m.username, m.content):
            continue  # bot/sistem/komut/link -> sinyale hiç girmesin
        counts[b] += 1
        hype[b] += message_hype_score(m.content)
        if m.username:
            senders[b].add(m.username)
        norm = normalize_text(m.content)
        if norm:
            bucket_texts[b][norm] = bucket_texts[b].get(norm, 0) + 1

    uniq = np.array([len(s) for s in senders], dtype=float)
    # tekrar: aynı/benzer mesajın bir pencerede kaç kez fazladan görüldüğü
    repeat = np.array([
        sum(c - 1 for c in texts.values() if c > 1) for texts in bucket_texts
    ], dtype=float)

    # hype (kahkaha, "klip", OHA...) ağır basar — komik anlar aday olarak öne çıksın
    base = counts + 2.4 * hype + 0.4 * uniq + 1.3 * repeat
    # patlama (burst): yerel ortalamanın üzerine çıkan ani sıçrama
    baseline = rolling_baseline(base, win=max(5, int(round(60.0 / bucket_s))))
    burst = np.clip(base - baseline, 0.0, None)

    raw = base + 1.3 * burst
    z = robust_z(smooth(raw, 3))
    z = shift_earlier(z, int(round(lag_s / bucket_s)))
    return ChatSignal(bucket_s=bucket_s, counts=counts, hype=hype,
                      unique_senders=uniq, repeat=repeat, raw=raw, z=z,
                      lag_s=lag_s, messages=list(messages))


def smooth(x: np.ndarray, k: int = 3) -> np.ndarray:
    if len(x) < k or k <= 1:
        return x.astype(float)
    kernel = np.ones(k) / k
    return np.convolve(x.astype(float), kernel, mode="same")


def rolling_baseline(x: np.ndarray, win: int) -> np.ndarray:
    """Kayan ortalama temel çizgisi (yavaş trafik artışını süzmek için)."""
    x = x.astype(float)
    if win <= 1 or len(x) < win:
        return np.full_like(x, float(np.median(x)) if len(x) else 0.0)
    pad = win // 2
    padded = np.pad(x, (pad, pad), mode="edge")
    kernel = np.ones(win) / win
    return np.convolve(padded, kernel, mode="valid")[:len(x)]


def shift_earlier(arr: np.ndarray, k: int) -> np.ndarray:
    """Diziyi k pencere öne kaydırır (gelecekteki değerleri geri çeker)."""
    if k <= 0:
        return arr
    out = np.zeros_like(arr)
    out[:-k] = arr[k:]
    return out


def robust_z(x: np.ndarray) -> np.ndarray:
    """Medyan/MAD tabanlı z-skoru; aykırı değerlere ortalamadan dayanıklıdır."""
    x = x.astype(float)
    med = float(np.median(x))
    mad = float(np.median(np.abs(x - med)))
    scale = 1.4826 * mad
    if scale < 1e-9:
        std = float(np.std(x))
        scale = std if std > 1e-9 else 1.0
    return (x - med) / scale
