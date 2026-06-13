"""Sinyal birleştirme ve öne çıkan an seçimi."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from clipmaker.audio_analysis import AudioSignal
from clipmaker.chat_analysis import ChatSignal


@dataclass
class Highlight:
    rank: int
    peak_s: float
    start_s: float
    end_s: float
    score: float
    chat_z: float = 0.0
    audio_z: float = 0.0
    top_messages: list = field(default_factory=list)


def combine_signals(
    duration_s: float,
    bucket_s: float,
    chat: Optional[ChatSignal] = None,
    audio: Optional[AudioSignal] = None,
    chat_weight: float = 0.6,
    audio_weight: float = 0.4,
    agreement_weight: float = 0.7,
) -> np.ndarray:
    """Chat ve ses z-skorlarını tek skora indirger.

    İki bileşen:
      1) Ağırlıklı toplam — her sinyalin tek başına katkısı.
      2) Uzlaşma bonusu — hem chat'in hem sesin AYNI ANDA yükseldiği anlar
         gerçek komik/çarpıcı anlardır. Yalnızca müzik (ses var, chat yok)
         ya da yalnızca selamlaşma spam'i (chat var, ses yok) bu bonusu
         alamaz; ikisinin pozitif kısımlarının geometrik ortalaması eklenir.

    Sinyallerden biri yoksa ağırlıklar kalan sinyale aktarılır, bonus 0 olur.
    """
    n = max(1, math.ceil(duration_s / bucket_s))

    def fit(z: np.ndarray) -> np.ndarray:
        if len(z) >= n:
            return z[:n]
        return np.pad(z, (0, n - len(z)))

    w_chat = chat_weight if chat is not None else 0.0
    w_audio = audio_weight if audio is not None else 0.0
    total = w_chat + w_audio
    if total <= 0:
        raise ValueError("En az bir sinyal (chat ya da ses) gerekli.")

    cz = fit(chat.z) if chat is not None else np.zeros(n)
    az = fit(audio.z) if audio is not None else np.zeros(n)

    score = (w_chat / total) * cz + (w_audio / total) * az
    if chat is not None and audio is not None and agreement_weight > 0:
        agree = np.sqrt(np.clip(cz, 0.0, None) * np.clip(az, 0.0, None))
        score = score + agreement_weight * agree
    return score


def pick_highlights(
    score: np.ndarray,
    bucket_s: float,
    duration_s: float,
    num_clips: int = 5,
    clip_duration: float = 45.0,
    pre_peak_ratio: float = 0.35,
    min_gap_s: Optional[float] = None,
    min_z: float = 0.3,
) -> list[Highlight]:
    """Skor dizisinden çakışmayan en iyi N anı seçer.

    min_z: ilk klip her halükârda seçilir; sonrakiler için skor bu eşiğin
    altına düşerse durulur (zorla sönük an klipi üretmemek için).
    """
    order = np.argsort(score)[::-1]
    chosen: list[Highlight] = []
    if min_gap_s is None:
        min_gap_s = clip_duration * 1.2

    for idx in order:
        if len(chosen) >= num_clips:
            break
        peak = _refine_peak(score, int(idx), bucket_s)
        if peak > duration_s:
            continue
        if any(abs(peak - h.peak_s) < min_gap_s for h in chosen):
            continue
        s = float(score[idx])
        if chosen and s < min_z:
            break
        start = peak - pre_peak_ratio * clip_duration
        start = max(0.0, min(start, max(0.0, duration_s - clip_duration)))
        end = min(duration_s, start + clip_duration)
        chosen.append(Highlight(
            rank=len(chosen) + 1,
            peak_s=peak,
            start_s=start,
            end_s=end,
            score=s,
        ))
    return chosen


def _refine_peak(score: np.ndarray, idx: int, bucket_s: float) -> float:
    """Komşu pencerelere parabol oturtarak zirveyi pencere-altı çözer.

    Skor zirvesi tam pencere ortasında olmayabilir; üç noktalı parabol
    interpolasyonu ile gerçek tepe noktasına daha iyi yaklaşırız.
    """
    center = float(idx) + 0.5
    if 0 < idx < len(score) - 1:
        a, b, c = float(score[idx - 1]), float(score[idx]), float(score[idx + 1])
        denom = a - 2.0 * b + c
        if abs(denom) > 1e-9:
            offset = 0.5 * (a - c) / denom
            offset = max(-0.5, min(0.5, offset))
            center += offset
    return center * bucket_s


def annotate_highlights(
    highlights: list[Highlight],
    chat: Optional[ChatSignal] = None,
    audio: Optional[AudioSignal] = None,
) -> None:
    """Rapor için her klibe sinyal detaylarını işler."""
    for h in highlights:
        if chat is not None:
            b = min(int(h.peak_s // chat.bucket_s), len(chat.z) - 1)
            h.chat_z = round(float(chat.z[b]), 2)
            h.top_messages = chat.top_messages(h.start_s, h.end_s)
        if audio is not None:
            b = min(int(h.peak_s // audio.bucket_s), len(audio.z) - 1)
            h.audio_z = round(float(audio.z[b]), 2)


def fmt_ts(seconds: float) -> str:
    s = int(max(0, seconds))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"
