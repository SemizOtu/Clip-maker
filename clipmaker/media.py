"""ffmpeg/ffprobe yardımcıları: indirme, kesme, dikey dönüştürme, kapak karesi."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

from clipmaker.kick_api import USER_AGENT


class MediaError(RuntimeError):
    pass


def require_ffmpeg() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise MediaError(
                f"'{tool}' bulunamadı. Kurulum: https://ffmpeg.org/download.html "
                "(Ubuntu/Debian: sudo apt install ffmpeg, macOS: brew install ffmpeg, "
                "Windows: winget install ffmpeg)"
            )


def http_input_args(source: str) -> list[str]:
    """HLS/HTTP girdiler için tarayıcı gibi görünen başlıklar."""
    if not str(source).startswith(("http://", "https://")):
        return []
    return [
        "-user_agent", USER_AGENT,
        "-headers", "Referer: https://kick.com/\r\nOrigin: https://kick.com\r\n",
    ]


def run_ffmpeg(args: list[str], tool: str = "ffmpeg", timeout: Optional[float] = None,
               cwd: Optional[str] = None) -> str:
    cmd = [tool, "-hide_banner", "-loglevel", "error"] + args
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    except subprocess.TimeoutExpired:
        raise MediaError(
            f"{tool} {timeout:.0f} sn içinde yanıt vermedi (muhtemelen uzaktaki "
            f"kaynağa erişim takıldı).\nKomut: {' '.join(cmd)}"
        )
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-8:]
        raise MediaError(f"{tool} hata verdi:\n" + "\n".join(tail) + f"\nKomut: {' '.join(cmd)}")
    return proc.stdout


def ffprobe_duration(source: str) -> Optional[float]:
    """Kaynağın süresini saniye olarak döndürür (başarısızsa None)."""
    try:
        out = run_ffmpeg(
            http_input_args(source)
            + ["-show_entries", "format=duration", "-of", "json", "-i", source],
            tool="ffprobe",
        )
        dur = json.loads(out).get("format", {}).get("duration")
        return float(dur) if dur else None
    except (MediaError, ValueError, json.JSONDecodeError):
        return None


# ---- HLS master playlist ----

def parse_master_playlist(text: str, base_url: str) -> dict:
    """Master m3u8 içinden video varyantlarını ve ses kanallarını çıkarır.

    Dönen yapı: {"variants": [{"bandwidth": int, "resolution": str, "url": str}],
                 "audio": [url, ...]}
    Varyantlar bant genişliğine göre artan sıralıdır.
    """
    variants: list[dict] = []
    audio: list[str] = []
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for i, line in enumerate(lines):
        if line.startswith("#EXT-X-MEDIA:") and "TYPE=AUDIO" in line:
            m = re.search(r'URI="([^"]+)"', line)
            if m:
                audio.append(urljoin(base_url, m.group(1)))
        elif line.startswith("#EXT-X-STREAM-INF:"):
            bw = re.search(r"BANDWIDTH=(\d+)", line)
            res = re.search(r"RESOLUTION=(\d+x\d+)", line)
            # URI bir sonraki yorum-olmayan satırdır
            for nxt in lines[i + 1:]:
                if not nxt.startswith("#"):
                    variants.append({
                        "bandwidth": int(bw.group(1)) if bw else 0,
                        "resolution": res.group(1) if res else "",
                        "url": urljoin(base_url, nxt),
                    })
                    break
    variants.sort(key=lambda v: v["bandwidth"])
    return {"variants": variants, "audio": audio}


def pick_variant(playlist: dict, quality: str, master_url: str) -> str:
    """quality='best'|'worst' için uygun varyant URL'si (yoksa master)."""
    variants = playlist.get("variants") or []
    if not variants:
        return master_url
    return (variants[-1] if quality == "best" else variants[0])["url"]


def pick_analysis_source(playlist: dict, master_url: str) -> str:
    """Analiz için en düşük bant genişlikli kaynak (varsa salt-ses kanalı)."""
    if playlist.get("audio"):
        return playlist["audio"][0]
    return pick_variant(playlist, "worst", master_url)


# ---- klip üretimi ----

def cut_clip(source: str, start_s: float, duration_s: float, out_path: Path,
             normalize_audio: bool = True) -> Path:
    """Kaynaktan (m3u8 ya da yerel dosya) paylaşıma hazır MP4 keser.

    -ss'in -i'den önce gelmesi HLS'te yalnızca gerekli segmentlerin
    indirilmesini sağlar. Anahtar kare hizası için yeniden kodlanır.
    normalize_audio: sosyal medya için ses yüksekliğini standartlaştırır
    (loudnorm -16 LUFS) — klipler ne çok kısık ne çok yüksek olsun.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    audio_args = ["-c:a", "aac", "-b:a", "160k"]
    if normalize_audio:
        audio_args = ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] + audio_args
    run_ffmpeg(
        ["-y"]
        + http_input_args(source)
        + ["-ss", f"{max(0.0, start_s):.3f}", "-i", source, "-t", f"{duration_s:.3f}",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
        + audio_args
        + ["-movflags", "+faststart", "-avoid_negative_ts", "make_zero",
           str(out_path)]
    )
    return out_path


def burn_ass(clip_path: Path, ass_path: Path, out_path: Path) -> Path:
    """ASS (karaoke) altyazıyı videoya gömer.

    Windows'ta filtre yolundaki ':' sorununu aşmak için ffmpeg, ASS dosyasının
    bulunduğu klasörde (cwd) çalıştırılır ve filtreye yalnızca dosya adı verilir.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(
        ["-y", "-i", str(clip_path.resolve()),
         "-vf", f"ass={ass_path.name}",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
         "-c:a", "copy", "-movflags", "+faststart",
         str(out_path.resolve())],
        cwd=str(ass_path.parent.resolve()),
    )
    return out_path


def _drawtext_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\\\'").replace("%", "\\%")


def escape_font_path(path: str) -> str:
    """drawtext fontfile yolu için: ters bölü -> '/', sürücü iki noktası kaçışlı.

    Windows'ta 'C:/Windows/Fonts/arialbd.ttf' filtre içinde 'C' ve geri kalanı
    ayrı seçenekler sanılır; 'C\\:/Windows/...' biçimi gerekir.
    """
    return path.replace("\\", "/").replace(":", "\\:")


def find_font() -> Optional[str]:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arialbd.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None


def make_vertical(clip_path: Path, out_path: Path, title: Optional[str] = None) -> Path:
    """Yatay klibi 1080x1920 dikey formata çevirir (bulanık arka planlı).

    TikTok / Instagram Reels / YouTube Shorts için hazır çıktı üretir.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    base = (
        "[0:v]split=2[bg][fg];"
        "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,gblur=sigma=25,eq=brightness=-0.08[bgb];"
        "[fg]scale=1080:-2[fgs];"
        "[bgb][fgs]overlay=(W-w)/2:(H-h)/2"
    )

    def _run(filters: str) -> None:
        run_ffmpeg([
            "-y", "-i", str(clip_path),
            "-filter_complex", filters,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
            "-c:a", "copy", "-movflags", "+faststart",
            str(out_path),
        ])

    font = find_font()
    if title and font:
        # Windows'ta font yolundaki 'C:' iki noktası filtre ayıracı sanılır;
        # ters bölüleri '/' yapıp iki noktayı kaçışlamak gerekir.
        font_arg = escape_font_path(font)
        drawtext = (
            f",drawtext=fontfile={font_arg}:text='{_drawtext_escape(title)}'"
            ":fontsize=58:fontcolor=white:borderw=4:bordercolor=black@0.7"
            ":x=(w-text_w)/2:y=150"
        )
        try:
            _run(base + drawtext)
            return out_path
        except MediaError:
            pass  # başlık bindirme başarısız -> başlıksız üret (klip kaybolmasın)
    _run(base)
    return out_path


def make_thumbnail(clip_path: Path, out_path: Path, at_s: float = 1.0) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg([
        "-y", "-ss", f"{at_s:.2f}", "-i", str(clip_path),
        "-frames:v", "1", "-q:v", "3", str(out_path),
    ])
    return out_path


def extract_analysis_audio(
    source: str,
    out_wav: Path,
    limit_s: Optional[float] = None,
    sample_rate: int = 16000,
) -> Path:
    """Analiz için tüm yayının sesini WAV olarak indirir.

    16 kHz: hem RMS analizi hem de jürinin konuşma tanıması (Whisper'ın doğal
    örnekleme hızı) için kullanılır — böylece transcript çok daha doğru olur.
    """
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    args = ["-y"] + http_input_args(source) + ["-i", source]
    if limit_s:
        args += ["-t", f"{limit_s:.1f}"]
    args += ["-vn", "-ac", "1", "-ar", str(sample_rate), "-c:a", "pcm_s16le", str(out_wav)]
    run_ffmpeg(args)
    return out_wav


def extract_audio_segment(
    source: str,
    out_wav: Path,
    start_s: float,
    dur_s: float,
    sample_rate: int = 16000,
) -> Path:
    """Kaynaktan tek bir zaman penceresinin sesini WAV olarak çıkarır.

    Konuşma tanıma (Whisper) için 16 kHz mono kullanılır. -ss'in -i'den önce
    gelmesi HLS'te yalnızca gerekli kısmın indirilmesini sağlar.
    """
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(
        ["-y"]
        + http_input_args(source)
        + ["-ss", f"{max(0.0, start_s):.3f}", "-i", source, "-t", f"{dur_s:.3f}",
           "-vn", "-ac", "1", "-ar", str(sample_rate), "-c:a", "pcm_s16le", str(out_wav)],
        timeout=180,
    )
    return out_wav


def slice_wav(src_wav: Path, out_wav: Path, start_s: float, dur_s: float) -> Path:
    """Yerel bir WAV dosyasından zaman penceresini anında keser (ağ yok, ffmpeg yok).

    Aday anların konuşmasını yazıya dökerken, sesi uzaktan yeniden indirmek
    yerine önceden indirilmiş analiz WAV'ından kesmek için kullanılır.
    """
    import wave

    out_wav.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(src_wav), "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        sw = w.getsampwidth()
        nframes = w.getnframes()
        start_frame = max(0, min(int(start_s * sr), nframes))
        w.setpos(start_frame)
        data = w.readframes(max(0, int(dur_s * sr)))
    with wave.open(str(out_wav), "wb") as o:
        o.setnchannels(ch)
        o.setsampwidth(sw)
        o.setframerate(sr)
        o.writeframes(data)
    return out_wav

