"""Kelime kelime hareketli (karaoke) altyazı üretimi — sosyal medya klipleri için.

Paylaşıma hazır kliplerin olmazsa olmazı: büyük, ortada, konuşulan kelimenin
vurgulandığı altyazı (sessiz akışta bile izlenebilsin). Final kliplerin yüksek
kaliteli sesinden faster-whisper ile KELİME zaman damgaları çıkarılır ve bir
ASS altyazı dosyası üretilir; ffmpeg bunu videoya gömer.

faster-whisper kurulu değilse boş döner (klip altyazısız üretilir).
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

# Dikey klip çözünürlüğü (make_vertical ile aynı)
PLAY_W, PLAY_H = 1080, 1920

_ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial,{fontsize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{outline},2,2,80,80,{marginv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

# Aktif (konuşulan) kelime rengi: parlak sarı (ASS &Hbbggrr)
ACTIVE = r"{\c&H00FFFF&\fscx112\fscy112}"
NORMAL = r"{\c&HFFFFFF&\fscx100\fscy100}"

MAX_WORDS_PER_LINE = 4
MAX_CHARS_PER_LINE = 24
GAP_NEW_LINE_S = 1.0


def captions_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def transcribe_words(
    media_path: Path,
    language: str = "tr",
    model_size: str = "base",
) -> list[dict]:
    """Klibin yüksek kaliteli sesinden KELİME zaman damgaları çıkarır.

    [{"word": str, "start": float, "end": float}, ...] döndürür; yoksa [].
    """
    if not captions_available():
        return []
    try:
        from clipmaker.transcribe import _get_model
        model = _get_model(model_size)
        segments, _info = model.transcribe(
            str(media_path), language=language, vad_filter=True, word_timestamps=True)
        out: list[dict] = []
        for seg in segments:
            for w in (getattr(seg, "words", None) or []):
                token = (w.word or "").strip()
                if not token or w.start is None or w.end is None:
                    continue
                out.append({"word": token, "start": float(w.start), "end": float(w.end)})
        return out
    except Exception:
        return []


def _ass_time(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int(round((t - int(t)) * 100))
    if cs == 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_escape(s: str) -> str:
    return s.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ").strip()


def _chunk_words(words: list[dict]) -> list[list[dict]]:
    """Kelimeleri ekran satırlarına böler (kelime/karakter sayısı + zaman boşluğu)."""
    chunks: list[list[dict]] = []
    cur: list[dict] = []
    cur_chars = 0
    for w in words:
        tok = _ass_escape(w["word"])
        if not tok:
            continue
        gap = (w["start"] - cur[-1]["end"]) if cur else 0.0
        if cur and (len(cur) >= MAX_WORDS_PER_LINE
                    or cur_chars + len(tok) + 1 > MAX_CHARS_PER_LINE
                    or gap > GAP_NEW_LINE_S):
            chunks.append(cur)
            cur, cur_chars = [], 0
        cur.append({"word": tok, "start": w["start"], "end": w["end"]})
        cur_chars += len(tok) + 1
    if cur:
        chunks.append(cur)
    return chunks


def build_ass(words: list[dict], play_w: int = PLAY_W, play_h: int = PLAY_H) -> str:
    """Kelime-zamanlı listeden karaoke ASS altyazısı üretir (vurgulu aktif kelime).

    Font boyu ve alt boşluk hedef çözünürlüğe göre ölçeklenir; böylece dikey,
    kare ve yatay formatların hepsinde okunaklı görünür.
    """
    fontsize = max(24, round(play_h * 0.040))   # 1920 -> ~76
    marginv = max(40, round(play_h * 0.155))     # 1920 -> ~298
    outline = max(2, round(play_h * 0.0026))     # 1920 -> ~5
    lines = [_ASS_HEADER.format(w=play_w, h=play_h, fontsize=fontsize,
                                marginv=marginv, outline=outline)]
    for chunk in _chunk_words(words):
        for j, w in enumerate(chunk):
            start = w["start"]
            end = chunk[j + 1]["start"] if j + 1 < len(chunk) else w["end"]
            if end <= start:
                end = start + 0.3
            rendered = []
            for k, ww in enumerate(chunk):
                if k == j:
                    rendered.append(ACTIVE + ww["word"] + NORMAL)
                else:
                    rendered.append(ww["word"])
            text = NORMAL + " ".join(rendered)
            lines.append(
                f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Cap,,0,0,0,,{text}"
            )
    return "\n".join(lines) + "\n"


def write_ass(words: list[dict], out_path: Path,
              play_w: int = PLAY_W, play_h: int = PLAY_H) -> Optional[Path]:
    """ASS dosyasını yazar; konuşma yoksa None döner."""
    if not words:
        return None
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(build_ass(words, play_w=play_w, play_h=play_h), encoding="utf-8")
    return out_path
