"""İzleyici kliplerinden 'en iyi an' seçimi.

İzleyiciler yayın sırasında en iyi/komik anları kendileri kliplediği için,
bu klipler 'paylaşmaya değer an' için en güvenilir sinyaldir — gerçek insan
kararı, üstelik izlenme sayısıyla popülerlik sıralaması. Bu modül, kanalın
kliplerini VOD zaman çizgisine eşler, üst üste binenleri birleştirir ve
popülerliğe göre sıralar.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from clipmaker.kick_api import Clip

MIN_CLIP_LEN = 18.0
MAX_CLIP_LEN = 75.0
MERGE_GAP_S = 20.0


@dataclass
class ClipMoment:
    offset_s: float       # VOD başlangıcına göre saniye
    duration_s: float
    views: int            # birleşen kliplerin toplam izlenmesi
    likes: int
    count: int            # kaç izleyici klibi bu anı kapsıyor
    title: str
    top_views: int        # en çok izlenen tek klibin izlenmesi (başlık seçimi için)


def map_clips_to_vod(
    clips: list[Clip],
    vod_started_at: Optional[datetime],
    vod_duration_s: Optional[float],
) -> list[ClipMoment]:
    """Klipleri started_at'e göre VOD zaman penceresine eşler (dışındakiler elenir)."""
    out: list[ClipMoment] = []
    if vod_started_at is None:
        return out
    for c in clips:
        if c.started_at is None:
            continue
        off = (c.started_at - vod_started_at).total_seconds()
        if off < -5.0:
            continue
        if vod_duration_s and off > vod_duration_s + 5.0:
            continue
        off = max(0.0, off)
        dur = c.duration_s if c.duration_s and c.duration_s > 3 else 30.0
        out.append(ClipMoment(offset_s=off, duration_s=dur, views=max(0, c.views),
                              likes=max(0, c.likes), count=1,
                              title=c.title, top_views=max(0, c.views)))
    return out


def cluster_moments(moments: list[ClipMoment], merge_gap_s: float = MERGE_GAP_S) -> list[ClipMoment]:
    """Üst üste binen / yakın klipleri tek ana birleştirir (toplam izlenme = güç)."""
    if not moments:
        return []
    ms = sorted(moments, key=lambda m: m.offset_s)
    merged: list[ClipMoment] = [_clone(ms[0])]
    for m in ms[1:]:
        last = merged[-1]
        last_end = last.offset_s + last.duration_s
        if m.offset_s <= last_end + merge_gap_s:
            new_end = max(last_end, m.offset_s + m.duration_s)
            last.duration_s = new_end - last.offset_s
            last.views += m.views
            last.likes += m.likes
            last.count += m.count
            if m.top_views > last.top_views:
                last.top_views = m.top_views
                last.title = m.title
        else:
            merged.append(_clone(m))
    return merged


def select_clip_moments(
    clips: list[Clip],
    vod_started_at: Optional[datetime],
    vod_duration_s: Optional[float],
    num_clips: int,
) -> list[ClipMoment]:
    """En popüler, çakışmayan izleyici-klip anlarını döndürür (en fazla num_clips)."""
    mapped = map_clips_to_vod(clips, vod_started_at, vod_duration_s)
    merged = cluster_moments(mapped)
    # popülerlik: önce toplam izlenme, sonra klip sayısı
    merged.sort(key=lambda m: (m.views, m.count, m.likes), reverse=True)
    chosen = merged[:num_clips]
    for m in chosen:
        m.duration_s = max(MIN_CLIP_LEN, min(MAX_CLIP_LEN, m.duration_s))
    return chosen


def _clone(m: ClipMoment) -> ClipMoment:
    return ClipMoment(offset_s=m.offset_s, duration_s=m.duration_s, views=m.views,
                      likes=m.likes, count=m.count, title=m.title, top_views=m.top_views)
