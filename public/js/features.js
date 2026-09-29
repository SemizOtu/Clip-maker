// Etkileşimler: sayaç, özel günler, ölçer, kazı kazan, sınav, mektuplar,
// kuponlar, final, ışık kutusu, slayt gösterisi ve Deniz'e giden bildirimler
import {
  state, $, $$, h, rand, reducedMotion, parseDate, diffParts, daysBetween, addMonths,
  sameDay, dayIndex, fmtNum, store, toast, dialog, heartSvg, mediaUrl, paragraphs, HEART_PATH,
} from './core.js';
import { splitWords } from './effects.js';

const fx = () => state.fx;

/* ------------------------------------------------------------------ */
/* Tarihler, sayaç, özel günler                                        */
/* ------------------------------------------------------------------ */
export const sinceDate = () => parseDate(state.content?.site?.since);

const calMonths = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());

export function counterParts(now = new Date()) {
  const since = sinceDate();
  if (!since) return null;
  return { parts: diffParts(since, now), totalDays: Math.max(0, Math.floor((now - since) / 86_400_000)) };
}

function bigNum(n) {
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyar`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyon`;
  return fmtNum(n);
}

export function statsList(now = new Date()) {
  const since = sinceDate();
  const ms = since ? Math.max(0, now - since) : 0;
  const days = ms / 86_400_000;
  const months = since && since < now ? diffParts(since, now).y * 12 + diffParts(since, now).mo : 0;
  return [
    { icon: '🌅', value: fmtNum(Math.floor(days)), label: 'gün doğumu' },
    { icon: '🌕', value: fmtNum(Math.floor(days / 29.530588853)), label: 'dolunay' },
    { icon: '🍂', value: fmtNum(Math.floor(months / 3)), label: 'mevsim' },
    { icon: '💓', value: bigNum((ms / 60_000) * 72), label: 'kalp atışı' },
  ];
}

function birthdayOf(now) {
  const b = parseDate(state.content?.site?.birthday);
  if (!b) return null;
  let next = new Date(now.getFullYear(), b.getMonth(), b.getDate());
  if (daysBetween(now, next) < 0) next = new Date(now.getFullYear() + 1, b.getMonth(), b.getDate());
  return next;
}

export function nextMilestones(now = new Date()) {
  const since = sinceDate();
  const out = [];
  if (since && since <= now) {
    const m = calMonths(since, now);
    let n = m;
    let date = addMonths(since, m);
    if (daysBetween(now, date) <= 0) { n = m + 1; date = addMonths(since, m + 1); }
    const left = daysBetween(now, date);
    if (n % 12 === 0) out.push({ icon: '🥂', text: `${n / 12}. yıl dönümümüze ${left} gün kaldı` });
    else out.push({ icon: '💞', text: `${n}. ayımıza ${left} gün kaldı` });
    const total = daysBetween(since, now);
    const hundred = (Math.floor(total / 100) + 1) * 100;
    if (hundred - total <= 30) out.push({ icon: '✨', text: `${hundred.toLocaleString('tr-TR')}. günümüze ${hundred - total} gün kaldı` });
  }
  const bd = birthdayOf(now);
  if (bd) {
    const left = daysBetween(now, bd);
    if (left > 0 && left <= 30) out.push({ icon: '🎂', text: `Doğum gününe ${left} gün kaldı` });
  }
  return out;
}

export function specialDays(now = new Date()) {
  const out = [];
  const c = state.content;
  if (!c || !c.site) return out;
  const you = c.names?.you || '';
  const since = sinceDate();
  if (since && since <= now) {
    const m = calMonths(since, now);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (m > 0 && now.getDate() === Math.min(since.getDate(), lastDay)) {
      if (m % 12 === 0) out.push({ key: `yil-${m / 12}`, icon: '🥂', text: `Bugün ${m / 12}. yıl dönümümüz!` });
      else out.push({ key: `ay-${m}`, icon: '💞', text: `Bugün ${m}. ayımız!` });
    }
    const total = daysBetween(since, now);
    if (total > 0 && total % 100 === 0) out.push({ key: `gun-${total}`, icon: '✨', text: `Bugün birlikte ${total.toLocaleString('tr-TR')}. günümüz!` });
  }
  const bd = birthdayOf(now);
  if (bd && sameDay(bd, now)) out.push({ key: 'dogum', icon: '🎂', text: `İyi ki doğdun ${you}!` });
  if (now.getMonth() === 1 && now.getDate() === 14) out.push({ key: 'sevgililer', icon: '💘', text: 'Sevgililer Günümüz kutlu olsun!' });
  if (now.getMonth() === 0 && now.getDate() === 1) out.push({ key: 'yilbasi', icon: '🎆', text: 'Mutlu yıllar sevgilim!' });
  return out;
}

export function dailyNote(now = new Date()) {
  const list = (state.content?.home?.daily || []).filter((s) => s && String(s).trim());
  return list.length ? list[dayIndex(now) % list.length] : '';
}

export function startCounter(sec) {
  const root = $('[data-counter]', sec);
  if (!root) return () => {};
  const next = $('[data-next]', root);
  const total = $('[data-total]', root);
  const update = () => {
    const r = counterParts();
    if (!r) return;
    for (const [k, v] of Object.entries(r.parts)) {
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
    if (total) total.textContent = r.totalDays.toLocaleString('tr-TR');
  };
  if (next) {
    const list = nextMilestones();
    next.textContent = list.map((m) => `${m.icon} ${m.text}`).join('   ·   ');
    next.hidden = !list.length;
  }
  update();
  const timer = setInterval(update, 1000);
  return () => clearInterval(timer);
}

// Özel günde ana sayfaya ilk girişte kutlama (günde bir kez)
export function celebrateSpecial() {
  if (state.editing) return;
  const list = specialDays();
  if (!list.length) return;
  const key = `ds:kutlama:${new Date().toDateString()}`;
  if (store.get(key)) return;
  store.set(key, '1');
  setTimeout(() => {
    fx().fireworks({ count: 5 });
    toast(`${list[0].icon} ${list[0].text}`, { ms: 5000 });
  }, 900);
}

/* ------------------------------------------------------------------ */
/* Deniz'e bildirim                                                    */
/* ------------------------------------------------------------------ */
export async function sendEvent(type, { title = '', text = '' } = {}, { once = null } = {}) {
  if (state.editing || state.previewing) return { skipped: true };
  if (once && store.get(`ds:olay:${once}`)) return { skipped: true };
  try {
    const res = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title, text }),
    });
    if (res.ok && once) store.set(`ds:olay:${once}`, '1');
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  }
}

/* ------------------------------------------------------------------ */
/* Aşk ölçer                                                           */
/* ------------------------------------------------------------------ */
export function runMeter(card) {
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
    const e = 1 - (1 - t) ** 3;
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
        fx().burst(r.left + r.width / 2, r.top + r.height / 2, 32, { power: 1.5 });
      }
    }, 95);
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------ */
/* Kazı kazan                                                          */
/* ------------------------------------------------------------------ */
export async function initScratch(sec) {
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
  grad.addColorStop(0, '#f3c98b');
  grad.addColorStop(0.35, '#e8b36c');
  grad.addColorStop(0.65, '#f6d9a3');
  grad.addColorStop(1, '#d99a4e');
  g.fillStyle = grad;
  g.fillRect(0, 0, r.width, r.height);
  const shine = g.createLinearGradient(0, 0, r.width, 0);
  shine.addColorStop(0, 'rgba(255,255,255,0)');
  shine.addColorStop(0.45, 'rgba(255,255,255,.35)');
  shine.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.fillStyle = shine;
  g.fillRect(0, 0, r.width, r.height);
  const heart = new Path2D(HEART_PATH);
  g.fillStyle = 'rgba(255,255,255,.22)';
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
  g.shadowColor = 'rgba(120, 60, 10, .5)';
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
  const reveal = () => {
    if (wrap.classList.contains('done')) return;
    wrap.classList.add('done');
    store.set('ds:kazi', new Date().toISOString());
    const b = wrap.getBoundingClientRect();
    fx().burst(b.left + b.width / 2, b.top + b.height / 2, 28, { power: 1.4 });
    fx().confetti({ count: 90 });
    sendEvent('kazi', { title: 'Kazı kazanı kazıdı ve ödülünü gördü 🎁' }, { once: 'kazi' });
  };
  const check = () => {
    const data = g.getImageData(0, 0, cv.width, cv.height).data;
    let clear = 0;
    let total = 0;
    for (let i = 3; i < data.length; i += 4 * 23) {
      total++;
      if (data[i] < 50) clear++;
    }
    if (total && clear / total > 0.5) reveal();
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
    if (moves % 4 === 0) fx().trail(e.clientX, e.clientY);
  });
  const end = () => { if (drawing) { drawing = false; check(); } };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

/* ------------------------------------------------------------------ */
/* Sınav                                                               */
/* ------------------------------------------------------------------ */
export function quizQuestions() {
  return (state.content?.quiz?.questions || []).map((q) => {
    const options = (q.options || []).map((t, k) => ({ t: String(t || '').trim(), k })).filter((o) => o.t);
    return { q: String(q.q || '').trim(), note: String(q.note || '').trim(), options, answer: Number(q.answer) };
  }).filter((q) => q.q && q.options.length >= 2 && q.options.some((o) => o.k === q.answer));
}

export function startQuiz(box) {
  const qs = quizQuestions();
  const c = state.content.quiz;
  if (!qs.length || !box) return;
  let i = 0;
  let score = 0;
  let answered = false;

  const renderQuestion = () => {
    answered = false;
    const q = qs[i];
    box.replaceChildren(h('div', { class: 'quiz-q' },
      h('div', { class: 'quiz-progress', 'aria-hidden': 'true' }, qs.map((_, n) => h('i', { class: n < i ? 'done' : n === i ? 'now' : '' }))),
      h('p', { class: 'quiz-num' }, `Soru ${i + 1} / ${qs.length}`),
      h('h3', { class: 'quiz-text' }, q.q),
      h('div', { class: 'quiz-options' }, q.options.map((o, n) => h('button', {
        class: 'quiz-opt', type: 'button', 'data-k': o.k, style: { '--d': `${n * 0.06}s` },
      }, h('span', { class: 'qo-letter', 'aria-hidden': 'true' }, 'ABCDEF'[n]), h('span', { class: 'qo-text' }, o.t)))),
      h('p', { class: 'quiz-note', 'aria-live': 'polite' }),
      h('button', { class: 'btn quiz-next', type: 'button', hidden: true }, i + 1 < qs.length ? 'Sonraki soru →' : 'Sonucu gör 💝')));
    const first = $('.quiz-opt', box);
    if (first && state.quizFocus) first.focus({ preventScroll: true });
  };

  const renderResult = () => {
    const ratio = score / qs.length;
    const msg = ratio === 1 ? c.resultPerfect : ratio >= 0.6 ? c.resultGood : c.resultLow;
    box.replaceChildren(h('div', { class: 'quiz-result' },
      h('p', { class: 'quiz-num' }, 'Sonucun'),
      h('div', { class: 'quiz-hearts', 'aria-label': `${qs.length} sorudan ${score} doğru` },
        qs.map((_, n) => h('span', { class: n < score ? 'on' : '', style: { '--d': `${n * 0.12}s` } }, heartSvg()))),
      h('p', { class: 'quiz-score' }, h('b', {}, String(score)), ` / ${qs.length}`),
      h('p', { class: 'quiz-msg script' }, msg || ''),
      h('button', { class: 'link-btn', type: 'button', 'data-quiz-retry': '' }, `↺ ${c.retry || 'Tekrar çöz'}`)));
    if (ratio === 1) { fx().confetti({ count: 140 }); fx().fireworks({ count: 3 }); } else {
      const r = box.getBoundingClientRect();
      fx().burst(r.left + r.width / 2, r.top + 80, 22, { power: 1.2 });
    }
    sendEvent('sinav', { title: `Sınavı bitirdi: ${score} / ${qs.length}`, text: msg || '' });
  };

  box.onclick = (e) => {
    const opt = e.target.closest('.quiz-opt');
    if (opt && !answered) {
      answered = true;
      const q = qs[i];
      const k = Number(opt.dataset.k);
      const ok = k === q.answer;
      if (ok) score++;
      $$('.quiz-opt', box).forEach((b) => {
        b.disabled = true;
        if (Number(b.dataset.k) === q.answer) b.classList.add('correct');
      });
      if (!ok) opt.classList.add('wrong');
      $('.quiz-note', box).textContent = `${ok ? 'Doğru! 🎉' : 'Hımm, olmadı 🙈'} ${q.note}`.trim();
      const r = opt.getBoundingClientRect();
      if (ok) fx().burst(r.left + r.width / 2, r.top + r.height / 2, 14, { power: 1 });
      const nextBtn = $('.quiz-next', box);
      nextBtn.hidden = false;
      nextBtn.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('.quiz-next')) {
      i++;
      state.quizFocus = true;
      if (i < qs.length) renderQuestion(); else renderResult();
      box.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
      return;
    }
    if (e.target.closest('[data-quiz-retry]')) {
      i = 0;
      score = 0;
      renderQuestion();
    }
  };
  state.quizFocus = false;
  renderQuestion();
}

/* ------------------------------------------------------------------ */
/* Zamanı gelince açılacak mektuplar                                   */
/* ------------------------------------------------------------------ */
const letterKey = (it) => `ds:mektup:${it.label}`;
export const openedLetter = (i) => {
  const it = state.content?.letter?.openWhen?.[i];
  return it ? Boolean(store.get(letterKey(it))) : false;
};

export function openWhenLetter(i, btn) {
  const it = state.content.letter.openWhen[i];
  if (!it) return;
  const first = !store.get(letterKey(it));
  store.set(letterKey(it), new Date().toISOString());
  if (btn) {
    btn.classList.add('opened');
    const s = $('.ow-state', btn);
    if (s) s.textContent = 'Açıldı ♥';
  }
  const body = h('div', { class: 'ow-letter-body' });
  let n = 0;
  paragraphs(it.text).forEach((p) => {
    const el = h('p');
    n = splitWords(el, p, n);
    body.append(el);
  });
  const prevFocus = document.activeElement;
  const back = h('div', { class: 'ow-modal-back no-burst', role: 'dialog', 'aria-modal': 'true', 'aria-label': it.label });
  const close = () => {
    back.classList.add('closing');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => back.remove(), 380);
    if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  back.append(h('article', { class: 'ow-modal' },
    h('button', { class: 'ow-close', type: 'button', 'aria-label': 'Kapat', onclick: close }, '✕'),
    h('span', { class: 'ow-modal-icon', 'aria-hidden': 'true' }, it.icon || '💌'),
    h('h3', { class: 'ow-modal-title script' }, it.label || ''),
    body,
    h('p', { class: 'ow-modal-sign script' }, `— ${state.content.names?.me || ''}`)));
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  requestAnimationFrame(() => {
    back.classList.add('open');
    requestAnimationFrame(() => body.classList.add('is-in'));
    $$('.words', body).forEach((w) => w.classList.add('is-in'));
  });
  $('.ow-close', back).focus({ preventScroll: true });
  const r = btn ? btn.getBoundingClientRect() : null;
  if (r) fx().burst(r.left + r.width / 2, r.top + r.height / 3, 12, { power: 0.9 });
  if (first) sendEvent('mektup', { title: `“${it.label}” mektubunu açtı` }, { once: `mektup:${it.label}` });
}

/* ------------------------------------------------------------------ */
/* Aşk kuponları                                                       */
/* ------------------------------------------------------------------ */
const couponKey = (cp) => `ds:kupon:${cp.title}`;
export const couponUsed = (cp) => Boolean(store.get(couponKey(cp)));

export async function useCoupon(i, btn) {
  const cp = state.content.surprise.coupons[i];
  if (!cp) return;
  const wrap = btn.closest('.coupon-wrap');
  const used = couponUsed(cp);
  const me = state.content.names?.me || '';
  const ok = await dialog({
    icon: cp.icon || '💝',
    text: used
      ? `“${cp.title}” kuponunu bir kez daha kullanmak ister misin? 😄`
      : `“${cp.title}” kuponunu kullanmak istediğine emin misin? 😏`,
    yes: 'Evet, kullan!',
    no: 'Vazgeç',
  });
  if (!ok) return;
  store.set(couponKey(cp), new Date().toISOString());
  wrap.classList.add('used');
  const r = wrap.getBoundingClientRect();
  fx().burst(r.left + r.width - 60, r.top + r.height / 2, 18, { power: 1.1 });
  sendEvent('kupon', { title: `${cp.icon || ''} ${cp.title}`.trim(), text: cp.text || '' });

  const num = String(state.content.site?.whatsapp || '').replace(/\D/g, '');
  if (num) {
    const text = `💌 Aşk kuponumu kullanıyorum: ${cp.icon || ''} ${cp.title} — ${cp.text}`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }
  toast(`Kupon kullanıldı! ${me ? `${me} ` : ''}haberdar edildi 💌`, { ms: 4200 });
}

/* ------------------------------------------------------------------ */
/* Formlar: hayal önerisi, Deniz'e not                                 */
/* ------------------------------------------------------------------ */
export async function submitForm(form) {
  const kind = form.dataset.form;
  const field = form.elements.text;
  const btn = $('button[type="submit"]', form);
  const text = field ? field.value.trim() : '';
  if (!text) { field?.focus(); return; }
  btn.disabled = true;
  const res = await sendEvent(kind === 'dream' ? 'hayal' : 'not', { text });
  btn.disabled = false;
  if (!res.ok && !res.skipped) {
    toast(res.status === 429 ? 'Biraz yavaş 🙂 Birazdan tekrar dene.' : 'Gönderilemedi; internet bağlantını kontrol edip tekrar dener misin?', { error: true, ms: 5000 });
    return;
  }
  const r = btn.getBoundingClientRect();
  fx().burst(r.left + r.width / 2, r.top + r.height / 2, 20, { power: 1.2 });
  const thanks = kind === 'dream' ? state.content.dreams.suggestThanks : state.content.finale.replyThanks;
  if (kind === 'dream') {
    field.value = '';
    toast(res.skipped ? 'Önizleme: gerçekte bu hayal sana gelirdi 💭' : thanks, { ms: 4500 });
  } else {
    form.replaceWith(h('p', { class: 'reply-thanks script' }, res.skipped ? 'Önizleme: gerçekte bu not sana gelirdi 💌' : thanks));
  }
}

/* ------------------------------------------------------------------ */
/* Final: kaçan “Hayır” ve kutlama                                     */
/* ------------------------------------------------------------------ */
const LOVE_WORDS = [
  'Seni seviyorum', 'I love you', 'Je t’aime', 'Te amo', 'Ti amo', 'Ich liebe dich', 'Eu te amo',
  'Ik hou van jou', 'Te iubesc', 'Kocham cię', 'Szeretlek', 'Jag älskar dig', 'Mahal kita',
  'Səni sevirəm', 'Volim te', 'Rakastan sinua', 'Σ’ αγαπώ', 'Я тебя люблю', '愛してる', '사랑해',
];

export function resetNoButton() {
  const sec = $('#ch-finale');
  if (!sec) return;
  const btns = $('.finale-btns', sec);
  const no = $('.no-btn[data-action="no"]');
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

export function flee(btn) {
  const now = performance.now();
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
  fx().burst(r.left + r.width / 2, r.top + r.height / 2, 6, { power: 0.6, size: [7, 13] });
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
export function startLoveWords(sec) {
  stopLoveWords();
  if (reducedMotion || !sec) return;
  loveWordsEl = h('div', { class: 'love-words', 'aria-hidden': 'true' });
  const count = innerWidth < 600 ? 9 : 18;
  for (let i = 0; i < count; i++) {
    // yazılar daha çok kenarlarda dolaşsın, ortadaki metni kapatmasın
    const side = i % 2 === 0 ? rand(0, 26) : rand(58, 84);
    loveWordsEl.append(h('span', {
      style: {
        '--x': `${side.toFixed(1)}%`,
        '--fs': `${rand(1.4, 2.6).toFixed(2)}rem`,
        '--dur': `${rand(9, 16).toFixed(1)}s`,
        '--delay': `${(-rand(0, 14)).toFixed(1)}s`,
      },
    }, LOVE_WORDS[i % LOVE_WORDS.length]));
  }
  sec.append(loveWordsEl);
}

export function stopLoveWords() {
  if (loveWordsEl) { loveWordsEl.remove(); loveWordsEl = null; }
}

export function celebrate() {
  state.answered = true;
  const sec = $('#ch-finale');
  resetNoButton();
  $('.finale-ask', sec).classList.add('answered');
  const succ = $('.success', sec);
  succ.hidden = false;
  $$('.reveal, .ink', succ).forEach((el) => state.observe?.(el));
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  fx().confetti({ count: 180 });
  fx().fireworks({ count: 8, gap: 380 });
  startLoveWords(sec);
  if ('vibrate' in navigator) { try { navigator.vibrate([60, 40, 60]); } catch { /* yok say */ } }
  sendEvent('evet', { title: 'Sonsuza dek sorusuna “Evet” dedi! 💍' }, { once: 'evet' });
}

/* ------------------------------------------------------------------ */
/* Işık kutusu                                                         */
/* ------------------------------------------------------------------ */
const lb = { items: [], i: 0 };

function galleryItems(container) {
  return $$('.slot[data-zoom] img', container).map((im) => ({
    src: im.currentSrc || im.src,
    cap: im.closest('.slot').dataset.caption || '',
    alt: im.alt,
    el: im,
  }));
}

export function openLightbox(img) {
  const container = img.closest('[data-list]') || img.closest('.chapter');
  lb.items = galleryItems(container);
  lb.i = Math.max(0, lb.items.findIndex((it) => it.el === img));
  const box = $('#lightbox');
  box.hidden = false;
  document.body.classList.add('no-scroll');
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

export function stepLightbox(d) {
  if (lb.items.length < 2) return;
  lb.i = (lb.i + d + lb.items.length) % lb.items.length;
  showLightbox();
}

export function closeLightbox() {
  const box = $('#lightbox');
  if (box.hidden) return false;
  box.hidden = true;
  document.body.classList.remove('no-scroll');
  return true;
}

/* ------------------------------------------------------------------ */
/* Slayt gösterisi                                                     */
/* ------------------------------------------------------------------ */
const ss = { items: [], i: 0, timer: 0, playing: true, started: 0 };
const SLIDE_MS = 5200;

export function openSlideshow() {
  const items = (state.content.gallery.items || []).filter((it) => it.photo);
  if (!items.length) return;
  ss.items = items.map((it) => ({ src: mediaUrl(it.photo), cap: it.caption || '' }));
  ss.i = 0;
  ss.playing = true;
  const box = $('#slideshow');
  box.hidden = false;
  document.body.classList.add('no-scroll');
  $('.ss-stage', box).textContent = '';
  showSlide(true);
  $('.ss-close', box).focus({ preventScroll: true });
  state.playMusic?.();
  // bir sonraki fotoğrafı önceden yükle
  items.slice(1, 3).forEach((it) => { const im = new Image(); im.src = mediaUrl(it.photo); });
}

function showSlide(first = false) {
  const box = $('#slideshow');
  const stage = $('.ss-stage', box);
  const it = ss.items[ss.i];
  const img = h('img', {
    class: 'ss-img', src: it.src, alt: it.cap || 'Fotoğrafımız', draggable: 'false',
    style: { '--kx': `${rand(-4, 4).toFixed(1)}%`, '--ky': `${rand(-3, 3).toFixed(1)}%`, '--ks': (1.08 + Math.random() * 0.08).toFixed(3) },
  });
  // Fotoğrafın bulanık kopyası boşlukları doldursun
  const slide = h('div', { class: 'ss-slide' }, h('img', { class: 'ss-bg', src: it.src, alt: '', 'aria-hidden': 'true', draggable: 'false' }), img);
  const old = $$('.ss-slide', stage);
  stage.append(slide);
  const show = () => {
    slide.classList.add('on');
    old.forEach((o) => { o.classList.remove('on'); setTimeout(() => o.remove(), 1400); });
  };
  if (img.complete) requestAnimationFrame(show); else img.addEventListener('load', show, { once: true });
  img.addEventListener('error', show, { once: true });
  const cap = $('.ss-cap', box);
  cap.classList.remove('on');
  setTimeout(() => { cap.textContent = it.cap; cap.classList.add('on'); }, first ? 200 : 500);
  const pre = ss.items[(ss.i + 1) % ss.items.length];
  if (pre) { const im = new Image(); im.src = pre.src; }
  scheduleSlide();
}

function scheduleSlide() {
  clearTimeout(ss.timer);
  const bar = $('#slideshow .ss-bar i');
  bar.style.transition = 'none';
  bar.style.width = '0%';
  void bar.offsetWidth;
  if (!ss.playing || ss.items.length < 2) return;
  bar.style.transition = `width ${SLIDE_MS}ms linear`;
  bar.style.width = '100%';
  ss.timer = setTimeout(() => stepSlideshow(1), SLIDE_MS);
}

export function stepSlideshow(d) {
  if (!ss.items.length) return;
  ss.i = (ss.i + d + ss.items.length) % ss.items.length;
  showSlide();
}

export function toggleSlideshow() {
  ss.playing = !ss.playing;
  const btn = $('#slideshow .ss-play');
  btn.textContent = ss.playing ? '❚❚' : '▶';
  btn.setAttribute('aria-label', ss.playing ? 'Duraklat' : 'Oynat');
  scheduleSlide();
}

export function closeSlideshow() {
  const box = $('#slideshow');
  if (box.hidden) return false;
  clearTimeout(ss.timer);
  box.hidden = true;
  document.body.classList.remove('no-scroll');
  return true;
}
