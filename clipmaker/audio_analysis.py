"""Ses enerjisinden heyecan sinyali çıkarımı.

Yayıncının bağırması, gülmesi ya da ortamın hareketlenmesi ses enerjisinde
(RMS) ani sıçramalar yaratır. WAV pencerelere bölünür, RMS hesaplanır ve
dayanıklı z-skoru alınır.
"""
from __future__ import annotations

import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from clipmaker.chat_analysis import robust_z, smooth


@dataclass
class AudioSignal:
    bucket_s: float
    rms: np.ndarray
    z: np.ndarray


def compute_rms(wav_path: Path, bucket_s: float = 5.0) -> Optional[AudioSignal]:
    """WAV dosyasını pencere pencere okuyup RMS enerjisini hesaplar."""
    try:
        with wave.open(str(wav_path), "rb") as w:
            sr = w.getframerate()
            sampwidth = w.getsampwidth()
            nframes = w.getnframes()
            if nframes == 0 or sampwidth != 2:
                return None
            frames_per_bucket = max(1, int(sr * bucket_s))
            values = []
            while True:
                raw = w.readframes(frames_per_bucket)
                if not raw:
                    break
                data = np.frombuffer(raw, dtype=np.int16).astype(np.float64)
                if data.size == 0:
                    break
                values.append(float(np.sqrt(np.mean(np.square(data / 32768.0)))))
    except (wave.Error, EOFError, FileNotFoundError):
        return None

    if not values:
        return None
    rms = np.array(values)
    z = robust_z(smooth(rms, 3))
    return AudioSignal(bucket_s=bucket_s, rms=rms, z=z)
