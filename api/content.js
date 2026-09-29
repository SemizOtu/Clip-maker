// GET  /api/content            → ziyaretçi için içerik (kilitliyse sadece kapak)
// GET  /api/content?duzenle=1  → düzenleme için tam içerik (şifre gerekli)
// PUT  /api/content            → düzenlemeleri kaydeder (şifre gerekli)
import { json, readJsonBody, assertSameOrigin, route } from '../lib/http.js';
import {
  loadContent, saveContent, validateContent, publicView, lockedView, mediaRefs,
} from '../lib/content.js';
import { isAdmin, canView } from '../lib/session.js';
import { removeFiles, ConflictError } from '../lib/store.js';

const handlers = route({
  async GET(request) {
    const url = new URL(request.url);
    if (url.searchParams.has('duzenle')) {
      if (!(await isAdmin(request))) return json({ error: 'Önce giriş yapmalısın.' }, 401);
      const doc = await loadContent({ fresh: true });
      return json({ content: doc.value, etag: doc.etag });
    }
    const doc = await loadContent();
    if (!(await canView(request, doc.value))) {
      return json({ locked: true, content: lockedView(doc.value) });
    }
    return json({ locked: false, admin: await isAdmin(request), content: publicView(doc.value) });
  },

  async PUT(request) {
    assertSameOrigin(request);
    if (!(await isAdmin(request))) return json({ error: 'Oturumun kapanmış; tekrar giriş yap.' }, 401);
    const body = await readJsonBody(request, 1_000_000);
    const next = validateContent(body.content);
    const current = await loadContent({ fresh: true });

    if (current.etag && body.etag !== current.etag) {
      return json({ error: 'Site başka bir yerden değiştirilmiş. Sayfayı yenileyip tekrar dene.', conflict: true }, 409);
    }
    if (current.etag && JSON.stringify(current.value) === JSON.stringify(next)) {
      return json({ ok: true, etag: current.etag, unchanged: true });
    }

    let saved;
    try {
      saved = await saveContent(next, current.etag);
    } catch (e) {
      if (e instanceof ConflictError) {
        return json({ error: 'Site başka bir yerden değiştirilmiş. Sayfayı yenileyip tekrar dene.', conflict: true }, 409);
      }
      throw e;
    }

    // Artık kullanılmayan fotoğraf ve şarkıları depodan temizle
    const before = mediaRefs(current.value);
    const after = mediaRefs(next);
    const removed = [...before].filter((p) => !after.has(p));
    if (removed.length) {
      try { await removeFiles(removed); } catch (e) { console.warn('Eski dosyalar silinemedi:', e); }
    }
    return json({ ok: true, etag: saved.etag });
  },
});

export const GET = handlers.GET;
export const PUT = handlers.PUT;
