"""Uçtan uca akış: VOD çöz -> chat + ses analizi -> an seç -> klip üret."""
from __future__ import annotations

import json
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from clipmaker.audio_analysis import AudioSignal, compute_rms
from clipmaker.chat_analysis import ChatSignal, analyze_chat
from clipmaker.config import Settings
from clipmaker.highlights import (Highlight, annotate_highlights,
                                  combine_signals, fmt_ts, pick_highlights)
from clipmaker.kick_api import (ChatMessage, KickAPIError, KickClient,
                                VodInfo, resolve_source_via_ytdlp)
from clipmaker.media import (MediaError, cut_clip, extract_analysis_audio,
                             ffprobe_duration, make_thumbnail, make_vertical,
                             parse_master_playlist, pick_analysis_source,
                             pick_variant, require_ffmpeg)
from clipmaker.report import write_report


def log(msg: str) -> None:
    print(msg, flush=True)


def run_pipeline(settings: Settings) -> int:
    try:
        require_ffmpeg()
    except MediaError as e:
        log(f"HATA: {e}")
        return 1

    if settings.subtitles:
        from clipmaker.subtitles import whisper_available
        if not whisper_available():
            log("  ! UYARI: --subtitles istendi ama 'faster-whisper' kurulu değil; "
                "altyazı eklenmeyecek.")
            log("    Kurmak için: pip install faster-whisper")

    client = KickClient()

    # 1) VOD bilgisi
    log(f"[1/6] VOD çözülüyor: {settings.url}")
    try:
        vod = client.resolve_vod(settings.url, pick_index=settings.pick_index)
    except KickAPIError as e:
        log(f"  ! Kick API hatası: {e}")
        if settings.m3u8_override:
            vod = _vod_from_override(settings)
        else:
            src = resolve_source_via_ytdlp(settings.url)
            if src:
                log("  > Kaynak yt-dlp ile çözüldü (chat analizi yapılamayacak).")
                vod = _vod_from_override(settings, source=src)
            else:
                return 1
    if settings.m3u8_override:
        vod.source_url = settings.m3u8_override
    if not vod.source_url:
        log("HATA: VOD için video kaynağı (m3u8) bulunamadı.")
        return 1

    log(f"  Kanal : {vod.channel_slug or '?'}")
    log(f"  Başlık: {vod.title or '?'}")

    # 2) Varyant seçimi + süre doğrulama
    log("[2/6] Video kaynağı hazırlanıyor...")
    best_source, analysis_source = _resolve_sources(client, vod, settings)
    duration = _resolve_duration(vod, best_source, settings)
    if duration is None:
        log("HATA: VOD süresi belirlenemedi.")
        return 1
    vod.duration_s = duration
    analysis_duration = duration
    if settings.limit_minutes:
        analysis_duration = min(duration, settings.limit_minutes * 60.0)
        log(f"  Analiz ilk {fmt_ts(analysis_duration)} ile sınırlandı.")
    log(f"  VOD süresi: {fmt_ts(duration)}")

    workdir = _make_workdir(settings, vod)
    cache_dir = workdir / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    log(f"  Çalışma klasörü: {workdir}")

    # 3) Chat analizi
    chat_signal: Optional[ChatSignal] = None
    if settings.use_chat:
        log("[3/6] Chat tekrarı alınıyor...")
        messages = _fetch_chat_cached(client, vod, analysis_duration, cache_dir)
        if messages:
            chat_signal = analyze_chat(messages, analysis_duration, settings.bucket_s,
                                       lag_s=settings.chat_lag_s)
            log(f"  {len(messages)} mesaj analiz edildi.")
        else:
            log("  ! Chat verisi alınamadı; yalnızca ses sinyali kullanılacak.")
    else:
        log("[3/6] Chat analizi atlandı (--no-chat).")

    # 4) Ses analizi
    audio_signal: Optional[AudioSignal] = None
    if settings.use_audio:
        log("[4/6] Ses indiriliyor ve analiz ediliyor (uzun yayınlarda zaman alabilir)...")
        audio_signal = _analyze_audio_cached(analysis_source, analysis_duration, cache_dir, settings)
        if audio_signal is None:
            log("  ! Ses analizi başarısız; yalnızca chat sinyali kullanılacak.")
    else:
        log("[4/6] Ses analizi atlandı (--no-audio).")

    if chat_signal is None and audio_signal is None:
        log("HATA: Hiçbir sinyal üretilemedi (chat de ses de yok). Klip seçimi imkânsız.")
        return 1

    # 5) Aday havuzu + (varsa) yapay zeka jürisiyle seçim
    log("[5/6] Öne çıkan anlar hesaplanıyor...")
    score = combine_signals(
        analysis_duration, settings.bucket_s,
        chat=chat_signal, audio=audio_signal,
        chat_weight=settings.chat_weight, audio_weight=settings.audio_weight,
        agreement_weight=settings.agreement_weight,
    )

    from clipmaker.ai_judge import select_judge
    judge, why_no_ai = select_judge(settings.ai_backend, settings.ai_model)
    use_ai = judge is not None

    # Yapay zeka açıksa jürinin seçebilmesi için geniş bir aday havuzu üret
    pool_n = settings.num_clips
    if use_ai:
        auto_pool = max(settings.num_clips * 3, settings.num_clips + 6)
        pool_n = settings.judge_pool if settings.judge_pool > 0 else min(auto_pool, 24)

    candidates = pick_highlights(
        score, settings.bucket_s, analysis_duration,
        num_clips=pool_n,
        clip_duration=settings.clip_duration,
        pre_peak_ratio=settings.pre_peak_ratio,
        min_gap_s=settings.clip_duration * settings.min_gap_factor,
        min_z=(-1e9 if use_ai else 0.3),   # AI modunda havuzu daraltma
    )
    annotate_highlights(candidates, chat=chat_signal, audio=audio_signal)
    if not candidates:
        log("HATA: Öne çıkan an bulunamadı.")
        return 1

    if use_ai:
        highlights = _ai_select(judge, candidates, analysis_source, cache_dir, settings)
    else:
        log(f"  Yapay zeka jürisi devre dışı ({why_no_ai}); sinyal sıralaması kullanılıyor.")
        highlights = candidates[:settings.num_clips]
        for i, h in enumerate(highlights, 1):
            h.rank = i

    for h in highlights:
        if h.ai_score is not None:
            log(f"  #{h.rank}  {fmt_ts(h.start_s)}–{fmt_ts(h.end_s)}  "
                f"AI={h.ai_score:.0f} [{h.category}] {h.title or '—'}")
        else:
            log(f"  #{h.rank}  {fmt_ts(h.start_s)}–{fmt_ts(h.end_s)}  skor={h.score:.2f}"
                f"  (chat z={h.chat_z}, ses z={h.audio_z})")

    # 6) Klip üretimi
    clip_files: dict[int, dict] = {}
    if settings.analyze_only:
        log("[6/6] Klip kesimi atlandı (--analyze-only).")
    else:
        log("[6/6] Klipler kesiliyor...")
        clip_files = _produce_clips(best_source, vod, highlights, workdir, settings)

    json_path, md_path = write_report(workdir, vod, highlights, clip_files, settings)
    log("")
    log("Bitti! Çıktılar:")
    log(f"  Rapor : {md_path}")
    log(f"  JSON  : {json_path}")
    for rank in sorted(clip_files):
        for kind, p in clip_files[rank].items():
            log(f"  Klip {rank} ({kind}): {p}")
    return 0


# ---- yapay zeka jürisi ----

def _ai_select(judge, candidates: list[Highlight], analysis_source: str,
               cache_dir: Path, settings: Settings) -> list[Highlight]:
    """Adayları yazıya döküp jüriye sunar, en iyi N tanesini döndürür."""
    from clipmaker.ai_judge import AIJudgeError, Candidate as AICand
    from clipmaker.transcribe import transcribe_window, transcription_available

    do_tx = settings.transcribe and transcription_available()
    if settings.transcribe and not transcription_available():
        log("  ! Konuşma yazıya dökme atlandı (faster-whisper kurulu değil); "
            "jüri yalnızca chat tepkilerine bakacak.")

    transcripts = _load_transcripts(cache_dir)
    # Konuşmayı uzaktan değil, önceden indirilen yerel ses dosyasından kes (hızlı/güvenli)
    local_wav = cache_dir / "audio.wav"
    local_wav = local_wav if local_wav.exists() else None
    if do_tx:
        log(f"  Konuşmalar yazıya dökülüyor ({len(candidates)} aday, "
            f"model={settings.transcribe_model})...")
    ai_cands: list = []
    for i, h in enumerate(candidates, 1):
        key = f"{round(h.start_s, 1)}"
        tx = transcripts.get(key, "")
        if do_tx and not tx:
            # Tüm klibi değil, zirvenin etrafındaki ~30 sn'yi çevir (hız)
            tw_start = max(h.start_s, h.peak_s - 15.0)
            tw_dur = max(5.0, min(h.end_s, tw_start + 30.0) - tw_start)
            t0 = time.time()
            tx = transcribe_window(analysis_source, tw_start, tw_dur,
                                   cache_dir, settings.language, settings.transcribe_model,
                                   local_wav=local_wav)
            transcripts[key] = tx
            log(f"    aday {i}/{len(candidates)} ({fmt_ts(h.start_s)}) "
                f"yazıya döküldü [{time.time() - t0:.0f} sn]")
        h.transcript = tx
        ai_cands.append(AICand(
            index=h.rank, start_ts=fmt_ts(h.start_s), end_ts=fmt_ts(h.end_s),
            transcript=tx,
            chat=[{"user": m["user"], "text": m["text"]} for m in h.top_messages],
            chat_z=h.chat_z, audio_z=h.audio_z,
        ))
    if do_tx:
        _save_transcripts(cache_dir, transcripts)

    log(f"  Yapay zeka jürisi ({judge.name}) {len(ai_cands)} adayı değerlendiriyor...")
    try:
        verdicts = judge.judge(ai_cands, settings.num_clips)
    except AIJudgeError as e:
        log(f"  ! Yapay zeka jürisi başarısız: {e}")
        log("  > Sinyal sıralamasına dönülüyor.")
        chosen = candidates[:settings.num_clips]
        for i, h in enumerate(chosen, 1):
            h.rank = i
        return chosen

    vmap = {v.index: v for v in verdicts}
    for h in candidates:
        v = vmap.get(h.rank)
        if v is not None:
            h.ai_score, h.category, h.title, h.reason = v.score, v.category, v.title, v.reason
        else:
            h.ai_score = 0.0  # jüri puanlamadıysa en sona düşsün
    ranked = sorted(candidates, key=lambda h: (h.ai_score or 0.0), reverse=True)
    chosen = ranked[:settings.num_clips]
    for i, h in enumerate(chosen, 1):
        h.rank = i
    return chosen


def _load_transcripts(cache_dir: Path) -> dict:
    f = cache_dir / "transcripts.json"
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def _save_transcripts(cache_dir: Path, transcripts: dict) -> None:
    (cache_dir / "transcripts.json").write_text(
        json.dumps(transcripts, ensure_ascii=False), encoding="utf-8")


# ---- yardımcılar ----

def _vod_from_override(settings: Settings, source: Optional[str] = None) -> VodInfo:
    from clipmaker.kick_api import parse_vod_url
    try:
        kind, value = parse_vod_url(settings.url)
    except KickAPIError:
        kind, value = "video", "manual"
    return VodInfo(
        uuid=value if kind == "video" else "manual",
        title="(API'siz mod)",
        source_url=source or settings.m3u8_override,
        channel_slug=value if kind == "channel" else "",
    )


def _resolve_sources(client: KickClient, vod: VodInfo, settings: Settings) -> tuple[str, str]:
    """(klip kaynağı, analiz kaynağı) — master playlist'ten varyant seçer."""
    master = vod.source_url or ""
    if not master.startswith(("http://", "https://")):
        return master, master  # yerel dosya / elle verilen kaynak
    try:
        text = client.get_text(master)
        playlist = parse_master_playlist(text, master)
        best = pick_variant(playlist, settings.quality, master)
        analysis = pick_analysis_source(playlist, master)
        n = len(playlist.get("variants") or [])
        if n:
            log(f"  {n} kalite varyantı bulundu.")
        return best, analysis
    except KickAPIError:
        # Playlist'i kendimiz çekemiyorsak ffmpeg'in master'ı işlemesine bırak
        return master, master


def _resolve_duration(vod: VodInfo, source: str, settings: Settings) -> Optional[float]:
    probed = ffprobe_duration(source)
    if probed and probed > 1:
        if vod.duration_s and abs(probed - vod.duration_s) / probed > 0.05:
            log(f"  Süre ffprobe ile düzeltildi: {fmt_ts(vod.duration_s)} -> {fmt_ts(probed)}")
        return probed
    return vod.duration_s


def _make_workdir(settings: Settings, vod: VodInfo) -> Path:
    name = f"{vod.channel_slug or 'vod'}_{vod.uuid[:8]}"
    d = settings.out_dir / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def _fetch_chat_cached(
    client: KickClient, vod: VodInfo, duration_s: float, cache_dir: Path,
) -> list[ChatMessage]:
    cache_file = cache_dir / "chat.json"
    if cache_file.exists():
        try:
            raw = json.loads(cache_file.read_text(encoding="utf-8"))
            if raw.get("duration_s", 0) >= duration_s - 1:
                log("  Chat önbellekten yüklendi.")
                return [ChatMessage(**m) for m in raw["messages"]]
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

    if vod.channel_id is None or vod.started_at is None:
        log("  ! Kanal kimliği ya da yayın başlangıcı bilinmiyor; chat atlanıyor.")
        return []

    last_print = [0.0]

    def progress(done: float, count: int) -> None:
        if time.time() - last_print[0] > 5:
            last_print[0] = time.time()
            log(f"    chat taraması %{done * 100:.0f} — {count} mesaj")

    try:
        messages = client.fetch_chat(vod.channel_id, vod.started_at, duration_s, progress=progress)
    except KickAPIError as e:
        log(f"  ! Chat alınamadı: {e}")
        return []

    cache_file.write_text(
        json.dumps({"duration_s": duration_s,
                    "messages": [asdict(m) for m in messages]}, ensure_ascii=False),
        encoding="utf-8",
    )
    return messages


def _analyze_audio_cached(
    source: str, duration_s: float, cache_dir: Path, settings: Settings,
) -> Optional[AudioSignal]:
    wav = cache_dir / "audio.wav"
    meta = cache_dir / "audio.json"
    cached_ok = False
    if wav.exists() and meta.exists():
        try:
            m = json.loads(meta.read_text())
            cached_ok = m.get("duration_s", 0) >= duration_s - 1
        except json.JSONDecodeError:
            pass
    if not cached_ok:
        try:
            extract_analysis_audio(source, wav, limit_s=duration_s)
            meta.write_text(json.dumps({"duration_s": duration_s}))
        except MediaError as e:
            log(f"  ! Ses indirilemedi: {e}")
            return None
    else:
        log("  Ses önbellekten yüklendi.")
    return compute_rms(wav, settings.bucket_s)


def _produce_clips(
    source: str, vod: VodInfo, highlights: list[Highlight],
    workdir: Path, settings: Settings,
) -> dict[int, dict]:
    clip_files: dict[int, dict] = {}
    for h in highlights:
        files: dict[str, str] = {}
        stem = f"clip_{h.rank:02d}_{fmt_ts(h.start_s).replace(':', '-')}"
        try:
            raw_h = workdir / "clips" / f"{stem}.mp4"
            cut_clip(source, h.start_s, h.end_s - h.start_s, raw_h)
            log(f"  Klip {h.rank}: kesildi ({fmt_ts(h.start_s)}–{fmt_ts(h.end_s)})")

            # Altyazıyı bir kez üret; hem yatay hem dikeyde kullan
            srt = _make_srt(raw_h, workdir, stem, settings) if settings.subtitles else None

            # Yatay sürüm (istenirse altyazı gömülü)
            horizontal_final = raw_h
            if settings.horizontal:
                if srt is not None:
                    horizontal_final = _burn(raw_h, srt, workdir / "clips" / f"{stem}_altyazili.mp4",
                                             vertical=False) or raw_h
                    files["yatay (altyazılı)" if horizontal_final != raw_h else "yatay"] = str(horizontal_final)
                else:
                    files["yatay"] = str(raw_h)

            # Dikey 9:16 sürüm — altyazı burada büyük, alt-orta stille gömülür
            if settings.vertical:
                vertical_path = workdir / "clips" / "vertical" / f"{stem}_dikey.mp4"
                # Yapay zeka başlığı videoya basılmaz (uzun/garip olabilir); raporda
                # "önerilen başlık" olarak verilir. Yalnızca kullanıcı --title verirse bindir.
                make_vertical(raw_h, vertical_path, title=settings.title)
                if srt is not None:
                    subbed = _burn(vertical_path, srt,
                                   workdir / "clips" / "vertical" / f"{stem}_dikey_altyazili.mp4",
                                   vertical=True)
                    if subbed is not None:
                        vertical_path = subbed
                        files["dikey (altyazılı)"] = str(vertical_path)
                    else:
                        files["dikey"] = str(vertical_path)
                else:
                    files["dikey"] = str(vertical_path)
                log(f"  Klip {h.rank}: dikey (9:16) versiyon hazır"
                    + (" + altyazı" if srt is not None else ""))

            thumb = workdir / "thumbnails" / f"{stem}.jpg"
            make_thumbnail(horizontal_final, thumb, at_s=min(2.0, (h.end_s - h.start_s) / 2))
            files["kapak"] = str(thumb)
        except MediaError as e:
            log(f"  ! Klip {h.rank} üretilemedi: {e}")
        clip_files[h.rank] = files
    return clip_files


def _make_srt(clip_path: Path, workdir: Path, stem: str, settings: Settings) -> Optional[Path]:
    from clipmaker.subtitles import generate_srt
    srt = generate_srt(clip_path, workdir / "subtitles" / f"{stem}.srt",
                       language=settings.language, model_size=settings.whisper_model)
    if srt is None:
        log("  ! Altyazı üretilemedi (faster-whisper kurulu değil ya da konuşma yok).")
    return srt


def _burn(clip_path: Path, srt: Path, out_path: Path, vertical: bool) -> Optional[Path]:
    from clipmaker.subtitles import VERTICAL_STYLE, burn_subtitles
    try:
        return burn_subtitles(clip_path, srt, out_path,
                              style=VERTICAL_STYLE if vertical else None)
    except MediaError as e:
        log(f"  ! Altyazı gömülemedi: {e}")
        return None


def list_channel_vods(url: str) -> int:
    """--list: kanalın VOD'larını numaralı tablo halinde yazdırır."""
    from clipmaker.kick_api import parse_vod_url
    client = KickClient()
    kind, value = parse_vod_url(url)
    if kind != "channel":
        log("--list yalnızca kanal bağlantısıyla kullanılır (örn. https://kick.com/kanaladi).")
        return 1
    try:
        vods = client.list_videos(value)
    except KickAPIError as e:
        log(f"HATA: {e}")
        return 1
    if not vods:
        log(f"'{value}' kanalında VOD bulunamadı.")
        return 1
    log(f"'{value}' kanalındaki VOD'lar (en yeni üstte):")
    for i, v in enumerate(vods):
        started = v.started_at.strftime("%Y-%m-%d %H:%M") if v.started_at else "?"
        dur = fmt_ts(v.duration_s) if v.duration_s else "?"
        log(f"  [{i}] {started}  {dur}  {v.title[:70]}")
    log("")
    log("Seçim için: python -m clipmaker <kanal-linki> --pick <numara>")
    return 0
