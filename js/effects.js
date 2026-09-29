// Kalp, gül yaprağı, konfeti efektleri (canvas)

export const HEART_PATH = 'M50 96C50 96 2 66 2 34C2 15 15 3 30 3C40 3 47 9 50 17C53 9 60 3 70 3C85 3 98 15 98 34C98 66 50 96 50 96Z';

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const HEART_COLORS = [
  ['#ffa3bb', '#f43f75'],
  ['#ffc6d4', '#ff7aa2'],
  ['#ff7196', '#d0104a'],
  ['#ffd6e0', '#ffa1b9'],
  ['#fbb6d6', '#db2777'],
  ['#ffd0d6', '#fb7185'],
];
const PETAL_COLORS = [
  ['#fff3f6', '#ffadc2'],
  ['#ffe6ec', '#ff8fab'],
  ['#fff7f9', '#f7bccb'],
  ['#ffeef2', '#f9a3b8'],
];
const CONFETTI_COLORS = ['#e11d5c', '#ff8fab', '#ffd1dc', '#f7c26b', '#ffffff', '#f43f75', '#fda4af'];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function makeHeart([c1, c2], size = 64) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
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
  return cv;
}

function makePetal([c1, c2], size = 56) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
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
  return cv;
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
/* Arka plan: yükselen kalpler + süzülen gül yaprakları                */
/* ------------------------------------------------------------------ */
export function startBackground(canvas) {
  const st = setupCanvas(canvas, 1.5);
  const hearts = HEART_COLORS.map((c) => makeHeart(c));
  const petals = PETAL_COLORS.map((c) => makePetal(c));
  const ps = [];
  let running = true;
  let last = performance.now();
  let t = 0;

  const targets = () => {
    const area = st.W * st.H;
    const k = reducedMotion ? 0.35 : 1;
    return {
      heart: Math.round(clamp(area / 46000, 7, 20) * k),
      petal: Math.round(clamp(area / 58000, 5, 16) * k),
    };
  };

  const spawn = (kind, init) => {
    if (kind === 'heart') {
      const x = rand(0, st.W);
      return {
        kind, img: pick(hearts), x0: x, x, y: init ? rand(0, st.H) : st.H + 30,
        s: rand(10, 28), vy: -rand(16, 36), sway: rand(8, 28), f: rand(0.4, 1.1),
        ph: rand(0, 6.28), rot: rand(-0.35, 0.35), a: 0, base: 0, amax: rand(0.3, 0.7),
      };
    }
    return {
      kind, img: pick(petals), x: rand(-40, st.W), y: init ? rand(0, st.H) : -30,
      s: rand(13, 26), vy: rand(24, 50), vx: rand(6, 26), sway: rand(12, 34), f: rand(0.5, 1.2),
      ph: rand(0, 6.28), rot: rand(0, 6.28), vr: rand(-1.3, 1.3), flip: rand(1, 2.6),
      a: 0, amax: rand(0.55, 0.9),
    };
  };

  const fill = (init) => {
    const tg = targets();
    let nh = 0;
    let np = 0;
    for (const p of ps) p.kind === 'heart' ? nh++ : np++;
    for (; nh < tg.heart; nh++) ps.push(spawn('heart', init));
    for (; np < tg.petal; np++) ps.push(spawn('petal', init));
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
      if (p.kind === 'heart') {
        p.y += p.vy * dt;
        p.x = p.x0 + Math.sin(t * p.f + p.ph) * p.sway;
        const fadeTop = clamp(p.y / (H * 0.18), 0, 1);
        p.base = Math.min(p.amax, p.base + dt * 0.5);
        p.a = p.base * fadeTop;
        if (p.y < -40) { ps.splice(i, 1); continue; }
      } else {
        p.y += p.vy * dt;
        p.x += (p.vx + Math.cos(t * p.f + p.ph) * p.sway) * dt;
        p.rot += p.vr * dt;
        sx = Math.cos(t * p.flip + p.ph);
        p.a = Math.min(p.amax, p.a + dt * 0.6);
        if (p.y > H + 40 || p.x > W + 60) { ps.splice(i, 1); continue; }
      }
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      ctx.globalAlpha = p.a;
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

  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
  requestAnimationFrame(frame);
  return { pause, resume };
}

/* ------------------------------------------------------------------ */
/* Ön plan efektleri: dokunma patlaması, konfeti, imleç izi             */
/* ------------------------------------------------------------------ */
export function createFX(canvas) {
  const st = setupCanvas(canvas, 2);
  const hearts = HEART_COLORS.map((c) => makeHeart(c, 48));
  const ps = [];
  let running = false;
  let last = 0;

  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const { ctx, W, H, dpr } = st;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W * dpr, H * dpr);
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life || p.y > H + 60) { ps.splice(i, 1); continue; }
      p.vx *= 1 - p.drag * dt;
      p.vy = p.vy * (1 - p.drag * dt) + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const k = p.age / p.life;
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const scale = p.grow ? Math.min(1, p.age * 6) : 1;
      const wob = p.wobble ? Math.cos(p.age * p.wobble) : 1;
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      ctx.globalAlpha = alpha * p.alpha;
      ctx.setTransform(dpr * c * scale * wob, dpr * s * scale * wob, -dpr * s * scale, dpr * c * scale, dpr * p.x, dpr * p.y);
      if (p.img) {
        ctx.drawImage(p.img, -p.s / 2, -p.s / 2, p.s, p.s);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      }
    }
    ctx.globalAlpha = 1;
    if (ps.length) requestAnimationFrame(loop);
    else { running = false; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W * dpr, H * dpr); }
  };

  const kick = () => {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  };

  const base = (o) => Object.assign({ age: 0, drag: 1.2, g: 420, vr: 0, rot: 0, alpha: 1, grow: true, wobble: 0 }, o);

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
    if (ps.length > 700) ps.splice(0, ps.length - 700);
    kick();
  }

  function confetti({ count = 150, from = 'top' } = {}) {
    const { W, H } = st;
    if (reducedMotion) count = Math.round(count / 5);
    for (let i = 0; i < count; i++) {
      const isHeart = Math.random() < 0.45;
      const fromTop = from === 'top';
      ps.push(base({
        img: isHeart ? pick(hearts) : null,
        color: pick(CONFETTI_COLORS),
        x: fromTop ? rand(0, W) : W / 2 + rand(-40, 40),
        y: fromTop ? rand(-H * 0.4, -10) : H * 0.55,
        s: isHeart ? rand(12, 24) : rand(8, 14),
        vx: fromTop ? rand(-60, 60) : rand(-420, 420),
        vy: fromTop ? rand(60, 200) : rand(-780, -380),
        g: fromTop ? 140 : 520,
        drag: fromTop ? 0.4 : 0.9,
        rot: rand(0, 6.28),
        vr: rand(-6, 6),
        wobble: isHeart ? 0 : rand(4, 10),
        life: rand(3, 5.2),
        grow: false,
      }));
    }
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

  return { burst, confetti, trail };
}

/* ------------------------------------------------------------------ */
/* Yazı efektleri                                                      */
/* ------------------------------------------------------------------ */

// Başlığı harflere böler (harf harf açılan animasyon için)
export function splitLetters(el) {
  const text = el.textContent;
  el.textContent = '';
  el.setAttribute('aria-label', text);
  let i = 0;
  // Kelimeleri bölünmez kutulara koy ki uzun isimler satır atlayabilsin
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
export function splitWords(el, text) {
  el.textContent = '';
  el.classList.add('words');
  const parts = text.split(/(\s+)/);
  let i = 0;
  for (const part of parts) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { el.append(' '); continue; }
    const span = document.createElement('span');
    span.className = 'w';
    span.style.setProperty('--i', Math.min(i++, 140));
    span.textContent = part;
    el.append(span);
  }
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
