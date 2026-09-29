# 💌 Sana Özel

Sevgiline hazırlanmış, fotoğraflı, kalpli ve çiçekli romantik bir web sitesi.
Kalp şeklinde sayfa geçişleri, açılan bir zarf, uçuşan kalpler ve gül yaprakları,
birlikte geçen zamanı sayan bir sayaç, uzun bir mektup, çevrilen kartlar, kazı kazan,
aşk kuponları ve “Hayır” butonu kaçan eğlenceli bir final içerir.

## 🌐 Adresler

| | Adres |
|---|---|
| Sevgiline göndereceğin adres | **https://semizotu.github.io/Clip-maker/** |
| Düzenleme modu (sadece sen) | https://semizotu.github.io/Clip-maker/?duzenle |

> Düzenleme adresini sevgiline gönderme; o sadece senin için. Göndereceğin adres `?duzenle` olmadan olan.

## ✏️ Fotoğraf ve yazıları değiştirme

Adresin sonuna **`?duzenle`** ekleyince düzenleme modu açılır:

1. **Yazılar:** Kesik çizgili her yazıya dokun ve değiştir. Bitince alttaki **💾 Kaydet**’e bas.
2. **Fotoğraflar:** Fotoğraf alanındaki **📷 Fotoğraf seç** butonuna dokun → fotoğrafını seç → kırp → **Kırp ve ekle**. Fotoğraf kendiliğinden kaydedilir.
3. **Ekle / sırala / sil:** Listelerin altındaki **+ Ekle** butonları (yeni anı, fotoğraf, sebep, kupon), **↑ ↓** ile sıralama, **✕** ile silme.
4. **⚙️ Ayarlar:** Birlikteliğinizin başladığı tarih (sayaç), zarf açılınca çalacak şarkınız (MP3), WhatsApp numaran (kupon mesajları için), bölüm adları ve kaçan “Hayır” butonunun yazıları.
5. **👁 Önizle:** Sevgilinin göreceği hâli gösterir.

Kaydettiğin her şey 1–2 dakika içinde siteye yansır.

## 🔑 Bir kereye mahsus kurulum: GitHub anahtarı

Düzenleme modunun değişiklikleri siteye kaydedebilmesi için GitHub’dan bir anahtar (token) gerekir:

1. [Anahtar oluşturma sayfasını aç](https://github.com/settings/personal-access-tokens/new?name=Ask+Sitesi+Duzenleme&expires_in=none&contents=write&metadata=read) ve GitHub hesabınla giriş yap.
2. **Expiration**: “No expiration” ya da uzun bir süre seç.
3. **Repository access** → **Only select repositories** → **Clip-maker** deposunu seç.
4. **Permissions** kısmında **Contents** izninin **Read and write** olduğundan emin ol.
5. **Generate token**’a bas, `github_pat_…` ile başlayan anahtarı kopyala.
6. Düzenleme modunda **⚙️ Ayarlar → GitHub bağlantısı** kutusuna yapıştırıp **Kaydet ve test et**’e bas.

Anahtar yalnızca kendi tarayıcında saklanır; siteye ya da depoya yazılmaz.

## 📖 Bölümler

| | Bölüm | İçinde neler var |
|---|---|---|
| — | Kapak | Kalp mühürlü zarf; dokununca açılır, varsa şarkınız başlar |
| I | Sen & Ben | Harf harf açılan başlık, dönen “Sen benim …” sözleri, kalp çerçeveli fotoğraf, canlı sayaç |
| II | Hikayemiz | Tarihli, fotoğraflı zaman tüneli |
| III | Anılarımız | Bantlı polaroid duvarı; dokununca büyüyen fotoğraflar |
| IV | Sana Mektubum | Mühürlü, kelime kelime beliren uzun mektup |
| V | Neden Sen? | Çevrilen sebep kartları + “Seni ne kadar seviyorum?” ölçeri |
| VI | Sürprizler | Kazı kazan + WhatsApp’tan haber veren aşk kuponları |
| VII | Sonsuza Dek | Gece sahnesi, kaçan “Hayır” butonu ve konfetili “Seni Seviyorum” |

## 🔒 Gizlilik

- Site arama motorlarına kapalıdır (`noindex`), ama depo herkese açık olduğu için eklenen fotoğraflar adresini bilen herkes tarafından açılabilir. Paylaşmak istemediğin fotoğrafları ekleme.
- GitHub anahtarın sadece senin tarayıcında durur. Başka bir cihazdan düzenlemek için orada da bir kere girmen gerekir; işin bitince **Ayarlar → Anahtarı bu cihazdan sil** diyebilirsin.

## 🛠 Teknik notlar

- Derleme gerektirmeyen düz HTML/CSS/JavaScript. Tüm yazılar ve fotoğraf listesi `content.json` içinde; fotoğraflar `foto/`, şarkı `muzik/` klasörüne kaydedilir.
- Yazı tipleri (Great Vibes, Cormorant Garamond, Caveat, Quicksand) `fonts/` içinde, fotoğraf kırpma aracı [Cropper.js](https://github.com/fengyuanchen/cropperjs) 1.6.2 (MIT) `vendor/` içinde.
- Düzenleme modu değişiklikleri `claude/ecstatic-tesla-c0znbc` dalına (deponun varsayılan dalı) kaydeder ve GitHub Pages’in yayınladığı `claude/clip-layout-social-media-19i1sx` dalını da aynı sürüme eşitler. Elle `git push` yaparsan iki dala da gönder ya da **Settings → Pages** bölümünden kaynağı varsayılan dal olarak değiştir.
- Bilgisayarında denemek için: `python3 -m http.server` → http://localhost:8000
