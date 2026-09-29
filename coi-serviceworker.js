// Bu dosya, bu adreste daha önce yayınlanan eski sitenin (klip düzenleyici)
// tarayıcılarda kalmış servis çalışanını kendiliğinden kaldırmak için duruyor.
// Lütfen silme; yeni sitede hiçbir işlevi yok.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => client.navigate(client.url));
  })());
});
