// Bölümlerin HTML'ini içerikten üretir (izleme ve düzenleme modu için)
import {
  state, h, svg, getPath, mediaUrl, heartSvg, arrowSvg, sparkleSvg, checkSvg, flourish, waxSeal,
  visibleChapters, chapterNumber, paragraphs, HEART_PATH, store,
} from './core.js';
import { splitLetters, splitWords } from './effects.js';
import { counterParts, statsList, specialDays, dailyNote, couponUsed, openedLetter, quizQuestions } from './features.js';

const POLAROID_TILT = [-3.5, 2.5, -1.5, 4, -2.5, 1.5, -4, 3];

// Düzenlenebilir yazı öğesi
export function T(tag, path, cls, props = {}) {
  const v = getPath(state.content, path);
  return h(tag, { class: cls, 'data-edit': path, ...props }, v == null ? '' : String(v));
}

/* ------------------------------------------------------------------ */
/* Fotoğraf yuvaları                                                   */
/* ------------------------------------------------------------------ */
// Yüklenen dosyaların adında boyut yazar (foto-1600x1200-…) → yer önceden ayrılır
function ratioFromName(p) {
  const m = /-(\d{2,5})x(\d{2,5})-/.exec(String(p || ''));
  return m ? `${m[1]} / ${m[2]}` : null;
}

export function photoSlot(path, { aspects = '1', fixed = false, cls = '', alt = '', zoom = false, caption = '' } = {}) {
  const value = getPath(state.content, path);
  const first = aspects.split(',')[0].trim();
  const el = h('div', {
    class: `slot${fixed ? ' fixed' : ''}${cls ? ` ${cls}` : ''}${value ? '' : ' empty'}`,
    'data-photo': path,
    'data-aspects': aspects,
    'data-zoom': zoom && value ? '' : null,
    'data-caption': caption || null,
  });
  if (value) {
    const img = h('img', { src: mediaUrl(value), alt: alt || 'Fotoğrafımız', loading: 'lazy', decoding: 'async', draggable: 'false' });
    img.addEventListener('load', () => el.classList.add('loaded'), { once: true });
    img.addEventListener('error', () => el.classList.add('broken'), { once: true });
    el.append(img);
    el.style.aspectRatio = fixed ? first : (ratioFromName(value) || 'auto');
  } else {
    el.style.aspectRatio = first;
    el.append(h('div', { class: 'slot-empty' }, heartSvg(), h('span', {}, state.editing ? 'Fotoğraf ekle' : 'Fotoğrafımız')));
  }
  return el;
}

function heartPhoto(path, captionPath) {
  return h('figure', { class: 'heart-wrap reveal' },
    h('div', { class: 'heart-frame' }, photoSlot(path, { fixed: true, aspects: '1', alt: 'En sevdiğim fotoğrafımız', zoom: true })),
    sparkleSvg('sparkle s1'), sparkleSvg('sparkle s2'), sparkleSvg('sparkle s3'),
    captionPath ? T('figcaption', captionPath, 'heart-caption') : null);
}

/* ------------------------------------------------------------------ */
/* Bölüm iskeleti                                                      */
/* ------------------------------------------------------------------ */
function chapterShell(key, ...content) {
  const hidden = state.editing && state.content.site.chapters[key] === false;
  return h('section', {
    class: `chapter ch-${key}${hidden ? ' is-hidden-ch' : ''}`,
    id: `ch-${key}`,
    'data-ch': key,
    'aria-label': state.content[key]?.title || '',
  }, h('div', { class: 'wrap' }, ...content, chNav(key)));
}

function chHead(key, { intro = true } = {}) {
  const c = state.content[key];
  const long = String(c.title || '').length > 15 ? ' long' : '';
  return h('header', { class: 'ch-head' },
    h('p', { class: 'ch-eyebrow reveal' }, `Bölüm ${chapterNumber(key)}`),
    T('h2', `${key}.title`, `ch-title script shimmer ink${long}`),
    flourish(),
    intro && c.intro != null ? T('p', `${key}.intro`, 'ch-intro reveal', { style: { '--d': '.3s' } }) : null);
}

function chNav(key) {
  const list = visibleChapters();
  const i = list.findIndex((c) => c.key === key);
  const next = list[i + 1];
  return h('nav', { class: 'ch-nav reveal', 'aria-label': 'Sayfa geçişi' },
    next ? h('button', { class: 'next-card', type: 'button', 'data-go': 'next' },
      h('span', { class: 'next-label' }, 'Sıradaki bölüm'),
      h('span', { class: 'next-title script', 'data-bind': `${next.key}.title` }, state.content[next.key].title),
      h('span', { class: 'next-arrow' }, arrowSvg())) : null,
    i > 0 ? h('button', { class: 'link-btn', type: 'button', 'data-go': 'prev' }, '← Önceki bölüm') : null);
}

// Düzenlerken küçük kelime listeleri için
function chipList(path, cls = '') {
  const arr = getPath(state.content, path) || [];
  return h('div', { class: `ed-chips ${cls}`, 'data-list': path },
    arr.map((w, i) => h('span', { class: 'ed-chip-wrap', 'data-index': i }, T('span', `${path}.${i}`, 'ed-chip'))));
}

/* ------------------------------------------------------------------ */
/* I. Sen & Ben                                                        */
/* ------------------------------------------------------------------ */
function renderHome() {
  const c = state.content.home;
  const E = state.editing;
  const title = T('h1', 'home.heroTitle', 'hero-title script bloom');
  if (!E) splitLetters(title);

  const rotator = E
    ? h('div', { class: 'rotator ed-rotator' }, T('span', 'home.rotatingPrefix', 'rot-prefix'), chipList('home.rotating'))
    : h('p', { class: 'rotator reveal', style: { '--d': '.9s' } },
      T('span', 'home.rotatingPrefix', 'rot-prefix'), ' ',
      h('span', { class: 'word', 'data-rotator': '' }),
      h('span', { class: 'caret', 'aria-hidden': 'true' }));

  const specials = E ? [] : specialDays();
  const banner = specials.length
    ? h('div', { class: 'special reveal', role: 'note' },
      h('span', { class: 'special-ic', 'aria-hidden': 'true' }, specials[0].icon),
      h('p', {}, specials.map((s) => s.text).join(' · ')))
    : null;

  const units = [['y', 'Yıl'], ['mo', 'Ay'], ['d', 'Gün'], ['h', 'Saat'], ['mi', 'Dakika'], ['s', 'Saniye']];
  const parts = counterParts();
  const counter = h('section', { class: 'counter reveal', 'data-counter': '' },
    T('h3', 'home.counterTitle', 'counter-title script'),
    h('div', { class: 'counter-grid' }, units.map(([k, label]) =>
      h('div', { class: 'cbox', 'data-u': k }, h('b', {}, parts ? String(parts.parts[k]) : '0'), h('span', {}, label)))),
    h('p', { class: 'counter-total' }, 'Tam ', h('strong', { 'data-total': '' }, parts ? parts.totalDays.toLocaleString('tr-TR') : '0'), ' gündür kalbim seninle.'),
    h('p', { class: 'counter-next', 'data-next': '' }),
    T('p', 'home.counterNote', 'counter-note'));

  const stats = h('section', { class: 'stats reveal' },
    T('h3', 'home.statsTitle', 'sub-title script'),
    h('div', { class: 'stats-grid', 'data-stats': '' }, statsList().map((s) => h('div', { class: 'stat' },
      h('span', { class: 'stat-ic', 'aria-hidden': 'true' }, s.icon),
      h('b', { 'data-n': E ? null : s.n, 'data-big': s.big ? '1' : null }, s.value),
      h('span', {}, s.label)))));

  const daily = E
    ? h('section', { class: 'daily' },
      T('h3', 'home.dailyTitle', 'daily-title script'),
      h('p', { class: 'ed-note-inline' }, 'Her gün bu listeden sırayla bir not gösterilir.'),
      h('ol', { class: 'ed-daily-list', 'data-list': 'home.daily' },
        (c.daily || []).map((t, i) => h('li', { 'data-index': i }, T('p', `home.daily.${i}`, 'daily-text')))))
    : (c.daily || []).length ? h('section', { class: 'daily reveal' },
      h('span', { class: 'daily-pin', 'aria-hidden': 'true' }),
      T('h3', 'home.dailyTitle', 'daily-title script'),
      h('p', { class: 'daily-date' }, new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })),
      h('p', { class: 'daily-text' }, dailyNote())) : null;

  return chapterShell('home',
    banner,
    h('div', { class: 'hero' },
      T('p', 'home.kicker', 'hero-kicker reveal'),
      title,
      T('p', 'home.lead', 'hero-lead reveal', { style: { '--d': '.6s' } }),
      rotator),
    heartPhoto('home.photo', 'home.photoCaption'),
    counter,
    stats,
    daily,
    T('p', 'home.quote', 'quote reveal'),
    E
      ? h('section', { class: 'ed-secret' },
        h('p', { class: 'ed-secret-head' }, '🤫 Gizli not — Sena isimlere üç kez dokununca açılır (boş bırakırsan kapanır)'),
        T('p', 'home.secretHint', 'secret-hint'),
        T('p', 'home.secretNote', 'ed-secret-note ed-multiline', { 'data-multiline': '' }))
      : (String(c.secretNote || '').trim() && c.secretHint ? T('p', 'home.secretHint', 'secret-hint reveal') : null),
    h('div', { class: 'home-cta reveal' },
      h('button', { class: 'btn btn-big', type: 'button', 'data-go': 'next' }, heartSvg(), T('span', 'home.cta'))));
}

/* ------------------------------------------------------------------ */
/* II. Hikâyemiz                                                       */
/* ------------------------------------------------------------------ */
function renderStory() {
  const c = state.content.story;
  return chapterShell('story',
    chHead('story'),
    h('ol', { class: 'timeline', 'data-list': 'story.items' },
      (c.items || []).map((it, i) => h('li', { class: 'tl-item reveal', 'data-index': i },
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

/* ------------------------------------------------------------------ */
/* III. Anılarımız                                                     */
/* ------------------------------------------------------------------ */
function renderGallery() {
  const c = state.content.gallery;
  let items = (c.items || []).map((it, i) => ({ it, i }));
  const withPhoto = items.filter((x) => x.it.photo);
  if (!state.editing && withPhoto.length) items = withPhoto;
  // Sütun sayısı fotoğraf sayısına göre: boş sütun kalıp galeri yana kaymasın
  const n = items.length + (state.editing ? 1 : 0);
  const cols = (max) => String(Math.max(1, Math.ceil(n / Math.ceil(n / max))));
  return chapterShell('gallery',
    chHead('gallery'),
    state.editing || withPhoto.length > 1
      ? h('div', { class: 'gallery-tools reveal' },
        h('button', { class: 'btn btn-soft', type: 'button', 'data-action': 'slideshow' },
          svg('0 0 24 24', '<path d="M8 5v14l11-7z"/>'), T('span', 'gallery.slideshow')))
      : null,
    h('div', { class: 'polaroids', 'data-list': 'gallery.items', style: { '--c2': cols(2), '--c3': cols(3), '--c4': cols(4) } },
      items.map(({ it, i }, n) => h('figure', {
        class: 'polaroid reveal',
        'data-index': i,
        'data-tilt': state.editing ? null : '',
        style: { '--r': `${POLAROID_TILT[n % POLAROID_TILT.length]}deg`, '--d': `${(n % 4) * 0.08}s` },
      },
      h('span', { class: 'tape', 'aria-hidden': 'true' }),
      photoSlot(`gallery.items.${i}.photo`, { aspects: '4/5,1,4/3', alt: it.caption, zoom: true, caption: it.caption }),
      T('figcaption', `gallery.items.${i}.caption`)))));
}

/* ------------------------------------------------------------------ */
/* IV. Mektup + zamanı gelince açılacak mektuplar                      */
/* ------------------------------------------------------------------ */
function renderLetter() {
  const c = state.content.letter;
  const E = state.editing;
  let body;
  if (E) {
    body = T('div', 'letter.body', 'letter-body ed-multiline', { 'data-multiline': '' });
  } else {
    // Her paragraf ekrana girdiğinde kendi içinde kelime kelime belirir
    body = h('div', { class: 'letter-body' }, paragraphs(c.body).map((p) => {
      const el = h('p');
      splitWords(el, p);
      return el;
    }));
  }
  const letters = c.openWhen || [];
  const openWhen = h('section', { class: 'openwhen' },
    T('h3', 'letter.openWhenTitle', 'sub-title script reveal'),
    T('p', 'letter.openWhenIntro', 'sub-intro reveal'),
    h('div', { class: `ow-grid${E ? ' ed-ow' : ''}`, 'data-list': 'letter.openWhen' },
      letters.map((it, i) => (E
        ? h('article', { class: 'ow-edit', 'data-index': i },
          h('div', { class: 'ow-edit-head' }, T('span', `letter.openWhen.${i}.icon`, 'ow-icon'), T('h4', `letter.openWhen.${i}.label`, 'ow-label')),
          T('p', `letter.openWhen.${i}.text`, 'ow-text ed-multiline', { 'data-multiline': '' }))
        : h('button', {
          class: `ow-env reveal${openedLetter(i) ? ' opened' : ''}`,
          type: 'button',
          'data-open-when': i,
          style: { '--d': `${(i % 3) * 0.08}s` },
        },
        h('span', { class: 'ow-flap', 'aria-hidden': 'true' }),
        h('span', { class: 'ow-seal', 'aria-hidden': 'true' }, waxSeal('ow-seal-svg', { plain: true }), h('span', { class: 'ow-emoji' }, it.icon || '💌')),
        h('span', { class: 'ow-caption' },
          h('span', { class: 'ow-label' }, it.label || 'Mektup'),
          h('span', { class: 'ow-state' }, openedLetter(i) ? 'Açıldı ♥' : 'Aç')))))));

  return chapterShell('letter',
    chHead('letter'),
    h('article', { class: 'letter reveal' },
      waxSeal('letter-seal'),
      svg('0 0 64 64',
        '<path d="M33 36 Q30 48 35 62" stroke="#86b89a" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
        + '<path d="M34 50 Q44 42 50 47 Q42 55 34 50Z" fill="#a9d6b8"/><path d="M32 44 Q22 38 17 42 Q24 50 32 44Z" fill="#b9e0c6"/>'
        + `<g transform="translate(32 24)">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-9" rx="7" ry="10.5" fill="#ffb3c6" transform="rotate(${a})"/>`).join('')}`
        + `${[36, 108, 180, 252, 324].map((a) => `<ellipse cx="0" cy="-6" rx="4" ry="6.5" fill="#ff8fab" transform="rotate(${a})"/>`).join('')}<circle r="4" fill="#f7c26b"/></g>`,
        'letter-flower'),
      T('p', 'letter.greeting', 'letter-greeting script'),
      body,
      T('p', 'letter.closing', 'letter-closing'),
      T('p', 'letter.signature', 'letter-signature script ink')),
    letters.length || E ? openWhen : null);
}

/* ------------------------------------------------------------------ */
/* V. Neden Sen?                                                       */
/* ------------------------------------------------------------------ */
function meterSvg() {
  return svg('0 0 100 100',
    `<defs><clipPath id="meter-clip"><path d="${HEART_PATH}"/></clipPath>`
    + '<linearGradient id="meter-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff85a8"/><stop offset="1" stop-color="#c8103f"/></linearGradient></defs>'
    + `<path d="${HEART_PATH}" fill="#fff"/>`
    + '<g clip-path="url(#meter-clip)"><g class="meter-level" transform="translate(0 100)">'
    + '<path class="meter-wave" d="M0 4 Q12.5 -2 25 4 T50 4 T75 4 T100 4 T125 4 T150 4 V120 H0 Z" fill="url(#meter-fill)"/>'
    + '</g></g>'
    + `<path d="${HEART_PATH}" fill="none" stroke="#e0245e" stroke-width="3"/>`);
}

function renderReasons() {
  const c = state.content.reasons;
  const E = state.editing;
  return chapterShell('reasons',
    chHead('reasons'),
    h('div', { class: 'reasons', 'data-list': 'reasons.items' },
      (c.items || []).map((r, i) => h(E ? 'div' : 'button', {
        class: `flip reveal${E ? ' flipped' : ''}`,
        type: E ? null : 'button',
        'data-index': i,
        'aria-label': E ? null : `Sebep ${i + 1}`,
        style: { '--d': `${(i % 4) * 0.07}s` },
      },
      h('span', { class: 'flip-inner' },
        h('span', { class: 'flip-front', 'aria-hidden': 'true' },
          h('span', { class: 'flip-num script' }, `#${i + 1}`), heartSvg(), h('span', { class: 'flip-hint' }, 'Dokun')),
        h('span', { class: 'flip-back' }, T('span', `reasons.items.${i}`, 'flip-text')))))),
    h('div', { class: 'reasons-tools reveal' },
      h('button', { class: 'btn btn-soft', type: 'button', 'data-action': 'random-reason' }, sparkleSvg(), T('span', 'reasons.randomLabel')),
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

/* ------------------------------------------------------------------ */
/* VI. Sınav                                                           */
/* ------------------------------------------------------------------ */
function renderQuiz() {
  const c = state.content.quiz;
  const E = state.editing;
  if (E) {
    return chapterShell('quiz',
      chHead('quiz'),
      h('div', { class: 'quiz-edit', 'data-list': 'quiz.questions' },
        (c.questions || []).map((q, i) => h('article', { class: 'qe-card', 'data-index': i },
          h('p', { class: 'qe-num' }, `Soru ${i + 1}`),
          T('h4', `quiz.questions.${i}.q`, 'qe-q'),
          h('ol', { class: 'qe-options' }, [0, 1, 2, 3].map((k) => h('li', { class: `qe-opt${Number(q.answer) === k ? ' correct' : ''}` },
            h('button', {
              type: 'button', class: 'qe-mark', 'data-quiz-answer': `${i}:${k}`,
              title: 'Doğru cevap olarak işaretle', 'aria-label': 'Doğru cevap olarak işaretle',
            }, Number(q.answer) === k ? '✓' : ''),
            T('span', `quiz.questions.${i}.options.${k}`, 'qe-opt-text')))),
          h('p', { class: 'qe-note-label' }, 'Cevaptan sonra görünecek not:'),
          T('p', `quiz.questions.${i}.note`, 'qe-note')))),
      h('section', { class: 'qe-results' },
        h('h4', {}, 'Sonuç mesajları'),
        h('p', {}, h('b', {}, 'Hepsi doğruysa: '), T('span', 'quiz.resultPerfect')),
        h('p', {}, h('b', {}, 'Çoğu doğruysa: '), T('span', 'quiz.resultGood')),
        h('p', {}, h('b', {}, 'Azı doğruysa: '), T('span', 'quiz.resultLow'))));
  }
  const total = quizQuestions().length;
  return chapterShell('quiz',
    chHead('quiz'),
    h('section', { class: 'quiz reveal', 'data-quiz': '' },
      h('div', { class: 'quiz-start' },
        h('div', { class: 'quiz-badge', 'aria-hidden': 'true' }, heartSvg(), h('span', {}, String(total))),
        h('p', { class: 'quiz-count' }, `${total} soru · her doğru cevap bir kalp`),
        h('button', { class: 'btn btn-big', type: 'button', 'data-action': 'quiz-start', disabled: total ? null : true }, T('span', 'quiz.start')))));
}

/* ------------------------------------------------------------------ */
/* VII. Hayallerimiz                                                   */
/* ------------------------------------------------------------------ */
function renderDreams() {
  const c = state.content.dreams;
  const E = state.editing;
  const items = c.items || [];
  const done = items.filter((d) => d.done).length;
  return chapterShell('dreams',
    chHead('dreams'),
    h('div', { class: 'dream-progress reveal' },
      h('div', { class: 'dp-bar' }, h('i', { style: { width: `${items.length ? (done / items.length) * 100 : 0}%` } })),
      h('p', {}, h('b', {}, `${done} / ${items.length}`), ' hayal gerçekleşti')),
    h('ul', { class: 'dreams', 'data-list': 'dreams.items' },
      items.map((d, i) => h('li', { class: `dream reveal${d.done ? ' done' : ''}`, 'data-index': i, style: { '--d': `${(i % 3) * 0.06}s` } },
        E
          ? h('button', { class: 'dream-check', type: 'button', 'data-dream-toggle': i, 'aria-pressed': d.done ? 'true' : 'false', title: 'Gerçekleşti mi?' }, checkSvg())
          : h('span', { class: 'dream-check', 'aria-hidden': 'true' }, checkSvg()),
        T('span', `dreams.items.${i}.text`, 'dream-text'),
        d.done ? h('span', { class: 'dream-tag' }, 'Gerçekleşti') : null))),
    h('section', { class: 'suggest reveal' },
      T('h3', 'dreams.suggestTitle', 'sub-title script'),
      E ? h('p', { class: 'ed-note-inline' }, 'Sena buradan yeni bir hayal yazınca Gelen Kutusu’na düşer.') : null,
      h('form', { class: 'suggest-form', 'data-form': 'dream' },
        h('textarea', {
          class: 'field', name: 'text', rows: '2', maxlength: '600', required: true,
          placeholder: c.suggestPlaceholder || '', 'aria-label': c.suggestTitle || 'Hayalin',
        }),
        h('button', { class: 'btn', type: E ? 'button' : 'submit' }, T('span', 'dreams.suggestButton')))));
}

/* ------------------------------------------------------------------ */
/* VIII. Sürprizler                                                    */
/* ------------------------------------------------------------------ */
function renderSurprise() {
  const c = state.content.surprise;
  const E = state.editing;
  return chapterShell('surprise',
    chHead('surprise'),
    h('section', { class: 'surprise-block reveal' },
      T('h3', 'surprise.scratchTitle', 'sub-title script'),
      T('p', 'surprise.scratchHint', 'sub-intro'),
      h('div', { class: `scratch${E || store.get('ds:kazi') ? ' done' : ''}`, 'data-scratch': '' },
        h('div', { class: 'scratch-prize' },
          h('span', { class: 'prize-icon', 'aria-hidden': 'true' }, '🎁'),
          T('p', 'surprise.scratchPrize', 'prize-text')),
        E ? null : h('canvas', { class: 'scratch-canvas no-burst', 'aria-label': 'Kazınacak alan' })),
      !E && store.get('ds:kazi') ? h('button', { class: 'link-btn scratch-again', type: 'button', 'data-action': 'scratch-again' }, '↺ Yeniden kazı') : null),
    h('section', { class: 'surprise-block coupons-block' },
      T('h3', 'surprise.couponsTitle', 'sub-title script reveal'),
      T('p', 'surprise.couponsIntro', 'sub-intro reveal'),
      h('div', { class: 'coupons', 'data-list': 'surprise.coupons' },
        (c.coupons || []).map((cp, i) => h('div', {
          class: `coupon-wrap reveal${!E && couponUsed(cp) ? ' used' : ''}`,
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

/* ------------------------------------------------------------------ */
/* IX. Sonsuza Dek                                                     */
/* ------------------------------------------------------------------ */
function renderFinale() {
  const E = state.editing;
  const c = state.content.finale;
  const tag = E ? 'div' : 'button';
  const showSuccess = E || state.answered;
  return chapterShell('finale',
    h('header', { class: 'ch-head' }, h('p', { class: 'ch-eyebrow reveal' }, `Bölüm ${chapterNumber('finale')}`)),
    h('div', { class: `finale-ask${state.answered && !E ? ' answered' : ''}` },
      T('p', 'finale.pre', 'finale-pre reveal'),
      T('h2', 'finale.question', 'finale-q script'),
      h('div', { class: 'finale-btns reveal', style: { '--d': '.8s' } },
        h(tag, { class: 'btn yes-btn', type: E ? null : 'button', 'data-action': 'yes' }, heartSvg(), T('span', 'finale.yes')),
        h(tag, { class: 'no-btn', type: E ? null : 'button', 'data-action': 'no' }, T('span', 'finale.no', 'no-label'))),
      E ? null : h('p', { class: 'no-gone-note', hidden: true }, c.noGone || '')),
    h('div', { class: 'success', hidden: !showSuccess },
      T('p', 'finale.successTitle', 'success-title script'),
      heartPhoto('finale.photo', null),
      T('p', 'finale.big', 'success-big script'),
      T('p', 'finale.successText', 'success-text'),
      h('section', { class: 'reply' },
        T('h3', 'finale.replyTitle', 'reply-title script'),
        E ? h('p', { class: 'ed-note-inline' }, 'Sena’nın yazdığı not Gelen Kutusu’na düşer.') : null,
        h('form', { class: 'reply-form', 'data-form': 'note' },
          h('textarea', { class: 'field', name: 'text', rows: '4', maxlength: '2000', required: true, placeholder: c.replyPlaceholder || '', 'aria-label': c.replyTitle || 'Notun' }),
          h('button', { class: 'btn', type: E ? 'button' : 'submit' }, T('span', 'finale.replyButton')))),
      h('button', { class: 'btn btn-ghost', type: 'button', 'data-go': 'intro' }, '↺ ', T('span', 'finale.restart')),
      T('p', 'footer', 'site-footer')));
}

export const RENDERERS = {
  home: renderHome,
  story: renderStory,
  gallery: renderGallery,
  letter: renderLetter,
  reasons: renderReasons,
  quiz: renderQuiz,
  dreams: renderDreams,
  surprise: renderSurprise,
  finale: renderFinale,
};

/* ------------------------------------------------------------------ */
/* Kapak                                                               */
/* ------------------------------------------------------------------ */
export function renderIntro(root) {
  const E = state.editing;
  const specials = E ? [] : specialDays();
  root.textContent = '';
  root.append(h('div', { class: 'intro-inner' },
    specials.length ? h('p', { class: 'intro-ribbon' }, `${specials[0].icon} ${specials[0].text}`) : null,
    T('p', 'intro.kicker', 'intro-kicker'),
    h('div', { class: 'env-stage', 'data-tilt': E ? null : 'zarf' },
      h('div', { class: 'env-glow', 'aria-hidden': 'true' }),
      h('div', {
        class: `envelope${E ? ' open' : ''}`,
        id: 'envelope',
        role: E ? null : 'button',
        tabindex: E ? null : '0',
        'aria-label': E ? null : 'Mektubu aç',
      },
      h('div', { class: 'env-back' }),
      h('div', { class: 'env-letter' }, T('p', 'intro.letter', 'env-letter-text script'), heartSvg('env-letter-heart')),
      h('div', { class: 'env-pocket' }),
      h('div', { class: 'env-flap' }),
      h('button', { class: 'env-seal', type: 'button', 'aria-label': 'Mektubu aç', tabindex: '-1' }, waxSeal('env-seal-svg')))),
    T('h1', 'intro.to', 'intro-to script shimmer-gold'),
    T('p', 'intro.from', 'intro-from'),
    T('p', 'intro.hint', 'intro-hint'),
    E ? h('button', { class: 'btn', type: 'button', 'data-action': 'enter' }, 'Siteye gir →') : null));
  return root;
}

// Kilit ekranı (sadece Sena açabilsin diye)
export function renderLock(root) {
  const c = state.content;
  root.textContent = '';
  root.append(h('div', { class: 'intro-inner lock-inner' },
    h('p', { class: 'intro-kicker' }, c.intro?.kicker || ''),
    h('div', { class: 'lock-card' },
      h('div', { class: 'lock-seal' }, waxSeal('lock-seal-svg'), h('span', { class: 'lock-ic', 'aria-hidden': 'true' }, '🔒')),
      h('h1', { class: 'lock-to script shimmer-gold' }, c.intro?.to || ''),
      h('p', { class: 'lock-lead' }, 'Bu mektup sadece bir kişi için. Önce küçük bir soru:'),
      h('p', { class: 'lock-q' }, c.site.lock.question || ''),
      h('form', { class: 'lock-form', 'data-form': 'unlock' },
        h('input', { class: 'field', name: 'answer', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', required: true, placeholder: 'Cevabın…', 'aria-label': 'Cevabın' }),
        h('button', { class: 'btn', type: 'submit' }, 'Aç ', heartSvg())),
      h('p', { class: 'lock-msg', 'aria-live': 'polite' }),
      h('p', { class: 'lock-hint', hidden: true }, c.site.lock.hint || ''))));
  return root;
}

/* ------------------------------------------------------------------ */
/* Menü                                                                */
/* ------------------------------------------------------------------ */
export function renderMenu(root) {
  root.textContent = '';
  const list = visibleChapters();
  root.append(
    h('button', { class: 'pill menu-close', type: 'button', 'data-action': 'menu-close' }, '✕ Kapat'),
    h('div', { class: 'menu-head' },
      h('h2', { class: 'script' }, 'İçindekiler'),
      h('p', {}, 'Hangi sayfaya gitmek istersin?')),
    h('ol', {}, list.map((ch, i) => h('li', { style: { '--i': i }, class: ch.key === state.current ? 'current' : null },
      h('button', { class: 'menu-item', type: 'button', 'data-goto': ch.key },
        h('span', { class: 'menu-num' }, chapterNumber(ch.key)),
        h('span', { class: 'menu-t', 'data-bind': `${ch.key}.title` }, state.content[ch.key].title),
        h('span', { class: 'menu-d', 'data-bind': `${ch.key}.desc` }, state.content[ch.key].desc))))),
    h('div', { class: 'menu-foot' },
      h('button', { class: 'link-btn', type: 'button', 'data-go': 'intro' }, '💌 Mektubu yeniden aç')));
  return root;
}
