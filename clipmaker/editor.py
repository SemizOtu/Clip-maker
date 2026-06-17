"""Klip editörü: kullanıcının yüklediği klibi sosyal medyaya hazır hale getirir.

Otomatik klip bulma yok — sen bir video dosyası verirsin, sistem onu:
  1. (istersen) baştan/sondan kırpar; birden çok dosya verirsen birleştirir (montaj),
  2. sesini normalize eder (loudnorm, -16 LUFS),
  3. konuşmasını kelime kelime yazıya döküp KARAOKE altyazı üretir,
  4. 9:16 dikey (ve istenirse 1:1 kare / 16:9 yatay) formatlara çevirip altyazıyı gömer,
  5. kapak görseli + paylaşım için önerilen başlık/etiket metni üretir.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from clipmaker.config import Settings
from clipmaker.media import (MediaError, ffprobe_duration, make_reframe,
                             make_thumbnail, require_ffmpeg, run_ffmpeg)

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv", ".ts", ".m2ts", ".wmv"}

FORMAT_DIMS = {
    "vertical": (1080, 1920),    # TikTok / Reels / Shorts
    "square": (1080, 1080),      # Instagram akış
    "horizontal": (1920, 1080),  # YouTube / Twitter
}
FORMAT_LABEL = {"vertical": "dikey 9:16", "square": "kare 1:1", "horizontal": "yatay 16:9"}


def log(msg: str) -> None:
    print(msg, flush=True)


def is_video_file(arg: str) -> bool:
    p = Path(arg)
    return p.suffix.lower() in VIDEO_EXTS or (p.exists() and p.is_file())


def parse_timestamp(value) -> Optional[float]:
    """'90', '1:30', '01:02:03' veya saniye -> saniye (float)."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if re.fullmatch(r"\d+(\.\d+)?", s):
        return float(s)
    parts = s.split(":")
    try:
        parts = [float(p) for p in parts]
    except ValueError:
        return None
    sec = 0.0
    for p in parts:
        sec = sec * 60 + p
    return sec


def run_editor(inputs: list[Path], settings: Settings) -> int:
    try:
        require_ffmpeg()
    except MediaError as e:
        log(f"HATA: {e}")
        return 1

    inputs = [Path(p) for p in inputs]
    missing = [p for p in inputs if not p.exists()]
    if missing:
        log("HATA: Şu dosya(lar) bulunamadı:")
        for p in missing:
            log(f"  - {p}")
        return 1

    name = inputs[0].stem
    workdir = settings.out_dir / f"{name}_hazir"
    cache = workdir / "_ara"
    cache.mkdir(parents=True, exist_ok=True)
    log(f"Çalışma klasörü: {workdir}")

    # 1) Hazırlık: birleştir (montaj) + kırp + ses normalizasyonu -> work.mp4
    log("[1/4] Klip hazırlanıyor (birleştirme/kırpma/ses normalizasyonu)...")
    work = cache / "work.mp4"
    try:
        _prepare(inputs, work, settings)
    except MediaError as e:
        log(f"HATA: Klip hazırlanamadı:\n{e}")
        return 1
    dur = ffprobe_duration(str(work)) or 0.0
    log(f"  Hazır klip süresi: {dur:.1f} sn")

    # 2) Karaoke altyazı için kelime zaman damgaları
    words: list = []
    if settings.captions:
        from clipmaker.captions import captions_available, transcribe_words
        if captions_available():
            log(f"[2/4] Konuşma yazıya dökülüyor (karaoke altyazı, model={settings.caption_model})...")
            words = transcribe_words(work, settings.language, settings.caption_model)
            if not words:
                log("  ! Konuşma bulunamadı; altyazısız devam edilecek.")
            else:
                log(f"  {len(words)} kelime yakalandı.")
        else:
            log("[2/4] Altyazı atlandı: faster-whisper kurulu değil "
                "(pip install faster-whisper). Kapatmak için --no-captions.")
    else:
        log("[2/4] Altyazı kapalı (--no-captions).")

    # 3) Formatları üret (dikey/kare/yatay) + altyazı göm
    log("[3/4] Formatlar üretiliyor...")
    outputs: dict[str, Path] = {}
    formats = [f for f in settings.formats if f in FORMAT_DIMS] or ["vertical"]
    for fmt in formats:
        try:
            outputs[fmt] = _produce_format(work, fmt, words, workdir, settings)
            log(f"  {FORMAT_LABEL[fmt]} hazır: {outputs[fmt].name}")
        except MediaError as e:
            log(f"  ! {FORMAT_LABEL[fmt]} üretilemedi: {e}")

    if not outputs:
        log("HATA: Hiçbir format üretilemedi.")
        return 1

    # 4) Kapak + önerilen paylaşım metni
    log("[4/4] Kapak ve paylaşım metni hazırlanıyor...")
    thumb = workdir / "kapak.jpg"
    try:
        primary = outputs.get("vertical") or next(iter(outputs.values()))
        make_thumbnail(primary, thumb, at_s=min(2.0, dur / 2))
    except MediaError:
        thumb = None
    caption_txt = _write_caption_text(workdir, words, settings)

    log("")
    log("Bitti! Paylaşıma hazır dosyalar:")
    for fmt, p in outputs.items():
        log(f"  {FORMAT_LABEL[fmt]}: {p}")
    if thumb:
        log(f"  kapak: {thumb}")
    log(f"  paylaşım metni: {caption_txt}")
    return 0


# ---- iç adımlar ----

def _prepare(inputs: list[Path], out: Path, settings: Settings) -> None:
    """Girdileri tek bir normalize edilmiş çalışma klibine indirger."""
    audio_filter = "loudnorm=I=-16:TP=-1.5:LRA=11" if settings.normalize_audio else None
    venc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
    aenc = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]

    if len(inputs) == 1:
        a = inputs[0]
        args = ["-y"]
        if settings.trim_start:
            args += ["-ss", f"{settings.trim_start:.3f}"]
        args += ["-i", str(a)]
        if settings.trim_end is not None:
            length = settings.trim_end - (settings.trim_start or 0.0)
            if length > 0:
                args += ["-t", f"{length:.3f}"]
        if audio_filter:
            args += ["-af", audio_filter]
        args += venc + aenc + ["-movflags", "+faststart", str(out)]
        run_ffmpeg(args)
        return

    # Birden çok klip -> 1080p'ye normalize edip birleştir (montaj)
    args = ["-y"]
    for a in inputs:
        args += ["-i", str(a)]
    n = len(inputs)
    fc = ""
    for i in range(n):
        fc += (f"[{i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
               f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v{i}];")
        fc += f"[{i}:a]aresample=48000[a{i}];"
    fc += "".join(f"[v{i}][a{i}]" for i in range(n))
    fc += f"concat=n={n}:v=1:a=1[vc][ac]"
    aout = ["[ac]"]
    if audio_filter:
        fc += f";[ac]{audio_filter}[an]"
        aout = ["[an]"]
    args += ["-filter_complex", fc, "-map", "[vc]", "-map", aout[0]]
    args += venc + aenc + ["-movflags", "+faststart", str(out)]
    run_ffmpeg(args)


def _produce_format(work: Path, fmt: str, words: list, workdir: Path,
                    settings: Settings) -> Path:
    from clipmaker.captions import write_ass
    from clipmaker.media import burn_ass

    W, H = FORMAT_DIMS[fmt]
    reframed = workdir / f"_{fmt}_ham.mp4"
    make_reframe(work, reframed, W, H, title=settings.title)

    final = workdir / f"{fmt}.mp4"
    if words:
        ass = write_ass(words, workdir / f"_{fmt}.ass", play_w=W, play_h=H)
        if ass is not None:
            try:
                burn_ass(reframed, ass, final)
                reframed.unlink(missing_ok=True)
                return final
            except MediaError:
                pass
    reframed.rename(final)
    return final


def _write_caption_text(workdir: Path, words: list, settings: Settings) -> Path:
    """Paylaşım için önerilen başlık + etiket metni (düzenlenebilir)."""
    transcript = " ".join(w["word"] for w in words).strip()
    title = settings.title or _first_sentence(transcript) or "Öne çıkan an"
    tags = "#kick #klip #shorts #reels #fyp #keşfet"
    lines = [
        "# Paylaşım için önerilen metin (istediğin gibi düzenle)",
        "",
        f"Başlık: {title}",
        "",
        f"Etiketler: {tags}",
    ]
    if transcript:
        lines += ["", "Konuşma dökümü:", transcript[:800]]
    out = workdir / "paylasim_metni.txt"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out


def _first_sentence(text: str, max_words: int = 10) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    words = text.split()
    return " ".join(words[:max_words])
