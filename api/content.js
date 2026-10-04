// GET  /api/content            → ziyaretçi için içerik (kilitliyse sadece kapak)
// GET  /api/content?duzenle=1  → düzenleme için tam içerik (şifre gerekli)
// PUT  /api/content            → düzenlemeleri kaydeder (şifre gerekli)
//      { content, etag, force }  force:true → başka yerde kaydedilmiş olsa da üzerine yazar
import { json, readJsonBody, assertSameOrigin, route } from '../lib/http.js';
import {
  loadContent, saveContent, validateContent, publicView, lockedView,
} from '../lib/content.js';
import { isAdmin, canView } from '../lib/session.js';
import { ConflictError, strongEtag } from '../lib/store.js';

const CONFLICT = 'Site bu arada başka bir sekmede ya da cihazda kaydedilmiş.';

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
    const force = body.force === true;
    const etag = typeof body.etag === 'string' && body.etag ? strongEtag(body.etag) : null;

    // Hiçbir şey değişmediyse yazma (Blob işlem kotası boşa gitmesin)
    const current = await loadContent({ fresh: true });
    if (!force && etag && etag === current.etag && JSON.stringify(current.value) === JSON.stringify(next)) {
      return json({ ok: true, etag: current.etag, unchanged: true });
    }

    // Çakışma kontrolünü Blob'un kendisi yapar: belge, düzenleyicinin bildiği sürümde
    // değilse yazma reddedilir. (Okuma birkaç saniye eski olabildiği için burada
    // okunan etiketle karşılaştırmak yanlış "başka yerde kaydedilmiş" uyarısı veriyordu.)
    let saved;
    try {
      saved = await saveContent(next, force ? { force: true } : { etag });
    } catch (e) {
      if (e instanceof ConflictError) return json({ error: CONFLICT, conflict: true }, 409);
      throw e;
    }
    // Not: Kullanılmayan fotoğraflar burada silinmez; “Yüklediklerim”de durur,
    // Deniz isterse oradan geri ekler ya da kendisi siler.
    return json({ ok: true, etag: saved.etag });
  },
});

export const GET = handlers.GET;
export const PUT = handlers.PUT;
