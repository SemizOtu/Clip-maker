"""Chat tekrarından heyecan sinyali çıkarımı.

Mantık: mesaj yoğunluğu + "hype" kalıpları (kahkaha, şaşkınlık, klip
çağrıları, emote spam) + farklı kullanıcı sayısı birleşik bir ham skora
dönüştürülür; sonra dayanıklı z-skoru alınır. Ani yükselişler genellikle
yayındaki dikkat çekici anlara denk gelir.
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
    (re.compile(r"(?:ha){3,}|(?:he){3,}|(?:ah){3,}|(?:js){2,}|(?:sj){2,}|(?:kj){2,}|(?:jsk){2,}|asd(?:as|f){1,}|x[dD]{2,}|\blmaoo*\b|\blo+l\b", re.I), 1.0),
    # emote kültürü
    (re.compile(r"\b(?:kekw|omegalul|lulw?|icant|kek|pepelaugh|kappa)\b", re.I), 1.2),
    # heyecan (EN)
    (re.compile(r"\b(?:pog(?:gers|champ)?|lets?\s*go+|insane|holy|no\s*way|nah+|wtf|omg|crazy)\b", re.I), 1.0),
    # heyecan (TR)
    (re.compile(r"\b(?:oha+|off+|vay\s*be|yok\s*artık|inanılmaz|inanilmaz|efsane|müthiş|muthis|kral|baba|adamsın|adamsin|helal|bravo|nasıl\s*ya|nasil\s*ya|beyler)\b", re.I), 1.2),
    # klip çağrısı — en güçlü sinyal
    (re.compile(r"\b(?:clip\s*(?:it|that)?|klip(?:le|lik|leyin|lendi)?|kliple)\b", re.I), 2.0),
    # tek başına W / L
    (re.compile(r"^\s*[wW]{1,3}\s*$"), 1.0),
    # yoğun ünlem/soru
    (re.compile(r"[?!]{3,}"), 0.6),
]

# Kick mesajlarında emote'lar [emote:12345:isim] biçiminde gömülü gelir
EMOTE_RE = re.compile(r"\[emote:\d+:([A-Za-z0-9_]+)\]")
HYPE_EMOTE_RE = re.compile(r"kekw|lul|omegalul|pog|icant|kek|laugh|hype|fire|w\b", re.I)


def message_hype_score(content: str) -> float:
    """Tek bir mesajın 'hype' katkısını hesaplar."""
    if not content:
        return 0.0
    score = 0.0
    for pattern, weight in HYPE_PATTERNS:
        if pattern.search(content):
            score += weight
    emotes = EMOTE_RE.findall(content)
    for name in emotes:
        score += 1.0 if HYPE_EMOTE_RE.search(name) else 0.4
    # BÜYÜK HARF bağırışı
    stripped = EMOTE_RE.sub("", content)
    letters = [c for c in stripped if c.isalpha()]
    if len(letters) >= 5:
        upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
        if upper_ratio > 0.8:
            score += 0.8
    return score


@dataclass
class ChatSignal:
    bucket_s: float
    counts: np.ndarray            # mesaj sayısı / pencere
    hype: np.ndarray              # hype puanı / pencere
    unique_senders: np.ndarray    # farklı kullanıcı / pencere
    raw: np.ndarray               # birleşik ham skor
    z: np.ndarray                 # dayanıklı z-skoru (yumuşatılmış)
    messages: list = field(default_factory=list, repr=False)

    def top_messages(self, start_s: float, end_s: float, k: int = 5) -> list[dict]:
        """Pencere içindeki en dikkat çekici mesajları döndürür (rapor için)."""
        window = [m for m in self.messages if start_s <= m.offset_s <= end_s]
        window.sort(key=lambda m: message_hype_score(m.content), reverse=True)
        out = []
        for m in window[:k]:
            text = EMOTE_RE.sub(lambda g: f":{g.group(1)}:", m.content).strip()
            if text:
                out.append({"t": round(m.offset_s, 1), "user": m.username, "text": text[:120]})
        return out


def analyze_chat(messages: list[ChatMessage], duration_s: float, bucket_s: float = 5.0) -> Optional[ChatSignal]:
    """Mesaj listesini pencereli sinyale dönüştürür. Mesaj yoksa None."""
    if not messages or duration_s <= 0:
        return None
    n = max(1, math.ceil(duration_s / bucket_s))
    counts = np.zeros(n)
    hype = np.zeros(n)
    senders: list[set] = [set() for _ in range(n)]

    for m in messages:
        b = int(m.offset_s // bucket_s)
        if 0 <= b < n:
            counts[b] += 1
            hype[b] += message_hype_score(m.content)
            if m.username:
                senders[b].add(m.username)

    uniq = np.array([len(s) for s in senders], dtype=float)
    raw = counts + 1.5 * hype + 0.5 * uniq
    z = robust_z(smooth(raw, 3))
    return ChatSignal(bucket_s=bucket_s, counts=counts, hype=hype,
                      unique_senders=uniq, raw=raw, z=z, messages=list(messages))


def smooth(x: np.ndarray, k: int = 3) -> np.ndarray:
    if len(x) < k or k <= 1:
        return x.astype(float)
    kernel = np.ones(k) / k
    return np.convolve(x.astype(float), kernel, mode="same")


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
