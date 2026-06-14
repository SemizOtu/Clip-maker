# 🎬 Clip Maker — Kick Yayınlarından Otomatik Klip Üretici

Kick'teki **geçmiş yayınları (VOD)** analiz eder, **en dikkat çekici anları otomatik bulur**
ve sosyal medyada paylaşıma hazır klipler üretir:

- 📺 **Yatay MP4** (YouTube, Twitter/X için)
- 📱 **9:16 dikey MP4** — bulanık arka planlı (TikTok, Instagram Reels, YouTube Shorts için)
- 🖼️ Her klip için **kapak görseli** (thumbnail)
- 📋 Zaman damgalı **analiz raporu** (hangi an neden seçildi, öne çıkan chat mesajları)

## Nasıl çalışır?

Sistem **iki aşamalıdır**: önce ucuz sinyallerle tüm yayından bol **aday** çıkarır,
sonra (varsa) bir **yapay zeka jürisi** bu adayların *içeriğini* okuyup gerçekten
komik/çarpıcı olanları seçer. Bu, OpusClip'in açık kaynak alternatiflerinin
([SamurAIGPT](https://github.com/samuraigpt/ai-youtube-shorts-generator),
[ClipsAI](https://github.com/ClipsAI/clipsai), [openshorts](https://github.com/mutonby/openshorts))
kullandığı **"Whisper ile yazıya dök → LLM ile öne çıkanı seç → dikey kes"**
yaklaşımının livestream'e uyarlanmış hâlidir.

```
Aday üretimi (sinyaller) ──► aday havuzu ──► [yapay zeka jürisi] ──► en iyi N klip
   chat + ses                                 transcript + chat okur,
   (tüm yayını ucuza tarar)                    0-100 puanlar, başlık üretir
```

### 1) Aday üretimi — iki sinyal

Sistem iki bağımsız sinyali birleştirerek "dikkat çekici an" skoru üretir:

1. **Chat analizi** — Kick'in VOD chat tekrarı taranır. Mesaj yoğunluğundaki ani artışlar,
   kahkaha kalıpları (`HAHAHA`, `sjsjsj`, `KEKW`...), Türkçe/evrensel heyecan ifadeleri
   (`OHA`, `yok artık`, `EFSANE`, `POG`...), **"kliple!" çağrıları**, emote spam'i,
   **kopyala-yapıştır dalgaları** (aynı mesajın onlarca kişiden gelmesi) ve BÜYÜK HARF
   bağırışları puanlanır. Bot komutları (`!discord`) ve saf linkler elenir.
2. **Ses analizi** — yalnızca "yüksek ses" değil, **ani ses değişimi** (onset/novelty)
   yakalanır: yayıncının birden bağırması, gülmesi, ortamın patlaması. Sürekli intro müziği
   gibi sabit yükseklikler elenir.

Bu yaklaşımı "sadece yoğun/yüksek anı al"dan ayıran dört nokta:

- **Chat gecikmesi telafisi** — chat, ekrandaki olaydan ~4 sn *sonra* tepki verir
  (yayın gecikmesi + insan tepkisi + yazma süresi). Sinyal öne kaydırılır ki klip,
  chat tepkisinin değil, **tepkiyi doğuran anın** üzerine otursun.
- **Patlama (burst) tespiti** — "sürekli aktif chat" değil, yerel ortalamanın üzerine
  **aniden sıçrayan** chat dikkat çekici anı işaret eder.
- **Uzlaşma bonusu** — hem yayıncının (ses) hem de izleyicinin (chat) **aynı anda**
  patladığı anlar gerçek komik/çarpıcı anlardır ve ekstra puan alır. Yalnızca müzik
  (ses var, chat yok) ya da yalnızca selamlaşma spam'i (chat var, ses yok) bu bonusu alamaz.
- **Pencere-altı zirve** — klip, parabol interpolasyonuyla bulunan gerçek tepe noktasına
  göre konumlandırılır.

İki sinyal dayanıklı z-skoruna çevrilip ağırlıklı birleştirilir (varsayılan %60 chat +
%40 ses) ve uzlaşma bonusu eklenir; çakışmayan en iyi pencereler aday havuzu olur.

### 2) Yapay zeka jürisi — içeriği anlar

Sinyaller yalnızca "hareketli" anı bulur; ama **hareketli ≠ komik**. Asıl zeka burada:
her aday anın **konuşması Whisper ile yazıya dökülür** ve o anki **chat tepkileriyle**
birlikte bir dil modeline (LLM) sunulur. Model her adayı *tek başına paylaşılan bir klip
olarak* ne kadar komik / çarpıcı / dramatik / ilgi çekici olduğuna göre **0-100 puanlar**,
bir **kategori** ve paylaşıma hazır bir **başlık** üretir. Klipler bu yapay zeka puanına
göre seçilir — yani "sadece kalabalık olduğu için" öne çıkan sönük anlar elenir.

Yapay zeka motoru **otomatik seçilir** (kademeli, hiçbiri yoksa sistem yine çalışır):

| Öncelik | Motor | Gereksinim | Kalite |
|---|---|---|---|
| 1 | **Claude API** | `ANTHROPIC_API_KEY` + `pip install anthropic` | En iyi |
| 2 | **Ollama (yerel, ücretsiz)** | `ollama serve` çalışıyor olmalı | İyi |
| 3 | **Sinyal sıralaması** | — (her zaman var) | Temel |

**Kurulum — Claude (önerilen):**
```bash
pip install anthropic faster-whisper
# Windows (kalıcı): setx ANTHROPIC_API_KEY "sk-ant-..."   (yeni terminal açın)
# Mac/Linux:        export ANTHROPIC_API_KEY="sk-ant-..."
python -m clipmaker <link>          # --ai auto: anahtarı otomatik bulur
```
> Maliyet düşüktür: jüriye yalnızca aday anların kısa metni gönderilir; VOD başına
> birkaç–on sent civarı (varsayılan model `claude-opus-4-8`). Daha ucuzu için
> `--ai-model claude-haiku-4-5`. Anahtarı [console.anthropic.com](https://console.anthropic.com)'dan alırsınız.

**Kurulum — Ollama (ücretsiz/yerel):**
```bash
pip install faster-whisper
# https://ollama.com indirip kurun, sonra:
ollama pull llama3.1
python -m clipmaker <link> --ai ollama   # ya da --ai auto
```

Yapay zekayı kapatmak için `--ai off` (yalnızca sinyaller kullanılır).

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

# En iyi sonuç: yapay zeka jürisi + karaoke altyazı (zaten varsayılan):
python -m clipmaker <link> --ai auto --lang tr

# Daha net altyazı (zayıf bilgisayarda daha yavaş):
python -m clipmaker <link> --caption-model small

# Altyazısız, sade dikey klip istersen:
python -m clipmaker <link> --no-captions
```

### Karaoke altyazı (paylaşıma hazır kliplerin olmazsa olmazı)

Sosyal medyada klipleri "hazır" yapan şey, **kelime kelime hareketli altyazıdır**
(konuşulan kelime vurgulanır; sessiz akışta bile izlenir). Bu **varsayılan olarak açıktır**.

```bash
pip install faster-whisper      # tek seferlik; altyazı için gerekli
python -m clipmaker <link> --ai auto --lang tr
```

- Altyazı, **dikey (9:16)** klibe TikTok/Reels/Shorts tarzında büyük, ortada, konuşulan
  kelime **sarı vurgulu** olarak gömülür. Ses de otomatik **normalize** edilir (loudnorm).
- `faster-whisper` kurulu değilse klipler yine üretilir ama **altyazısız** (program başında
  açıkça uyarır). Kapatmak için `--no-captions`.
- Altyazı yalnızca seçilen **final klipler** için, klibin **yüksek kaliteli sesinden** üretilir
  (hızlı ve doğru). Model: `--caption-model tiny|base|small` (varsayılan `base`; en net için `small`).
- İlk çalıştırmada whisper modeli (~birkaç yüz MB) bir kez indirilir.

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
| `--agreement` | 0.7 | chat+ses aynı anda patlarsa eklenen uzlaşma bonusu |
| `--chat-lag` | 4 | chat'in olaya göre gecikmesi (sn); klibi öne kaydırır |
| `--ai` | auto | yapay zeka motoru: `auto` / `claude` / `ollama` / `off` |
| `--ai-model` | — | model adı (Claude: `claude-opus-4-8`, Ollama: `llama3.1`) |
| `--judge-pool` | otomatik | jüriye sunulacak aday sayısı (varsayılan ≈ klip×3) |
| `--transcribe-model` | base | jüri konuşma tanıma modeli: `tiny` (en hızlı) / `base` / `small` |
| `--no-transcribe` | — | konuşmayı yazıya dökme; jüri yalnızca chat'e baksın |
| `--caption-model` | base | karaoke altyazı modeli: `tiny` / `base` / `small` (en net: `small`) |
| `--no-captions` | — | kelime kelime hareketli altyazıyı kapat (varsayılan açık) |
| `--no-normalize` | — | ses yüksekliği normalizasyonunu (loudnorm) kapat |
| `--no-chat` / `--no-audio` | — | bir sinyali tamamen kapat |
| `--quality` | best | klip kesiminde kullanılacak video kalitesi (`best`/`worst`) |
| `--bucket` | 5 | analiz penceresi (saniye); küçültmek hassasiyeti artırır |

> **Yavaş bilgisayar / ekran kartı yok mu?** Konuşma tanıma işlemcide çalışır.
> Hız için: `--transcribe-model tiny --caption-model tiny --judge-pool 8`.

> **İpucu — klipler hâlâ "tam o anı" yakalamıyorsa:** chat tepkisi yavaşsa
> `--chat-lag 6`, hızlıysa `--chat-lag 2` deneyin. Komik anları daha çok kovalamak için
> `--agreement 1.0` (yayıncı + chat birlikte patlayan anlara odaklanır). Hassasiyet için
> `--bucket 3`. Önce `--analyze-only` ile raporu görüp ayar yapmak en hızlısıdır.

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
| `clipmaker/audio_analysis.py` | RMS ses enerjisi + yenilik → z-skor sinyali |
| `clipmaker/highlights.py` | sinyal birleştirme, çakışmasız aday seçimi |
| `clipmaker/transcribe.py` | aday anların konuşmasını Whisper ile yazıya döker |
| `clipmaker/ai_judge.py` | yapay zeka jürisi (Claude / Ollama) — içeriği puanlar |
| `clipmaker/media.py` | ffmpeg: varyant seçimi, kesim, 9:16 dönüştürme, kapak |
| `clipmaker/captions.py` | kelime kelime karaoke altyazı (ASS) üretimi |
| `clipmaker/pipeline.py` | uçtan uca akış + önbellekleme |
| `clipmaker/cli.py` | komut satırı arayüzü |

## Notlar

- Kick'in herkese açık ama **resmi olmayan** API'si kullanılır; Kick uç noktaları
  değiştirirse `kick_api.py` güncellenmelidir.
- Yalnızca **kendi yayınlarınız veya izinli içerik** için kullanın.
