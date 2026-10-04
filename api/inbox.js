// Sena'dan Deniz'e: notlar, kullanılan kuponlar, açılan mektuplar, sınav sonucu…
// POST   /api/inbox            → yeni kayıt (herkese açık, sınırlı)
// GET    /api/inbox            → gelen kutusu (şifre gerekli)
// PATCH  /api/inbox            → hepsini okundu say (şifre gerekli)
// DELETE /api/inbox[?id=…]     → bir kaydı ya da hepsini sil (şifre gerekli)
import { json, readJsonBody, assertSameOrigin, clientIp, route } from '../lib/http.js';
import { loadContent } from '../lib/content.js';
import { canView, isAdmin } from '../lib/session.js';
import { readJson, writeJson, ConflictError } from '../lib/store.js';
import { allow, randomHex } from '../lib/security.js';

const INBOX_PATH = 'ozel/gelen-kutusu.json';
const KEEP = 300;
// tür → en fazla yazı uzunluğu
const TYPES = { not: 2000, hayal: 600, kupon: 300, mektup: 200, evet: 200, sinav: 300, kazi: 200, gizli: 200 };
// Bu türler "bildirimler kapalı" olsa da gelir (Sena bilerek yazdı)
const ALWAYS = new Set(['not', 'hayal']);

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+\n/g, '\n').trim().slice(0, max) : '');

function deviceOf(ua = '') {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'Diğer';
}

async function update(mutator) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await readJson(INBOX_PATH);
    const value = doc ? doc.value : { items: [], readAt: null };
    if (!Array.isArray(value.items)) value.items = [];
    const next = mutator(value);
    try {
      await writeJson(INBOX_PATH, next, doc ? { etag: doc.etag } : { create: true });
      return next;
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt === 3) throw e;
    }
  }
  return null;
}

async function requireAdmin(request) {
  return isAdmin(request);
}

const handlers = route({
  async POST(request) {
    assertSameOrigin(request);
    const ip = clientIp(request);
    if (!allow(`gelen:${ip}`, 25, 3_600_000) || !allow('gelen:*', 90, 3_600_000)) {
      return json({ error: 'Biraz yavaş 🙂 Birazdan tekrar dene.' }, 429);
    }
    const body = await readJsonBody(request, 8_000);
    const type = String(body.type || '');
    if (!TYPES[type]) return json({ error: 'Geçersiz tür.' }, 400);

    const { value: content } = await loadContent();
    if (!(await canView(request, content))) return json({ error: 'Kilitli.' }, 403);
    if (content.site.events === false && !ALWAYS.has(type)) return json({ ok: true, skipped: true });

    const text = str(body.text, TYPES[type]);
    const title = str(body.title, 160);
    if ((type === 'not' || type === 'hayal') && !text) return json({ error: 'Boş gönderilemez.' }, 400);

    const entry = {
      id: randomHex(6),
      type,
      title,
      text,
      at: new Date().toISOString(),
      device: deviceOf(request.headers.get('user-agent') || ''),
      // Deniz kendi denerken gelen kayıtlar ayrı işaretlenir
      ...(await isAdmin(request) ? { test: true } : {}),
    };
    await update((v) => ({ ...v, items: [entry, ...v.items].slice(0, KEEP) }));
    return json({ ok: true });
  },

  async GET(request) {
    if (!(await requireAdmin(request))) return json({ error: 'Önce giriş yapmalısın.' }, 401);
    const doc = await readJson(INBOX_PATH);
    const value = doc ? doc.value : { items: [], readAt: null };
    const items = Array.isArray(value.items) ? value.items : [];
    const readAt = value.readAt ? Date.parse(value.readAt) : 0;
    const unread = items.filter((it) => Date.parse(it.at) > readAt).length;
    return json({ items, readAt: value.readAt || null, unread });
  },

  async PATCH(request) {
    assertSameOrigin(request);
    if (!(await requireAdmin(request))) return json({ error: 'Önce giriş yapmalısın.' }, 401);
    const now = new Date().toISOString();
    await update((v) => ({ ...v, readAt: now }));
    return json({ ok: true, readAt: now });
  },

  async DELETE(request) {
    assertSameOrigin(request);
    if (!(await requireAdmin(request))) return json({ error: 'Önce giriş yapmalısın.' }, 401);
    const id = new URL(request.url).searchParams.get('id');
    await update((v) => ({ ...v, items: id ? v.items.filter((it) => it.id !== id) : [] }));
    return json({ ok: true });
  },
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
