// Günün sorusu (kilit açıksa görmeye izni olanlar)
// GET  /api/soru              → bugünün sorusu, benim cevabım, karşı tarafın cevabı (ben cevapladıysam) ve arşiv
// POST /api/soru { text, date? } → cevabımı kaydeder (son 60 günün sorusu da cevaplanabilir)
// Giriş yapmış olan Deniz'dir, diğer herkes Sena. Biri cevaplamadan öbürünün cevabı ona gönderilmez.
import { json, readJsonBody, assertSameOrigin, clientIp, originOf, route } from '../lib/http.js';
import { loadContent } from '../lib/content.js';
import { canView, isAdmin } from '../lib/session.js';
import { readJson, updateJson } from '../lib/store.js';
import { allow } from '../lib/security.js';
import { notifyText } from '../lib/notify.js';
import { questionFor, ymd } from '../public/js/sorular.js';
import { parseLocal, daysBetween } from '../public/js/takvim.js';

const PATH = 'ozel/sorular.json';
const MAX = 600;
const KEEP_DAYS = 60;

function view(days, who, today, extra) {
  const other = who === 'sena' ? 'deniz' : 'sena';
  const pack = (date, e) => {
    const mine = e && e[who] ? e[who].text : null;
    return {
      date,
      q: (e && e.q) || questionFor(parseLocal(date), extra),
      mine,
      other: mine && e && e[other] ? e[other].text : null,
      otherAnswered: Boolean(e && e[other]),
    };
  };
  const archive = Object.keys(days)
    .filter((d) => d < today && days[d] && (days[d].sena || days[d].deniz))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, KEEP_DAYS)
    .map((d) => pack(d, days[d]));
  return { who, today: pack(today, days[today]), archive };
}

const handlers = route({
  async GET(request) {
    const { value: content } = await loadContent();
    if (!(await canView(request, content))) return json({ error: 'Kilitli.' }, 403);
    const who = (await isAdmin(request)) ? 'deniz' : 'sena';
    const doc = await readJson(PATH);
    const days = (doc && doc.value && doc.value.days) || {};
    return json(view(days, who, ymd(new Date()), content.home && content.home.askQuestions));
  },

  async POST(request) {
    assertSameOrigin(request);
    if (!allow(`soru:${clientIp(request)}`, 20, 3_600_000)) return json({ error: 'Biraz yavaş 🙂 Birazdan tekrar dene.' }, 429);
    const { value: content } = await loadContent();
    if (!(await canView(request, content))) return json({ error: 'Kilitli.' }, 403);
    const who = (await isAdmin(request)) ? 'deniz' : 'sena';
    const body = await readJsonBody(request, 4_000);
    const text = typeof body.text === 'string' ? body.text.replace(/\s+\n/g, '\n').trim().slice(0, MAX) : '';
    if (!text) return json({ error: 'Boş cevap gönderilemez.' }, 400);
    const now = new Date();
    const today = ymd(now);
    const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today;
    const age = daysBetween(parseLocal(date), now);
    if (age < 0 || age > KEEP_DAYS) return json({ error: 'Bu sorunun süresi geçmiş.' }, 400);
    const extra = content.home && content.home.askQuestions;

    let already = false;
    const saved = await updateJson(PATH, (v) => {
      const days = { ...(v.days || {}) };
      const e = { ...(days[date] || {}) };
      already = Boolean(e[who]);
      if (already) return null;
      e.q = e.q || questionFor(parseLocal(date), extra);
      e[who] = { text, at: now.toISOString() };
      days[date] = e;
      return { ...v, days };
    }, () => ({ days: {} }));
    if (already) return json({ error: 'Bu soruyu zaten cevapladın 💞' }, 409);

    const e = saved.days[date];
    if (who === 'sena') {
      const names = content.names || {};
      const you = names.you || 'Sena';
      const body2 = e.deniz
        ? `İkiniz de cevapladınız, cevaplar açıldı 💞\n\n${you}: “${text}”\nSen: “${e.deniz.text}”`
        : 'Sen de cevaplayınca iki cevap birden açılacak 💞 (sitede “Günün sorusu”)';
      await notifyText(content, `❓ ${you} ${date === today ? 'günün' : 'bir'} sorusunu cevapladı: “${e.q}”`, body2, originOf(request))
        .catch(() => {});
    }
    return json(view(saved.days, who, today, extra));
  },
});

export const GET = handlers.GET;
export const POST = handlers.POST;
