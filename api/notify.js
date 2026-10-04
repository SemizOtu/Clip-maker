// POST /api/notify → Ayarlar'daki "Deneme gönder" düğmesi (şifre gerekli)
//   { kind: 'whatsapp', phone, apikey }  ya da  { kind: 'ntfy', topic }
import { json, readJsonBody, assertSameOrigin, clientIp, originOf, route } from '../lib/http.js';
import { isAdmin } from '../lib/session.js';
import { allow } from '../lib/security.js';
import { loadContent } from '../lib/content.js';
import { normalizePhone, sendTest, TOPIC_RE } from '../lib/notify.js';

const handlers = route({
  async POST(request) {
    assertSameOrigin(request);
    if (!(await isAdmin(request))) return json({ error: 'Önce giriş yapmalısın.' }, 401);
    if (!allow(`bildirim:${clientIp(request)}`, 12, 10 * 60_000)) {
      return json({ error: 'Çok sık denedin; birkaç dakika sonra tekrar dene.' }, 429);
    }
    const body = await readJsonBody(request, 2_000);
    let target;
    if (body.kind === 'whatsapp') {
      const phone = normalizePhone(body.phone);
      const apikey = String(body.apikey || '').trim();
      if (!phone) return json({ error: 'Telefon numarasını ülke koduyla yaz (ör. +90 532 123 45 67).' }, 400);
      if (!apikey) return json({ error: 'CallMeBot’un gönderdiği API anahtarını yaz.' }, 400);
      target = { kind: 'whatsapp', phone, apikey };
    } else if (body.kind === 'ntfy') {
      const topic = String(body.topic || '').trim();
      if (!topic) return json({ error: 'Önce “Konu oluştur”a bas.' }, 400);
      if (!TOPIC_RE.test(topic)) return json({ error: 'Konu adı geçersiz.' }, 400);
      target = { kind: 'ntfy', topic };
    } else {
      return json({ error: 'Geçersiz istek.' }, 400);
    }
    const { value } = await loadContent();
    try {
      await sendTest(target, value, originOf(request));
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502);
    }
    return json({ ok: true, phone: target.phone || null });
  },
});

export const POST = handlers.POST;
