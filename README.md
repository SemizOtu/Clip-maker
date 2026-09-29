# 💌 Deniz & Sena

Deniz’den Sena’ya, sevgiyle hazırlanmış romantik bir web sitesi.
Mühürlü bir zarfla açılır; kalpli sayfa geçişleri, uçuşan gül yaprakları,
canlı bir sayaç, fotoğraflar, mektuplar, bir sınav, aşk kuponları ve
kalp şeklinde havai fişeklerle biten bir final içerir.

## 🌐 Adresler

| | Adres |
|---|---|
| Sena’ya göndereceğin adres | **https://deniz-ve-sena.vercel.app** |
| Düzenleme modu (sadece sen, şifreli) | https://deniz-ve-sena.vercel.app/duzenle |

## ✨ İlk kurulum (bir kereye mahsus)

1. **https://deniz-ve-sena.vercel.app/duzenle** adresini aç.
2. Kendine bir **düzenleme şifresi** belirle (en az 6 karakter). Bu şifreyi sadece sen bileceksin.
3. Açılan “Yapılacaklar” listesini takip et: tarihi ayarla, fotoğrafları yükle, şarkını ekle.
4. Hazır olunca adresi (sonunda `/duzenle` olmadan) Sena’ya gönder. Ayarlar’daki “WhatsApp’ta gönder” butonu hazır bir mesaj açar.

## ✏️ Düzenleme modu

- **Yazılar:** Kesik çizgili her yazıya dokunup değiştir. Birkaç saniye içinde kendiliğinden kaydedilir (istersen 💾 Kaydet’e de basabilirsin).
- **Fotoğraflar:** “📷 Fotoğraf seç” → fotoğrafı seç → kırp → “Kırp ve ekle”. Fotoğraflar otomatik küçültülür (en fazla 2000 px) ve anında kaydedilir.
- **Toplu fotoğraf:** “Anılarımız” bölümündeki “📷 Fotoğraf ekle” ile birden fazla fotoğrafı tek seferde yükleyebilirsin; önce boş kutular dolar, sonra yenileri eklenir.
- **Listeler:** “+ Ekle” butonları; ↑ ↓ ile sırala, ✕ ile sil.
- **Bölümler:** Her bölümün üstündeki anahtarla bölümü gizleyebilirsin; Sena gizli bölümleri görmez.
- **Sınav:** Her şıkkın solundaki yuvarlağa dokunarak doğru cevabı seç.
- **Hayaller:** Soldaki yuvarlağa dokunarak “gerçekleşti” olarak işaretle.
- **⚙️ Ayarlar:** İsimler, birlikteliğin başladığı an, Sena’nın doğum günü, şarkınız, bölüm adları, özel kilit, bildirimler, kaçan “Hayır” butonunun yazıları, şifre değiştirme.
- **👁 Önizle:** Sena’nın göreceği hâli gösterir (önizlemedeki tıklamalar Gelen Kutusu’na düşmez).

## 💌 Gelen kutusu

Sena bir aşk kuponunu kullandığında, “zamanı gelince aç” mektuplarından birini açtığında,
sınavı bitirdiğinde, kazı kazanı kazıdığında, sonsuza dek sorusuna “Evet” dediğinde
ya da sana bir not / yeni bir hayal yazdığında düzenleme modundaki **💌 Gelen** kutusunda görürsün.
Ayarlar’dan WhatsApp numaranı yazarsan, kupon kullanıldığında sana WhatsApp mesajı da açılır.
Sen giriş yapmışken sitede yaptığın denemeler “senin denemen” etiketiyle ayrı görünür.

## 📖 Bölümler

| | Bölüm | İçinde neler var |
|---|---|---|
| — | Kapak | Kadife zemin, mühürlü zarf; açılınca şarkınız başlar. İstersen soru-cevaplı özel kilit |
| I | Sen & Ben | Harf harf açılan isimler, “Sen benim …”, kalp çerçeveli fotoğraf, canlı sayaç, bir sonraki ay dönümü, “Sayılarla biz”, her gün değişen “Bugünün notu” |
| II | Hikâyemiz | Tarihli, fotoğraflı zaman tüneli |
| III | Anılarımız | Bantlı polaroid duvarı, büyüyen fotoğraflar, müzikli slayt gösterisi |
| IV | Sana Mektubum | Kelime kelime beliren mektup + “Zamanı gelince aç” mektupları |
| V | Neden Sen? | Çevrilen sebep kartları, rastgele sebep, “Seni ne kadar seviyorum?” ölçeri |
| VI | Beni Ne Kadar Tanıyorsun? | Kalpli puanlı küçük sınav |
| VII | Hayallerimiz | Birlikte yapılacaklar listesi; Sena da yeni hayal önerebilir |
| VIII | Sürprizler | Kazı kazan + aşk kuponları |
| IX | Sonsuza Dek | Gece sahnesi, kaçan “Hayır”, kalpli havai fişekler ve Sena’dan sana not |

Ay dönümlerinde, 100’ün katı olan günlerde, Sena’nın doğum gününde, Sevgililer Günü’nde
ve yılbaşında site kendiliğinden kutlama yapar.

## 🔒 Gizlilik ve güvenlik

- Fotoğraflar ve yazılar **özel (private) Vercel Blob** deposunda durur; depoya doğrudan erişilemez, sadece site üzerinden gösterilir. Artık fotoğraflar herkese açık GitHub deposuna yüklenmiyor.
- Site arama motorlarına kapalıdır (`noindex`).
- İstersen **Ayarlar → Özel kilit** ile siteyi sadece doğru cevabı bilen birinin açabileceği bir soruyla kilitleyebilirsin; o zaman fotoğraflar da kilitlenir.
- Düzenleme şifren depoda sadece özet (scrypt) olarak saklanır.

### Şifreni unutursan

Vercel → projen → **Storage** → Blob deposu → **Browser** kısmında `ozel/giris.json` dosyasını sil.
Bir dakika sonra `/duzenle` adresi tekrar “şifre belirle” ekranıyla açılır. (İçerik ve fotoğraflar silinmez.)

## 🛠 Teknik notlar

- Arayüz derleme gerektirmeyen düz HTML/CSS/JavaScript (`public/`), sunucu tarafı Vercel Functions (`api/`, Node.js).
- İçerik `ozel/icerik.json`, fotoğraf ve şarkılar `medya/` altında Vercel Blob’da saklanır. İlk hâl `lib/defaults.js` içindedir.
- Fotoğraflar tarayıcıda küçültülüp Blob’a doğrudan yüklenir (`@vercel/blob/client`, `public/vendor/blob-istemcisi.min.js` — `npm run blob-istemcisi` ile üretilir).
- Yazı tipleri (Great Vibes, Cormorant Garamond, Caveat, Quicksand) `public/fonts/` içinde, fotoğraf kırpma aracı [Cropper.js](https://github.com/fengyuanchen/cropperjs) 1.6.2 (MIT).

### Bilgisayarında denemek

```bash
npm install
npm run dev
```

Sonra http://localhost:5173 (site) ve http://localhost:5173/duzenle (düzenleme).
Yerelde her şey `.yerel-depo/` klasörüne kaydedilir; Vercel’deki siteye dokunulmaz.

### Yayınlamak

```bash
npx vercel deploy --prod
```
