// GET /api/gunluk — Vercel her sabah (~09:00, Türkiye) çağırır (vercel.json → crons):
//  1) içeriğin ve gelen kutusunun o günkü yedeğini alır: ozel/yedek/gunluk/YYYY-MM-DD/…
//  2) Deniz'e tek bir mesajla hatırlatır: bugün/yarın özel gün, bugün açılacak kapsüller,
//     Sena'nın geleceğe yazıp bugün açılan mektupları
// Aynı gün ikinci kez çağrılırsa hiçbir şey yapmaz (dışarıdan çağrılsa da zararsız).
import { json, originOf, route } from '../lib/http.js';
import { loadContent } from '../lib/content.js';
import { readJson, writeJson, copyFile, ConflictError } from '../lib/store.js';
import { notifyText } from '../lib/notify.js';
import { upcoming, parseLocal, daysBetween, formatDate, genitive } from '../public/js/takvim.js';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// Bugünün hatırlatma satırları (sadece hesaplama; test edilebilsin diye ayrı)
export function reminderLines(content, inboxItems, now = new Date()) {
  const names = content.names || {};
  const lines = [];
  for (const it of upcoming(content, now, { horizon: 7 })) {
    if (it.kind === 'kapsul') continue;
    if (it.days === 0) lines.push(`🎉 Bugün: ${it.icon} ${it.title}`);
    else if (it.days === 1) lines.push(`⏰ Yarın: ${it.icon} ${it.title}`);
    else if (it.days === 7 && (it.kind === 'yil' || it.kind === 'dogum' || it.kind === 'etkinlik')) {
      lines.push(`📅 Bir hafta sonra: ${it.icon} ${it.title} (hazırlık zamanı 😉)`);
    }
  }
  for (const cp of (content.future && content.future.capsules) || []) {
    const at = parseLocal(cp && cp.openAt);
    if (at && daysBetween(now, at) === 0) {
      lines.push(`⏳ Bugün ${hhmm(at)}’de ${genitive(names.you || 'Sena')} “${cp.title || 'zaman kapsülü'}” kapsülü açılıyor`);
    }
  }
  for (const it of inboxItems || []) {
    const at = it && it.type === 'gelecek' ? parseLocal(it.openAt) : null;
    if (at && daysBetween(now, at) === 0) {
      const when = parseLocal(it.at) || new Date(it.at);
      lines.push(`📮 ${names.you || 'Sena'} ${formatDate(when)} günü geleceğe bir mektup yazmıştı; bugün açıldı:\n“${String(it.text || '').trim()}”`);
    }
  }
  return lines;
}

const handlers = route({
  async GET(request) {
    const secret = process.env.CRON_SECRET;
    if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Yetkisiz.' }, 401);
    const now = new Date();
    const today = ymd(now);
    try {
      await writeJson(`ozel/gunluk/${today}.json`, { at: now.toISOString() }, { create: true });
    } catch (e) {
      if (e instanceof ConflictError) return json({ ok: true, already: true });
      throw e;
    }

    const backups = [];
    for (const p of ['ozel/icerik.json', 'ozel/gelen-kutusu.json']) {
      try {
        if (await copyFile(p, `ozel/yedek/gunluk/${today}/${p.split('/').pop()}`)) backups.push(p);
      } catch (e) {
        console.error(`[gunluk] yedeklenemedi: ${p}`, e);
      }
    }

    const { value: content } = await loadContent({ fresh: true });
    const inbox = await readJson('ozel/gelen-kutusu.json').catch(() => null);
    const lines = reminderLines(content, inbox && inbox.value && inbox.value.items, now);
    let sent = 0;
    if (lines.length) {
      const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
      const origin = host ? `https://${host}` : originOf(request);
      const me = (content.names && content.names.me) || 'Deniz';
      const res = await notifyText(content, `🌅 Günaydın ${me}! Bugün için küçük hatırlatmalar:`, lines.join('\n'), origin);
      sent = res.count;
    }
    return json({ ok: true, backups, reminders: lines.length, sent });
  },
});

export const GET = handlers.GET;
