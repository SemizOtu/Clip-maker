/*
 * GitHub Pages gibi özel HTTP başlığı gönderemeyen statik sunucularda
 * crossOriginIsolated'ı (SharedArrayBuffer → çok çekirdekli ffmpeg) etkinleştirir.
 * Aynı dosya hem sayfa betiği hem service worker olarak çalışır.
 */
if (typeof window === 'undefined') {
  // ---- Service worker tarafı: tüm yanıtlara COOP/COEP başlıkları ekle ----
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 0) return res;
          const headers = new Headers(res.headers);
          headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');
          headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers,
          });
        })
        .catch((err) => new Response(String(err), { status: 500 }))
    );
  });
} else {
  // ---- Sayfa tarafı: worker'ı kaydet, ilk seferde bir kez yenile ----
  (() => {
    if (window.crossOriginIsolated) return;            // zaten etkin (ör. gerçek başlıklar var)
    if (!window.isSecureContext) return;               // SW yalnızca https/localhost'ta çalışır
    if (!('serviceWorker' in navigator)) return;
    const KEY = 'coi-reloaded';
    const reloadOnce = () => {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, '1');
      window.location.reload();
    };
    navigator.serviceWorker
      .register(document.currentScript.src)
      .then((reg) => {
        // Worker zaten aktif ama bu sayfayı kontrol etmiyorsa (ilk ziyaret / sert yenileme)
        if (reg.active && !navigator.serviceWorker.controller) reloadOnce();
        navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
      })
      .catch(() => { /* kayıt başarısızsa uygulama tek çekirdekle devam eder */ });
  })();
}
