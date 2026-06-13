"""Pipeline ayarları."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class Settings:
    # Kaynak
    url: str = ""
    m3u8_override: Optional[str] = None      # API çalışmazsa elle m3u8 kaynağı
    pick_index: int = 0                      # Kanal linki verilirse kaçıncı VOD (0 = en yeni)

    # Klip seçimi
    num_clips: int = 5
    clip_duration: float = 45.0              # saniye
    pre_peak_ratio: float = 0.35             # klibin ne kadarı zirveden ÖNCE başlasın
    min_gap_factor: float = 1.2              # klipler arası asgari mesafe (süre x bu katsayı)

    # Sinyaller
    use_chat: bool = True
    use_audio: bool = True
    bucket_s: float = 5.0                    # analiz pencere boyu (saniye)
    chat_weight: float = 0.6
    audio_weight: float = 0.4
    agreement_weight: float = 0.7            # chat+ses aynı anda patlarsa bonus
    chat_lag_s: float = 4.0                  # chat'in olaya göre gecikmesi (telafi)
    limit_minutes: Optional[float] = None    # sadece ilk X dakikayı analiz et (test için)

    # Çıktılar
    out_dir: Path = field(default_factory=lambda: Path("output"))
    horizontal: bool = True
    vertical: bool = True                    # 9:16 sosyal medya versiyonu
    quality: str = "best"                    # best | worst (klip kesiminde kullanılacak varyant)
    analyze_only: bool = False               # klip kesme, sadece analiz raporu üret
    title: Optional[str] = None              # dikey klibe yazı bindir (boşsa yazı yok)

    # Altyazı (opsiyonel, faster-whisper gerektirir)
    subtitles: bool = False
    language: str = "tr"
    whisper_model: str = "small"
