"""highlights.json + REPORT.md çıktıları."""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from clipmaker.config import Settings
from clipmaker.highlights import Highlight, fmt_ts
from clipmaker.kick_api import VodInfo


def write_report(
    workdir: Path,
    vod: VodInfo,
    highlights: list[Highlight],
    clip_files: dict[int, dict],
    settings: Settings,
) -> tuple[Path, Path]:
    """JSON ve Markdown raporları yazar; (json_yolu, md_yolu) döndürür."""
    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "vod": {
            "uuid": vod.uuid,
            "title": vod.title,
            "channel": vod.channel_slug,
            "duration_s": vod.duration_s,
            "started_at": vod.started_at.isoformat() if vod.started_at else None,
            "url": f"https://kick.com/{vod.channel_slug}/videos/{vod.uuid}" if vod.channel_slug else None,
        },
        "settings": {
            "num_clips": settings.num_clips,
            "clip_duration": settings.clip_duration,
            "bucket_s": settings.bucket_s,
            "chat_weight": settings.chat_weight,
            "audio_weight": settings.audio_weight,
        },
        "highlights": [
            {**asdict(h), "start_ts": fmt_ts(h.start_s), "end_ts": fmt_ts(h.end_s),
             "peak_ts": fmt_ts(h.peak_s), "files": clip_files.get(h.rank, {})}
            for h in highlights
        ],
    }
    json_path = workdir / "highlights.json"
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"# Klip Raporu — {vod.title or vod.uuid}",
        "",
        f"- **Kanal:** {vod.channel_slug}",
        f"- **VOD:** https://kick.com/{vod.channel_slug}/videos/{vod.uuid}" if vod.channel_slug else f"- **VOD UUID:** {vod.uuid}",
        f"- **Süre:** {fmt_ts(vod.duration_s or 0)}",
        f"- **Üretim zamanı:** {data['generated_at']}",
        "",
    ]

    used_rich = any((h.ai_score is not None) or h.title for h in highlights)
    if used_rich:
        lines += [
            "| # | Zaman | Kategori | Başlık | Gerekçe |",
            "|---|-------|----------|--------|---------|",
        ]
        for h in highlights:
            title = (h.title or "—").replace("|", "\\|")
            note = (h.reason or (f"AI {h.ai_score:.0f}/100" if h.ai_score is not None else "—")).replace("|", "\\|")
            lines.append(
                f"| {h.rank} | {fmt_ts(h.start_s)}–{fmt_ts(h.end_s)} "
                f"| {h.category or '—'} | {title} | {note} |"
            )
        lines += [
            "",
            "> **Başlık**lar paylaşım için önerilen metinlerdir (videoya basılmaz); "
            "klibi atarken açıklama/başlık olarak kullanabilirsiniz.",
            "",
            "## Klip detayları",
            "",
        ]
        for h in highlights:
            lines.append(f"### {h.rank}. {h.title or fmt_ts(h.start_s)}  ({h.category or '—'})")
            lines.append(f"- **Zaman:** {fmt_ts(h.start_s)}–{fmt_ts(h.end_s)}")
            if h.reason:
                lines.append(f"- **Neden seçildi:** {h.reason}")
            if h.transcript:
                lines.append(f"- **Konuşma:** {h.transcript[:300]}")
            msgs = "; ".join(f"{m['user']}: {m['text']}" for m in h.top_messages[:3])
            if msgs:
                lines.append(f"- **Chat:** {msgs}")
            lines.append("")
    else:
        lines += [
            "| # | Zaman | Zirve | Skor | Chat | Ses | Öne çıkan mesajlar |",
            "|---|-------|-------|------|------|-----|--------------------|",
        ]
        for h in highlights:
            msgs = "; ".join(f"{m['user']}: {m['text']}" for m in h.top_messages[:3]) or "—"
            msgs = msgs.replace("|", "\\|")
            lines.append(
                f"| {h.rank} | {fmt_ts(h.start_s)}–{fmt_ts(h.end_s)} | {fmt_ts(h.peak_s)} "
                f"| {h.score:.2f} | {h.chat_z:.1f} | {h.audio_z:.1f} | {msgs} |"
            )
    lines += ["", "## Dosyalar", ""]
    for h in highlights:
        files = clip_files.get(h.rank, {})
        for kind, path in files.items():
            lines.append(f"- Klip {h.rank} ({kind}): `{path}`")
    md_path = workdir / "REPORT.md"
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path
