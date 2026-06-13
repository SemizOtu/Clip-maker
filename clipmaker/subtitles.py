"""Opsiyonel otomatik altyazı (faster-whisper gerektirir).

Kurulum: pip install faster-whisper

Altyazı, klibin sesinden otomatik yazıya dökülür ve videonun üzerine
gömülür. Dikey (9:16) kliplerde sosyal medya stilinde büyük, alt-orta
yazı kullanılır.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from clipmaker.media import run_ffmpeg

# Yatay klipler: alta yakın, orta boy
HORIZONTAL_STYLE = "FontSize=18,Bold=1,Outline=2,Shadow=1,Alignment=2,MarginV=40"
# Dikey (9:16) klipler: büyük, alttan yukarıda, kalın dış hat (Reels/Shorts/TikTok)
VERTICAL_STYLE = (
    "FontSize=22,Bold=1,Outline=4,Shadow=1,Alignment=2,MarginV=300,"
    "PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000"
)


def whisper_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def _fmt_srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def generate_srt(
    clip_path: Path,
    srt_path: Path,
    language: str = "tr",
    model_size: str = "small",
) -> Optional[Path]:
    """Klibi yazıya döker, SRT üretir. faster-whisper yoksa None döner."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        return None

    model = WhisperModel(model_size, device="auto", compute_type="int8")
    segments, _info = model.transcribe(str(clip_path), language=language, vad_filter=True)

    lines = []
    for i, seg in enumerate(segments, start=1):
        text = seg.text.strip()
        if not text:
            continue
        lines.append(f"{i}\n{_fmt_srt_time(seg.start)} --> {_fmt_srt_time(seg.end)}\n{text}\n")
    if not lines:
        return None
    srt_path.parent.mkdir(parents=True, exist_ok=True)
    srt_path.write_text("\n".join(lines), encoding="utf-8")
    return srt_path


def burn_subtitles(
    clip_path: Path,
    srt_path: Path,
    out_path: Path,
    style: Optional[str] = None,
    audio_codec: str = "copy",
) -> Path:
    """SRT altyazıyı klibin üzerine gömer.

    style: libass force_style dizgesi. None ise yatay stil kullanılır.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # subtitles filtresi yol içindeki ':' ve '\' karakterlerine duyarlıdır
    srt_escaped = str(srt_path).replace("\\", "/").replace(":", "\\:")
    style = style or HORIZONTAL_STYLE
    run_ffmpeg([
        "-y", "-i", str(clip_path),
        "-vf", f"subtitles='{srt_escaped}':force_style='{style}'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-c:a", audio_codec, "-movflags", "+faststart",
        str(out_path),
    ])
    return out_path
