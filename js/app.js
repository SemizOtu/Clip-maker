// Sana Özel ❤ — sitenin ana mantığı
import { startBackground, createFX, splitLetters, splitWords, typewriter, reducedMotion, HEART_PATH } from './effects.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const rand = (a, b) => a + Math.random() * (b - a);

const query = new URLSearchParams(location.search);
const EDIT = query.has('duzenle') || query.has('edit');

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const CHAPTERS = [
  { key: 'home', slug: 'biz' },
  { key: 'story', slug: 'hikayemiz' },
  { key: 'gallery', slug: 'anilarimiz' },
  { key: 'letter', slug: 'mektubum' },
  { key: 'reasons', slug: 'neden-sen' },
  { key: 'surprise', slug: 'surprizler' },
  { key: 'finale', slug: 'sonsuza-dek' },
];

const LOVE_WORDS = [
  'Seni seviyorum', 'I love you', "Je t'aime", 'Te amo', 'Ti amo', 'Ich liebe dich', 'Eu te amo',
  'Ik hou van jou', 'Te iubesc', 'Kocham cię', 'Szeretlek', 'Jag älskar dig', 'Mahal kita',
  'Səni sevirəm', 'Volim te', 'Rakastan sinua', 'Σ’ αγαπώ', 'Я тебя люблю', '愛してる', '사랑해',
];
const POLAROID_TILT = [-3.5, 2.5, -1.5, 4, -2.5, 1.5, -4, 3];

const state = {
  content: null,
  editing: EDIT,
  current: -1,
  startIndex: 0,
  busy: false,
  stops: [],
  answered: false,
  noCount: 0,
  photoOverrides: new Map(),
  rawBase: '',
};

let fx = null;
let io = null;

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
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
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// Düzenlenebilir yazı öğesi
function T(tag, path, cls, props = {}) {
  const v = getPath(state.content, path);
  return h(tag, { class: cls, 'data-edit': path, ...props }, v == null ? '' : String(v));
}

function svg(viewBox, inner, cls) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  if (cls) el.setAttribute('class', cls);
  el.innerHTML = inner;
  return el;
}

const heartSvg = (cls) => svg('0 0 100 100', `<path d="${HEART_PATH}"/>`, cls);
const arrowSvg = () => svg('0 0 24 24', '<path d="M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4z"/>');
const sparkleSvg = (cls) => svg('0 0 24 24', '<path d="M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z"/>', cls);

function flourish() {
  return svg('0 0 200 24',
    '<path d="M8 13c22 0 32-8 50-8 14 0 20 8 30 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
    '<path d="M192 13c-22 0-32-8-50-8-14 0-20 8-30 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
    '<circle cx="5" cy="13" r="1.9" fill="currentColor"/><circle cx="195" cy="13" r="1.9" fill="currentColor"/>' +
    `<path transform="translate(90 3) scale(.2)" d="${HEART_PATH}" fill="currentColor"/>`,
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
  return d + 'Z';
}

const sealSvg = () => svg('0 0 100 100',
  '<defs><radialGradient id="seal-g" cx="36%" cy="30%" r="75%"><stop offset="0" stop-color="#ff7196"/><stop offset=".55" stop-color="#cf1149"/><stop offset="1" stop-color="#7d0a2d"/></radialGradient></defs>' +
  `<path d="${wavyCircle(50, 50, 45, 2.6, 13)}" fill="url(#seal-g)"/>` +
  '<circle cx="50" cy="50" r="31" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2"/>' +
  `<path transform="translate(32 33) scale(.36)" d="${HEART_PATH}" fill="#ffd6e0" opacity=".92"/>`,
  'letter-seal');

const flowerSvg = () => svg('0 0 64 64',
  '<path d="M33 36 Q30 48 35 62" stroke="#86b89a" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
  '<path d="M34 50 Q44 42 50 47 Q42 55 34 50Z" fill="#a9d6b8"/>' +
  '<path d="M32 44 Q22 38 17 42 Q24 50 32 44Z" fill="#b9e0c6"/>' +
  '<g transform="translate(32 24)">' +
  [0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-9" rx="7" ry="10.5" fill="#ffb3c6" transform="rotate(${a})"/>`).join('') +
  [36, 108, 180, 252, 324].map((a) => `<ellipse cx="0" cy="-6" rx="4" ry="6.5" fill="#ff8fab" transform="rotate(${a})"/>`).join('') +
  '<circle r="4" fill="#f7c26b"/></g>',
  'letter-flower');

function pointOf(e, el) {
  if (e && (e.clientX || e.clientY)) return { x: e.clientX, y: e.clientY };
  if (el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Fotoğraf yuvaları                                                   */
/* ------------------------------------------------------------------ */
export function photoUrl(p) {
  if (!p) return '';
  if (state.photoOverrides.has(p)) return state.photoOverrides.get(p);
  return p;
}

function photoSlot(path, { aspects = '1', fixed = false, cls = '', alt = '', zoom = false, caption = '' } = {}) {
  const value = getPath(state.content, path);
  const first = aspects.split(',')[0].trim();
  const el = h('div', {
    class: `slot${fixed ? ' fixed' : ''}${cls ? ' ' + cls : ''}${value ? '' : ' empty'}`,
    'data-photo': path,
    'data-aspects': aspects,
    'data-zoom': zoom && value ? '' : null,
    'data-caption': caption || null,
  });
  if (value) {
    const img = h('img', { src: photoUrl(value), alt: alt || 'Fotoğrafımız', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => {
      if (state.rawBase && !img.dataset.retried && !/^(blob:|data:|https?:)/.test(value)) {
        img.dataset.retried = '1';
        img.src = state.rawBase + value;
      }
    });
    el.append(img);
    if (fixed) el.style.aspectRatio = first;
  } else {
    el.style.aspectRatio = first;
    el.append(h('div', { class: 'slot-empty' }, heartSvg(), h('span', {}, state.editing ? 'Fotoğraf ekle' : 'Fotoğrafımız')));
  }
  return el;
}

function heartPhoto(path, captionPath) {
  return h('figure', { class: 'heart-wrap reveal' },
    h('div', { class: 'heart-frame' }, photoSlot(path, { fixed: true, aspects: '1', alt: 'En sevdiğim fotoğrafımız' })),
    sparkleSvg('sparkle s1'), sparkleSvg('sparkle s2'), sparkleSvg('sparkle s3'),
    captionPath ? T('figcaption', captionPath, 'heart-caption') : null);
}

/* ------------------------------------------------------------------ */
/* Bölümler                                                            */
/* ------------------------------------------------------------------ */
function chapterShell(idx, ...content) {
  const ch = CHAPTERS[idx];
  return h('section', {
    class: `chapter ${ch.key === 'finale' ? 'finale' : ''}`,
    id: `ch-${ch.key}`,
    'data-ch': ch.key,
    'aria-label': state.content[ch.key]?.title || '',
  }, h('div', { class: 'wrap' }, ...content, chNav(idx)));
}

function chHead(key, idx) {
  const c = state.content[key];
  return h('header', { class: 'ch-head' },
    h('p', { class: 'ch-eyebrow reveal' }, `Bölüm ${ROMAN[idx]}`),
    T('h2', `${key}.title`, 'ch-title script shimmer ink'),
    flourish(),
    c.intro != null ? T('p', `${key}.intro`, 'ch-intro reveal', { style: { '--d': '.3s' } }) : null);
}

function chNav(idx) {
  const next = CHAPTERS[idx + 1];
  return h('nav', { class: 'ch-nav reveal', 'aria-label': 'Sayfa geçişi' },
    next ? h('button', { class: 'next-card', type: 'button', 'data-go': 'next' },
      h('span', { class: 'next-label' }, 'Sıradaki bölüm'),
      h('span', { class: 'next-title script', 'data-bind': `${next.key}.title` }, state.content[next.key].title),
      h('span', { class: 'next-arrow' }, arrowSvg())) : null,
    idx > 0 ? h('button', { class: 'link-btn', type: 'button', 'data-go': 'prev' }, '← Önceki bölüm') : null);
}

function renderHome(idx) {
  const c = state.content.home;
  const title = T('h1', 'home.title', 'hero-title script bloom');
  if (!state.editing) splitLetters(title);

  const rotator = state.editing
    ? h('div', { class: 'rotator ed-rotator' },
      T('span', 'home.rotatingPrefix', 'rot-prefix'),
      h('div', { class: 'ed-chips', 'data-list': 'home.rotating' },
        (c.rotating || []).map((w, i) => h('span', { class: 'ed-chip-wrap', 'data-index': i },
          T('span', `home.rotating.${i}`, 'ed-chip')))))
    : h('p', { class: 'rotator reveal', style: { '--d': '.9s' } },
      T('span', 'home.rotatingPrefix', 'rot-prefix'), ' ',
      h('span', { class: 'word', 'data-rotator': '' }),
      h('span', { class: 'caret', 'aria-hidden': 'true' }));

  const units = [['y', 'Yıl'], ['mo', 'Ay'], ['d', 'Gün'], ['h', 'Saat'], ['mi', 'Dakika'], ['s', 'Saniye']];
  const counter = h('section', { class: 'counter reveal', 'data-counter': '' },
    T('h3', 'home.counterTitle', 'counter-title script'),
    h('div', { class: 'counter-grid' }, units.map(([k, label]) =>
      h('div', { class: 'cbox', 'data-u': k }, h('b', {}, '0'), h('span', {}, label)))),
    h('p', { class: 'counter-total' }, 'Tam ', h('strong', { 'data-total': '' }, '0'), ' gündür kalbim seninle.'),
    T('p', 'home.counterNote', 'counter-note'));

  return chapterShell(idx,
    h('div', { class: 'hero' },
      T('p', 'home.kicker', 'hero-kicker reveal'),
      title,
      T('p', 'home.lead', 'hero-lead reveal', { style: { '--d': '.6s' } }),
      rotator),
    heartPhoto('home.photo', 'home.photoCaption'),
    counter,
    T('p', 'home.quote', 'quote reveal'),
    h('div', { class: 'home-cta reveal' },
      h('button', { class: 'btn btn-big', type: 'button', 'data-go': 'next' }, heartSvg(), 'Hikayemize başla')));
}

function renderStory(idx) {
  const c = state.content.story;
  const items = c.items || [];
  return chapterShell(idx,
    chHead('story', idx),
    h('ol', { class: 'timeline', 'data-list': 'story.items' },
      items.map((it, i) => h('li', { class: 'tl-item reveal', 'data-index': i },
        h('span', { class: 'tl-dot' }, heartSvg()),
        h('article', { class: 'tl-card' },
          T('span', `story.items.${i}.date`, 'tl-date'),
          T('h3', `story.items.${i}.title`, 'tl-title'),
          (it.photo || state.editing)
            ? photoSlot(`story.items.${i}.photo`, { aspects: '4/3,1,3/4', cls: 'tl-photo', alt: it.title, zoom: true, caption: it.title })
            : null,
          T('p', `story.items.${i}.text`, 'tl-text'))))),
    c.outro != null ? T('p', 'story.outro', 'story-outro script reveal') : null);
}

function renderGallery(idx) {
  const c = state.content.gallery;
  let items = (c.items || []).map((it, i) => ({ it, i }));
  if (!state.editing) {
    const withPhoto = items.filter((x) => x.it.photo);
    if (withPhoto.length) items = withPhoto;
  }
  return chapterShell(idx,
    chHead('gallery', idx),
    h('div', { class: 'polaroids', 'data-list': 'gallery.items' },
      items.map(({ it, i }, n) => h('figure', {
        class: 'polaroid reveal',
        'data-index': i,
        style: { '--r': `${POLAROID_TILT[n % POLAROID_TILT.length]}deg`, '--d': `${(n % 4) * 0.08}s` },
      },
      h('span', { class: 'tape', 'aria-hidden': 'true' }),
      photoSlot(`gallery.items.${i}.photo`, { aspects: '4/5,1,4/3', alt: it.caption, zoom: true, caption: it.caption }),
      T('figcaption', `gallery.items.${i}.caption`)))));
}

function paragraphs(text) {
  return String(text || '').split(/\n\s*\n+/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
}

function renderLetter(idx) {
  const c = state.content.letter;
  let body;
  if (state.editing) {
    body = T('div', 'letter.body', 'letter-body ed-multiline', { 'data-multiline': '' });
  } else {
    body = h('div', { class: 'letter-body' }, paragraphs(c.body).map((p) => {
      const el = h('p');
      splitWords(el, p);
      return el;
    }));
  }
  return chapterShell(idx,
    chHead('letter', idx),
    h('article', { class: 'letter reveal' },
      sealSvg(),
      flowerSvg(),
      T('p', 'letter.greeting', 'letter-greeting script'),
      body,
      T('p', 'letter.closing', 'letter-closing'),
      T('p', 'letter.signature', 'letter-signature script ink')));
}

function meterSvg() {
  return svg('0 0 100 100',
    '<defs><clipPath id="meter-clip"><path d="' + HEART_PATH + '"/></clipPath>' +
    '<linearGradient id="meter-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff85a8"/><stop offset="1" stop-color="#d0104a"/></linearGradient></defs>' +
    `<path d="${HEART_PATH}" fill="#fff"/>` +
    '<g clip-path="url(#meter-clip)"><g class="meter-level" transform="translate(0 100)">' +
    '<path class="meter-wave" d="M0 4 Q12.5 -2 25 4 T50 4 T75 4 T100 4 T125 4 T150 4 V120 H0 Z" fill="url(#meter-fill)"/>' +
    '</g></g>' +
    `<path d="${HEART_PATH}" fill="none" stroke="#e11d5c" stroke-width="3"/>`);
}

function renderReasons(idx) {
  const c = state.content.reasons;
  const E = state.editing;
  return chapterShell(idx,
    chHead('reasons', idx),
    h('div', { class: 'reasons', 'data-list': 'reasons.items' },
      (c.items || []).map((r, i) => h(E ? 'div' : 'button', {
        class: `flip reveal${E ? ' flipped' : ''}`,
        type: E ? null : 'button',
        'data-index': i,
        style: { '--d': `${(i % 4) * 0.07}s` },
      },
      h('span', { class: 'flip-inner' },
        h('span', { class: 'flip-front', 'aria-hidden': 'true' },
          h('span', { class: 'flip-num script' }, `#${i + 1}`), heartSvg(), h('span', { class: 'flip-hint' }, 'Dokun')),
        h('span', { class: 'flip-back' }, T('span', `reasons.items.${i}`, 'flip-text')))))),
    E ? null : h('div', { class: 'reasons-tools' },
      h('button', { class: 'link-btn', type: 'button', 'data-action': 'flip-all' }, '♥ Hepsini çevir')),
    h('section', { class: 'meter-card reveal', 'data-meter': '' },
      T('h3', 'reasons.meterTitle', 'meter-title script'),
      h('button', { class: 'meter-heart', type: 'button', 'data-action': 'meter', 'aria-label': 'Sevgimi ölç' }, meterSvg()),
      h('div', { class: 'meter-pct', 'aria-live': 'polite' }, '%0'),
      T('p', 'reasons.meterHint', 'meter-hint'),
      h('div', { class: 'meter-after' },
        T('p', 'reasons.meterResult', 'meter-result script'),
        T('p', 'reasons.meterNote', 'meter-note'))));
}

function couponKey(cp) { return `ask-kupon:${cp.title}`; }
function isUsed(cp) {
  try { return !!localStorage.getItem(couponKey(cp)); } catch { return false; }
}

function renderSurprise(idx) {
  const c = state.content.surprise;
  const E = state.editing;
  return chapterShell(idx,
    chHead('surprise', idx),
    h('section', { class: 'surprise-block reveal' },
      T('h3', 'surprise.scratchTitle', 'sub-title script'),
      T('p', 'surprise.scratchHint', 'sub-intro'),
      h('div', { class: `scratch${E ? ' done' : ''}`, 'data-scratch': '' },
        h('div', { class: 'scratch-prize' },
          h('span', { class: 'prize-icon', 'aria-hidden': 'true' }, '🎁'),
          T('p', 'surprise.scratchPrize', 'prize-text')),
        E ? null : h('canvas', { class: 'scratch-canvas no-burst', 'aria-label': 'Kazınacak alan' }))),
    h('section', { class: 'surprise-block', style: { marginTop: '64px' } },
      T('h3', 'surprise.couponsTitle', 'sub-title script reveal'),
      T('p', 'surprise.couponsIntro', 'sub-intro reveal'),
      h('div', { class: 'coupons', 'data-list': 'surprise.coupons' },
        (c.coupons || []).map((cp, i) => h('div', {
          class: `coupon-wrap reveal${!E && isUsed(cp) ? ' used' : ''}`,
          'data-index': i,
          style: { '--d': `${(i % 2) * 0.08}s` },
        },
        h('div', { class: 'coupon' },
          T('span', `surprise.coupons.${i}.icon`, 'coupon-icon'),
          h('div', { class: 'coupon-body' },
            T('h4', `surprise.coupons.${i}.title`, 'coupon-title'),
            T('p', `surprise.coupons.${i}.text`, 'coupon-text')),
          E ? null : h('button', { class: 'coupon-use', type: 'button', 'data-coupon': i }, 'Kullan')),
        h('span', { class: 'coupon-stamp', 'aria-hidden': 'true' }, 'KULLANILDI'))))));
}

function renderFinale(idx) {
  const E = state.editing;
  const tag = E ? 'div' : 'button';
  const showSuccess = E || state.answered;
  return chapterShell(idx,
    h('header', { class: 'ch-head' }, h('p', { class: 'ch-eyebrow reveal' }, `Bölüm ${ROMAN[idx]}`)),
    h('div', { class: `finale-ask${state.answered && !E ? ' answered' : ''}` },
      T('p', 'finale.pre', 'finale-pre reveal'),
      T('h2', 'finale.question', 'finale-q script ink'),
      h('div', { class: 'finale-btns reveal', style: { '--d': '.8s' } },
        h(tag, { class: 'btn yes-btn', type: E ? null : 'button', 'data-action': 'yes' }, heartSvg(), T('span', 'finale.yes')),
        h(tag, { class: 'no-btn', type: E ? null : 'button', 'data-action': 'no' }, T('span', 'finale.no', 'no-label'))),
      E ? null : h('p', { class: 'no-gone-note', hidden: true }, state.content.finale.noGone || '')),
    h('div', { class: 'success', hidden: !showSuccess },
      T('p', 'finale.successTitle', 'success-title script'),
      heartPhoto('finale.photo', null),
      T('p', 'finale.big', 'success-big script'),
      T('p', 'finale.successText', 'success-text'),
      E ? null : h('button', { class: 'btn', type: 'button', 'data-go': 'intro' }, '↺ Baştan izle'),
      T('p', 'footer', 'site-footer')));
}

const RENDERERS = {
  home: renderHome,
  story: renderStory,
  gallery: renderGallery,
  letter: renderLetter,
  reasons: renderReasons,
  surprise: renderSurprise,
  finale: renderFinale,
};

function renderIntro() {
  const E = state.editing;
  const intro = $('#intro');
  intro.textContent = '';
  intro.append(h('div', { class: 'intro-inner' },
    T('p', 'intro.kicker', 'intro-kicker'),
    h('div', {
      class: `envelope${E ? ' open' : ''}`,
      id: 'envelope',
      role: E ? null : 'button',
      tabindex: E ? null : '0',
      'aria-label': E ? null : 'Zarfı aç',
    },
    h('div', { class: 'env-back' }),
    h('div', { class: 'env-letter' }, T('p', 'intro.letter', 'env-letter-text script'), heartSvg('env-letter-heart')),
    h('div', { class: 'env-pocket' }),
    h('div', { class: 'env-flap' }),
    h('button', { class: 'env-seal', type: 'button', 'aria-label': 'Zarfı aç', tabindex: '-1' }, heartSvg())),
    T('h1', 'intro.to', 'intro-to script shimmer'),
    T('p', 'intro.hint', 'intro-hint'),
    E ? h('button', { class: 'btn', type: 'button', 'data-action': 'enter' }, 'Siteye gir →') : null));
}

function renderMenu() {
  const menu = $('#menu');
  menu.textContent = '';
  menu.append(
    h('button', { class: 'pill menu-close', type: 'button', 'data-action': 'menu-close' }, '✕ Kapat'),
    h('div', { class: 'menu-head' },
      h('h2', { class: 'script' }, 'İçindekiler'),
      h('p', {}, 'Hangi sayfaya gitmek istersin?')),
    h('ol', {}, CHAPTERS.map((ch, i) => h('li', { style: { '--i': i }, class: i === state.current ? 'current' : null },
      h('button', { class: 'menu-item', type: 'button', 'data-goto': i },
        h('span', { class: 'menu-num' }, ROMAN[i]),
        h('span', { class: 'menu-t', 'data-bind': `${ch.key}.title` }, state.content[ch.key].title),
        h('span', { class: 'menu-d', 'data-bind': `${ch.key}.desc` }, state.content[ch.key].desc))))),
    h('div', { class: 'menu-foot' },
      h('button', { class: 'link-btn', type: 'button', 'data-go': 'intro' }, '💌 Zarfı yeniden aç')));
}

function renderAll() {
  const root = $('#chapters');
  root.textContent = '';
  CHAPTERS.forEach((ch, i) => root.append(RENDERERS[ch.key](i)));
  renderIntro();
  renderMenu();
  setupMusic();
  observeAll();
  document.title = state.content.site?.title || document.title;
  document.dispatchEvent(new CustomEvent('app:render'));
}

/* ------------------------------------------------------------------ */
/* Beliren animasyonlar                                                */
/* ------------------------------------------------------------------ */
function observeAll() {
  if (!io) {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) e.target.classList.add('is-in');
    }, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });
  }
  io.disconnect();
  $$('.reveal, .ink, .bloom, .words').forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------------ */
/* Sayfa geçişi (kalp)                                                 */
/* ------------------------------------------------------------------ */
async function heartWipe(point, card, swap) {
  const W = innerWidth;
  const H = innerHeight;
  if (reducedMotion || state.editing) {
    swap();
    return;
  }
  const wipe = $('#wipe');
  const heart = $('.wipe-heart', wipe);
  const cardEl = $('.wipe-card', wipe);
  const x = point ? point.x : W / 2;
  const y = point ? point.y : H / 2;
  // 480px kalbin güvenli yarıçapı ≈ 149px
  const S = (Math.hypot(Math.max(x, W - x), Math.max(y, H - y)) / 149) * 1.08;

  $('.wipe-eyebrow', wipe).textContent = card.eyebrow || '';
  $('.wipe-title', wipe).textContent = card.title || '';
  $('.wipe-desc', wipe).textContent = card.desc || '';
  heart.getAnimations().forEach((a) => a.cancel());
  heart.style.left = `${x - 240}px`;
  heart.style.top = `${y - 230}px`;
  wipe.classList.add('active');

  await heart.animate([{ transform: 'scale(0)' }, { transform: `scale(${S})` }],
    { duration: 620, easing: 'cubic-bezier(.62,0,.34,1)', fill: 'forwards' }).finished.catch(() => {});
  swap();
  cardEl.classList.add('show');
  await sleep(card.title ? 1000 : 250);
  cardEl.classList.remove('show');
  await sleep(180);
  heart.style.left = `${W / 2 - 240}px`;
  heart.style.top = `${H / 2 - 230}px`;
  await heart.animate([{ transform: `scale(${S})` }, { transform: 'scale(0)' }],
    { duration: 720, easing: 'cubic-bezier(.55,0,.1,1)', fill: 'forwards' }).finished.catch(() => {});
  wipe.classList.remove('active');
}

/* ------------------------------------------------------------------ */
/* Gezinme                                                             */
/* ------------------------------------------------------------------ */
function indexFromHash() {
  const slug = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  return CHAPTERS.findIndex((c) => c.slug === slug);
}

function setHash(i) {
  const url = i >= 0 ? `#/${CHAPTERS[i].slug}` : location.pathname + location.search;
  if (i >= 0 ? location.hash !== url : !!location.hash) history.pushState(null, '', url);
}

export async function go(target, point, { push = true } = {}) {
  if (state.busy) return;
  if (target === state.current) { closeMenu(); return; }
  state.busy = true;
  const toIntro = target < 0;
  const key = toIntro ? null : CHAPTERS[target].key;
  const card = toIntro
    ? { eyebrow: '', title: '', desc: '' }
    : { eyebrow: `Bölüm ${ROMAN[target]}`, title: state.content[key].title, desc: state.content[key].desc };
  try {
    await heartWipe(point, card, () => {
      closeMenu(true);
      if (toIntro) showIntro(); else showChapter(target);
      if (push) setHash(toIntro ? -1 : target);
    });
  } finally {
    state.busy = false;
  }
}

function stopBehaviors() {
  state.stops.forEach((fn) => { try { fn(); } catch { /* yok say */ } });
  state.stops = [];
  const prev = $('.chapter.active');
  if (prev) $$('.is-in', prev).forEach((el) => el.classList.remove('is-in'));
}

function showChapter(i) {
  stopBehaviors();
  $('#intro').classList.add('gone');
  $('#topbar').hidden = false;
  $$('.chapter').forEach((s, n) => s.classList.toggle('active', n === i));
  state.current = i;
  document.body.classList.toggle('night-mode', CHAPTERS[i].key === 'finale');
  window.scrollTo(0, 0);
  $$('#menu li').forEach((li, n) => li.classList.toggle('current', n === i));
  startBehaviors(i);
}

function showIntro() {
  stopBehaviors();
  renderIntro();
  $$('.chapter').forEach((s) => s.classList.remove('active'));
  $('#intro').classList.remove('gone', 'opening');
  $('#topbar').hidden = true;
  document.body.classList.remove('night-mode');
  state.current = -1;
  $$('#menu li').forEach((li) => li.classList.remove('current'));
  window.scrollTo(0, 0);
}

function startBehaviors(i) {
  const key = CHAPTERS[i].key;
  const sec = $(`#ch-${key}`);
  if (key === 'home') {
    const word = $('[data-rotator]', sec);
    if (word) state.stops.push(typewriter(word, state.content.home.rotating || []));
    const counter = $('[data-counter]', sec);
    updateCounter(counter);
    const timer = setInterval(() => updateCounter(counter), 1000);
    state.stops.push(() => clearInterval(timer));
  }
  if (key === 'surprise' && !state.editing) {
    requestAnimationFrame(() => initScratch(sec));
  }
  if (key === 'finale' && !state.editing) {
    resetNoButton();
    if (state.answered) startLoveWords(sec);
    state.stops.push(() => { resetNoButton(); stopLoveWords(); });
  }
}

function openMenu() {
  const menu = $('#menu');
  menu.classList.add('open');
  menu.setAttribute('aria-hidden', 'false');
  $('#menu-btn').setAttribute('aria-expanded', 'true');
}

function closeMenu(instant) {
  const menu = $('#menu');
  if (!menu.classList.contains('open')) return;
  if (instant) {
    menu.style.transition = 'none';
    requestAnimationFrame(() => { menu.style.transition = ''; });
  }
  menu.classList.remove('open');
  menu.setAttribute('aria-hidden', 'true');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
}

/* ------------------------------------------------------------------ */
/* Kapak / zarf                                                        */
/* ------------------------------------------------------------------ */
async function openEnvelope() {
  const env = $('#envelope');
  if (!env || state.busy || state.editing || env.classList.contains('open')) return;
  state.busy = true;
  env.classList.add('open');
  $('#intro').classList.add('opening');
  playMusic();
  const seal = $('.env-seal', env).getBoundingClientRect();
  fx.burst(seal.left + seal.width / 2, seal.top + seal.height / 2, 20, { power: 1.2 });
  await sleep(1700);
  const letter = $('.env-letter', env).getBoundingClientRect();
  state.busy = false;
  await go(state.startIndex, { x: letter.left + letter.width / 2, y: letter.top + letter.height / 2 });
}

/* ------------------------------------------------------------------ */
/* Sayaç                                                               */
/* ------------------------------------------------------------------ */
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffParts(a, b) {
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
  return { parts: { y, mo, d, h: hh, mi, s }, totalDays: Math.floor((b - a) / 86400000) };
}

function updateCounter(root) {
  if (!root) return;
  const since = parseDate(state.content.site?.since);
  if (!since) return;
  const { parts, totalDays } = diffParts(since, new Date());
  for (const [k, v] of Object.entries(parts)) {
    const box = root.querySelector(`[data-u="${k}"]`);
    if (!box) continue;
    const b = box.firstChild;
    const str = String(v);
    if (b.textContent !== str) {
      b.textContent = str;
      if (k === 's' && !reducedMotion) {
        box.classList.remove('tick');
        void box.offsetWidth;
        box.classList.add('tick');
      }
    }
  }
  const total = root.querySelector('[data-total]');
  if (total) total.textContent = totalDays.toLocaleString('tr-TR');
}

/* ------------------------------------------------------------------ */
/* Aşk ölçer                                                           */
/* ------------------------------------------------------------------ */
function runMeter(card) {
  if (!card || card.dataset.running) return;
  card.dataset.running = '1';
  card.classList.remove('done');
  const level = $('.meter-level', card);
  const pct = $('.meter-pct', card);
  const heartBtn = $('.meter-heart', card);
  const start = performance.now();
  const D = reducedMotion ? 10 : 1900;
  const step = (now) => {
    const t = Math.min(1, (now - start) / D);
    const e = 1 - Math.pow(1 - t, 3);
    pct.textContent = `%${Math.round(e * 100)}`;
    level.setAttribute('transform', `translate(0 ${(100 - e * 108).toFixed(2)})`);
    if (t < 1) { requestAnimationFrame(step); return; }
    card.classList.add('shaking');
    let n = 100;
    const over = setInterval(() => {
      n += Math.round(40 + Math.random() * 170);
      pct.textContent = `%${n.toLocaleString('tr-TR')}`;
      if (n > 1000) {
        clearInterval(over);
        pct.textContent = '∞';
        card.classList.remove('shaking');
        card.classList.add('done');
        delete card.dataset.running;
        const r = heartBtn.getBoundingClientRect();
        fx.burst(r.left + r.width / 2, r.top + r.height / 2, 32, { power: 1.5 });
      }
    }, 95);
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------ */
/* Kazı kazan                                                          */
/* ------------------------------------------------------------------ */
async function initScratch(sec) {
  const wrap = $('[data-scratch]', sec);
  if (!wrap || wrap.dataset.ready || wrap.classList.contains('done')) return;
  const cv = $('.scratch-canvas', wrap);
  const r = wrap.getBoundingClientRect();
  if (!cv || !r.width) return;
  wrap.dataset.ready = '1';
  try { await document.fonts.load('700 24px Quicksand'); } catch { /* yok say */ }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.scale(dpr, dpr);
  const grad = g.createLinearGradient(0, 0, r.width, r.height);
  grad.addColorStop(0, '#f7bfd0');
  grad.addColorStop(0.5, '#ec8fab');
  grad.addColorStop(1, '#d9668c');
  g.fillStyle = grad;
  g.fillRect(0, 0, r.width, r.height);
  const shine = g.createLinearGradient(0, 0, r.width, 0);
  shine.addColorStop(0, 'rgba(255,255,255,0)');
  shine.addColorStop(0.45, 'rgba(255,255,255,.28)');
  shine.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.fillStyle = shine;
  g.fillRect(0, 0, r.width, r.height);
  const heart = new Path2D(HEART_PATH);
  g.fillStyle = 'rgba(255,255,255,.2)';
  let row = 0;
  for (let yy = 8; yy < r.height; yy += 30, row++) {
    for (let xx = (row % 2) * 15 + 6; xx < r.width; xx += 30) {
      g.save();
      g.translate(xx, yy);
      g.scale(0.13, 0.13);
      g.fill(heart);
      g.restore();
    }
  }
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(140, 16, 56, .45)';
  g.shadowBlur = 8;
  g.font = `700 ${Math.round(Math.min(30, r.width / 12))}px Quicksand, sans-serif`;
  g.fillText('Burayı kazı', r.width / 2, r.height / 2 - 10);
  g.font = `600 ${Math.round(Math.min(18, r.width / 20))}px Quicksand, sans-serif`;
  g.fillText('parmağınla ya da fareyle', r.width / 2, r.height / 2 + 22);
  g.shadowBlur = 0;

  g.globalCompositeOperation = 'destination-out';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(34, r.width / 11);
  let drawing = false;
  let last = null;
  let moves = 0;
  const pos = (e) => {
    const b = cv.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * r.width, y: ((e.clientY - b.top) / b.height) * r.height };
  };
  const line = (a, b) => {
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x + 0.01, b.y + 0.01);
    g.stroke();
  };
  const check = () => {
    const data = g.getImageData(0, 0, cv.width, cv.height).data;
    let clear = 0;
    let total = 0;
    for (let i = 3; i < data.length; i += 4 * 23) {
      total++;
      if (data[i] < 50) clear++;
    }
    if (total && clear / total > 0.52) reveal();
  };
  const reveal = () => {
    if (wrap.classList.contains('done')) return;
    wrap.classList.add('done');
    const b = wrap.getBoundingClientRect();
    fx.burst(b.left + b.width / 2, b.top + b.height / 2, 28, { power: 1.4 });
    fx.confetti({ count: 90 });
  };
  cv.addEventListener('pointerdown', (e) => {
    drawing = true;
    try { cv.setPointerCapture(e.pointerId); } catch { /* yok say */ }
    last = pos(e);
    line(last, last);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    line(last, p);
    last = p;
    if (++moves % 10 === 0) check();
    if (moves % 4 === 0) fx.trail(e.clientX, e.clientY);
  });
  const end = () => { if (drawing) { drawing = false; check(); } };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

/* ------------------------------------------------------------------ */
/* Aşk kuponları                                                       */
/* ------------------------------------------------------------------ */
export function dialog({ icon = '💌', text = '', yes = 'Tamam', no = null } = {}) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'dialog-back no-burst' });
    const done = (v) => { back.remove(); resolve(v); };
    back.append(h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'dialog-icon' }, icon),
      h('p', { class: 'dialog-text' }, text),
      h('div', { class: 'dialog-btns' },
        no ? h('button', { class: 'link-btn', type: 'button', onclick: () => done(false) }, no) : null,
        h('button', { class: 'btn', type: 'button', onclick: () => done(true) }, yes))));
    back.addEventListener('click', (e) => { if (e.target === back) done(false); });
    document.body.append(back);
    $('.btn', back).focus();
  });
}

async function useCoupon(i, btn) {
  const cp = state.content.surprise.coupons[i];
  if (!cp) return;
  const wrap = btn.closest('.coupon-wrap');
  const used = isUsed(cp);
  const ok = await dialog({
    icon: cp.icon || '💝',
    text: used
      ? `“${cp.title}” kuponunu bir kez daha kullanmak ister misin? 😄`
      : `“${cp.title}” kuponunu kullanmak istediğine emin misin? 😏`,
    yes: 'Evet, kullan!',
    no: 'Vazgeç',
  });
  if (!ok) return;
  try { localStorage.setItem(couponKey(cp), new Date().toISOString()); } catch { /* yok say */ }
  wrap.classList.add('used');
  const r = wrap.getBoundingClientRect();
  fx.burst(r.left + r.width - 60, r.top + r.height / 2, 18, { power: 1.1 });
  const text = `💌 Aşk kuponumu kullanıyorum: ${cp.icon || ''} ${cp.title} — ${cp.text}`;
  const num = String(state.content.site?.whatsapp || '').replace(/\D/g, '');
  if (num) {
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  } else if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }
}

/* ------------------------------------------------------------------ */
/* Final: kaçan “Hayır” ve kutlama                                     */
/* ------------------------------------------------------------------ */
function resetNoButton() {
  const sec = $('#ch-finale');
  if (!sec) return;
  const btns = $('.finale-btns', sec);
  const no = $('.no-btn[data-action="no"]') || null;
  if (no && btns && no.parentElement !== btns) btns.append(no);
  if (no) {
    no.classList.remove('fleeing', 'gone');
    no.style.left = '';
    no.style.top = '';
    const label = $('.no-label', no);
    if (label) label.textContent = state.content.finale.no;
  }
  const yes = $('.yes-btn', sec);
  if (yes) yes.style.removeProperty('--grow');
  const note = $('.no-gone-note', sec);
  if (note) note.hidden = true;
  state.noCount = 0;
}

function flee(btn) {
  const now = performance.now();
  // dokunuşun ardından gelen “click” ikinci kez kaçırmasın
  if (now - (state.lastFlee || 0) < 450) return;
  state.lastFlee = now;
  const c = state.content.finale;
  const texts = (c.noTexts || []).filter(Boolean);
  state.noCount++;
  const label = $('.no-label', btn);
  if (label && texts.length) label.textContent = texts[(state.noCount - 1) % texts.length];
  const yes = $('#ch-finale .yes-btn');
  if (yes) yes.style.setProperty('--grow', Math.min(1 + state.noCount * 0.11, 1.85).toFixed(2));
  const r = btn.getBoundingClientRect();
  fx.burst(r.left + r.width / 2, r.top + r.height / 2, 6, { power: 0.6, size: [7, 13] });
  if (state.noCount >= 10) {
    btn.classList.add('gone');
    const note = $('#ch-finale .no-gone-note');
    if (note) note.hidden = false;
    return;
  }
  if (!btn.classList.contains('fleeing')) {
    btn.style.left = `${r.left}px`;
    btn.style.top = `${r.top}px`;
    btn.classList.add('fleeing');
    document.body.append(btn);
    void btn.offsetWidth;
  }
  const W = innerWidth;
  const H = innerHeight;
  const bw = btn.offsetWidth;
  const bh = btn.offsetHeight;
  const yr = yes ? yes.getBoundingClientRect() : null;
  let x = 0;
  let y = 0;
  for (let t = 0; t < 40; t++) {
    x = 12 + Math.random() * Math.max(10, W - bw - 24);
    y = 70 + Math.random() * Math.max(10, H - bh - 110);
    const far = Math.hypot(x - r.left, y - r.top) > 110;
    const clearOfYes = !yr || x + bw < yr.left - 16 || x > yr.right + 16 || y + bh < yr.top - 16 || y > yr.bottom + 16;
    if (far && clearOfYes) break;
  }
  btn.style.left = `${x}px`;
  btn.style.top = `${y}px`;
}

let loveWordsEl = null;
function startLoveWords(sec) {
  stopLoveWords();
  if (reducedMotion) return;
  loveWordsEl = h('div', { class: 'love-words', 'aria-hidden': 'true' });
  const count = innerWidth < 600 ? 12 : 20;
  for (let i = 0; i < count; i++) {
    loveWordsEl.append(h('span', {
      style: {
        '--x': `${rand(2, 82)}%`,
        '--fs': `${rand(1.4, 2.6).toFixed(2)}rem`,
        '--dur': `${rand(9, 16).toFixed(1)}s`,
        '--delay': `${(-rand(0, 14)).toFixed(1)}s`,
      },
    }, LOVE_WORDS[i % LOVE_WORDS.length]));
  }
  sec.append(loveWordsEl);
}
function stopLoveWords() {
  if (loveWordsEl) { loveWordsEl.remove(); loveWordsEl = null; }
}

function celebrate() {
  state.answered = true;
  const sec = $('#ch-finale');
  resetNoButton();
  $('.finale-ask', sec).classList.add('answered');
  const succ = $('.success', sec);
  succ.hidden = false;
  $$('.reveal', succ).forEach((el) => io.observe(el));
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  fx.confetti({ count: 200 });
  for (let k = 0; k < 7; k++) {
    setTimeout(() => fx.burst(rand(innerWidth * 0.12, innerWidth * 0.88), rand(innerHeight * 0.18, innerHeight * 0.6), 22, { power: 1.4 }), k * 360);
  }
  startLoveWords(sec);
  if ('vibrate' in navigator) { try { navigator.vibrate([60, 40, 60]); } catch { /* yok say */ } }
}

/* ------------------------------------------------------------------ */
/* Işık kutusu                                                         */
/* ------------------------------------------------------------------ */
const lb = { items: [], i: 0 };

function openLightbox(img) {
  const container = img.closest('[data-list]') || img.closest('.chapter');
  const imgs = $$('.slot[data-zoom] img', container);
  lb.items = imgs.map((im) => ({ src: im.currentSrc || im.src, cap: im.closest('.slot').dataset.caption || '', alt: im.alt }));
  lb.i = Math.max(0, imgs.indexOf(img));
  const box = $('#lightbox');
  box.hidden = false;
  document.body.style.overflow = 'hidden';
  showLightbox();
  $('.lb-close', box).focus({ preventScroll: true });
}

function showLightbox() {
  const box = $('#lightbox');
  const it = lb.items[lb.i];
  if (!it) return;
  const im = $('.lb-img', box);
  im.style.animation = 'none';
  im.src = it.src;
  im.alt = it.alt || '';
  void im.offsetWidth;
  im.style.animation = '';
  $('.lb-cap', box).textContent = it.cap;
  $('.lb-count', box).textContent = lb.items.length > 1 ? `${lb.i + 1} / ${lb.items.length}` : '';
  $('.lb-prev', box).hidden = lb.items.length < 2;
  $('.lb-next', box).hidden = lb.items.length < 2;
}

function stepLightbox(d) {
  if (lb.items.length < 2) return;
  lb.i = (lb.i + d + lb.items.length) % lb.items.length;
  showLightbox();
}

function closeLightbox() {
  const box = $('#lightbox');
  if (box.hidden) return;
  box.hidden = true;
  document.body.style.overflow = '';
}

/* ------------------------------------------------------------------ */
/* Müzik                                                               */
/* ------------------------------------------------------------------ */
function setupMusic() {
  const src = state.content.site?.music?.src;
  const btn = $('#music-btn');
  const audio = $('#music');
  if (!src) {
    btn.hidden = true;
    if (!audio.paused) audio.pause();
    audio.removeAttribute('src');
    return;
  }
  const url = photoUrl(src);
  if (audio.getAttribute('src') !== url) audio.src = url;
  btn.hidden = false;
  btn.title = state.content.site.music.title || 'Şarkımız';
}

function playMusic() {
  const audio = $('#music');
  if (!audio.getAttribute('src')) return;
  audio.volume = 0;
  audio.play().then(() => {
    let v = 0;
    const t = setInterval(() => {
      v = Math.min(0.75, v + 0.05);
      audio.volume = v;
      if (v >= 0.75) clearInterval(t);
    }, 120);
  }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Bildirim                                                            */
/* ------------------------------------------------------------------ */
let toastTimer = 0;
export function toast(msg, { error = false, ms = 3400 } = {}) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ------------------------------------------------------------------ */
/* Olaylar                                                             */
/* ------------------------------------------------------------------ */
function bindEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const editingText = state.editing && t.closest('[data-edit]');

    const goEl = t.closest('[data-go]');
    if (goEl && !editingText) {
      const dir = goEl.dataset.go;
      const p = pointOf(e, goEl);
      if (dir === 'next') go(Math.min(state.current + 1, CHAPTERS.length - 1), p);
      else if (dir === 'prev') go(Math.max(state.current - 1, 0), p);
      else if (dir === 'intro') { state.answered = false; state.startIndex = 0; go(-1, p); }
      return;
    }
    const gotoEl = t.closest('[data-goto]');
    if (gotoEl) {
      go(Number(gotoEl.dataset.goto), pointOf(e, gotoEl));
      return;
    }
    const act = t.closest('[data-action]');
    if (act) {
      const a = act.dataset.action;
      if (a === 'menu-close') { closeMenu(); return; }
      if (a === 'enter') { go(state.startIndex, pointOf(e, act)); return; }
      if (state.editing) return;
      if (a === 'flip-all') {
        const cards = $$('.flip', act.closest('.chapter'));
        const all = cards.every((c) => c.classList.contains('flipped'));
        cards.forEach((c, n) => setTimeout(() => c.classList.toggle('flipped', !all), n * 70));
        return;
      }
      if (a === 'meter') { runMeter(act.closest('[data-meter]')); return; }
      if (a === 'yes') { celebrate(); return; }
      if (a === 'no') { e.preventDefault(); flee(act); return; }
    }
    if (state.editing) return;

    const flip = t.closest('.flip');
    if (flip) {
      flip.classList.toggle('flipped');
      return;
    }
    const zoomImg = t.closest('.slot[data-zoom] img');
    if (zoomImg) { openLightbox(zoomImg); return; }
    const couponBtn = t.closest('.coupon-use');
    if (couponBtn) { useCoupon(Number(couponBtn.dataset.coupon), couponBtn); return; }
    const usedWrap = t.closest('.coupon-wrap.used');
    if (usedWrap) {
      const b = $('.coupon-use', usedWrap);
      if (b) useCoupon(Number(b.dataset.coupon), b);
      return;
    }
    if (t.closest('.envelope')) openEnvelope();
  });

  document.addEventListener('keydown', (e) => {
    const box = $('#lightbox');
    if (!box.hidden) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') stepLightbox(1);
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      return;
    }
    if (e.key === 'Escape') closeMenu();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'envelope') {
      e.preventDefault();
      openEnvelope();
    }
  });

  // “Hayır” butonu dokunulmadan kaçsın
  document.addEventListener('pointerover', (e) => {
    if (state.editing || e.pointerType !== 'mouse') return;
    const no = e.target instanceof Element && e.target.closest('.no-btn[data-action="no"]');
    if (no && !no.classList.contains('gone')) flee(no);
  });
  document.addEventListener('pointerdown', (e) => {
    if (state.editing || !(e.target instanceof Element)) return;
    const no = e.target.closest('.no-btn[data-action="no"]');
    if (no && e.pointerType !== 'mouse') { e.preventDefault(); flee(no); }
  });

  // Dokunulan yerde kalpler
  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !(e.target instanceof Element)) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], .no-burst, .ed-ui, #lightbox')) return;
    fx.burst(e.clientX, e.clientY, 7, { power: 0.75, size: [8, 16] });
  }, { passive: true });

  if (matchMedia('(pointer: fine)').matches && !state.editing) {
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') fx.trail(e.clientX, e.clientY);
    }, { passive: true });
  }

  $('#menu-btn').addEventListener('click', () => {
    if ($('#menu').classList.contains('open')) closeMenu(); else openMenu();
  });

  const audio = $('#music');
  const mbtn = $('#music-btn');
  mbtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.volume = 0.75;
      audio.play().catch(() => toast('Şarkı çalınamadı 😢', { error: true }));
    } else audio.pause();
  });
  audio.addEventListener('play', () => mbtn.classList.add('playing'));
  audio.addEventListener('pause', () => mbtn.classList.remove('playing'));

  const box = $('#lightbox');
  $('.lb-close', box).addEventListener('click', closeLightbox);
  $('.lb-prev', box).addEventListener('click', () => stepLightbox(-1));
  $('.lb-next', box).addEventListener('click', () => stepLightbox(1));
  box.addEventListener('click', (e) => { if (e.target === box) closeLightbox(); });
  let sx = null;
  box.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  box.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
  });

  window.addEventListener('popstate', () => {
    const i = indexFromHash();
    if (i !== state.current) go(i, null, { push: false });
  });
}

function makeStars() {
  const box = $('#night .stars');
  const n = innerWidth < 600 ? 55 : 90;
  for (let i = 0; i < n; i++) {
    box.append(h('i', {
      style: {
        left: `${rand(0, 100).toFixed(2)}%`,
        top: `${rand(0, 100).toFixed(2)}%`,
        '--s': `${rand(1, 2.8).toFixed(1)}px`,
        '--t': `${rand(2, 5).toFixed(1)}s`,
        '--dl': `${(-rand(0, 5)).toFixed(1)}s`,
      },
    }));
  }
}

// Eski sitenin (klip düzenleyici) servis çalışanını temizle
function removeOldServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations().then((regs) => {
    if (!regs.length) return;
    Promise.all(regs.map((r) => r.unregister())).then(() => {
      let reloaded = false;
      try { reloaded = !!sessionStorage.getItem('sw-temizlendi'); } catch { /* yok say */ }
      if (navigator.serviceWorker.controller && !reloaded) {
        try { sessionStorage.setItem('sw-temizlendi', '1'); } catch { /* yok say */ }
        location.reload();
      }
    });
  }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Düzenleme modu için dışa açılan arayüz                              */
/* ------------------------------------------------------------------ */
export const app = {
  state,
  CHAPTERS,
  ROMAN,
  getPath,
  setPath,
  photoUrl,
  toast,
  dialog,
  go,
  get fx() { return fx; },
  get content() { return state.content; },
  setContent(c) { state.content = c; },
  setPhotoOverride(path, url) { state.photoOverrides.set(path, url); },
  setRawBase(url) { state.rawBase = url; },
  rerender() {
    const y = window.scrollY;
    stopBehaviors();
    renderAll();
    if (state.current >= 0) {
      $('#intro').classList.add('gone');
      $$('.chapter').forEach((s, n) => s.classList.toggle('active', n === state.current));
      $$('#menu li').forEach((li, n) => li.classList.toggle('current', n === state.current));
      startBehaviors(state.current);
      window.scrollTo(0, y);
    }
  },
  syncBinds(path) {
    const v = getPath(state.content, path);
    $$(`[data-bind="${path}"]`).forEach((el) => { el.textContent = v == null ? '' : String(v); });
    if (path === 'site.title') document.title = v || document.title;
  },
  setEditing(on) {
    state.editing = on;
    document.body.classList.toggle('editing', on);
    app.rerender();
  },
};

/* ------------------------------------------------------------------ */
/* Başlat                                                              */
/* ------------------------------------------------------------------ */
async function init() {
  removeOldServiceWorkers();
  if (state.editing) document.body.classList.add('editing');
  startBackground($('#bg-canvas'));
  fx = createFX($('#fx-canvas'));
  makeStars();

  try {
    const res = await fetch('content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.content = await res.json();
  } catch (err) {
    document.body.classList.remove('is-loading');
    document.body.append(h('div', { class: 'noscript' }, 'İçerik yüklenemedi 😢 Sayfayı yenilemeyi dene.'));
    console.error(err);
    return;
  }

  if (document.fonts && document.fonts.ready) {
    await Promise.race([document.fonts.ready, sleep(1500)]);
  }

  renderAll();
  bindEvents();
  const fromHash = indexFromHash();
  state.startIndex = fromHash >= 0 ? fromHash : 0;
  showIntro();
  document.body.classList.remove('is-loading');

  if (state.editing) {
    try {
      const mod = await import('./editor.js');
      await mod.startEditor(app);
    } catch (err) {
      console.error(err);
      toast('Düzenleme modu açılamadı: ' + err.message, { error: true, ms: 8000 });
    }
  }
}

init();
