"""Aday anların konuşmasını yazıya döker (faster-whisper).

Yapay zeka jürisinin "ne konuşuluyor"u anlayabilmesi için her aday anın
sesini metne çevirir. Tüm yayını değil, yalnızca aday pencereleri işler;
bu yüzden hızlıdır. faster-whisper kurulu değilse boş metin döner ve jüri
yalnızca chat tepkilerine bakar.

Kurulum: pip install faster-whisper
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from clipmaker.media import MediaError, extract_audio_segment, slice_wav

_model_cache: dict = {}


def transcription_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def _get_model(model_size: str):
    if model_size not in _model_cache:
        from faster_whisper import WhisperModel  # type: ignore
        _model_cache[model_size] = WhisperModel(model_size, device="auto", compute_type="int8")
    return _model_cache[model_size]


def transcribe_window(
    source: str,
    start_s: float,
    dur_s: float,
    work_dir: Path,
    language: str = "tr",
    model_size: str = "small",
    local_wav: Optional[Path] = None,
) -> str:
    """Verilen pencerenin konuşmasını metne çevirir. Başarısızsa "" döner.

    local_wav verilmişse (önceden indirilmiş analiz sesi) pencere bu yerel
    dosyadan anında kesilir — uzaktaki kaynağa erişilmez (hız + güvenilirlik).
    Yoksa kaynaktan ffmpeg ile (zaman aşımlı) çıkarılır.
    """
    if not transcription_available():
        return ""
    seg = work_dir / "seg.wav"
    try:
        if local_wav is not None and Path(local_wav).exists():
            slice_wav(Path(local_wav), seg, start_s, dur_s)
        else:
            extract_audio_segment(source, seg, start_s, dur_s, sample_rate=16000)
    except (MediaError, OSError, EOFError):
        return ""
    try:
        model = _get_model(model_size)
        segments, _info = model.transcribe(str(seg), language=language, vad_filter=True)
        parts = [s.text.strip() for s in segments if s.text and s.text.strip()]
        return " ".join(parts).strip()
    except Exception:
        return ""
    finally:
        try:
            seg.unlink(missing_ok=True)
        except OSError:
            pass
