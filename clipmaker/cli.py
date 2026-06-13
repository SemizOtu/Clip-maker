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
            "Kick VOD'larından otomatik öne çıkan an klipleri üretir. "
            "Chat yoğunluğu + ses enerjisi analiziyle en dikkat çekici anları bulur, "
            "paylaşıma hazır MP4 (yatay + 9:16 dikey) çıkarır."
        ),
        epilog=(
            "Örnekler:\n"
            "  python -m clipmaker https://kick.com/kanaladi/videos/9f10b2c3-...\n"
            "  python -m clipmaker https://kick.com/kanaladi            # en son VOD\n"
            "  python -m clipmaker https://kick.com/kanaladi --list     # VOD'ları listele\n"
            "  python -m clipmaker <link> -n 8 -d 30 --analyze-only\n"
            "  python -m clipmaker <link> --subtitles --lang tr\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("url", help="Kick VOD ya da kanal bağlantısı")
    p.add_argument("--version", action="version", version=f"clipmaker {__version__}")

    g = p.add_argument_group("klip seçimi")
    g.add_argument("-n", "--clips", type=int, default=5, help="üretilecek klip sayısı (varsayılan: 5)")
    g.add_argument("-d", "--duration", type=float, default=45.0, help="klip süresi, saniye (varsayılan: 45)")
    g.add_argument("--pre", type=float, default=0.35, metavar="ORAN",
                   help="klibin zirveden önce başlama oranı 0-1 (varsayılan: 0.35)")
    g.add_argument("--min-gap", type=float, default=None, metavar="SN",
                   help="iki klip arası asgari mesafe, saniye (varsayılan: süre x 1.2)")

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

    g = p.add_argument_group("altyazı (faster-whisper gerektirir)")
    g.add_argument("--subtitles", action="store_true", help="otomatik altyazı üret ve göm")
    g.add_argument("--lang", default="tr", help="konuşma dili (varsayılan: tr)")
    g.add_argument("--whisper-model", default="small",
                   help="whisper model boyu: tiny/base/small/medium (varsayılan: small)")

    g = p.add_argument_group("kaynak seçenekleri")
    g.add_argument("--list", action="store_true", help="kanalın VOD'larını listele ve çık")
    g.add_argument("--pick", type=int, default=0, metavar="N",
                   help="kanal bağlantısında kaçıncı VOD (0 = en yeni)")
    g.add_argument("--m3u8", default=None, metavar="URL",
                   help="API çalışmazsa video kaynağını elle ver (master.m3u8 adresi)")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    from clipmaker.pipeline import list_channel_vods, run_pipeline

    if args.list:
        return list_channel_vods(args.url)

    settings = Settings(
        url=args.url,
        m3u8_override=args.m3u8,
        pick_index=args.pick,
        num_clips=args.clips,
        clip_duration=args.duration,
        pre_peak_ratio=args.pre,
        min_gap_factor=(args.min_gap / args.duration) if args.min_gap else 1.2,
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
        subtitles=args.subtitles,
        language=args.lang,
        whisper_model=args.whisper_model,
    )
    return run_pipeline(settings)
