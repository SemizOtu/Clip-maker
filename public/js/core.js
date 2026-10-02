// Ortak yardımcılar ve uygulama durumu

export const HEART_PATH = 'M50 96C50 96 2 66 2 34C2 15 15 3 30 3C40 3 47 9 50 17C53 9 60 3 70 3C85 3 98 15 98 34C98 66 50 96 50 96Z';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export const CHAPTERS = [
  { key: 'home', slug: 'biz' },
  { key: 'story', slug: 'hikayemiz' },
  { key: 'gallery', slug: 'anilarimiz' },
  { key: 'letter', slug: 'mektubum' },
  { key: 'reasons', slug: 'neden-sen' },
  { key: 'quiz', slug: 'sinav' },
  { key: 'dreams', slug: 'hayallerimiz' },
  { key: 'surprise', slug: 'surprizler' },
  { key: 'finale', slug: 'sonsuza-dek' },
];

export const state = {
  content: null,
  locked: false,
  editing: false,
  admin: false,
  current: -1,
  startKey: null,
  busy: false,
  stops: [],
  answered: false,
  noCount: 0,
  localUrls: new Map(),
};

/* ------------------------------------------------------------------ */
/* İçerik yolları                                                      */
/* ------------------------------------------------------------------ */
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let o = obj;
  for (const k of keys) {
    if (o[k] == null) o[k] = /^\d+$/.test(k) ? [] : {};
    o = o[k];
  }
  o[last] = value;
}

// Görünür bölümler (düzenlerken hepsi görünür)
export function visibleChapters() {
  const flags = state.content?.site?.chapters || {};
  return CHAPTERS.filter((ch) => state.editing || flags[ch.key] !== false);
}

export function chapterNumber(key) {
  const i = visibleChapters().findIndex((c) => c.key === key);
  return i < 0 ? '' : ROMAN[i];
}

/* ------------------------------------------------------------------ */
/* DOM                                                                 */
/* ------------------------------------------------------------------ */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function svg(viewBox, inner, cls) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  if (cls) el.setAttribute('class', cls);
  el.innerHTML = inner;
  return el;
}

export const heartSvg = (cls) => svg('0 0 100 100', `<path d="${HEART_PATH}"/>`, cls);
export const arrowSvg = () => svg('0 0 24 24', '<path d="M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4z"/>');
export const sparkleSvg = (cls) => svg('0 0 24 24', '<path d="M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z"/>', cls);
export const checkSvg = () => svg('0 0 24 24', '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>');

export function flourish() {
  return svg('0 0 200 24',
    '<path d="M8 13c22 0 32-8 50-8 14 0 20 8 30 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
    + '<path d="M192 13c-22 0-32-8-50-8-14 0-20 8-30 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
    + '<circle cx="5" cy="13" r="1.9" fill="currentColor"/><circle cx="195" cy="13" r="1.9" fill="currentColor"/>'
    + `<path transform="translate(90 3) scale(.2)" d="${HEART_PATH}" fill="currentColor"/>`,
    'flourish');
}

function wavyCircle(cx, cy, r, amp, bumps) {
  let d = '';
  const n = bumps * 10;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r + Math.sin(a * bumps) * amp;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`;
  }
  return `${d}Z`;
}

let sealCount = 0;
export function waxSeal(cls, { initials = '', plain = false } = {}) {
  const id = `seal-g${++sealCount}`;
  let mark = `<path transform="translate(32 33) scale(.36)" d="${HEART_PATH}" fill="#ffd9e3" opacity=".92"/>`;
  if (initials) mark = `<text x="50" y="58" text-anchor="middle" font-family="Great Vibes, cursive" font-size="30" fill="#ffd9e3" opacity=".95">${escapeXml(initials)}</text>`;
  if (plain) mark = '';
  return svg('0 0 100 100',
    `<defs><radialGradient id="${id}" cx="36%" cy="30%" r="75%"><stop offset="0" stop-color="#ff6b92"/><stop offset=".5" stop-color="#c8103f"/><stop offset="1" stop-color="#6d0724"/></radialGradient></defs>`
    + `<path d="${wavyCircle(50, 50, 45, 2.8, 13)}" fill="url(#${id})"/>`
    + '<circle cx="50" cy="50" r="32" fill="none" stroke="rgba(255,255,255,.26)" stroke-width="2"/>'
    + '<circle cx="50" cy="50" r="35.5" fill="none" stroke="rgba(0,0,0,.14)" stroke-width="1.2"/>'
    + mark,
    cls);
}

export function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

export function pointOf(e, el) {
  if (e && (e.clientX || e.clientY)) return { x: e.clientX, y: e.clientY };
  if (el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Medya adresleri                                                     */
/* ------------------------------------------------------------------ */
export function mediaUrl(p) {
  if (!p) return '';
  if (state.localUrls.has(p)) return state.localUrls.get(p);
  if (/^(blob:|data:|https?:|\/)/.test(p)) return p;
  return `/api/media?p=${encodeURIComponent(p)}`;
}

/* ------------------------------------------------------------------ */
/* Yazı ve tarih                                                       */
/* ------------------------------------------------------------------ */
export function paragraphs(text) {
  return String(text || '').split(/\n\s*\n+/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
}

export function parseDate(s) {
  if (!s) return null;
  // “2024-05-17” gibi sadece tarih olanlar yerel saatle okunsun (UTC değil)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const fmtNum = (n) => Math.round(n).toLocaleString('tr-TR');

export function initials(name) {
  return String(name || '').trim().charAt(0).toLocaleUpperCase('tr');
}

// Ayı güvenle ekler (31 Ocak + 1 ay → 28/29 Şubat)
export function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

export function diffParts(a, b) {
  if (b < a) [a, b] = [b, a];
  let y = b.getFullYear() - a.getFullYear();
  let mo = b.getMonth() - a.getMonth();
  let d = b.getDate() - a.getDate();
  let hh = b.getHours() - a.getHours();
  let mi = b.getMinutes() - a.getMinutes();
  let s = b.getSeconds() - a.getSeconds();
  if (s < 0) { s += 60; mi--; }
  if (mi < 0) { mi += 60; hh--; }
  if (hh < 0) { hh += 24; d--; }
  if (d < 0) { d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); mo--; }
  if (d < 0) d = 0;
  if (mo < 0) { mo += 12; y--; }
  return { y, mo, d, h: hh, mi, s };
}

export function daysBetween(a, b) {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86_400_000);
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayIndex(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

export function relTime(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86_400) return `${Math.floor(s / 3600)} saat önce`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} gün önce`;
  return new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ------------------------------------------------------------------ */
/* Tarayıcı deposu (hata vermeyen)                                     */
/* ------------------------------------------------------------------ */
export const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* yok say */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* yok say */ }
  },
};

/* ------------------------------------------------------------------ */
/* Bildirim ve küçük pencere                                           */
/* ------------------------------------------------------------------ */
let toastTimer = 0;
export function toast(msg, { error = false, ms = 3400 } = {}) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Sonuç: “yes” → true, “no” → false, pencere kapatılırsa (dışına dokunma / Esc) → null
export function dialog({ icon = '💌', title = '', text = '', yes = 'Tamam', no = null, wide = false, body = null } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const back = h('div', { class: 'dialog-back no-burst' });
    let finished = false;
    const done = (v) => {
      if (finished) return;
      finished = true;
      back.classList.add('closing');
      setTimeout(() => back.remove(), 220);
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    const box = h('div', { class: `dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || text || 'Pencere' },
      icon ? h('div', { class: 'dialog-icon', 'aria-hidden': 'true' }, icon) : null,
      title ? h('h3', { class: 'dialog-title' }, title) : null,
      text ? h('p', { class: 'dialog-text' }, text) : null,
      body,
      h('div', { class: 'dialog-btns' },
        no ? h('button', { class: 'link-btn', type: 'button', onclick: () => done(false) }, no) : null,
        yes ? h('button', { class: 'btn', type: 'button', onclick: () => done(true) }, yes) : null));
    back.append(box);
    back.addEventListener('click', (e) => { if (e.target === back) done(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    const focusEl = $('.btn', box) || $('button', box);
    if (focusEl) focusEl.focus({ preventScroll: true });
  });
}
