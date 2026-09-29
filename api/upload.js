// POST   /api/upload           → tarayıcının Blob'a doğrudan yükleme yapabilmesi için geçici izin
// DELETE /api/upload?p=…       → kaydedilmeden vazgeçilen dosyayı siler
// PUT    /api/upload?p=…       → (sadece bilgisayarda denerken) dosyayı yerel klasöre yazar
import { handleUpload } from '@vercel/blob/client';
import { json, assertSameOrigin, route, HttpError } from '../lib/http.js';
import { isAdmin } from '../lib/session.js';
import { loadContent, mediaRefs } from '../lib/content.js';
import { isLocal, saveLocalFile, removeFiles, MEDIA_RE } from '../lib/store.js';

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav',
];
const MAX_BYTES = 30 * 1024 * 1024;
const NAME_RE = /^medya\/[a-z0-9-]{1,80}\.(jpg|png|webp|gif|mp3|m4a|aac|ogg|oga|wav)$/;

async function requireAdmin(request) {
  if (!(await isAdmin(request))) throw new HttpError(401, 'Oturumun kapanmış; tekrar giriş yap.');
}

const handlers = route({
  async POST(request) {
    assertSameOrigin(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'Geçersiz istek.' }, 400);
    try {
      const result = await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname) => {
          await requireAdmin(request);
          if (!NAME_RE.test(pathname)) throw new HttpError(400, 'Geçersiz dosya adı.');
          return {
            allowedContentTypes: ALLOWED_TYPES,
            maximumSizeInBytes: MAX_BYTES,
            addRandomSuffix: true,
            cacheControlMaxAge: 31_536_000,
          };
        },
      });
      return json(result);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error('Yükleme izni verilemedi:', e);
      return json({ error: 'Yükleme başlatılamadı. Biraz sonra tekrar dene.' }, 400);
    }
  },

  async DELETE(request) {
    assertSameOrigin(request);
    await requireAdmin(request);
    const p = new URL(request.url).searchParams.get('p') || '';
    if (!MEDIA_RE.test(p)) return json({ error: 'Geçersiz dosya.' }, 400);
    const { value } = await loadContent({ fresh: true });
    if (mediaRefs(value).has(p)) return json({ ok: true, kept: true });
    await removeFiles([p]);
    return json({ ok: true });
  },

  async PUT(request) {
    if (!isLocal) return json({ error: 'Bulunamadı.' }, 404);
    assertSameOrigin(request);
    await requireAdmin(request);
    const p = new URL(request.url).searchParams.get('p') || '';
    if (!NAME_RE.test(p)) return json({ error: 'Geçersiz dosya adı.' }, 400);
    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.length > MAX_BYTES) return json({ error: 'Dosya çok büyük.' }, 413);
    const dot = p.lastIndexOf('.');
    const pathname = `${p.slice(0, dot)}-${Math.random().toString(36).slice(2, 10)}${p.slice(dot)}`;
    await saveLocalFile(pathname, buf);
    return json({ pathname });
  },
});

export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
export const PUT = handlers.PUT;
