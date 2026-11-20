// Takvim: yaklaşan özel günler, zaman kapsülleri ve tarih yardımcıları.
// Tarayıcıda da sunucuda da (günlük hatırlatıcı) kullanılır; DOM'a dokunmaz.

// “2024-05-17” ya da “2024-05-17T20:00” → yerel saatle Date
export function parseLocal(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(String(s).trim());
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0))
    : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysBetween(a, b) {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86_400_000);
}

export function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

export const calMonths = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());

// Türkçe iyelik eki: Sena → Sena’nın, Deniz → Deniz’in
export function genitive(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  const vowels = n.toLocaleLowerCase('tr').match(/[aeıioöuü]/g);
  const last = vowels ? vowels[vowels.length - 1] : 'e';
  const suffix = { a: 'ın', ı: 'ın', e: 'in', i: 'in', o: 'un', u: 'un', ö: 'ün', ü: 'ün' }[last];
  const endsVowel = /[aeıioöuü]$/i.test(n.toLocaleLowerCase('tr'));
  return `${n}’${endsVowel ? 'n' : ''}${suffix}`;
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const formatDate = (d, { weekday = false, year = true } = {}) =>
  `${d.getDate()} ${AYLAR[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ''}${weekday ? `, ${GUNLER[d.getDay()]}` : ''}`;

// Bir sonraki yıllık tekrar (bugünse bugün)
function nextYearly(base, today) {
  let d = new Date(today.getFullYear(), base.getMonth(), base.getDate());
  if (base.getMonth() === 1 && base.getDate() === 29 && d.getMonth() !== 1) d = new Date(today.getFullYear(), 1, 28);
  if (daysBetween(today, d) < 0) d = new Date(today.getFullYear() + 1, base.getMonth(), base.getDate());
  return d;
}

// Kapsül/ileri tarihli mektup açıldı mı?
export const isOpen = (openAt, now = new Date()) => {
  const d = parseLocal(openAt);
  return !d || d <= now;
};

// Yaklaşan günler: [{ key, icon, title, date, days, kind }], tarihe göre sıralı
export function upcoming(content, now = new Date(), { horizon = 400 } = {}) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const names = (content && content.names) || {};
  const site = (content && content.site) || {};
  const out = [];
  const add = (it) => {
    const days = daysBetween(today, it.date);
    if (days >= 0 && days <= horizon) out.push({ ...it, days });
  };

  const since = parseLocal(site.since);
  if (since && since <= now) {
    // sıradaki ay dönümü (12'nin katıysa yıl dönümü)
    let n = calMonths(since, today);
    if (daysBetween(today, addMonths(since, n)) < 0) n += 1;
    if (n === 0) n = 1;
    const monthDate = addMonths(since, n);
    if (n % 12 === 0) add({ key: `yil-${n / 12}`, icon: '🥂', title: `${n / 12}. yıl dönümümüz`, date: monthDate, kind: 'yil' });
    else add({ key: `ay-${n}`, icon: '💞', title: `${n}. ayımız`, date: monthDate, kind: 'ay' });
    // ve sıradaki yıl dönümü
    const years = Math.ceil(calMonths(since, today) / 12) || 1;
    let y = years;
    let yd = addMonths(since, y * 12);
    if (daysBetween(today, yd) < 0) { y += 1; yd = addMonths(since, y * 12); }
    if (y * 12 !== n) add({ key: `yil-${y}`, icon: '🥂', title: `${y}. yıl dönümümüz`, date: yd, kind: 'yil' });
    // 100'ün katı olan günler (yarım/bin özel)
    const total = daysBetween(since, today);
    for (const k of [100, 500, 1000]) {
      const target = (Math.floor(total / k) + (total % k === 0 && total > 0 ? 0 : 1)) * k;
      const d = new Date(since.getFullYear(), since.getMonth(), since.getDate() + target);
      if (target > 0 && !out.some((o) => o.key === `gun-${target}`)) {
        add({ key: `gun-${target}`, icon: target % 1000 === 0 ? '🎇' : '✨', title: `Birlikte ${target.toLocaleString('tr-TR')}. günümüz`, date: d, kind: 'gun' });
      }
    }
  }

  const bd = parseLocal(site.birthday);
  if (bd) add({ key: 'dogum-o', icon: '🎂', title: `${genitive(names.you || 'Sena')} doğum günü`, date: nextYearly(bd, today), kind: 'dogum' });
  const bd2 = parseLocal(site.myBirthday);
  if (bd2) add({ key: 'dogum-ben', icon: '🎁', title: `${genitive(names.me || 'Deniz')} doğum günü`, date: nextYearly(bd2, today), kind: 'dogum' });
  add({ key: 'sevgililer', icon: '💘', title: 'Sevgililer Günü', date: nextYearly(new Date(2000, 1, 14), today), kind: 'genel' });
  add({ key: 'yilbasi', icon: '🎆', title: 'Yeni yıl', date: nextYearly(new Date(2000, 0, 1), today), kind: 'genel' });

  const fut = (content && content.future) || {};
  (Array.isArray(fut.events) ? fut.events : []).forEach((ev, i) => {
    const d = parseLocal(ev && ev.date);
    if (!d || !String(ev.title || '').trim()) return;
    add({
      key: `etkinlik-${i}`, icon: ev.icon || '📌', title: String(ev.title).trim(),
      date: ev.yearly ? nextYearly(d, today) : d, time: /T\d/.test(String(ev.date)) ? d : null, kind: 'etkinlik', index: i,
    });
  });
  (Array.isArray(fut.capsules) ? fut.capsules : []).forEach((cp, i) => {
    const d = parseLocal(cp && cp.openAt);
    if (!d || d <= now) return;
    add({ key: `kapsul-${i}`, icon: '⏳', title: `“${cp.title || 'Zaman'}” kapsülü açılıyor`, date: d, kind: 'kapsul', index: i });
  });

  return out.sort((a, b) => a.date - b.date || a.key.localeCompare(b.key));
}

// “3 gün”, “2 ay 5 gün”, “1 yıl 2 ay” gibi kısa kalan süre
export function remaining(target, now = new Date()) {
  const ms = target - now;
  if (ms <= 0) return 'şimdi';
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) {
    const h = Math.floor(ms / 3_600_000);
    return h ? `${h} saat` : `${Math.max(1, Math.floor(ms / 60_000))} dakika`;
  }
  if (days < 45) return `${days} gün`;
  const months = calMonths(now, target) - (target.getDate() < now.getDate() ? 1 : 0);
  if (months < 12) {
    const rest = daysBetween(addMonths(now, months), target);
    return rest > 0 ? `${months} ay ${rest} gün` : `${months} ay`;
  }
  const y = Math.floor(months / 12);
  const mo = months % 12;
  return mo ? `${y} yıl ${mo} ay` : `${y} yıl`;
}

// Telefona eklenebilen takvim dosyası (.ics)
export function icsFor({ title, date, time = null, yearly = false, description = '' }) {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const esc = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const start = time ? `DTSTART:${ymd(time)}T${pad(time.getHours())}${pad(time.getMinutes())}00` : `DTSTART;VALUE=DATE:${ymd(date)}`;
  const endD = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const end = time ? `DTEND:${ymd(time)}T${pad((time.getHours() + 1) % 24)}${pad(time.getMinutes())}00` : `DTEND;VALUE=DATE:${ymd(endD)}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Deniz ve Sena//TR', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${ymd(date)}-${Math.random().toString(36).slice(2)}@deniz-ve-sena`, `DTSTAMP:${stamp}`, start, end,
    yearly ? 'RRULE:FREQ=YEARLY' : null, `SUMMARY:${esc(title)}`, description ? `DESCRIPTION:${esc(description)}` : null,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'TRIGGER:-P1D', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}
