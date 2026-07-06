# 🎬 Reels Klip Düzenleyici

Elindeki hazır yayın kliplerini **Instagram Reels / TikTok / YouTube Shorts** için
paylaşıma hazır **9:16 dikey videolara** dönüştüren, tamamen **tarayıcıda çalışan** araç.

- 🎮 **Oyun + Kamera modu** — kamera (facecam) üstte, oyun görüntüsü altta
- 📷 **Sadece Kamera modu** — seçtiğin kamera bölgesi ekranın tamamını doldurur
- 📱 Çıktı: **1080×1920, H.264 + AAC MP4, 30 fps** — Reels/TikTok/Shorts ile birebir uyumlu
- 🔊 Ses seviyesi otomatik normalize edilir (−16 LUFS; kapatılabilir)
- ✂️ İsteğe bağlı baştan/sondan kırpma
- 📋 Birden çok klibi sıraya al, düzeni **tek tıkla hepsine uygula**, arka arkaya işle
- 💾 Kamera/oyun bölgesi düzenin tarayıcıda **hatırlanır** — yayıncının kamerası hep aynı
  yerdeyse bir kez ayarlaman yeterli
- 🔒 **Hiçbir video hiçbir yere yüklenmez** — tüm işleme senin bilgisayarında,
  tarayıcının içinde yapılır (ffmpeg.wasm)

## Kullanım (GitHub Pages)

Site yayında olduğunda adres şudur:

```
https://semizotu.github.io/Clip-maker/
```

1. Sayfayı aç, kliplerini sürükle-bırak.
2. **🎮 Oyun + Kamera** ya da **📷 Sadece Kamera** modunu seç.
3. Video üzerindeki renkli kutuları sürükleyip boyutlandır:
   - 🟩 **Kamera** kutusunu facecam'in üzerine oturt,
   - 🟧 **Oyun** kutusuyla oyunun hangi bölümünün görüneceğini seç.
   - Kutu oranları çıktı düzenine kilitlidir: **ne görüyorsan onu alırsın.**
4. Sağdaki 9:16 önizlemede sonucu canlı gör, **🚀 Hazırla**'ya bas, MP4'ü indir.
5. Birden çok klip için: ilk klibin düzenini ayarla → **📋 Bu düzeni tüm kliplere uygula**
   → **🚀 Tümünü hazırla**.

> İlk kullanımda video motoru (~31 MB) bir kez indirilir; sonrası önbellekten gelir.
> Chrome / Edge / Firefox önerilir. Tarayıcı desteklerse çok çekirdekli (hızlı) mod
> otomatik etkinleşir; desteklemezse tek çekirdekle yine çalışır.

### GitHub Pages'i etkinleştirme (tek seferlik, ~30 saniye)

Depo sahibi olarak:

1. GitHub'da depo sayfasında **Settings → Pages**'e git.
2. **Source: Deploy from a branch** seç.
3. **Branch:** bu kodun bulunduğu dalı seç (ör. varsayılan dal), klasör olarak **/ (root)** bırak, **Save**.
4. 1–2 dakika içinde site `https://semizotu.github.io/Clip-maker/` adresinde yayına girer.

> Not: Ücretsiz planda GitHub Pages yalnızca **herkese açık (public)** depolarda çalışır.

## Bilgisayarında çalıştırma (internetsiz)

Siteyi kurmadan yerel olarak da kullanabilirsin — tek gereksinim Python:

```bash
python dev/serve.py
# http://localhost:8642 otomatik açılır
```

Bu yol ayrıca çok çekirdekli modu her tarayıcıda garanti eder (COOP/COEP başlıklarını
sunucu gönderir).

## Nasıl çalışır?

- Arayüz: tek sayfalık statik uygulama (`index.html`, `app.js`, `style.css`) — derleme yok,
  sunucu yok, framework yok.
- Video işleme: [ffmpeg.wasm](https://ffmpegwasm.netlify.app) (`vendor/ffmpeg/` altında depoya
  gömülü; CDN gerekmez). Oyun+kamera düzeni tek bir ffmpeg filtresiyle üretilir:
  `crop` (kamera) + `crop` (oyun) + `vstack`.
- GitHub Pages özel HTTP başlığı gönderemediği için `coi-serviceworker.js`,
  COOP/COEP başlıklarını bir service worker ile ekleyerek **SharedArrayBuffer**'ı
  (= çok çekirdekli, hızlı ffmpeg) etkinleştirir. Service worker çalışmazsa uygulama
  otomatik olarak tek çekirdekli çekirdeğe düşer.
- Seçtiğin bölgeler kaynak videoya oransal saklanır; böylece aynı düzen farklı
  çözünürlükteki kliplere de uygulanabilir ve `localStorage` ile oturumlar arasında korunur.

## Sık sorulanlar

**Çıktı Instagram'a uygun mu?**
Evet: 1080×1920 (9:16), H.264 yuv420p + AAC 48 kHz, 30 fps, `+faststart`. Reels için
önerilen biçimin aynısı.

**Büyük dosyalar?**
İşleme tarayıcı belleğinde yapıldığı için dosya başına ~500 MB altı önerilir. Kısa
klipler (15–90 sn) için fazlasıyla yeterli.

**Tarayıcı videoyu önizleyemiyor (ör. HEVC/MKV)?**
Önizleme çalışmasa bile "Hazırla" yine de işleyebilir; bölge seçimi için kayıtlı düzen
kullanılır. En sorunsuz deneyim için H.264 MP4 kaynak önerilir.

**Eski Kick otomatik klipçisi nerede?**
Bu depo önceden Kick VOD'larından otomatik klip çıkaran bir Python aracıydı. O sistem
artık kullanılmadığı için kaldırıldı; ihtiyaç olursa git geçmişinde duruyor
(`git log` → `b9ee445` ve öncesi).
