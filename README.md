# 🎬 Clip Maker — Kick Yayınlarından Otomatik Klip Üretici

Kick'teki **geçmiş yayınları (VOD)** analiz eder, **en dikkat çekici anları otomatik bulur**
ve sosyal medyada paylaşıma hazır klipler üretir:

- 📺 **Yatay MP4** (YouTube, Twitter/X için)
- 📱 **9:16 dikey MP4** — bulanık arka planlı (TikTok, Instagram Reels, YouTube Shorts için)
- 🖼️ Her klip için **kapak görseli** (thumbnail)
- 📋 Zaman damgalı **analiz raporu** (hangi an neden seçildi, öne çıkan chat mesajları)

## Nasıl çalışır?

Sistem iki bağımsız sinyali birleştirerek "dikkat çekici an" skoru üretir:

1. **Chat analizi** — Kick'in VOD chat tekrarı taranır. Mesaj yoğunluğundaki ani artışlar,
   kahkaha kalıpları (`HAHAHA`, `sjsjsj`, `KEKW`...), Türkçe/evrensel heyecan ifadeleri
   (`OHA`, `yok artık`, `EFSANE`, `POG`...), **"kliple!" çağrıları**, emote spam'i ve
   BÜYÜK HARF bağırışları puanlanır.
2. **Ses analizi** — yayının ses enerjisi (RMS) ölçülür; yayıncının bağırdığı, güldüğü,
   ortamın hareketlendiği anlardaki ses sıçramaları yakalanır.

İki sinyal dayanıklı z-skoruna çevrilip ağırlıklı olarak birleştirilir (varsayılan:
%60 chat + %40 ses), çakışmayan en iyi N pencere seçilir ve klipler ffmpeg ile kesilir.

```
Kick VOD linki ──► Kick API (curl_cffi) ──► m3u8 kaynağı + chat tekrarı
                                                  │
                          ┌───────────────────────┴───────────────┐
                          ▼                                       ▼
                   Chat sinyali (z-skor)                  Ses sinyali (z-skor)
                          └───────────────┬───────────────────────┘
                                          ▼
                              Birleşik skor + zirve seçimi
                                          ▼
                     ffmpeg: yatay klip + 9:16 dikey + kapak + rapor
```

## Kurulum

Gereksinimler: **Python 3.10+** ve **ffmpeg**.

```bash
# 1) ffmpeg
sudo apt install ffmpeg        # Ubuntu/Debian
brew install ffmpeg            # macOS
winget install ffmpeg          # Windows

# 2) Python bağımlılıkları
pip install -r requirements.txt

# (opsiyonel) otomatik altyazı için:
pip install faster-whisper
```

## Kullanım

```bash
# Belirli bir VOD'dan 5 klip (varsayılan ayarlar):
python -m clipmaker https://kick.com/KANALADI/videos/9f10b2c3-...

# Kanal linki ver, en son yayını otomatik kullansın:
python -m clipmaker https://kick.com/KANALADI

# Önce kanalın VOD'larını listele, sonra seç:
python -m clipmaker https://kick.com/KANALADI --list
python -m clipmaker https://kick.com/KANALADI --pick 2

# 8 adet 30 saniyelik klip, başlık yazısıyla:
python -m clipmaker <link> -n 8 -d 30 --title "KANALADI en iyi anlar"

# Önce sadece analiz raporu al (klip kesmeden):
python -m clipmaker <link> --analyze-only

# Hızlı deneme: yalnızca ilk 30 dakikayı analiz et:
python -m clipmaker <link> --limit-minutes 30

# Türkçe otomatik altyazı gömülü klipler:
python -m clipmaker <link> --subtitles --lang tr
```

### Çıktı yapısı

```
output/kanaladi_9f10b2c3/
├── REPORT.md             # okunabilir rapor: zamanlar, skorlar, öne çıkan mesajlar
├── highlights.json       # makine-okunur tam veri
├── clips/
│   ├── clip_01_01-23-45.mp4          # yatay
│   └── vertical/
│       └── clip_01_01-23-45_dikey.mp4 # 9:16, paylaşıma hazır
├── thumbnails/
│   └── clip_01_01-23-45.jpg
└── cache/                # chat + ses önbelleği (tekrar çalıştırma hızlı olur)
```

> Aynı VOD'u farklı ayarlarla tekrar çalıştırmak hızlıdır: chat ve ses
> önbellekten okunur, yalnızca seçim ve kesim yeniden yapılır.

### Önemli parametreler

| Parametre | Varsayılan | Açıklama |
|---|---|---|
| `-n, --clips` | 5 | üretilecek klip sayısı |
| `-d, --duration` | 45 | klip süresi (saniye) |
| `--pre` | 0.35 | klibin ne kadarının zirveden *önce* başlayacağı (bağlam için) |
| `--chat-weight` / `--audio-weight` | 0.6 / 0.4 | sinyal ağırlıkları |
| `--no-chat` / `--no-audio` | — | bir sinyali tamamen kapat |
| `--quality` | best | klip kesiminde kullanılacak video kalitesi (`best`/`worst`) |
| `--bucket` | 5 | analiz penceresi (saniye); küçültmek hassasiyeti artırır |

## Sorun giderme

**"Kick API'sine ulaşılamadı" / 403 hatası**
Kick, Cloudflare arkasındadır. Sistem `curl_cffi` ile gerçek tarayıcı taklidi yapar ve bu
normalde yeterlidir; ancak **veri merkezi / VPN IP'leri Cloudflare tarafından sık engellenir**.
Çözümler:
1. Ev internetinden (normal IP) çalıştırın.
2. Yine olmazsa video kaynağını elle verin: tarayıcıda VOD'u açın, geliştirici araçları →
   Ağ sekmesinde `master.m3u8` adresini kopyalayın ve `--m3u8 <adres>` ile çalıştırın
   (bu modda chat analizi yine denenir, video indirme garantiye alınır).
3. `yt-dlp` kuruluysa sistem kaynağı onunla çözmeyi de otomatik dener.

**Chat verisi alınamıyor ama video iniyor**
Sistem otomatik olarak yalnızca ses sinyaliyle devam eder. Uzun yayınlarda chat taraması
zaman alır (Kick API'si sayfa sayfa verir); ilerleme yüzdesi gösterilir ve sonuç önbelleğe alınır.

**Uzun VOD'larda ses analizi yavaş**
Ses, en düşük bant genişlikli kaynaktan (varsa salt-ses kanalından) indirilir; yine de
5+ saatlik yayınlarda dakikalar sürebilir. `--limit-minutes` ile sınırlayabilir veya
`--no-audio` ile yalnızca chat kullanabilirsiniz.

**Klipler ilginç anları kaçırıyor**
- `--bucket 3` ile hassasiyeti artırın,
- chat'i aktif bir yayında `--chat-weight 0.8` deneyin,
- `--analyze-only` ile rapora bakıp `-d` süresini ayarlayın.

## Testler

```bash
python -m unittest discover -s tests
```

37 test: URL/zaman/playlist çözümleme, hype puanlama, sinyal birleştirme, zirve seçimi
ve ffmpeg ile gerçek uçtan uca medya hattı (sentetik video üzerinde).

## Mimari

| Modül | Görev |
|---|---|
| `clipmaker/kick_api.py` | Kick API istemcisi (curl_cffi ile Cloudflare aşımı), VOD + chat tekrarı |
| `clipmaker/chat_analysis.py` | mesaj yoğunluğu + hype kalıpları → z-skor sinyali |
| `clipmaker/audio_analysis.py` | RMS ses enerjisi → z-skor sinyali |
| `clipmaker/highlights.py` | sinyal birleştirme, çakışmasız zirve seçimi |
| `clipmaker/media.py` | ffmpeg: varyant seçimi, kesim, 9:16 dönüştürme, kapak |
| `clipmaker/subtitles.py` | opsiyonel faster-whisper altyazı |
| `clipmaker/pipeline.py` | uçtan uca akış + önbellekleme |
| `clipmaker/cli.py` | komut satırı arayüzü |

## Notlar

- Kick'in herkese açık ama **resmi olmayan** API'si kullanılır; Kick uç noktaları
  değiştirirse `kick_api.py` güncellenmelidir.
- Yalnızca **kendi yayınlarınız veya izinli içerik** için kullanın.
