// Yedekler (şifre gerekli)
// GET /api/yedek?indir=1     → şu anki bütün yazılar + gelen kutusu, tek dosya olarak indirilir
// GET /api/yedek?liste=1     → her sabah alınan otomatik yedeklerin listesi
// GET /api/yedek?p=ozel/yedek/…/icerik.json → o yedekteki içerik (geri yüklemek için)
import { json, route } from '../lib/http.js';
import { isAdmin } from '../lib/session.js';
import { loadContent } from '../lib/content.js';
import { readJson, listBackups, listMedia } from '../lib/store.js';

const BACKUP_RE = /^ozel\/yedek\/[A-Za-z0-9._/-]{1,160}\/icerik\.json$/;

const handlers = route({
  async GET(request) {
    if (!(await isAdmin(request))) return json({ error: 'Önce giriş yapmalısın.' }, 401);
    const url = new URL(request.url);

    if (url.searchParams.has('indir')) {
      const { value } = await loadContent({ fresh: true });
      const inbox = await readJson('ozel/gelen-kutusu.json');
      const media = await listMedia();
      const d = new Date();
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const body = JSON.stringify({
        alindi: new Date().toISOString(),
        aciklama: 'Deniz & Sena sitesinin yedeği: bütün yazılar (icerik), gelen kutusu ve yüklenen dosyaların listesi. Fotoğrafların kendileri “Yüklediklerim”den tek tek indirilebilir.',
        icerik: value,
        gelenKutusu: inbox ? inbox.value : { items: [] },
        medya: media.map((m) => ({ dosya: m.pathname, boyut: m.size, yuklendi: m.uploadedAt })),
      }, null, 2);
      return new Response(body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="deniz-ve-sena-yedek-${day}.json"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (url.searchParams.has('liste')) {
      const items = (await listBackups()).filter((b) => BACKUP_RE.test(b.pathname));
      return json({ items: items.map((b) => ({ p: b.pathname, at: b.uploadedAt, size: b.size })) });
    }

    const p = url.searchParams.get('p') || '';
    if (BACKUP_RE.test(p)) {
      const doc = await readJson(p);
      if (!doc) return json({ error: 'Yedek bulunamadı.' }, 404);
      return json({ content: doc.value });
    }
    return json({ error: 'Geçersiz istek.' }, 400);
  },
});

export const GET = handlers.GET;
