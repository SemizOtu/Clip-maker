// Sena’ya ❤ — sitenin ana akışı: içerik, kapak, bölümler arası geçiş ve olaylar
import {
  state, $, $$, h, sleep, rand, reducedMotion, CHAPTERS, visibleChapters, chapterNumber,
  getPath, setPath, pointOf, toast, dialog, mediaUrl, store,
} from './core.js';
import { startBackground, createFX, typewriter } from './effects.js';
import { RENDERERS, renderIntro, renderLock, renderMenu } from './chapters.js';
import * as F from './features.js';

const EDIT = /^\/duzenle\/?$/.test(location.pathname) || new URLSearchParams(location.search).has('duzenle');
state.editing = EDIT;

let io = null;
let bound = false;

/* ------------------------------------------------------------------ */
/* Sahne (kapak kadifesi, gündüz, gece)                                */
/* ------------------------------------------------------------------ */
function setScene(scene) {
  document.body.classList.toggle('at-intro', scene === 'intro');
  document.body.classList.toggle('night-mode', scene === 'night');
  state.bg?.setMode(scene === 'intro' ? 'intro' : scene === 'night' ? 'night' : 'day');
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = scene === 'day' ? '#fbd3de' : '#2a0716';
}

function makeStars() {
  const night = $('.scene-night');
  if (night && !$('.constellation', night)) night.append(F.buildConstellation());
  const box = $('.scene-night .stars');
  if (!box || box.childElementCount) return;
  const n = innerWidth < 600 ? 60 : 100;
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

/* ------------------------------------------------------------------ */
/* Çizim                                                               */
/* ------------------------------------------------------------------ */
function observeAll() {
  if (!io) {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });
  }
  io.disconnect();
  $$('.chapter.active .reveal, .chapter.active .ink, .chapter.active .bloom, .chapter.active .words').forEach((el) => io.observe(el));
}
state.observe = (el) => io && io.observe(el);

function renderAll() {
  const root = $('#chapters');
  root.textContent = '';
  for (const ch of visibleChapters()) root.append(RENDERERS[ch.key]());
  renderIntro($('#intro'));
  renderMenu($('#menu'));
  setupMusic();
  document.title = state.content.site?.title || document.title;
  document.dispatchEvent(new CustomEvent('app:render'));
}

function updateTopbar() {
  const key = state.current;
  const title = $('#topbar-title');
  const list = visibleChapters();
  const i = list.findIndex((c) => c.key === key);
  if (title) title.textContent = key ? `${chapterNumber(key)} · ${state.content[key]?.title || ''}` : '';
  const bar = $('#progress i');
  if (bar) bar.style.width = i >= 0 ? `${((i + 1) / list.length) * 100}%` : '0%';
  $('#progress').classList.toggle('show', i >= 0);
}

/* ------------------------------------------------------------------ */
/* Kalpli sayfa geçişi                                                 */
/* ------------------------------------------------------------------ */
// swap: kalp ekranı kapatınca sayfayı değiştirir; reveal: kalp açılmaya başlarken
// bölümün animasyonlarını başlatır (perdenin arkasında oynayıp bitmesinler)
async function heartWipe(point, card, swap, reveal = () => {}) {
  const W = innerWidth;
  const H = innerHeight;
  if (reducedMotion || state.editing) {
    swap();
    reveal();
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
  await sleep(card.title ? 1050 : 250);
  cardEl.classList.remove('show');
  await sleep(180);
  heart.style.left = `${W / 2 - 240}px`;
  heart.style.top = `${H / 2 - 230}px`;
  const shrink = heart.animate([{ transform: `scale(${S})` }, { transform: 'scale(0)' }],
    { duration: 720, easing: 'cubic-bezier(.55,0,.1,1)', fill: 'forwards' });
  await sleep(240);
  reveal();
  await shrink.finished.catch(() => {});
  wipe.classList.remove('active');
}

/* ------------------------------------------------------------------ */
/* Gezinme                                                             */
/* ------------------------------------------------------------------ */
function keyFromHash() {
  const slug = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const ch = visibleChapters().find((c) => c.slug === slug);
  return ch ? ch.key : null;
}

function setHash(key) {
  const ch = CHAPTERS.find((c) => c.key === key);
  const url = ch ? `#/${ch.slug}` : location.pathname + location.search;
  if (ch ? location.hash !== url : Boolean(location.hash)) history.pushState(null, '', url);
}

function relativeKey(step) {
  const list = visibleChapters();
  const i = list.findIndex((c) => c.key === state.current);
  const j = Math.max(0, Math.min(list.length - 1, i + step));
  return list[j]?.key || list[0]?.key;
}

export async function go(target, point, { push = true } = {}) {
  if (state.busy) return;
  if (target === state.current) { closeMenu(); return; }
  state.busy = true;
  const toIntro = !target;
  const card = toIntro
    ? { eyebrow: '', title: '', desc: '' }
    : { eyebrow: `Bölüm ${chapterNumber(target)}`, title: state.content[target].title, desc: state.content[target].desc };
  try {
    await heartWipe(point, card, () => {
      closeMenu(true);
      if (toIntro) showIntro(); else showChapter(target, { defer: true });
      if (push) setHash(toIntro ? null : target);
    }, () => { if (!toIntro) startChapter(target); });
  } finally {
    state.busy = false;
  }
}
state.go = go;

function stopBehaviors() {
  state.stops.forEach((fn) => { try { fn(); } catch { /* yok say */ } });
  state.stops = [];
  F.closeLightbox();
  F.closeSlideshow();
}

function showChapter(key, { defer = false } = {}) {
  stopBehaviors();
  $('#intro').classList.add('gone');
  $('#topbar').hidden = false;
  $$('.chapter').forEach((s) => {
    const on = s.dataset.ch === key;
    s.classList.toggle('active', on);
    if (!on) $$('.is-in', s).forEach((el) => el.classList.remove('is-in'));
  });
  state.current = key;
  setScene(key === 'finale' ? 'night' : 'day');
  window.scrollTo(0, 0);
  $$('#menu li').forEach((li) => li.classList.toggle('current', $('[data-goto]', li)?.dataset.goto === key));
  updateTopbar();
  if (!defer) startChapter(key);
}

function startChapter(key) {
  if (state.current !== key) return;
  observeAll();
  startBehaviors(key);
}

function showIntro() {
  stopBehaviors();
  renderIntro($('#intro'));
  if (state.editing) document.dispatchEvent(new CustomEvent('app:render'));
  $$('.chapter').forEach((s) => s.classList.remove('active'));
  $('#intro').classList.remove('gone', 'opening');
  $('#topbar').hidden = true;
  setScene('intro');
  state.current = null;
  updateTopbar();
  $$('#menu li').forEach((li) => li.classList.remove('current'));
  window.scrollTo(0, 0);
}

function startBehaviors(key) {
  const sec = $(`#ch-${key}`);
  if (!sec) return;
  if (key === 'home') {
    const word = $('[data-rotator]', sec);
    if (word) state.stops.push(typewriter(word, state.content.home.rotating || []));
    state.stops.push(F.startCounter(sec));
    F.celebrateSpecial();
    const stats = $('.stats', sec);
    if (stats && !state.editing) {
      const seen = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { seen.disconnect(); F.countUp(stats); }
      }, { threshold: 0.35 });
      seen.observe(stats);
      state.stops.push(() => seen.disconnect());
    }
  }
  if (key === 'surprise' && !state.editing) requestAnimationFrame(() => F.initScratch(sec));
  if (key === 'finale' && !state.editing) {
    F.resetNoButton();
    if (state.answered) F.startLoveWords(sec);
    state.stops.push(F.startNightSky());
    state.stops.push(() => { F.resetNoButton(); F.stopLoveWords(); });
  }
}

function openMenu() {
  const menu = $('#menu');
  menu.classList.add('open');
  menu.setAttribute('aria-hidden', 'false');
  $('#menu-btn').setAttribute('aria-expanded', 'true');
  const cur = $('li.current .menu-item', menu) || $('.menu-item', menu);
  if (cur) cur.focus({ preventScroll: true });
}

function closeMenu(instant) {
  const menu = $('#menu');
  if (!menu.classList.contains('open')) return false;
  if (instant) {
    menu.style.transition = 'none';
    requestAnimationFrame(() => { menu.style.transition = ''; });
  }
  menu.classList.remove('open');
  menu.setAttribute('aria-hidden', 'true');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
  return true;
}

/* ------------------------------------------------------------------ */
/* Kapak / zarf                                                        */
/* ------------------------------------------------------------------ */
async function openEnvelope() {
  const env = $('#envelope');
  if (!env || state.busy || state.editing || env.classList.contains('open')) return;
  state.busy = true;
  playMusic();
  const seal = $('.env-seal', env).getBoundingClientRect();
  await F.crackSeal(env);
  env.classList.add('open');
  $('#intro').classList.add('opening');
  state.fx.burst(seal.left + seal.width / 2, seal.top + seal.height / 2, 18, { power: 1.15 });
  if ('vibrate' in navigator) { try { navigator.vibrate(18); } catch { /* yok say */ } }
  await sleep(reducedMotion ? 200 : 1750);
  const letter = $('.env-letter', env).getBoundingClientRect();
  state.busy = false;
  const first = state.startKey && visibleChapters().some((c) => c.key === state.startKey) ? state.startKey : visibleChapters()[0]?.key;
  await go(first, { x: letter.left + letter.width / 2, y: letter.top + letter.height / 2 });
}

/* ------------------------------------------------------------------ */
/* Kilit                                                               */
/* ------------------------------------------------------------------ */
async function tryUnlock(form) {
  const input = form.elements.answer;
  const btn = $('button[type="submit"]', form);
  const msg = $('.lock-msg');
  const answer = input.value.trim();
  if (!answer) { input.focus(); return; }
  btn.disabled = true;
  try {
    const res = await fetch('/api/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      const card = $('.lock-card');
      card.classList.add('unlocked');
      const r = card.getBoundingClientRect();
      state.fx.burst(r.left + r.width / 2, r.top + r.height / 3, 26, { power: 1.3 });
      await sleep(700);
      await boot({ afterUnlock: true });
      return;
    }
    state.lockTries = (state.lockTries || 0) + 1;
    msg.textContent = data.error || 'Bu değil gibi 🙈';
    const card = $('.lock-card');
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
    if (state.lockTries >= 2) $('.lock-hint').hidden = false;
    input.select();
  } catch {
    msg.textContent = 'Bağlantı kurulamadı; internetini kontrol edip tekrar dener misin?';
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Müzik                                                               */
/* ------------------------------------------------------------------ */
function setupMusic() {
  const music = state.content.site?.music || {};
  const btn = $('#music-btn');
  const audio = $('#music');
  if (!music.src) {
    btn.hidden = true;
    if (!audio.paused) audio.pause();
    audio.removeAttribute('src');
    return;
  }
  const url = mediaUrl(music.src);
  if (audio.getAttribute('src') !== url) audio.src = url;
  btn.hidden = false;
  const label = [music.title, music.artist].filter(Boolean).join(' — ') || 'Şarkımız';
  btn.title = label;
  btn.setAttribute('aria-label', `${label} — çal / durdur`);
}

function playMusic() {
  const audio = $('#music');
  if (!audio.getAttribute('src') || !audio.paused) return;
  audio.volume = 0;
  audio.play().then(() => {
    let v = 0;
    const t = setInterval(() => {
      v = Math.min(0.75, v + 0.05);
      audio.volume = v;
      if (v >= 0.75) clearInterval(t);
    }, 120);
    const m = state.content.site.music;
    if (!state.musicAnnounced) {
      state.musicAnnounced = true;
      setTimeout(() => toast(`🎵 ${[m.title, m.artist].filter(Boolean).join(' — ') || 'Şarkımız'} çalıyor`, { ms: 3200 }), 2600);
    }
  }).catch(() => {});
}
state.playMusic = playMusic;

/* ------------------------------------------------------------------ */
/* Olaylar                                                             */
/* ------------------------------------------------------------------ */
function bindEvents() {
  if (bound) return;
  bound = true;

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const editingText = state.editing && t.closest('[data-edit]');

    const goEl = t.closest('[data-go]');
    if (goEl && !editingText) {
      const dir = goEl.dataset.go;
      const p = pointOf(e, goEl);
      if (dir === 'next') go(relativeKey(1), p);
      else if (dir === 'prev') go(relativeKey(-1), p);
      else if (dir === 'intro') { state.answered = false; state.startKey = null; go(null, p); }
      return;
    }
    const gotoEl = t.closest('[data-goto]');
    if (gotoEl) { go(gotoEl.dataset.goto, pointOf(e, gotoEl)); return; }

    const act = t.closest('[data-action]');
    if (act) {
      const a = act.dataset.action;
      if (a === 'menu-close') { closeMenu(); return; }
      if (a === 'enter') { go(visibleChapters()[0]?.key, pointOf(e, act)); return; }
      if (state.editing) return;
      if (a === 'flip-all') {
        const cards = $$('.flip', act.closest('.chapter'));
        const all = cards.every((c) => c.classList.contains('flipped'));
        cards.forEach((c, n) => setTimeout(() => c.classList.toggle('flipped', !all), n * 70));
        return;
      }
      if (a === 'random-reason') {
        const cards = $$('.flip', act.closest('.chapter'));
        if (!cards.length) return;
        const pickCard = cards[(Math.random() * cards.length) | 0];
        cards.forEach((c) => c.classList.remove('spotlight'));
        pickCard.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
        setTimeout(() => {
          pickCard.classList.add('flipped', 'spotlight');
          const r = pickCard.getBoundingClientRect();
          state.fx.burst(r.left + r.width / 2, r.top + r.height / 2, 14, { power: 1 });
          setTimeout(() => pickCard.classList.remove('spotlight'), 2400);
        }, reducedMotion ? 0 : 450);
        return;
      }
      if (a === 'meter') { F.runMeter(act.closest('[data-meter]')); return; }
      if (a === 'yes') { F.celebrate(); return; }
      if (a === 'no') { e.preventDefault(); F.flee(act); return; }
      if (a === 'slideshow') { F.openSlideshow(); return; }
      if (a === 'quiz-start') { F.startQuiz(act.closest('[data-quiz]')); return; }
      if (a === 'scratch-again') {
        store.remove('ds:kazi');
        const sec = act.closest('.chapter');
        const fresh = RENDERERS.surprise();
        sec.replaceWith(fresh);
        fresh.classList.add('active');
        observeAll();
        requestAnimationFrame(() => F.initScratch(fresh));
        return;
      }
    }
    if (state.editing) return;

    const flip = t.closest('.flip');
    if (flip) {
      flip.classList.toggle('flipped');
      if (flip.classList.contains('flipped')) {
        const r = flip.getBoundingClientRect();
        state.fx.sparkle(r.left + r.width / 2, r.top + r.height / 2, 12, { power: 0.8 });
      }
      return;
    }
    const hero = t.closest('.hero-title');
    if (hero) {
      const now = Date.now();
      state.heroTaps = (now - (state.heroTapAt || 0) < 900 ? (state.heroTaps || 0) : 0) + 1;
      state.heroTapAt = now;
      hero.classList.remove('tap');
      void hero.offsetWidth;
      hero.classList.add('tap');
      if (state.heroTaps >= 3) { state.heroTaps = 0; F.openSecret(hero); }
      return;
    }
    const zoomImg = t.closest('.slot[data-zoom] img');
    if (zoomImg) { F.openLightbox(zoomImg); return; }
    const couponBtn = t.closest('.coupon-use');
    if (couponBtn) { F.useCoupon(Number(couponBtn.dataset.coupon), couponBtn); return; }
    const usedWrap = t.closest('.coupon-wrap.used');
    if (usedWrap) {
      const b = $('.coupon-use', usedWrap);
      if (b) F.useCoupon(Number(b.dataset.coupon), b);
      return;
    }
    const ow = t.closest('[data-open-when]');
    if (ow) { F.openWhenLetter(Number(ow.dataset.openWhen), ow); return; }
    if (t.closest('.envelope')) openEnvelope();
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
    e.preventDefault();
    if (form.dataset.form === 'unlock') tryUnlock(form);
    else if (!state.editing) F.submitForm(form);
  });

  document.addEventListener('keydown', (e) => {
    if (!$('#slideshow').hidden) {
      if (e.key === 'Escape') F.closeSlideshow();
      if (e.key === 'ArrowRight') F.stepSlideshow(1);
      if (e.key === 'ArrowLeft') F.stepSlideshow(-1);
      if (e.key === ' ') { e.preventDefault(); F.toggleSlideshow(); }
      return;
    }
    if (!$('#lightbox').hidden) {
      if (e.key === 'Escape') F.closeLightbox();
      if (e.key === 'ArrowRight') F.stepLightbox(1);
      if (e.key === 'ArrowLeft') F.stepLightbox(-1);
      return;
    }
    if (e.key === 'Escape' && closeMenu()) return;
    if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'envelope') {
      e.preventDefault();
      openEnvelope();
    }
  });

  // “Hayır” butonu dokunulmadan kaçsın
  document.addEventListener('pointerover', (e) => {
    if (state.editing || e.pointerType !== 'mouse') return;
    const no = e.target instanceof Element && e.target.closest('.no-btn[data-action="no"]');
    if (no && !no.classList.contains('gone')) F.flee(no);
  });
  document.addEventListener('pointerdown', (e) => {
    if (state.editing || !(e.target instanceof Element)) return;
    const no = e.target.closest('.no-btn[data-action="no"]');
    if (no && e.pointerType !== 'mouse') { e.preventDefault(); F.flee(no); }
  });

  // Dokunulan yerde kalpler
  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !(e.target instanceof Element)) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], .no-burst, .ed-ui, #lightbox, #slideshow, .dialog-back')) return;
    const popped = !state.editing && !e.target.closest('button, a, .envelope') ? state.bg?.pop(e.clientX, e.clientY) : null;
    if (popped) {
      state.fx.sparkle(popped.x, popped.y, 16, { power: 0.9 });
      state.fx.burst(popped.x, popped.y, 9, { power: 0.9, size: [10, 18] });
      return;
    }
    state.fx.burst(e.clientX, e.clientY, 7, { power: 0.75, size: [8, 16] });
  }, { passive: true });

  // Masaüstünde zarf ve polaroidler fareyi takip ederek hafifçe eğilir
  if (matchMedia('(pointer: fine)').matches && !reducedMotion) {
    let tiltEl = null;
    let raf = 0;
    const reset = (el) => { if (el) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el.classList.remove('tilting'); } };
    const release = () => { cancelAnimationFrame(raf); reset(tiltEl); tiltEl = null; };
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || state.editing) return;
      const el = e.target instanceof Element ? e.target.closest('[data-tilt]') : null;
      if (el !== tiltEl) { release(); tiltEl = el; }
      if (!el || el.closest('.intro.opening')) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        const k = el.dataset.tilt === 'zarf' ? 12 : 9;
        el.classList.add('tilting');
        el.style.setProperty('--ry', `${(dx * k).toFixed(2)}deg`);
        el.style.setProperty('--rx', `${(-dy * k).toFixed(2)}deg`);
      });
    }, { passive: true });
    // Fare pencereden çıkınca ya da sayfa kayınca düzelsin
    document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) release(); });
    addEventListener('scroll', () => { if (tiltEl) release(); }, { passive: true });
  }

  if (matchMedia('(pointer: fine)').matches) {
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && !state.editing) state.fx.trail(e.clientX, e.clientY);
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
  $('.lb-close', box).addEventListener('click', F.closeLightbox);
  $('.lb-prev', box).addEventListener('click', () => F.stepLightbox(-1));
  $('.lb-next', box).addEventListener('click', () => F.stepLightbox(1));
  box.addEventListener('click', (e) => { if (e.target === box) F.closeLightbox(); });
  swipe(box, (d) => F.stepLightbox(d));

  const ssBox = $('#slideshow');
  $('.ss-close', ssBox).addEventListener('click', F.closeSlideshow);
  $('.ss-prev', ssBox).addEventListener('click', () => F.stepSlideshow(-1));
  $('.ss-next', ssBox).addEventListener('click', () => F.stepSlideshow(1));
  $('.ss-play', ssBox).addEventListener('click', F.toggleSlideshow);
  swipe(ssBox, (d) => F.stepSlideshow(d));

  window.addEventListener('popstate', () => {
    if (state.locked) return;
    const key = keyFromHash();
    if (key !== state.current) go(key, null, { push: false });
  });
}

function swipe(el, fn) {
  let sx = null;
  let sy = null;
  el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  el.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) fn(dx < 0 ? 1 : -1);
  });
}

/* ------------------------------------------------------------------ */
/* Düzenleme modu için dışa açılan arayüz                              */
/* ------------------------------------------------------------------ */
export const app = {
  state,
  CHAPTERS,
  getPath,
  setPath,
  toast,
  dialog,
  mediaUrl,
  go,
  get content() { return state.content; },
  setContent(c) { state.content = c; },
  setLocalUrl(path, url) { state.localUrls.set(path, url); },
  rerender() {
    const y = window.scrollY;
    const key = state.current;
    stopBehaviors();
    renderAll();
    if (key && $(`#ch-${key}`)) {
      $('#intro').classList.add('gone');
      $$('.chapter').forEach((s) => s.classList.toggle('active', s.dataset.ch === key));
      updateTopbar();
      observeAll();
      startBehaviors(key);
      window.scrollTo(0, y);
    } else if (key) {
      showChapter(visibleChapters()[0].key);
    }
  },
  syncBinds(path) {
    const v = getPath(state.content, path);
    $$(`[data-bind="${path}"]`).forEach((el) => { el.textContent = v == null ? '' : String(v); });
    if (path === 'site.title') document.title = v || document.title;
    if (/\.title$/.test(path)) updateTopbar();
  },
  setEditing(on) {
    state.editing = on;
    state.previewing = !on;
    document.body.classList.toggle('editing', on);
    app.rerender();
  },
  start(content) {
    state.content = content;
    state.locked = false;
    renderAll();
    bindEvents();
    const key = keyFromHash();
    state.startKey = key;
    if (state.editing && key) showChapter(key); else showIntro();
    document.body.classList.remove('is-loading');
  },
};

/* ------------------------------------------------------------------ */
/* Başlat                                                              */
/* ------------------------------------------------------------------ */
async function loadPublic() {
  const res = await fetch('/api/content', { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function fail(msg) {
  document.body.classList.remove('is-loading');
  document.body.append(h('div', { class: 'noscript' }, msg));
}

async function boot({ afterUnlock = false } = {}) {
  let data;
  try {
    data = await loadPublic();
  } catch (err) {
    console.error(err);
    fail('İçerik yüklenemedi 😢 Sayfayı yenilemeyi dene.');
    return;
  }
  state.admin = Boolean(data.admin);
  if (data.locked) {
    state.content = data.content;
    state.locked = true;
    bindEvents();
    setScene('intro');
    renderLock($('#intro'));
    document.title = data.content.site?.title || document.title;
    document.body.classList.remove('is-loading');
    $('.lock-form input')?.focus({ preventScroll: true });
    return;
  }
  app.start(data.content);
  // Düzenleme moduna sadece adresin sonuna /duzenle yazarak girilir (sitede bağlantısı yok)
  if (afterUnlock) toast('Hoş geldin 💖', { ms: 2600 });
  // Daha önce internet yokken gönderilemeyen haberler varsa şimdi gönder
  F.flushOutbox();
}

async function init() {
  if (EDIT) document.body.classList.add('editing');
  state.bg = startBackground($('#bg-canvas'));
  state.fx = createFX($('#fx-canvas'));
  makeStars();
  if (document.fonts && document.fonts.ready) {
    await Promise.race([document.fonts.ready, sleep(1500)]);
  }
  if (EDIT) {
    try {
      const mod = await import('./editor.js');
      await mod.startEditor(app);
    } catch (err) {
      console.error(err);
      fail(`Düzenleme modu açılamadı: ${err.message}`);
    }
    return;
  }
  addEventListener('online', () => F.flushOutbox());
  await boot();
}

init();
