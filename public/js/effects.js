// Kalpler, gül yaprakları, altın ışıltılar, konfeti ve kalpli havai fişekler (canvas)
import { HEART_PATH, rand, clamp, reducedMotion } from './core.js';

const pick = (arr) => arr[(Math.random() * arr.length) | 0];

const HEART_COLORS = [
  ['#ffa3bb', '#f43f75'], ['#ffc6d4', '#ff7aa2'], ['#ff7196', '#d0104a'],
  ['#ffd6e0', '#ffa1b9'], ['#fbb6d6', '#db2777'], ['#ffd0d6', '#fb7185'],
];
const PETAL_COLORS = [['#fff3f6', '#ffadc2'], ['#ffe6ec', '#ff8fab'], ['#fff7f9', '#f7bccb'], ['#ffeef2', '#f9a3b8']];
const DARK_PETALS = [['#ff9ab5', '#c2185b'], ['#ffb3c6', '#e0245e'], ['#f7a1b9', '#a3123f']];
const CONFETTI = ['#e0245e', '#ff8fab', '#ffd1dc', '#f3c97a', '#ffffff', '#f43f75', '#fda4af'];
const FIREWORK = ['#ff4d8d', '#ff8fab', '#ffd1dc', '#f7c56b', '#ffffff', '#ff6b6b', '#e879f9'];

function sprite(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  return cv;
}

function makeHeart([c1, c2], size = 64) {
  return sprite(size, (g) => {
    g.scale(size / 100, size / 100);
    const grad = g.createLinearGradient(10, 0, 90, 100);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    g.fillStyle = grad;
    g.fill(new Path2D(HEART_PATH));
    g.globalAlpha = 0.45;
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(28, 26, 11, 6.5, -0.7, 0, Math.PI * 2);
    g.fill();
  });
}

function makePetal([c1, c2], size = 56) {
  return sprite(size, (g) => {
    const s = size / 2;
    g.translate(s, s);
    g.beginPath();
    g.moveTo(0, s * 0.86);
    g.bezierCurveTo(s * 0.72, s * 0.5, s * 0.78, -s * 0.52, s * 0.2, -s * 0.8);
    g.quadraticCurveTo(0, -s * 0.6, -s * 0.2, -s * 0.8);
    g.bezierCurveTo(-s * 0.78, -s * 0.52, -s * 0.72, s * 0.5, 0, s * 0.86);
    const grad = g.createRadialGradient(0, s * 0.45, s * 0.05, 0, 0, s * 0.95);
    grad.addColorStop(0, c2);
    grad.addColorStop(1, c1);
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(225,29,92,.12)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, s * 0.8);
    g.quadraticCurveTo(s * 0.06, 0, 0, -s * 0.55);
    g.stroke();
  });
}

function makeGlow(color, size = 64) {
  return sprite(size, (g) => {
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, color);
    grad.addColorStop(0.28, color);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  });
}

function makeBokeh(color, size = 96) {
  return sprite(size, (g) => {
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, r * 0.1, r, r, r);
    grad.addColorStop(0, color);
    grad.addColorStop(0.6, color.replace(/[\d.]+\)$/, '0.35)'));
    grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.fill();
  });
}

function setupCanvas(canvas, maxDpr) {
  const ctx = canvas.getContext('2d');
  const st = { ctx, W: 0, H: 0, dpr: 1 };
  const resize = () => {
    st.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    st.W = window.innerWidth;
    st.H = window.innerHeight;
    canvas.width = Math.round(st.W * st.dpr);
    canvas.height = Math.round(st.H * st.dpr);
  };
  resize();
  window.addEventListener('resize', resize);
  return st;
}

/* ------------------------------------------------------------------ */
/* Arka plan: sahneye göre kalpler, yapraklar, altın ışıltılar         */
/* ------------------------------------------------------------------ */
const MODES = {
  intro: { heart: 0, petal: [5, 12], bokeh: [14, 30], petals: 'dark' },
  day: { heart: [7, 18], petal: [5, 14], bokeh: 0, petals: 'light' },
  night: { heart: [3, 7], petal: 0, bokeh: [10, 18], petals: 'dark' },
};

export function startBackground(canvas) {
  const st = setupCanvas(canvas, 1.5);
  const hearts = HEART_COLORS.map((c) => makeHeart(c));
  const petals = { light: PETAL_COLORS.map((c) => makePetal(c)), dark: DARK_PETALS.map((c) => makePetal(c)) };
  const bokehs = {
    intro: ['rgba(255,214,150,.55)', 'rgba(255,190,120,.45)', 'rgba(255,170,190,.4)', 'rgba(255,236,200,.5)'].map((c) => makeBokeh(c)),
    night: ['rgba(255,170,200,.45)', 'rgba(255,214,150,.4)', 'rgba(220,180,255,.35)'].map((c) => makeBokeh(c)),
  };
  const ps = [];
  let mode = 'intro';
  let running = true;
  let last = performance.now();
  let t = 0;

  const count = (spec, area) => {
    if (!spec) return 0;
    const [lo, hi] = spec;
    const k = reducedMotion ? 0.35 : 1;
    return Math.round(clamp(area / 52000, lo, hi) * k);
  };

  const spawn = (kind, init) => {
    const { W, H } = st;
    if (kind === 'heart') {
      const x = rand(0, W);
      return {
        kind, img: pick(hearts), x0: x, x, y: init ? rand(0, H) : H + 30,
        s: rand(10, 28), vy: -rand(16, 36), sway: rand(8, 28), f: rand(0.4, 1.1),
        ph: rand(0, 6.28), rot: rand(-0.35, 0.35), a: 0, amax: rand(0.3, 0.68) * (mode === 'night' ? 0.55 : 1),
      };
    }
    if (kind === 'petal') {
      const set = petals[MODES[mode].petals] || petals.light;
      return {
        kind, img: pick(set), x: rand(-40, W), y: init ? rand(0, H) : -30,
        s: rand(13, 26), vy: rand(24, 50), vx: rand(6, 26), sway: rand(12, 34), f: rand(0.5, 1.2),
        ph: rand(0, 6.28), rot: rand(0, 6.28), vr: rand(-1.3, 1.3), flip: rand(1, 2.6),
        a: 0, amax: rand(0.5, 0.85),
      };
    }
    const set = bokehs[mode === 'night' ? 'night' : 'intro'];
    return {
      kind, img: pick(set), x: rand(0, W), y: rand(0, H),
      s: rand(8, 46), vx: rand(-6, 6), vy: rand(-10, -2), f: rand(0.3, 0.9), ph: rand(0, 6.28),
      a: 0, amax: rand(0.25, 0.8), life: rand(8, 18), age: init ? rand(0, 8) : 0,
    };
  };

  const fill = (init) => {
    const area = st.W * st.H;
    const spec = MODES[mode];
    const want = { heart: count(spec.heart, area), petal: count(spec.petal, area), bokeh: count(spec.bokeh, area) };
    const have = { heart: 0, petal: 0, bokeh: 0 };
    for (const p of ps) if (!p.dying) have[p.kind]++;
    for (const kind of ['heart', 'petal', 'bokeh']) {
      for (let i = have[kind]; i < want[kind]; i++) ps.push(spawn(kind, init));
    }
  };
  fill(true);

  const frame = (now) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const { ctx, W, H, dpr } = st;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W * dpr, H * dpr);

    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      let sx = 1;
      let rot = 0;
      if (p.kind === 'heart') {
        p.y += p.vy * dt;
        p.x = p.x0 + Math.sin(t * p.f + p.ph) * p.sway;
        rot = p.rot;
        const fadeTop = clamp(p.y / (H * 0.18), 0, 1);
        p.a = Math.min(p.amax, p.a + dt * 0.5);
        p.alpha = p.a * fadeTop;
        if (p.y < -40) { ps.splice(i, 1); continue; }
      } else if (p.kind === 'petal') {
        p.y += p.vy * dt;
        p.x += (p.vx + Math.cos(t * p.f + p.ph) * p.sway) * dt;
        p.rot += p.vr * dt;
        rot = p.rot;
        sx = Math.cos(t * p.flip + p.ph);
        p.a = Math.min(p.amax, p.a + dt * 0.6);
        p.alpha = p.a;
        if (p.y > H + 40 || p.x > W + 60) { ps.splice(i, 1); continue; }
      } else {
        p.age += dt;
        p.x += (p.vx + Math.sin(t * p.f + p.ph) * 4) * dt;
        p.y += p.vy * dt;
        const k = p.age / p.life;
        p.alpha = p.amax * Math.sin(Math.PI * clamp(k, 0, 1)) * (0.75 + 0.25 * Math.sin(t * 2 + p.ph));
        if (k >= 1 || p.y < -60) { ps.splice(i, 1); continue; }
      }
      if (p.dying) {
        p.fade = (p.fade ?? 1) - dt * 0.9;
        if (p.fade <= 0) { ps.splice(i, 1); continue; }
        p.alpha *= p.fade;
      }
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      ctx.globalAlpha = p.alpha;
      ctx.setTransform(dpr * c * sx, dpr * s * sx, -dpr * s, dpr * c, dpr * p.x, dpr * p.y);
      ctx.drawImage(p.img, -p.s / 2, -p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    fill(false);
    requestAnimationFrame(frame);
  };

  const resume = () => {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  };
  const pause = () => { running = false; };

  const setMode = (m) => {
    if (!MODES[m] || m === mode) return;
    mode = m;
    const spec = MODES[m];
    for (const p of ps) {
      const wanted = spec[p.kind];
      if (!wanted || (p.kind === 'petal' && !petals[spec.petals].includes(p.img))) p.dying = true;
      if (p.kind === 'bokeh' && !bokehs[m === 'night' ? 'night' : 'intro'].includes(p.img)) p.dying = true;
    }
    fill(false);
  };

  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
  requestAnimationFrame(frame);
  return { pause, resume, setMode };
}

/* ------------------------------------------------------------------ */
/* Ön plan: dokunma kalpleri, konfeti, imleç izi, havai fişek          */
/* ------------------------------------------------------------------ */
// Kalp eğrisi (x = 16 sin³t, y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t)
function heartPoint(t) {
  const x = 16 * Math.sin(t) ** 3;
  const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
  return { x: x / 17, y: y / 17 };
}

export function createFX(canvas) {
  const st = setupCanvas(canvas, 2);
  const hearts = HEART_COLORS.map((c) => makeHeart(c, 48));
  const glows = Object.fromEntries(FIREWORK.map((c) => [c, makeGlow(c, 32)]));
  const ps = [];
  const rockets = [];
  let running = false;
  let last = 0;

  const drawParticle = (ctx, p, dpr) => {
    const k = p.age / p.life;
    const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const scale = p.grow ? Math.min(1, p.age * 6) : 1;
    const wob = p.wobble ? Math.cos(p.age * p.wobble) : 1;
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    ctx.globalAlpha = alpha * p.alpha * (p.twinkle ? 0.55 + 0.45 * Math.sin(p.age * p.twinkle) : 1);
    ctx.setTransform(dpr * c * scale * wob, dpr * s * scale * wob, -dpr * s * scale, dpr * c * scale, dpr * p.x, dpr * p.y);
    if (p.img) ctx.drawImage(p.img, -p.s / 2, -p.s / 2, p.s, p.s);
    else {
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    }
  };

  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const { ctx, W, H, dpr } = st;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W * dpr, H * dpr);

    // Roketler
    ctx.globalCompositeOperation = 'lighter';
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.vy += 260 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.trail.push({ x: r.x, y: r.y });
      if (r.trail.length > 10) r.trail.shift();
      r.trail.forEach((pt, n) => {
        ctx.globalAlpha = (n / r.trail.length) * 0.8;
        ctx.setTransform(dpr, 0, 0, dpr, dpr * pt.x, dpr * pt.y);
        const sz = 4 + n * 0.6;
        ctx.drawImage(glows[r.color], -sz, -sz, sz * 2, sz * 2);
      });
      if (r.vy >= -40 || r.y <= r.ty) {
        rockets.splice(i, 1);
        explode(r.x, r.y, r.color, r.size);
      }
    }

    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life || p.y > H + 60) { ps.splice(i, 1); continue; }
      p.vx *= 1 - p.drag * dt;
      p.vy = p.vy * (1 - p.drag * dt) + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ctx.globalCompositeOperation = p.glow ? 'lighter' : 'source-over';
      drawParticle(ctx, p, dpr);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (ps.length || rockets.length) requestAnimationFrame(loop);
    else {
      running = false;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W * dpr, H * dpr);
    }
  };

  const kick = () => {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  };

  const base = (o) => Object.assign({ age: 0, drag: 1.2, g: 420, vr: 0, rot: 0, alpha: 1, grow: true, wobble: 0 }, o);
  const cap = () => { if (ps.length > 900) ps.splice(0, ps.length - 900); };

  function burst(x, y, n = 9, { power = 1, size = [9, 20], life = [0.7, 1.25] } = {}) {
    if (reducedMotion) n = Math.min(n, 3);
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(120, 300) * power;
      ps.push(base({
        img: pick(hearts), x, y, s: rand(size[0], size[1]),
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 90 * power,
        rot: rand(-0.5, 0.5), vr: rand(-2, 2), life: rand(life[0], life[1]),
      }));
    }
    cap();
    kick();
  }

  function confetti({ count = 150 } = {}) {
    const { W, H } = st;
    if (reducedMotion) count = Math.round(count / 5);
    for (let i = 0; i < count; i++) {
      const isHeart = Math.random() < 0.45;
      ps.push(base({
        img: isHeart ? pick(hearts) : null,
        color: pick(CONFETTI),
        x: rand(0, W), y: rand(-H * 0.4, -10),
        s: isHeart ? rand(12, 24) : rand(8, 14),
        vx: rand(-60, 60), vy: rand(60, 200), g: 140, drag: 0.4,
        rot: rand(0, 6.28), vr: rand(-6, 6), wobble: isHeart ? 0 : rand(4, 10),
        life: rand(3, 5.2), grow: false,
      }));
    }
    cap();
    kick();
  }

  let lastTrail = 0;
  function trail(x, y) {
    const now = performance.now();
    if (now - lastTrail < 55 || reducedMotion) return;
    lastTrail = now;
    ps.push(base({
      img: pick(hearts), x: x + rand(-4, 4), y: y + rand(-4, 4), s: rand(7, 13),
      vx: rand(-20, 20), vy: rand(-60, -25), g: -10, drag: 1, life: rand(0.6, 0.95), alpha: 0.85,
    }));
    kick();
  }

  function explode(x, y, color, size = 1) {
    const n = reducedMotion ? 24 : 70;
    const speed = rand(170, 230) * size;
    for (let i = 0; i < n; i++) {
      const pt = heartPoint((i / n) * Math.PI * 2);
      const jitter = rand(0.92, 1.08);
      ps.push(base({
        img: glows[Math.random() < 0.8 ? color : '#ffffff'], glow: true,
        x, y, s: rand(6, 11), vx: pt.x * speed * jitter, vy: pt.y * speed * jitter,
        g: 90, drag: 1.5, life: rand(1.3, 2), grow: false, twinkle: rand(10, 22),
      }));
    }
    for (let i = 0; i < (reducedMotion ? 4 : 16); i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(40, 150) * size;
      ps.push(base({
        img: glows['#ffffff'], glow: true, x, y, s: rand(3, 6),
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 120, drag: 1.2, life: rand(0.8, 1.6), grow: false, twinkle: rand(14, 30),
      }));
    }
    cap();
  }

  function fireworks({ count = 7, gap = 420 } = {}) {
    const { W, H } = st;
    const n = reducedMotion ? 2 : count;
    for (let k = 0; k < n; k++) {
      setTimeout(() => {
        const x = rand(W * 0.15, W * 0.85);
        rockets.push({
          x, y: H + 10, vx: rand(-40, 40), vy: -rand(620, 820) * Math.min(1.2, H / 800 + 0.35),
          ty: rand(H * 0.16, H * 0.42), color: pick(FIREWORK), size: rand(0.8, 1.25) * Math.min(1.2, W / 700 + 0.4), trail: [],
        });
        kick();
      }, k * gap + rand(0, 160));
    }
  }

  return { burst, confetti, trail, fireworks, explode: (x, y) => { explode(x, y, pick(FIREWORK)); kick(); } };
}

/* ------------------------------------------------------------------ */
/* Yazı efektleri                                                      */
/* ------------------------------------------------------------------ */

// Başlığı harflere böler (harf harf açılan başlık için)
export function splitLetters(el) {
  const text = el.textContent;
  el.textContent = '';
  el.setAttribute('aria-label', text);
  let i = 0;
  text.split(/(\s+)/).forEach((part) => {
    if (!part) return;
    if (/^\s+$/.test(part)) { el.append(' '); return; }
    const word = document.createElement('span');
    word.className = 'wd';
    word.setAttribute('aria-hidden', 'true');
    for (const ch of Array.from(part)) {
      const span = document.createElement('span');
      span.className = 'ch';
      span.textContent = ch;
      span.style.setProperty('--i', i++);
      word.append(span);
    }
    el.append(word);
    i++;
  });
}

// Paragrafı kelimelere böler (mürekkep gibi beliren mektup için)
export function splitWords(el, text, startIndex = 0) {
  el.textContent = '';
  el.classList.add('words');
  let i = startIndex;
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { el.append(' '); continue; }
    const span = document.createElement('span');
    span.className = 'w';
    span.style.setProperty('--i', Math.min(i++, 260));
    span.textContent = part;
    el.append(span);
  }
  return i;
}

// "Sen benim ___" daktilo efekti
export function typewriter(el, words) {
  const list = words.filter((w) => w && w.trim());
  if (!list.length) return () => {};
  if (reducedMotion) {
    el.textContent = list[0];
    return () => {};
  }
  let wi = 0;
  let ci = 0;
  let deleting = false;
  let timer = 0;
  const tick = () => {
    const w = Array.from(list[wi % list.length]);
    if (!deleting) {
      ci++;
      el.textContent = w.slice(0, ci).join('');
      if (ci >= w.length) { deleting = true; timer = setTimeout(tick, 1900); return; }
      timer = setTimeout(tick, 75 + Math.random() * 70);
    } else {
      ci--;
      el.textContent = w.slice(0, ci).join('');
      if (ci <= 0) { deleting = false; wi++; timer = setTimeout(tick, 380); return; }
      timer = setTimeout(tick, 38);
    }
  };
  timer = setTimeout(tick, 900);
  return () => clearTimeout(timer);
}
