// POST /api/unlock { answer } → kilit sorusunun cevabı doğruysa ziyaretçi çerezi verir
import { json, readJsonBody, assertSameOrigin, clientIp, route } from '../lib/http.js';
import { loadContent, isLockActive, lockAnswers } from '../lib/content.js';
import { viewerCookie } from '../lib/session.js';
import { allow, normalizeAnswer } from '../lib/security.js';

const handlers = route({
  async POST(request) {
    assertSameOrigin(request);
    const ip = clientIp(request);
    if (!allow(`kilit:${ip}`, 15, 15 * 60_000) || !allow('kilit:*', 150, 15 * 60_000)) {
      return json({ error: 'Çok fazla deneme oldu. Biraz dinlenip sonra tekrar dene 🙈' }, 429);
    }
    const body = await readJsonBody(request, 2_000);
    const { value } = await loadContent({ fresh: true });
    if (!isLockActive(value)) return json({ ok: true });
    const given = normalizeAnswer(body.answer);
    if (!given || !lockAnswers(value).includes(given)) {
      return json({ ok: false, error: value.site.lock.wrong || 'Bu değil gibi 🙈' }, 403);
    }
    return json({ ok: true }, 200, { 'Set-Cookie': await viewerCookie(value) });
  },
});

export const POST = handlers.POST;
