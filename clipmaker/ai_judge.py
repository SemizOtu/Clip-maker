"""Yapay zeka jürisi: aday anları içeriğe göre puanlar.

Sinyal analizi (chat + ses) yalnızca "hareketli" anı bulur; ama hareketli
her zaman komik/ilgi çekici değildir. Bu modül, her aday anın KONUŞMASINI
(transcript) ve CHAT TEPKİLERİNİ bir dil modeline (LLM) okutarak "bu klip
gerçekten komik / çarpıcı / eğlenceli mi?" sorusunu yanıtlatır ve 0-100
puanlar; ayrıca kategori ve paylaşıma hazır bir başlık üretir.

Sağlayıcılar (otomatik seçim sırası):
  1. Claude API  — ANTHROPIC_API_KEY varsa (en iyi kalite)
  2. Ollama      — localhost'ta çalışıyorsa (ücretsiz, yerel)
  3. (yok)       — jüri devre dışı, sinyal sıralaması kullanılır
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional

DEFAULT_CLAUDE_MODEL = "claude-opus-4-8"
DEFAULT_OLLAMA_MODEL = "llama3.1"
OLLAMA_URL = "http://localhost:11434"

SYSTEM_PROMPT = (
    "Sen viral klip yapan deneyimli bir editörsün. Bir Kick yayınından çıkarılmış "
    "aday anları değerlendirip SADECE gerçekten paylaşmaya değer olanları seçeceksin. "
    "Çok SEÇİCİ ol — bir izleyici akışı kaydırırken DURDURACAK kadar iyi olmayan her "
    "şey çöptür.\n\n"
    "Sana her aday için o anda KONUŞULANLAR (transcript) ve CHAT TEPKİLERİ verilir. "
    "Önce KONUŞMAYA bak: yayıncı komik/şaşırtıcı/etkileyici bir şey mi söyledi/yaptı? "
    "Sonra chat'in nasıl tepki verdiğine bak (gülme, şok, 'klip', 'OHA').\n\n"
    "Puanlama (acımasız ol, çoğu aday DÜŞÜK almalı):\n"
    "- 85-100: NET bir şekilde komik, şok edici, dramatik ya da etkileyici. Tek başına "
    "izlenince bile güldürür/şaşırtır. (iyi bir espri/laf sokma, beklenmedik olay, "
    "komik fail, clutch/insanüstü oyun, duygusal/dramatik an, çarpıcı bir itiraf/hikaye)\n"
    "- 50-84: ilginç ama sıra dışı değil; ortalama.\n"
    "- 0-49: SIKICI. Düz muhabbet, oyun beklerken, ayar yaparken, donation okurken, "
    "selamlaşma, sponsor, teknik konuşma, anlamı kopuk/yarım cümle, tek kelimelik tepki.\n\n"
    "Örnekler:\n"
    "- YÜKSEK (92): Yayıncı bir şeye çok komik bir tepki verir, chat 'KEKW HAHAHA "
    "klip' diye akar.\n"
    "- YÜKSEK (88): Beklenmedik bir jumpscare, yayıncı bağırır, chat 'OHA korktu'.\n"
    "- DÜŞÜK (15): 'evet abi bir saniye', 'şimdi şuraya bakalım', sessiz oynanış, "
    "takip bildirimi okuma.\n\n"
    "KURALLAR:\n"
    "- Sadece yüksek ses ya da yoğun chat YÜKSEK PUAN DEĞİLDİR; içerik anlamlı olmalı.\n"
    "- Takip/abone/düello/raid/bağış/sponsor bildirimleri ve boş selamlaşma KLİP DEĞİLDİR.\n"
    "- Transcript boş/anlamsızsa ve chat de güçlü değilse düşük puan ver.\n"
    "- Aynı anların kopyasını seçme; çeşitlilik iyidir.\n\n"
    "Her aday için: kısa ve dürüst (clickbait olmayan, abartısız) bir Türkçe başlık ve "
    "kategori (komik | çarpıcı | dramatik | yetenek | tepki | bilgi | diğer) üret. "
    "reason alanına neden o puanı verdiğini tek cümleyle yaz."
)

# Yapılandırılmış çıktı şeması (Claude output_config.format için)
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "score": {"type": "integer"},
                    "category": {"type": "string"},
                    "title": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["index", "score", "category", "title", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["clips"],
    "additionalProperties": False,
}


@dataclass
class Candidate:
    index: int
    start_ts: str
    end_ts: str
    transcript: str
    chat: list  # [{"user","text"}]
    chat_z: float = 0.0
    audio_z: float = 0.0


@dataclass
class Verdict:
    index: int
    score: float          # 0-100
    category: str = ""
    title: str = ""
    reason: str = ""


def _intensity(z: float) -> str:
    if z >= 3.0:
        return "çok yüksek"
    if z >= 1.5:
        return "yüksek"
    if z >= 0.5:
        return "orta"
    return "düşük"


def build_user_prompt(candidates: list[Candidate], num_clips: int) -> str:
    lines = [
        f"Aşağıda bir yayından {len(candidates)} aday an var. En iyi {num_clips} "
        "tanesini seçeceğiz. ACIMASIZ ve seçici ol — sıkıcı anlara düşük puan ver. "
        "Her adayı puanla ve JSON döndür.\n",
    ]
    for c in candidates:
        lines.append(f"--- Aday {c.index} ({c.start_ts}–{c.end_ts}) | "
                     f"chat tepkisi: {_intensity(c.chat_z)}, ses tepkisi: {_intensity(c.audio_z)} ---")
        transcript = c.transcript.strip() or "(konuşma metni yok)"
        lines.append(f"KONUŞMA: {transcript[:1500]}")
        if c.chat:
            msgs = " | ".join(f"{m['user']}: {m['text']}" for m in c.chat[:15])
            lines.append(f"CHAT: {msgs[:1200]}")
        else:
            lines.append("CHAT: (kayda değer tepki yok)")
        lines.append("")
    lines.append(
        "Her aday için index, score (0-100 tam sayı), category, title (kısa Türkçe "
        "başlık), reason (tek cümle gerekçe) ver."
    )
    return "\n".join(lines)


def _coerce_verdicts(raw: dict, valid_indexes: set[int]) -> list[Verdict]:
    out: list[Verdict] = []
    items = raw.get("clips") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        try:
            idx = int(it.get("index"))
        except (TypeError, ValueError):
            continue
        if idx not in valid_indexes:
            continue
        try:
            score = float(it.get("score", 0))
        except (TypeError, ValueError):
            score = 0.0
        out.append(Verdict(
            index=idx,
            score=max(0.0, min(100.0, score)),
            category=str(it.get("category") or "").strip(),
            title=str(it.get("title") or "").strip(),
            reason=str(it.get("reason") or "").strip(),
        ))
    return out


def _extract_json(text: str) -> Optional[dict]:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # kod bloğu ya da metin içine gömülü JSON'u kurtarmayı dene
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    return None


# ---- sağlayıcılar ----

class ClaudeJudge:
    name = "Claude API"

    def __init__(self, model: Optional[str] = None):
        self.model = model or DEFAULT_CLAUDE_MODEL

    def judge(self, candidates: list[Candidate], num_clips: int) -> list[Verdict]:
        import anthropic  # lazımken yüklenir
        client = anthropic.Anthropic()  # ANTHROPIC_API_KEY ortamdan
        user_prompt = build_user_prompt(candidates, num_clips)
        valid = {c.index for c in candidates}

        # Tercih edilen yol: yapılandırılmış çıktı + uyarlanır düşünme
        kwargs_full = dict(
            model=self.model,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
            thinking={"type": "adaptive"},
            output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
        )
        for attempt_kwargs in (kwargs_full, _plain_kwargs(self.model, user_prompt)):
            try:
                resp = client.messages.create(**attempt_kwargs)
            except TypeError:
                continue  # SDK sürümü bu parametreleri bilmiyor; sade çağrıya düş
            except Exception as e:
                # API/anahtar/oran hatası: tek seferlik sade çağrıyı dene, olmazsa bırak
                if attempt_kwargs is kwargs_full:
                    continue
                raise AIJudgeError(f"Claude API hatası: {e}") from e
            if getattr(resp, "stop_reason", None) == "refusal":
                raise AIJudgeError("Claude isteği reddetti (refusal).")
            text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), "")
            data = _extract_json(text)
            if data is not None:
                return _coerce_verdicts(data, valid)
        raise AIJudgeError("Claude yanıtı çözümlenemedi.")


def _plain_kwargs(model: str, user_prompt: str) -> dict:
    """Eski SDK sürümleri için sade çağrı (JSON'u istemden ister)."""
    return dict(
        model=model,
        max_tokens=8000,
        system=SYSTEM_PROMPT + "\n\nYALNIZCA şu biçimde geçerli JSON döndür: "
        '{"clips":[{"index":int,"score":int,"category":str,"title":str,"reason":str}]}',
        messages=[{"role": "user", "content": user_prompt}],
    )


class OllamaJudge:
    def __init__(self, model: Optional[str] = None):
        self.model = model or DEFAULT_OLLAMA_MODEL

    @property
    def name(self) -> str:
        return f"Ollama: {self.model}"

    def judge(self, candidates: list[Candidate], num_clips: int) -> list[Verdict]:
        valid = {c.index for c in candidates}
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT
                 + '\nYALNIZCA şu biçimde JSON döndür: {"clips":[{"index","score","category","title","reason"}]}'},
                {"role": "user", "content": build_user_prompt(candidates, num_clips)},
            ],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.4},
        }
        try:
            req = urllib.request.Request(
                f"{OLLAMA_URL}/api/chat",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=600) as r:
                body = json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            raise AIJudgeError(f"Ollama hatası: {e}") from e
        content = (body.get("message") or {}).get("content", "")
        data = _extract_json(content)
        if data is None:
            raise AIJudgeError("Ollama yanıtı çözümlenemedi.")
        return _coerce_verdicts(data, valid)


class AIJudgeError(RuntimeError):
    pass


# ---- sağlayıcı seçimi ----

def claude_available() -> bool:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    try:
        import anthropic  # noqa: F401
        return True
    except ImportError:
        return False


def ollama_models() -> list[str]:
    """Ollama'da kurulu modellerin adlarını döndürür (yoksa [])."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=3.0) as r:
            data = json.loads(r.read().decode("utf-8"))
        return [str(m.get("name", "")) for m in data.get("models", []) if m.get("name")]
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return []


def ollama_available() -> bool:
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=2.0) as r:
            return r.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


# Türkçe mizah/değerlendirme için tercih sırası (kurulu olan ilk eşleşme seçilir)
OLLAMA_PREFERENCE = ["qwen2.5", "qwen3", "gemma2", "llama3.1", "qwen2", "mistral",
                     "llama3.2", "llama3", "gemma"]


def pick_ollama_model(installed: list[str]) -> str:
    """Kurulu modeller arasından en iyi olduğu düşünüleni seçer."""
    if not installed:
        return DEFAULT_OLLAMA_MODEL
    bases: dict[str, str] = {}
    for full in installed:
        base = full.split(":")[0]
        bases.setdefault(base, full)
    for pref in OLLAMA_PREFERENCE:
        if pref in bases:
            return bases[pref]
    return installed[0]


def _ollama_judge() -> "OllamaJudge":
    return OllamaJudge(pick_ollama_model(ollama_models()))


def select_judge(backend: str, model: Optional[str] = None):
    """backend: auto|claude|ollama|off -> jüri nesnesi ya da (None, sebep)."""
    backend = (backend or "auto").lower()
    if backend == "off":
        return None, "yapay zeka kapalı (--ai off)"
    if backend == "claude":
        if claude_available():
            return ClaudeJudge(model), None
        return None, "ANTHROPIC_API_KEY tanımlı değil ya da 'anthropic' kurulu değil"
    if backend == "ollama":
        if ollama_available():
            return (OllamaJudge(model) if model else _ollama_judge()), None
        return None, "Ollama localhost:11434'te çalışmıyor"
    # auto
    if claude_available():
        return ClaudeJudge(model), None
    if ollama_available():
        return (OllamaJudge(model) if model else _ollama_judge()), None
    return None, ("ne ANTHROPIC_API_KEY ne de yerel Ollama bulundu; "
                  "sinyal sıralaması kullanılacak")
