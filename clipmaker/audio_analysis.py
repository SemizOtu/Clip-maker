"""Ses enerjisinden heyecan sinyali çıkarımı.

Önemli olan yalnızca "yüksek ses" (intro müziği, sabit ortam gürültüsü
de yüksektir) değil, "ani ses değişimi"dir: yayıncının birden bağırması,
gülmesi, ortamın patlaması. Bu yüzden mutlak RMS düzeyine ek olarak,
yerel ortalamanın üzerine çıkan ani sıçramayı (onset/novelty) ölçer ve
ikisini birleştiririz.
"""
from __future__ import annotations

import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from clipmaker.chat_analysis import robust_z, rolling_baseline, smooth


@dataclass
class AudioSignal:
    bucket_s: float
    rms: np.ndarray
    novelty: np.ndarray           # yerel ortalamanın üzerine çıkan ani sıçrama
    z: np.ndarray


def compute_rms(wav_path: Path, bucket_s: float = 5.0) -> Optional[AudioSignal]:
    """WAV dosyasını pencere pencere okuyup RMS + yenilik sinyalini hesaplar."""
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
    # yenilik: ~30 sn'lik yerel ortalamanın üzerine çıkan pozitif sıçrama
    baseline = rolling_baseline(rms, win=max(5, int(round(30.0 / bucket_s))))
    novelty = np.clip(rms - baseline, 0.0, None)
    # mutlak düzey + yenilik (yenilik baskın); tek normalleştirme
    combined = smooth(rms, 3) + 1.6 * novelty
    z = robust_z(combined)
    return AudioSignal(bucket_s=bucket_s, rms=rms, novelty=novelty, z=z)
