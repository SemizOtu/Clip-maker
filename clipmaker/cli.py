"""Komut satırı arayüzü."""
from __future__ import annotations

import argparse
from pathlib import Path

from clipmaker import __version__
from clipmaker.config import Settings


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="clipmaker",
        description=(
            "İki kullanım: (1) KENDİ klibini sosyal medyaya hazırlar — 9:16 dikey + "
            "kelime kelime karaoke altyazı + ses normalizasyonu; (2) bir Kick VOD/kanal "
            "bağlantısı verilirse öne çıkan anları otomatik bulup klipler."
        ),
        epilog=(
            "Örnekler (kendi klibini hazırla):\n"
            "  python -m clipmaker klibim.mp4\n"
            "  python -m clipmaker klibim.mp4 --trim-start 0:05 --trim-end 0:35\n"
            "  python -m clipmaker klibim.mp4 --formats vertical,square --title \"izle bunu\"\n"
            "  python -m clipmaker parca1.mp4 parca2.mp4 parca3.mp4   # montaj (birleştir)\n"
            "\nÖrnekler (Kick'ten otomatik klip):\n"
            "  python -m clipmaker https://kick.com/kanaladi\n"
            "  python -m clipmaker https://kick.com/kanaladi --list\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("inputs", nargs="+", metavar="GİRDİ",
                   help="bir video dosyası (kendi klibin) ya da Kick VOD/kanal bağlantısı "
                        "(montaj için birden çok dosya verilebilir)")
    p.add_argument("--version", action="version", version=f"clipmaker {__version__}")

    g = p.add_argument_group("klip editörü (kendi klibini hazırla)")
    g.add_argument("--trim-start", default=None, metavar="ZAMAN",
                   help="baştan kırp (örn. 0:05 ya da 5)")
    g.add_argument("--trim-end", default=None, metavar="ZAMAN",
                   help="şuraya kadar tut (örn. 0:35 ya da 35)")
    g.add_argument("--formats", default="vertical", metavar="LİSTE",
                   help="çıktı formatları (virgülle): vertical,square,horizontal "
                        "(varsayılan: vertical)")

    g = p.add_argument_group("klip seçimi (Kick otomatik modu)")
    g.add_argument("-n", "--clips", type=int, default=5, help="üretilecek klip sayısı (varsayılan: 5)")
    g.add_argument("-d", "--duration", type=float, default=45.0, help="klip süresi, saniye (varsayılan: 45)")
    g.add_argument("--pre", type=float, default=0.35, metavar="ORAN",
                   help="klibin zirveden önce başlama oranı 0-1 (varsayılan: 0.35)")
    g.add_argument("--min-gap", type=float, default=None, metavar="SN",
                   help="iki klip arası asgari mesafe, saniye (varsayılan: süre x 1.2)")

    g = p.add_argument_group("seçim")
    g.add_argument("--no-viewer-clips", action="store_true",
                   help="izleyicilerin kestiği klipleri kullanma; doğrudan sinyal+yapay zeka moduna geç")

    g = p.add_argument_group("analiz")
    g.add_argument("--no-chat", action="store_true", help="chat analizini kapat")
    g.add_argument("--no-audio", action="store_true", help="ses analizini kapat")
    g.add_argument("--bucket", type=float, default=5.0, help="analiz penceresi, saniye (varsayılan: 5)")
    g.add_argument("--chat-weight", type=float, default=0.6, help="chat sinyali ağırlığı (varsayılan: 0.6)")
    g.add_argument("--audio-weight", type=float, default=0.4, help="ses sinyali ağırlığı (varsayılan: 0.4)")
    g.add_argument("--agreement", type=float, default=0.7, metavar="W",
                   help="chat+ses aynı anda patlarsa eklenen uzlaşma bonusu (varsayılan: 0.7)")
    g.add_argument("--chat-lag", type=float, default=4.0, metavar="SN",
                   help="chat'in olaya göre gecikmesi, saniye; klibi öne kaydırır (varsayılan: 4)")
    g.add_argument("--limit-minutes", type=float, default=None, metavar="DK",
                   help="yalnızca ilk X dakikayı analiz et (hızlı deneme için)")

    g = p.add_argument_group("yapay zeka jürisi (içeriği anlayıp en iyi anları seçer)")
    g.add_argument("--ai", choices=("auto", "claude", "ollama", "off"), default="auto",
                   help="AI motoru: auto (anahtar varsa Claude, yoksa Ollama, yoksa sinyal), "
                        "claude, ollama ya da off (varsayılan: auto)")
    g.add_argument("--ai-model", default=None, metavar="AD",
                   help="kullanılacak model (Claude varsayılanı claude-opus-4-8, "
                        "Ollama varsayılanı llama3.1)")
    g.add_argument("--no-transcribe", action="store_true",
                   help="aday anların konuşmasını yazıya dökme; jüri yalnızca chat'e baksın")
    g.add_argument("--transcribe-model", default="base", metavar="AD",
                   help="jüri için konuşma tanıma modeli: tiny (en hızlı) / base / small "
                        "(varsayılan: base; zayıf bilgisayarda 'tiny' önerilir)")
    g.add_argument("--judge-pool", type=int, default=0, metavar="N",
                   help="jüriye sunulacak aday sayısı (0 = otomatik, ~klip sayısının 3 katı)")

    g = p.add_argument_group("çıktı")
    g.add_argument("-o", "--out", type=Path, default=Path("output"), help="çıktı klasörü (varsayılan: output)")
    g.add_argument("--no-vertical", action="store_true", help="9:16 dikey versiyon üretme")
    g.add_argument("--no-horizontal", action="store_true", help="yatay versiyonu raporda gösterme")
    g.add_argument("--quality", choices=("best", "worst"), default="best",
                   help="klip kesiminde kullanılacak kalite (varsayılan: best)")
    g.add_argument("--analyze-only", action="store_true",
                   help="klip kesme; yalnızca analiz raporu üret")
    g.add_argument("--title", default=None, help="dikey klibin üstüne yazılacak başlık")

    g = p.add_argument_group("altyazı / karaoke caption (faster-whisper gerektirir, VARSAYILAN AÇIK)")
    g.add_argument("--no-captions", action="store_true",
                   help="kelime kelime hareketli altyazıyı kapat (varsayılan açık)")
    g.add_argument("--caption-model", default="base", metavar="AD",
                   help="caption için konuşma tanıma modeli: tiny/base/small/medium "
                        "(varsayılan: base; en iyi okunabilirlik için 'small')")
    g.add_argument("--lang", default="tr", help="konuşma dili (varsayılan: tr)")
    g.add_argument("--no-normalize", action="store_true",
                   help="ses yüksekliği normalizasyonunu kapat (loudnorm)")
    # Geriye dönük uyumluluk (artık caption varsayılan açık)
    g.add_argument("--subtitles", action="store_true", help=argparse.SUPPRESS)
    g.add_argument("--whisper-model", default=None, help=argparse.SUPPRESS)

    g = p.add_argument_group("kaynak seçenekleri")
    g.add_argument("--list", action="store_true", help="kanalın VOD'larını listele ve çık")
    g.add_argument("--debug-chat", action="store_true",
                   help="chat endpoint'inin ham yanıtını gösterip çık (tanı için)")
    g.add_argument("--pick", type=int, default=0, metavar="N",
                   help="kanal bağlantısında kaçıncı VOD (0 = en yeni)")
    g.add_argument("--m3u8", default=None, metavar="URL",
                   help="API çalışmazsa video kaynağını elle ver (master.m3u8 adresi)")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    first = args.inputs[0]

    # Girdi yerel video dosyası mı? -> klip editörü modu (kendi klibini hazırla)
    from clipmaker.editor import is_video_file, parse_timestamp, run_editor
    if not args.list and not args.debug_chat and is_video_file(first):
        formats = tuple(f.strip().lower() for f in (args.formats or "vertical").split(",") if f.strip())
        editor_settings = Settings(
            out_dir=args.out,
            trim_start=parse_timestamp(args.trim_start),
            trim_end=parse_timestamp(args.trim_end),
            formats=formats,
            title=args.title,
            captions=not args.no_captions,
            caption_model=args.whisper_model or args.caption_model,
            language=args.lang,
            normalize_audio=not args.no_normalize,
        )
        from pathlib import Path
        return run_editor([Path(p) for p in args.inputs], editor_settings)

    # Aksi halde: Kick VOD/kanal bağlantısı -> otomatik klip modu
    from clipmaker.pipeline import diagnose_chat, list_channel_vods, run_pipeline

    if args.list:
        return list_channel_vods(first)
    if args.debug_chat:
        return diagnose_chat(first)

    settings = Settings(
        url=first,
        m3u8_override=args.m3u8,
        pick_index=args.pick,
        num_clips=args.clips,
        clip_duration=args.duration,
        pre_peak_ratio=args.pre,
        min_gap_factor=(args.min_gap / args.duration) if args.min_gap else 1.2,
        use_viewer_clips=not args.no_viewer_clips,
        use_chat=not args.no_chat,
        use_audio=not args.no_audio,
        bucket_s=args.bucket,
        chat_weight=args.chat_weight,
        audio_weight=args.audio_weight,
        agreement_weight=args.agreement,
        chat_lag_s=args.chat_lag,
        limit_minutes=args.limit_minutes,
        ai_backend=args.ai,
        ai_model=args.ai_model,
        transcribe=not args.no_transcribe,
        transcribe_model=args.transcribe_model,
        judge_pool=args.judge_pool,
        out_dir=args.out,
        horizontal=not args.no_horizontal,
        vertical=not args.no_vertical,
        quality=args.quality,
        analyze_only=args.analyze_only,
        title=args.title,
        captions=not args.no_captions,
        # eski --whisper-model verildiyse caption modeli olarak kullan
        caption_model=args.whisper_model or args.caption_model,
        language=args.lang,
        normalize_audio=not args.no_normalize,
        subtitles=args.subtitles,
        whisper_model=args.whisper_model or "small",
    )
    return run_pipeline(settings)
