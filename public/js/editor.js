// Düzenleme modu (/duzenle): şifreyle giriş, yazılara dokunarak düzenleme,
// fotoğraf/şarkı yükleme, ayarlar ve Sena'dan gelenler.
import {
  $, $$, h, state, toast, dialog, relTime, getPath, setPath, CHAPTERS, chapterNumber, store, waxSeal, sleep,
} from './core.js';

let app;
const S = {
  etag: null,
  baseline: '',
  saving: false,
  queued: false,
  preview: false,
  timer: 0,
  pending: new Set(),
  local: false,
  inbox: { items: [], unread: 0, readAt: null },
  busyUploads: 0,
};

const MAX_PHOTO_PX = 2000;
const PHOTO_QUALITY = 0.86;
const MAX_MUSIC_MB = 30;
const AUTOSAVE_MS = 5000;

const LISTS = {
  'home.rotating': { add: '+ Kelime', make: () => 'yeni kelime', compact: true },
  'home.daily': { add: '+ Günlük not ekle', make: () => 'Yeni bir günlük not…' },
  'story.items': { add: '+ Yeni anı ekle', make: () => ({ date: 'Tarih', title: 'Yeni anımız', text: 'Bu anıyı buraya yaz…', photo: '' }) },
  'gallery.items': { add: '📷 Fotoğraf ekle (birden fazla seçebilirsin)', photos: true },
  'letter.openWhen': { add: '+ Yeni mektup ekle', make: () => ({ icon: '💌', label: '… olduğunda aç', text: 'Mektubunu buraya yaz…' }) },
  'reasons.items': { add: '+ Yeni sebep ekle', make: () => 'Seni seviyorum çünkü…' },
  'quiz.questions': { add: '+ Yeni soru ekle', make: () => ({ q: 'Yeni soru?', options: ['Cevap 1', 'Cevap 2', 'Cevap 3', 'Cevap 4'], answer: 0, note: '' }) },
  'dreams.items': { add: '+ Yeni hayal ekle', make: () => ({ text: 'Yeni bir hayal…', done: false }) },
  'surprise.coupons': { add: '+ Yeni kupon ekle', make: () => ({ icon: '💝', title: 'Yeni Kupon', text: 'Kuponun açıklaması…' }) },
};

/* ------------------------------------------------------------------ */
/* Sunucu                                                              */
/* ------------------------------------------------------------------ */
async function api(path, { method = 'GET', body, keepalive = false } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
    keepalive,
  });
  let data = {};
  try { data = await res.json(); } catch { /* boş yanıt */ }
  if (!res.ok) {
    const err = new Error(data.error || `Sunucu hatası (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function explain(e) {
  const msg = String((e && e.message) || '');
  if (e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return 'İnternet bağlantısı yok gibi görünüyor. Bağlantını kontrol edip tekrar dene.';
  }
  return msg || 'Bilinmeyen bir hata oluştu.';
}

/* ------------------------------------------------------------------ */
/* Giriş ekranı                                                        */
/* ------------------------------------------------------------------ */
function loginScreen({ setup }) {
  return new Promise((resolve) => {
    const msg = h('p', { class: 'ed-login-msg', 'aria-live': 'polite' });
    const pw = h('input', {
      class: 'ed-input', type: 'password', name: 'password', required: true, minlength: '6',
      autocomplete: setup ? 'new-password' : 'current-password', placeholder: setup ? 'Yeni şifren (en az 6 karakter)' : 'Şifren',
      'aria-label': 'Şifre',
    });
    const pw2 = setup ? h('input', {
      class: 'ed-input', type: 'password', name: 'password2', required: true, autocomplete: 'new-password',
      placeholder: 'Şifreni tekrar yaz', 'aria-label': 'Şifre tekrar',
    }) : null;
    const show = h('label', { class: 'ed-check' },
      h('input', { type: 'checkbox', onchange: (e) => { const t = e.target.checked ? 'text' : 'password'; pw.type = t; if (pw2) pw2.type = t; } }),
      ' Şifreyi göster');
    const btn = h('button', { class: 'btn ed-login-btn', type: 'submit' }, setup ? 'Şifremi belirle ve başla ✨' : 'Giriş yap');
    const form = h('form', { class: 'ed-login-form' }, pw, pw2, show, btn);
    const screen = h('div', { class: 'ed-ui ed-login' },
      h('div', { class: 'ed-login-card' },
        waxSeal('ed-login-seal'),
        h('h1', { class: 'script' }, 'Düzenleme Modu'),
        h('p', { class: 'ed-login-lead' }, setup
          ? 'Hoş geldin! Önce kendine bir şifre belirle. Siteyi düzenlemek için her seferinde bunu gireceksin; o yüzden unutmayacağın ama Sena’nın tahmin edemeyeceği bir şey seç 😉'
          : 'Şifreni gir, siteyi düzenlemeye başla ✏️'),
        form,
        msg,
        h('a', { class: 'ed-link', href: '/' }, '← Siteye dön')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      if (setup && pw.value !== pw2.value) { msg.textContent = 'İki şifre aynı değil, tekrar dener misin?'; pw2.focus(); return; }
      btn.disabled = true;
      btn.textContent = '⏳ Bekle…';
      try {
        await api('/api/auth', { method: 'POST', body: { action: setup ? 'setup' : 'login', password: pw.value } });
        screen.classList.add('ok');
        await sleep(350);
        screen.remove();
        resolve(true);
      } catch (err) {
        if (err.data && err.data.needsSetup) { screen.remove(); resolve(loginScreen({ setup: true })); return; }
        if (err.status === 409 && setup) { screen.remove(); resolve(loginScreen({ setup: false })); return; }
        msg.textContent = explain(err);
        btn.disabled = false;
        btn.textContent = setup ? 'Şifremi belirle ve başla ✨' : 'Giriş yap';
        pw.select();
      }
    });
    document.body.classList.remove('is-loading');
    document.body.append(screen);
    setTimeout(() => pw.focus(), 100);
  });
}

/* ------------------------------------------------------------------ */
/* Kaydetme                                                            */
/* ------------------------------------------------------------------ */
const serialize = () => JSON.stringify(app.content);
const isDirty = () => serialize() !== S.baseline;

function setStatus(kind, text) {
  const bar = $('.ed-bar');
  if (!bar) return;
  const labels = {
    saved: 'Her şey kaydedildi',
    dirty: 'Kaydedilmemiş değişiklik var',
    saving: 'Kaydediliyor…',
    uploading: 'Yükleniyor…',
    error: 'Kaydedilemedi — dokun',
  };
  bar.dataset.state = kind;
  $('.ed-status-text', bar).textContent = text || labels[kind] || '';
}

function refreshStatus() {
  if (S.saving) return setStatus('saving');
  if (S.busyUploads) return setStatus('uploading');
  return setStatus(isDirty() ? 'dirty' : 'saved');
}

function markDirty() {
  refreshStatus();
  clearTimeout(S.timer);
  S.timer = setTimeout(() => { if (isDirty() && !S.busyUploads) save({ quiet: true }); }, AUTOSAVE_MS);
}

async function reauth() {
  toast('Oturumun kapanmış; tekrar giriş yapman gerekiyor.', { error: true, ms: 5000 });
  await loginScreen({ setup: false });
}

async function save({ quiet = false } = {}) {
  clearTimeout(S.timer);
  if (S.saving) { S.queued = true; return false; }
  if (!isDirty()) {
    refreshStatus();
    if (!quiet) toast('Her şey zaten kaydedildi ✓');
    return true;
  }
  S.saving = true;
  setStatus('saving');
  const text = serialize();
  let ok = false;
  try {
    const data = await api('/api/content', { method: 'PUT', body: { content: app.content, etag: S.etag } });
    S.etag = data.etag;
    S.baseline = text;
    ok = true;
    cleanupPending();
    if (!quiet) toast('Kaydedildi! Sena artık bu hâlini görüyor 💖', { ms: 3200 });
  } catch (e) {
    console.error(e);
    if (e.status === 401) {
      S.saving = false;
      await reauth();
      return save({ quiet });
    }
    if (e.status === 409) {
      const reload = await dialog({
        icon: '⚠️',
        text: 'Site başka bir sekmede ya da cihazda değiştirilmiş. En son hâli yükleyelim mi? (Buradaki kaydedilmemiş değişiklikler kaybolur.)',
        yes: 'Yenile',
        no: 'Vazgeç',
      });
      if (reload) { S.baseline = serialize(); location.reload(); }
    } else {
      toast(explain(e), { error: true, ms: 7000 });
    }
    S.lastError = explain(e);
  } finally {
    S.saving = false;
  }
  if (ok) refreshStatus(); else setStatus('error');
  if (S.queued) { S.queued = false; save({ quiet: true }); }
  return ok;
}

// Kaydedilmeden vazgeçilen yüklemeleri depodan sil
function mediaInContent() {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (v.startsWith('medya/')) out.add(v); } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(app.content);
  return out;
}

function cleanupPending() {
  const used = mediaInContent();
  for (const p of [...S.pending]) {
    if (used.has(p)) { S.pending.delete(p); continue; }
    S.pending.delete(p);
    api(`/api/upload?p=${encodeURIComponent(p)}`, { method: 'DELETE' }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Yazı düzenleme                                                      */
/* ------------------------------------------------------------------ */
function readText(el) {
  let v = (el.innerText || '').replace(/ /g, ' ').replace(/\r\n?/g, '\n');
  if (el.hasAttribute('data-multiline')) v = v.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  else v = v.replace(/\s*\n\s*/g, ' ').trim();
  return v;
}

function makeEditable(el) {
  if (el.dataset.edReady) return;
  el.dataset.edReady = '1';
  try { el.contentEditable = 'plaintext-only'; } catch { /* eski tarayıcı */ }
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.spellcheck = false;
  el.setAttribute('role', 'textbox');
  el.addEventListener('input', () => {
    const path = el.dataset.edit;
    setPath(app.content, path, readText(el));
    app.syncBinds(path);
    markDirty();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !el.hasAttribute('data-multiline')) { e.preventDefault(); el.blur(); }
  });
  el.addEventListener('paste', (e) => {
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, el.hasAttribute('data-multiline') ? text : text.replace(/\s*\n\s*/g, ' '));
  });
  el.addEventListener('blur', () => {
    const v = getPath(app.content, el.dataset.edit);
    if (typeof v === 'string' && el.innerText.trim() !== v) el.textContent = v;
  });
  // butonların içindeki yazılar düzenlenirken buton çalışmasın
  el.addEventListener('click', (e) => { e.stopPropagation(); });
}

/* ------------------------------------------------------------------ */
/* Dosya seçme, fotoğraf işleme, yükleme                               */
/* ------------------------------------------------------------------ */
function chooseFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, class: 'ed-hidden-input' });
    document.body.append(input);
    let done = false;
    const finish = (files) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files || [])));
    input.addEventListener('cancel', () => finish([]));
    input.click();
  });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* eski yöntem */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Fotoğraf hazırlanamadı'))), 'image/jpeg', PHOTO_QUALITY);
  });
}

async function shrink(file) {
  let src;
  try {
    src = await decodeImage(file);
  } catch {
    throw new Error(/heic|heif/i.test(file.type || file.name) ? 'Bu fotoğraf HEIC biçiminde; tarayıcı açamadı. Telefonundan JPG olarak paylaşıp tekrar dener misin?' : 'Bu dosya açılamadı. JPG ya da PNG bir fotoğraf dener misin?');
  }
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  const k = Math.min(1, MAX_PHOTO_PX / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const hgt = Math.max(1, Math.round(h0 * k));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = hgt;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, hgt);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, hgt);
  if (src.close) src.close();
  return { blob: await canvasToBlob(cv), w, h: hgt };
}

let blobClient = null;
async function uploadBlob(blob, name, onProgress) {
  if (S.local) {
    const res = await fetch(`/api/upload?p=${encodeURIComponent(`medya/${name}`)}`, { method: 'PUT', body: blob, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Yüklenemedi');
    onProgress?.(100);
    return data.pathname;
  }
  if (!blobClient) blobClient = await import('/vendor/blob-istemcisi.min.js');
  try {
    const result = await blobClient.upload(`medya/${name}`, blob, {
      access: 'private',
      handleUploadUrl: '/api/upload',
      contentType: blob.type || undefined,
      multipart: blob.size > 8 * 1024 * 1024,
      onUploadProgress: (ev) => onProgress?.(ev.percentage),
    });
    return result.pathname;
  } catch (e) {
    console.error(e);
    const auth = await api('/api/auth').catch(() => ({}));
    if (auth && auth.admin === false) {
      await reauth();
      return uploadBlob(blob, name, onProgress);
    }
    throw new Error('Dosya yüklenemedi. İnternet bağlantını kontrol edip tekrar dener misin?');
  }
}

function trackUpload(delta) {
  S.busyUploads = Math.max(0, S.busyUploads + delta);
  refreshStatus();
}

function slotProgress(slot) {
  if (!slot) return { set() {}, done() {} };
  const ring = h('div', { class: 'ed-ui ed-progress' }, h('span', {}, '0%'));
  slot.append(ring);
  return {
    set(p) { ring.style.setProperty('--p', p); $('span', ring).textContent = `%${Math.round(p)}`; },
    done() { ring.remove(); },
  };
}

async function uploadPhotoTo(path, blob, w, hgt, slot) {
  const prog = slotProgress(slot);
  trackUpload(1);
  try {
    const pathname = await uploadBlob(blob, `foto-${w}x${hgt}-${stamp()}.jpg`, (p) => prog.set(p));
    app.setLocalUrl(pathname, URL.createObjectURL(blob));
    S.pending.add(pathname);
    setPath(app.content, path, pathname);
    return pathname;
  } finally {
    prog.done();
    trackUpload(-1);
  }
}

async function pickPhoto(path, aspects, slot) {
  const [file] = await chooseFiles('image/*');
  if (!file) return false;
  let prepared;
  try {
    prepared = await cropDialog(file, aspects);
  } catch (e) {
    toast(explain(e), { error: true, ms: 6000 });
    return false;
  }
  if (!prepared) return false;
  try {
    await uploadPhotoTo(path, prepared.blob, prepared.w, prepared.h, slot);
    app.rerender();
    toast('Fotoğraf eklendi ❤');
    await save({ quiet: true });
    return true;
  } catch (e) {
    toast(explain(e), { error: true, ms: 7000 });
    return false;
  }
}

async function addGalleryPhotos() {
  const files = await chooseFiles('image/*', true);
  if (!files.length) return;
  const list = getPath(app.content, 'gallery.items') || [];
  const bar = h('div', { class: 'ed-ui ed-upload-toast' }, h('b', {}, 'Fotoğraflar yükleniyor…'), h('div', { class: 'ed-bar-track' }, h('i')), h('span', {}));
  document.body.append(bar);
  const setBar = (n, pct) => {
    $('i', bar).style.width = `${((n + pct / 100) / files.length) * 100}%`;
    $('span', bar).textContent = `${Math.min(n + 1, files.length)} / ${files.length}`;
  };
  let added = 0;
  trackUpload(1);
  for (let n = 0; n < files.length; n++) {
    setBar(n, 0);
    try {
      const { blob, w, h: hgt } = await shrink(files[n]);
      const pathname = await uploadBlob(blob, `foto-${w}x${hgt}-${stamp()}.jpg`, (p) => setBar(n, p));
      app.setLocalUrl(pathname, URL.createObjectURL(blob));
      S.pending.add(pathname);
      // Önce fotoğrafı olmayan (örnek yazılı) kutuları doldur, sonra sona ekle
      const empty = list.find((it) => it && !it.photo);
      if (empty) empty.photo = pathname;
      else list.push({ photo: pathname, caption: '' });
      added++;
    } catch (e) {
      toast(`${files[n].name}: ${explain(e)}`, { error: true, ms: 6000 });
    }
  }
  trackUpload(-1);
  setPath(app.content, 'gallery.items', list);
  bar.classList.add('done');
  setTimeout(() => bar.remove(), 600);
  if (!added) return;
  app.rerender();
  toast(`${added} fotoğraf eklendi 📸 Altlarına dokunup not yazabilirsin.`, { ms: 4500 });
  await save({ quiet: true });
}

async function removePhoto(path) {
  const ok = await dialog({ icon: '🗑️', text: 'Bu fotoğraf kaldırılsın mı?', yes: 'Evet, kaldır', no: 'Vazgeç' });
  if (!ok) return;
  setPath(app.content, path, '');
  app.rerender();
  markDirty();
}

let cropperLoading = null;
function loadCropper() {
  if (window.Cropper) return Promise.resolve();
  if (cropperLoading) return cropperLoading;
  cropperLoading = new Promise((resolve, reject) => {
    document.head.append(h('link', { rel: 'stylesheet', href: '/vendor/cropper.min.css' }));
    const s = h('script', { src: '/vendor/cropper.min.js' });
    s.onload = () => resolve();
    s.onerror = () => { cropperLoading = null; reject(new Error('Kırpma aracı yüklenemedi')); };
    document.head.append(s);
  });
  return cropperLoading;
}

const ASPECT_NAMES = { 1: 'Kare', '4/5': 'Dikey', '3/4': 'Dikey', '4/3': 'Yatay', '16/9': 'Geniş' };
function parseAspects(str) {
  return String(str || '1').split(',').map((a) => a.trim()).filter(Boolean).map((a) => {
    const [w, hh] = a.split('/').map(Number);
    return { key: a, value: hh ? w / hh : w, label: ASPECT_NAMES[a] || a };
  });
}

// Fotoğrafı kırpma penceresi → { blob, w, h } ya da null
async function cropDialog(file, aspectsStr) {
  await loadCropper();
  // Önce makul boyuta küçült (dev fotoğraflarda kırpma aracı rahat çalışsın)
  const base = await shrink(file);
  const aspects = parseAspects(aspectsStr);
  const url = URL.createObjectURL(base.blob);
  return new Promise((resolve) => {
    let cropper = null;
    let current = aspects[0];
    let finished = false;
    const img = h('img', { alt: 'Kırpılacak fotoğraf' });
    const area = h('div', { class: 'ed-crop-area' }, img);
    const aspectBtns = aspects.length > 1 ? h('div', { class: 'ed-crop-tools' },
      h('span', { class: 'ed-crop-label' }, 'Biçim:'),
      aspects.map((a) => h('button', {
        type: 'button',
        class: `ed-chipbtn${a === current ? ' on' : ''}`,
        onclick: (e) => {
          current = a;
          $$('.ed-chipbtn', e.currentTarget.parentElement).forEach((b) => b.classList.remove('on'));
          e.currentTarget.classList.add('on');
          if (cropper) cropper.setAspectRatio(a.value);
        },
      }, a.label))) : null;
    const tool = (label, title, fn) => h('button', { type: 'button', class: 'ed-chipbtn', title, 'aria-label': title, onclick: () => cropper && fn() }, label);
    const tools = h('div', { class: 'ed-crop-tools' },
      tool('↺', 'Sola döndür', () => cropper.rotate(-90)),
      tool('↻', 'Sağa döndür', () => cropper.rotate(90)),
      tool('＋', 'Yakınlaştır', () => cropper.zoom(0.1)),
      tool('－', 'Uzaklaştır', () => cropper.zoom(-0.1)),
      tool('⟲ Sıfırla', 'Sıfırla', () => cropper.reset()));
    const okBtn = h('button', { type: 'button', class: 'ed-b primary', disabled: true }, '✂️ Kırp ve ekle');
    const cancelBtn = h('button', { type: 'button', class: 'ed-b' }, 'Vazgeç');
    const m = modal({
      title: 'Fotoğrafı kırp',
      wide: true,
      body: [area, aspectBtns, tools, h('p', { class: 'ed-note' }, 'Çerçeveyi sürükleyip köşelerinden boyutlandır; fotoğrafı iki parmakla yakınlaştırabilirsin.')],
      actions: [cancelBtn, okBtn],
      onClose: () => finish(null),
    });
    function finish(result) {
      if (finished) return;
      finished = true;
      try { if (cropper) cropper.destroy(); } catch { /* yok say */ }
      URL.revokeObjectURL(url);
      m.close();
      resolve(result);
    }
    cancelBtn.addEventListener('click', () => finish(null));
    okBtn.addEventListener('click', async () => {
      if (!cropper) return;
      okBtn.disabled = true;
      okBtn.textContent = '⏳ Hazırlanıyor…';
      const canvas = cropper.getCroppedCanvas({
        maxWidth: MAX_PHOTO_PX, maxHeight: MAX_PHOTO_PX, fillColor: '#fff', imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
      });
      if (!canvas) { toast('Fotoğraf kırpılamadı, başka bir fotoğraf dene.', { error: true }); finish(null); return; }
      try {
        const blob = await canvasToBlob(canvas);
        finish({ blob, w: canvas.width, h: canvas.height });
      } catch {
        toast('Fotoğraf hazırlanamadı, başka bir fotoğraf dene.', { error: true });
        finish(null);
      }
    });
    img.addEventListener('load', () => {
      cropper = new window.Cropper(img, {
        viewMode: 1, dragMode: 'move', aspectRatio: current.value, autoCropArea: 0.92, background: false,
        responsive: true, restore: false, checkOrientation: false, toggleDragModeOnDblclick: false,
        ready() { okBtn.disabled = false; },
      });
    }, { once: true });
    img.src = url;
  });
}

async function pickMusic(onChange) {
  const [file] = await chooseFiles('audio/*,.mp3,.m4a,.aac,.ogg,.wav');
  if (!file) return;
  if (file.size > MAX_MUSIC_MB * 1024 * 1024) {
    toast(`Şarkı dosyası çok büyük (en fazla ${MAX_MUSIC_MB} MB olmalı).`, { error: true, ms: 6000 });
    return;
  }
  const m = file.name.match(/\.(mp3|m4a|aac|ogg|oga|wav)$/i);
  const ext = m ? m[1].toLowerCase() : 'mp3';
  const bar = h('div', { class: 'ed-ui ed-upload-toast' }, h('b', {}, '🎵 Şarkı yükleniyor…'), h('div', { class: 'ed-bar-track' }, h('i')), h('span', {}, '%0'));
  document.body.append(bar);
  trackUpload(1);
  try {
    const pathname = await uploadBlob(file, `sarki-${stamp()}.${ext}`, (p) => {
      $('i', bar).style.width = `${p}%`;
      $('span', bar).textContent = `%${Math.round(p)}`;
    });
    app.setLocalUrl(pathname, URL.createObjectURL(file));
    S.pending.add(pathname);
    const music = app.content.site.music || (app.content.site.music = { src: '', title: '', artist: '' });
    music.src = pathname;
    if (!music.title || music.title === 'Bizim Şarkımız') music.title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    app.rerender();
    onChange?.();
    toast('Şarkımız eklendi 🎵 Zarf açılınca çalacak.', { ms: 4000 });
    await save({ quiet: true });
  } catch (e) {
    toast(explain(e), { error: true, ms: 7000 });
  } finally {
    trackUpload(-1);
    bar.remove();
  }
}

function decoratePhoto(slot) {
  const path = slot.dataset.photo;
  const host = slot.closest('.heart-frame') ? slot.closest('.heart-wrap') : slot;
  if (!host || host.querySelector(':scope > .ed-photo-btns')) return;
  const has = Boolean(getPath(app.content, path));
  const aspects = slot.dataset.aspects;
  host.append(h('div', { class: 'ed-ui ed-photo-btns' },
    h('button', { type: 'button', class: 'ed-photo-btn', onclick: (e) => { e.stopPropagation(); pickPhoto(path, aspects, slot); } },
      has ? '📷 Değiştir' : '📷 Fotoğraf seç'),
    has ? h('button', { type: 'button', class: 'ed-photo-btn ed-photo-del', title: 'Fotoğrafı kaldır', onclick: (e) => { e.stopPropagation(); removePhoto(path); } }, 'Kaldır') : null));
  if (!has) {
    slot.addEventListener('click', (e) => {
      if (e.target.closest('.ed-photo-btns')) return;
      pickPhoto(path, aspects, slot);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Listeler                                                            */
/* ------------------------------------------------------------------ */
function listOf(path) {
  let arr = getPath(app.content, path);
  if (!Array.isArray(arr)) { arr = []; setPath(app.content, path, arr); }
  return arr;
}

function moveItem(path, i, d) {
  const arr = listOf(path);
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  app.rerender();
  markDirty();
}

async function deleteItem(path, i) {
  const ok = await dialog({ icon: '🗑️', text: 'Bu öğe silinsin mi?', yes: 'Evet, sil', no: 'Vazgeç' });
  if (!ok) return;
  listOf(path).splice(i, 1);
  app.rerender();
  markDirty();
}

function addItem(path) {
  const spec = LISTS[path];
  if (!spec) return;
  if (spec.photos) { addGalleryPhotos(); return; }
  listOf(path).push(spec.make());
  app.rerender();
  markDirty();
  const list = $(`[data-list="${path}"]`);
  const item = list && $$(':scope > [data-index]', list).pop();
  if (item) {
    item.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const first = item.matches('[data-edit]') ? item : $('[data-edit]', item);
    if (first) setTimeout(() => { first.focus(); document.execCommand('selectAll', false, null); }, 450);
  }
}

function decorateList(list) {
  const path = list.dataset.list;
  const spec = LISTS[path];
  if (!spec || list.dataset.edReady) return;
  list.dataset.edReady = '1';
  for (const item of $$(':scope > [data-index]', list)) {
    const i = Number(item.dataset.index);
    const btn = (label, title, fn, cls = '') => h('button', {
      type: 'button', class: cls, title, 'aria-label': title,
      onclick: (e) => { e.stopPropagation(); fn(); },
    }, label);
    item.append(h('div', { class: `ed-ui ed-item-ctrl${spec.compact ? ' compact' : ''}` },
      spec.compact ? null : btn('↑', 'Yukarı taşı', () => moveItem(path, i, -1)),
      spec.compact ? null : btn('↓', 'Aşağı taşı', () => moveItem(path, i, 1)),
      btn('✕', 'Sil', () => deleteItem(path, i), 'del')));
  }
  const tag = list.tagName === 'OL' || list.tagName === 'UL' ? 'li' : 'div';
  list.append(h(tag, { class: `ed-ui ed-add${spec.compact ? ' compact' : ''}` },
    h('button', { type: 'button', onclick: () => addItem(path) }, spec.add)));
}

/* ------------------------------------------------------------------ */
/* Sayfayı düzenlenebilir yap                                          */
/* ------------------------------------------------------------------ */
function decorate() {
  if (S.preview || !state.editing) return;
  $$('[data-edit]').forEach(makeEditable);
  $$('[data-photo]').forEach(decoratePhoto);
  $$('[data-list]').forEach(decorateList);

  for (const sec of $$('.chapter')) {
    if ($(':scope > .ed-ch-bar', sec)) continue;
    const key = sec.dataset.ch;
    const visible = app.content.site.chapters[key] !== false;
    sec.prepend(h('div', { class: 'ed-ui ed-ch-bar' },
      h('span', {}, `Bölüm ${chapterNumber(key)} · ${visible ? 'Sena görebilir' : 'Gizli — Sena görmez'}`),
      h('button', {
        type: 'button', class: `ed-toggle${visible ? ' on' : ''}`, role: 'switch', 'aria-checked': visible ? 'true' : 'false',
        title: visible ? 'Bu bölümü gizle' : 'Bu bölümü göster',
        onclick: () => {
          app.content.site.chapters[key] = !visible;
          app.rerender();
          markDirty();
          toast(visible ? 'Bölüm gizlendi; Sena bu bölümü görmeyecek.' : 'Bölüm tekrar görünür.');
        },
      }, h('i'))));
  }

  const counter = $('[data-counter]');
  if (counter && !$('.ed-counter-btn', counter)) {
    counter.append(h('div', { class: 'ed-ui ed-inline-tools' },
      h('button', { type: 'button', class: 'ed-b primary ed-counter-btn', onclick: openDateModal }, '📅 Başlangıç tarihini ayarla')));
  }
  const finale = $('#ch-finale .finale-btns');
  if (finale && !finale.parentElement.querySelector('.ed-finale-note')) {
    finale.after(h('div', { class: 'ed-ui ed-inline-tools ed-finale-note' },
      h('button', { type: 'button', class: 'ed-b', onclick: () => openSettings('game') }, '🏃 Kaçan “Hayır” butonunun yazıları')));
  }
  const hero = $('#ch-home .hero');
  if (hero && !$('.ed-hero-tools', hero)) {
    hero.append(h('div', { class: 'ed-ui ed-inline-tools ed-hero-tools' },
      h('button', { type: 'button', class: 'ed-b', onclick: () => openSettings('chapters') }, '📖 Bölüm adları'),
      h('button', { type: 'button', class: 'ed-b', onclick: () => openSettings('music') }, '🎵 Şarkımız')));
  }
  const intro = $('#intro .intro-inner');
  if (intro && !$('.ed-intro-tools', intro)) {
    intro.append(h('div', { class: 'ed-ui ed-inline-tools ed-intro-tools' },
      h('button', { type: 'button', class: 'ed-b', onclick: () => openSettings('lock') }, '🔒 Özel kilit')));
  }
}

function onPageClick(e) {
  if (!state.editing || S.preview) return;
  const qa = e.target.closest('[data-quiz-answer]');
  if (qa) {
    const [i, k] = qa.dataset.quizAnswer.split(':').map(Number);
    setPath(app.content, `quiz.questions.${i}.answer`, k);
    app.rerender();
    markDirty();
    return;
  }
  const dt = e.target.closest('[data-dream-toggle]');
  if (dt) {
    const i = Number(dt.dataset.dreamToggle);
    const item = getPath(app.content, `dreams.items.${i}`);
    if (!item) return;
    item.done = !item.done;
    app.rerender();
    markDirty();
    if (item.done) {
      const r = dt.getBoundingClientRect();
      state.fx.burst(r.left + r.width / 2, r.top + r.height / 2, 14, { power: 1 });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pencereler                                                          */
/* ------------------------------------------------------------------ */
function modal({ title, body, actions, wide = false, onClose, cls = '' }) {
  const back = h('div', { class: 'ed-ui ed-modal-back' });
  let closed = false;
  const prevFocus = document.activeElement;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    if (!$('.ed-modal-back')) document.body.classList.remove('ed-lock');
    if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    if (onClose) onClose();
  };
  const box = h('div', { class: `ed-modal${wide ? ' wide' : ''} ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'ed-modal-head' },
      h('h3', {}, title),
      h('button', { type: 'button', class: 'ed-x', 'aria-label': 'Kapat', onclick: close }, '✕')),
    h('div', { class: 'ed-modal-body' }, body),
    actions ? h('div', { class: 'ed-modal-actions' }, actions) : null);
  back.append(box);
  back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  document.body.classList.add('ed-lock');
  setTimeout(() => { const f = $('input, textarea, button:not(.ed-x)', box); if (f) f.focus({ preventScroll: true }); }, 30);
  return { back, box, close };
}

function field(label, input, hint) {
  return h('div', { class: 'ed-field' }, h('label', {}, h('span', { class: 'ed-label' }, label), input), hint ? h('small', {}, hint) : null);
}

function boundInput(path, { type = 'text', placeholder = '', after, maxlength } = {}) {
  const v = getPath(app.content, path);
  const el = h('input', { class: 'ed-input', type, placeholder, maxlength, value: v == null ? '' : String(v) });
  el.addEventListener('input', () => {
    setPath(app.content, path, el.value);
    app.syncBinds(path);
    markDirty();
    after?.(el.value);
  });
  return el;
}

function toggle(label, checked, onChange, hint) {
  const btn = h('button', {
    type: 'button', class: `ed-toggle${checked ? ' on' : ''}`, role: 'switch', 'aria-checked': checked ? 'true' : 'false',
    onclick: () => {
      const on = !btn.classList.contains('on');
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      onChange(on);
    },
  }, h('i'));
  return h('div', { class: 'ed-field ed-switch-row' }, h('div', {}, h('span', { class: 'ed-label' }, label), hint ? h('small', {}, hint) : null), btn);
}

const shareUrl = () => `${location.origin}/`;

function openDateModal() {
  const c = app.content;
  const since = h('input', { class: 'ed-input', type: 'datetime-local', value: String(c.site.since || '').slice(0, 16) });
  since.addEventListener('input', () => {
    if (!since.value) return;
    c.site.since = since.value;
    c.site.sinceSet = true;
    markDirty();
  });
  const m = modal({
    title: '📅 Birlikteliğimizin başladığı an',
    body: [field('Tarih ve saat', since, 'Sayaç, istatistikler ve ay dönümü kutlamaları bu andan itibaren hesaplanır. Saati bilmiyorsan 00:00 yazabilirsin.')],
    actions: [h('button', { type: 'button', class: 'ed-b primary', onclick: () => m.close() }, 'Tamam')],
    onClose: () => app.rerender(),
  });
}

function openSettings(focus) {
  const c = app.content;
  const since = h('input', { class: 'ed-input', type: 'datetime-local', value: String(c.site.since || '').slice(0, 16) });
  since.addEventListener('input', () => { if (since.value) { c.site.since = since.value; c.site.sinceSet = true; markDirty(); } });
  const birthday = h('input', { class: 'ed-input', type: 'date', value: String(c.site.birthday || '').slice(0, 10) });
  birthday.addEventListener('input', () => { c.site.birthday = birthday.value; markDirty(); });

  const musicInfo = h('p', { class: 'ed-note' });
  const updateMusicInfo = () => {
    const mu = c.site.music || {};
    musicInfo.textContent = mu.src ? `🎵 Şu an: ${[mu.title, mu.artist].filter(Boolean).join(' — ') || 'isimsiz şarkı'}` : 'Henüz şarkı eklenmedi. Zarf açılınca çalacak bir şarkı ekleyebilirsin.';
  };
  updateMusicInfo();

  const noTexts = h('textarea', { class: 'ed-input', rows: '6' });
  noTexts.value = (c.finale.noTexts || []).join('\n');
  noTexts.addEventListener('input', () => { c.finale.noTexts = noTexts.value.split('\n').map((t) => t.trim()).filter(Boolean); markDirty(); });

  const answers = h('textarea', { class: 'ed-input', rows: '3', placeholder: 'Her satıra bir cevap (ör. aşkım)' });
  answers.value = (c.secret.lockAnswers || []).join('\n');
  const lockWarn = h('p', { class: 'ed-warn' });
  const updateLockWarn = () => {
    const none = !(c.secret.lockAnswers || []).length;
    lockWarn.hidden = !(c.site.lock.enabled && none);
    lockWarn.textContent = 'Kilit açık ama henüz kabul edilecek bir cevap yazmadın; cevap yazana kadar site kilitsiz görünür.';
  };
  answers.addEventListener('input', () => {
    c.secret.lockAnswers = answers.value.split('\n').map((t) => t.trim()).filter(Boolean);
    markDirty();
    updateLockWarn();
  });
  updateLockWarn();

  const chapterRows = CHAPTERS.map((ch) => {
    const vis = c.site.chapters[ch.key] !== false;
    const btn = h('button', {
      type: 'button', class: `ed-toggle small${vis ? ' on' : ''}`, role: 'switch', 'aria-checked': vis ? 'true' : 'false', title: 'Görünür / gizli',
      onclick: () => {
        const on = !btn.classList.contains('on');
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
        c.site.chapters[ch.key] = on;
        markDirty();
      },
    }, h('i'));
    return h('div', { class: 'ed-chapter-row' },
      btn,
      h('div', { class: 'ed-chapter-inputs' },
        boundInput(`${ch.key}.title`, { placeholder: 'Bölüm adı' }),
        boundInput(`${ch.key}.desc`, { placeholder: 'Kısa açıklama' })));
  });

  const pwMsg = h('p', { class: 'ed-result' });
  const pwOld = h('input', { class: 'ed-input', type: 'password', autocomplete: 'current-password', placeholder: 'Mevcut şifre' });
  const pwNew = h('input', { class: 'ed-input', type: 'password', autocomplete: 'new-password', placeholder: 'Yeni şifre (en az 6 karakter)' });
  const pwNew2 = h('input', { class: 'ed-input', type: 'password', autocomplete: 'new-password', placeholder: 'Yeni şifre tekrar' });

  const sections = {
    general: h('section', { class: 'ed-section' },
      h('h4', {}, '💞 İsimler ve başlık'),
      h('div', { class: 'ed-grid2' },
        field('Senin adın', boundInput('names.me')),
        field('Sevgilinin adı', boundInput('names.you'))),
      field('Tarayıcı sekmesindeki başlık', boundInput('site.title')),
      h('p', { class: 'ed-note' }, 'Sayfadaki diğer bütün yazıları (“Sena’ya”, imza, başlıklar…) doğrudan üzerlerine dokunarak değiştirebilirsin.')),
    dates: h('section', { class: 'ed-section' },
      h('h4', {}, '📅 Tarihler'),
      field('Birlikteliğimizin başladığı an', since, 'Sayaç, “Sayılarla biz” ve ay dönümü kutlamaları buna göre çalışır.'),
      field('Sena’nın doğum günü (isteğe bağlı)', birthday, 'O gün sitede “İyi ki doğdun” sürprizi ve havai fişekler olur.')),
    music: h('section', { class: 'ed-section' },
      h('h4', {}, '🎵 Şarkımız'),
      musicInfo,
      h('div', { class: 'ed-row' },
        h('button', { type: 'button', class: 'ed-b primary', onclick: () => pickMusic(updateMusicInfo) }, '🎵 Şarkı seç (MP3/M4A)'),
        h('button', {
          type: 'button', class: 'ed-b danger',
          onclick: () => { if (c.site.music) c.site.music.src = ''; app.rerender(); markDirty(); updateMusicInfo(); },
        }, 'Kaldır')),
      h('div', { class: 'ed-grid2' },
        field('Şarkının adı', boundInput('site.music.title')),
        field('Sanatçı', boundInput('site.music.artist'))),
      h('p', { class: 'ed-note' }, `Zarf açıldığında yavaşça başlar; sağ üstteki notadan durdurulabilir. En fazla ${MAX_MUSIC_MB} MB.`)),
    chapters: h('section', { class: 'ed-section' },
      h('h4', {}, '📖 Bölümler'),
      h('p', { class: 'ed-note' }, 'Anahtarı kapattığın bölümü Sena görmez. Adlar menüde ve sayfa geçişindeki kalpte görünür.'),
      chapterRows),
    lock: h('section', { class: 'ed-section' },
      h('h4', {}, '🔒 Özel kilit (isteğe bağlı)'),
      h('p', { class: 'ed-note' }, 'Açarsan site, sadece doğru cevabı bilen birinin açabileceği bir soruyla başlar. Fotoğraflar ve yazılar da o zaman kilitlenir. Büyük/küçük harf ve Türkçe karakter farkı önemsenmez.'),
      toggle('Kilidi aç', c.site.lock.enabled, (on) => { c.site.lock.enabled = on; markDirty(); updateLockWarn(); }),
      field('Soru', boundInput('site.lock.question')),
      field('Kabul edilecek cevaplar', answers, 'Her satıra bir tane. Birden fazla yazabilirsin (ör. “aşkım”, “askim”).'),
      field('İpucu (iki yanlıştan sonra görünür)', boundInput('site.lock.hint')),
      field('Yanlış cevapta çıkan yazı', boundInput('site.lock.wrong')),
      lockWarn),
    notify: h('section', { class: 'ed-section' },
      h('h4', {}, '🔔 Bildirimler'),
      toggle('Sena’nın yaptıklarını Gelen Kutusu’na düş', c.site.events !== false, (on) => { c.site.events = on; markDirty(); },
        'Kupon kullanınca, bir mektubu açınca, sınavı bitirince, “Evet” deyince… Senin için yazdığı notlar ve hayaller her zaman gelir.'),
      field('WhatsApp numaran (isteğe bağlı)', boundInput('site.whatsapp', { type: 'tel', placeholder: '905xxxxxxxxx' }),
        'Kupon kullanıldığında WhatsApp’ta sana hazır mesaj açılsın diye. Ülke koduyla, + olmadan yaz (ör. 905321234567).')),
    game: h('section', { class: 'ed-section' },
      h('h4', {}, '🏃 Kaçan “Hayır” butonu'),
      field('Kaçarken yazanlar (her satıra bir tane)', noTexts),
      field('Buton kaybolunca çıkan yazı', boundInput('finale.noGone'))),
    share: h('section', { class: 'ed-section' },
      h('h4', {}, '🔗 Sena’ya göndereceğin adres'),
      h('div', { class: 'ed-row' },
        h('input', { class: 'ed-input', readonly: true, value: shareUrl() }),
        h('button', {
          type: 'button', class: 'ed-b primary',
          onclick: async (e) => {
            try { await navigator.clipboard.writeText(shareUrl()); e.currentTarget.textContent = '✓ Kopyalandı'; } catch { toast('Kopyalanamadı; adresi elle seçebilirsin.'); }
          },
        }, 'Kopyala')),
      h('a', {
        class: 'ed-b whatsapp', target: '_blank', rel: 'noopener',
        href: `https://wa.me/?text=${encodeURIComponent(`Sana özel bir şey hazırladım 💌 ${shareUrl()}`)}`,
      }, '💬 WhatsApp’ta gönder'),
      h('p', { class: 'ed-note' }, '“/duzenle” kısmı olmadan olan adresi gönder. Düzenleme sayfası şifreli olduğu için Sena göremez.')),
    security: h('section', { class: 'ed-section' },
      h('h4', {}, '🔑 Şifre ve oturum'),
      h('div', { class: 'ed-grid3' }, pwOld, pwNew, pwNew2),
      h('div', { class: 'ed-row' },
        h('button', {
          type: 'button', class: 'ed-b',
          onclick: async () => {
            pwMsg.className = 'ed-result';
            if (pwNew.value !== pwNew2.value) { pwMsg.textContent = 'Yeni şifreler aynı değil.'; pwMsg.classList.add('bad'); return; }
            try {
              await api('/api/auth', { method: 'POST', body: { action: 'change', password: pwOld.value, newPassword: pwNew.value } });
              pwMsg.textContent = '✓ Şifren değişti. Diğer cihazlardaki oturumlar kapandı.';
              pwMsg.classList.add('good');
              pwOld.value = ''; pwNew.value = ''; pwNew2.value = '';
            } catch (e) { pwMsg.textContent = explain(e); pwMsg.classList.add('bad'); }
          },
        }, 'Şifreyi değiştir'),
        h('button', {
          type: 'button', class: 'ed-b danger',
          onclick: async () => {
            if (isDirty()) await save({ quiet: true });
            await api('/api/auth', { method: 'POST', body: { action: 'logout' } }).catch(() => {});
            location.href = '/';
          },
        }, 'Çıkış yap')),
      pwMsg),
  };

  const m = modal({
    title: '⚙️ Ayarlar',
    wide: true,
    body: Object.values(sections),
    actions: [h('button', { type: 'button', class: 'ed-b primary', onclick: () => m.close() }, 'Tamam')],
    onClose: () => { app.rerender(); refreshStatus(); },
  });
  if (focus && sections[focus]) setTimeout(() => sections[focus].scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
}

/* ------------------------------------------------------------------ */
/* Yapılacaklar listesi                                                */
/* ------------------------------------------------------------------ */
function checklist() {
  const c = app.content;
  const galleryCount = (c.gallery.items || []).filter((it) => it.photo).length;
  return [
    { done: true, text: 'Düzenleme şifreni belirledin' },
    { done: Boolean(c.site.sinceSet), text: 'Birlikteliğinizin başladığı tarihi ayarla', go: () => openDateModal() },
    { done: Boolean(c.home.photo), text: 'Ana sayfadaki kalp çerçeveye en sevdiğin fotoğrafınızı koy', go: () => app.go('home') },
    { done: galleryCount >= 3, text: `“Anılarımız”a fotoğraflarınızı yükle (${galleryCount} fotoğraf var)`, go: () => app.go('gallery') },
    { done: (c.story.items || []).some((it) => it.photo), text: '“Hikâyemiz”deki anılara fotoğraf ve tarih ekle', go: () => app.go('story') },
    { done: Boolean(c.site.music && c.site.music.src), text: 'Şarkınızı ekle (zarf açılınca çalar)', go: () => openSettings('music') },
    { done: Boolean(c.finale.photo), text: 'Final bölümündeki kalbe bir fotoğraf koy', go: () => app.go('finale') },
    { tip: true, text: 'Mektubu kendi cümlelerinle kişiselleştir', go: () => app.go('letter') },
    { tip: true, text: 'Sınav sorularını ikinize göre düzenle (✓ ile doğru cevabı seç)', go: () => app.go('quiz') },
    { tip: true, text: 'İstersen WhatsApp numaranı ve özel kilidi ayarla', go: () => openSettings('notify') },
  ];
}

function openChecklist({ welcome = false } = {}) {
  const items = checklist();
  const done = items.filter((it) => it.done).length;
  const total = items.filter((it) => !it.tip).length;
  let m;
  const list = h('ul', { class: 'ed-checklist' }, items.map((it) => h('li', { class: it.done ? 'done' : it.tip ? 'tip' : '' },
    h('span', { class: 'ed-cl-ic', 'aria-hidden': 'true' }, it.done ? '✓' : it.tip ? '💡' : '○'),
    h('span', { class: 'ed-cl-t' }, it.text),
    it.go && !it.done ? h('button', { type: 'button', class: 'ed-b small', onclick: () => { m.close(); it.go(); } }, 'Git →') : null)));
  m = modal({
    title: welcome ? `💌 Hoş geldin ${app.content.names?.me || ''}!` : '✅ Yapılacaklar',
    wide: true,
    body: [
      welcome ? h('div', { class: 'ed-welcome' },
        h('p', {}, 'Burası sadece senin gördüğün düzenleme modu. Sena sadece sonucu görür.'),
        h('ol', { class: 'ed-steps' },
          h('li', {}, h('b', {}, '✏️ Yazılar: '), 'Kesik çizgili her yazıya dokunup değiştir. Değişiklikler birkaç saniye içinde kendiliğinden kaydedilir.'),
          h('li', {}, h('b', {}, '📷 Fotoğraflar: '), '“Fotoğraf seç”e dokun → seç → kırp. “Anılarımız”da birden fazla fotoğrafı tek seferde yükleyebilirsin.'),
          h('li', {}, h('b', {}, '📖 Bölümler: '), 'Sağ üstteki “Bölümler”den sayfalar arasında gez; her bölümün üstündeki anahtarla o bölümü gizleyebilirsin.'),
          h('li', {}, h('b', {}, '💌 Gelen: '), 'Sena bir kupon kullanınca, mektup açınca ya da sana not bırakınca burada görürsün.'),
          h('li', {}, h('b', {}, '👁 Önizle: '), 'Sena’nın göreceği hâli görmek için.'))) : null,
      h('div', { class: 'ed-cl-progress' }, h('div', { class: 'ed-bar-track' }, h('i', { style: { width: `${(done / total) * 100}%` } })), h('span', {}, `${done} / ${total} tamam`)),
      list,
    ],
    actions: [h('button', { type: 'button', class: 'ed-b primary', onclick: () => m.close() }, welcome ? 'Hadi başlayalım ✨' : 'Tamam')],
  });
}

/* ------------------------------------------------------------------ */
/* Gelen kutusu                                                        */
/* ------------------------------------------------------------------ */
const INBOX_TYPES = {
  not: { icon: '💌', label: 'Sana bir not bıraktı' },
  hayal: { icon: '💭', label: 'Yeni bir hayal yazdı' },
  kupon: { icon: '🎟️', label: 'Bir kupon kullandı' },
  mektup: { icon: '✉️', label: 'Bir mektup açtı' },
  evet: { icon: '💍', label: '“Evet” dedi!' },
  sinav: { icon: '📝', label: 'Sınavı bitirdi' },
  kazi: { icon: '🎁', label: 'Kazı kazanı kazıdı' },
};

async function loadInbox() {
  try {
    const data = await api('/api/inbox');
    S.inbox = data;
    updateBadge();
  } catch { /* yok say */ }
}

function updateBadge() {
  const b = $('.ed-bar [data-ed="inbox"] .ed-badge');
  if (!b) return;
  b.textContent = S.inbox.unread > 9 ? '9+' : String(S.inbox.unread || '');
  b.hidden = !S.inbox.unread;
}

async function openInbox() {
  const listEl = h('div', { class: 'ed-inbox' }, h('p', { class: 'ed-note' }, 'Yükleniyor…'));
  const you = app.content.names?.you || 'Sena';
  const render = () => {
    const items = S.inbox.items || [];
    const readAt = S.inbox.readAt ? Date.parse(S.inbox.readAt) : 0;
    listEl.textContent = '';
    if (!items.length) {
      listEl.append(h('div', { class: 'ed-empty' }, h('span', {}, '📭'), h('p', {}, `Henüz bir şey yok. ${you} bir kupon kullandığında, bir mektup açtığında ya da sana not bıraktığında burada göreceksin.`)));
      return;
    }
    for (const it of items) {
      const t = INBOX_TYPES[it.type] || { icon: '•', label: it.type };
      listEl.append(h('article', { class: `ed-msg${Date.parse(it.at) > readAt ? ' new' : ''} t-${it.type}` },
        h('span', { class: 'ed-msg-ic', 'aria-hidden': 'true' }, t.icon),
        h('div', { class: 'ed-msg-body' },
          h('p', { class: 'ed-msg-head' }, h('b', {}, t.label), it.test ? h('span', { class: 'ed-tag' }, 'senin denemen') : null),
          it.title ? h('p', { class: 'ed-msg-title' }, it.title) : null,
          it.text ? h('p', { class: `ed-msg-text${it.type === 'not' || it.type === 'hayal' ? ' ed-quote' : ''}` }, it.text) : null,
          h('p', { class: 'ed-msg-meta' }, `${relTime(it.at)} · ${it.device || ''}`)),
        h('button', {
          type: 'button', class: 'ed-x small', title: 'Sil', 'aria-label': 'Sil',
          onclick: async () => {
            await api(`/api/inbox?id=${encodeURIComponent(it.id)}`, { method: 'DELETE' }).catch(() => {});
            S.inbox.items = S.inbox.items.filter((x) => x.id !== it.id);
            render();
          },
        }, '✕')));
    }
  };
  const m = modal({
    title: '💌 Gelen kutusu',
    wide: true,
    cls: 'ed-inbox-modal',
    body: [listEl],
    actions: [
      h('button', {
        type: 'button', class: 'ed-b danger',
        onclick: async () => {
          if (!(S.inbox.items || []).length) return;
          const ok = await dialog({ icon: '🗑️', text: 'Gelen kutusundaki her şey silinsin mi?', yes: 'Evet, sil', no: 'Vazgeç' });
          if (!ok) return;
          await api('/api/inbox', { method: 'DELETE' }).catch(() => {});
          S.inbox.items = [];
          render();
        },
      }, 'Tümünü sil'),
      h('button', { type: 'button', class: 'ed-b', onclick: async () => { await loadInbox(); render(); } }, '↻ Yenile'),
      h('button', { type: 'button', class: 'ed-b primary', onclick: () => m.close() }, 'Kapat'),
    ],
  });
  await loadInbox();
  render();
  if (S.inbox.unread) {
    api('/api/inbox', { method: 'PATCH' }).then((d) => { S.inbox.unread = 0; S.inbox.readAt = d.readAt; updateBadge(); }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Alt araç çubuğu                                                     */
/* ------------------------------------------------------------------ */
function buildBar() {
  const btn = (icon, label, action, cls = '') => h('button', { type: 'button', class: `ed-btn ${cls}`, 'data-ed': action, title: label },
    h('span', { class: 'ic', 'aria-hidden': 'true' }, icon), h('span', { class: 'lb' }, label),
    action === 'inbox' ? h('span', { class: 'ed-badge', hidden: true }) : null);
  const bar = h('div', { class: 'ed-ui ed-bar', 'data-state': 'saved', role: 'toolbar', 'aria-label': 'Düzenleme araçları' },
    h('button', { type: 'button', class: 'ed-status', title: 'Durum' }, h('span', { class: 'ed-dot' }), h('span', { class: 'ed-status-text' }, 'Düzenleme modu')),
    btn('💌', 'Gelen', 'inbox'),
    btn('✅', 'Yapılacaklar', 'todo'),
    btn('⚙️', 'Ayarlar', 'settings'),
    btn('👁', 'Önizle', 'preview', 'ed-preview-btn'),
    btn('💾', 'Kaydet', 'save', 'ed-primary'));
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ed]');
    if (b) {
      const a = b.dataset.ed;
      if (a === 'settings') openSettings();
      if (a === 'todo') openChecklist();
      if (a === 'inbox') openInbox();
      if (a === 'save') save();
      if (a === 'preview') togglePreview(b);
      return;
    }
    if (e.target.closest('.ed-status') && bar.dataset.state === 'error') save();
  });
  document.body.append(bar);
}

function togglePreview(btn) {
  S.preview = !S.preview;
  document.body.classList.toggle('ed-previewing', S.preview);
  $('.ic', btn).textContent = S.preview ? '✏️' : '👁';
  $('.lb', btn).textContent = S.preview ? 'Düzenle' : 'Önizle';
  app.setEditing(!S.preview);
  toast(S.preview ? 'Önizleme: Sena’nın göreceği hâli bu 💕' : 'Düzenlemeye geri döndün ✏️');
}

/* ------------------------------------------------------------------ */
/* Başlangıç                                                           */
/* ------------------------------------------------------------------ */
export async function startEditor(appApi) {
  app = appApi;
  const link = h('link', { rel: 'stylesheet', href: '/css/editor.css' });
  document.head.append(link);
  await new Promise((r) => { link.onload = r; link.onerror = r; setTimeout(r, 1500); });
  document.title = 'Düzenleme · Deniz & Sena';

  let auth;
  try {
    auth = await api('/api/auth');
  } catch (e) {
    throw new Error(`Sunucuya ulaşılamadı (${explain(e)})`);
  }
  S.local = Boolean(auth.local);
  const firstTime = !auth.setup;
  if (!auth.admin) await loginScreen({ setup: !auth.setup });

  const data = await api('/api/content?duzenle=1');
  S.etag = data.etag;
  app.start(data.content);
  S.baseline = serialize();
  document.title = 'Düzenleme · Deniz & Sena';

  buildBar();
  document.addEventListener('app:render', decorate);
  document.addEventListener('click', onPageClick);
  decorate();
  refreshStatus();
  loadCropper().catch(() => {});
  loadInbox();

  window.addEventListener('beforeunload', (e) => {
    if (isDirty() || S.saving || S.busyUploads) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isDirty() && !S.saving && !S.busyUploads) {
      const body = { content: app.content, etag: S.etag };
      if (JSON.stringify(body).length < 60_000) {
        api('/api/content', { method: 'PUT', body, keepalive: true })
          .then((d) => { S.etag = d.etag; S.baseline = serialize(); refreshStatus(); })
          .catch(() => {});
      } else {
        save({ quiet: true });
      }
    }
  });

  if (firstTime || !store.get('ds:ed:hosgeldin')) {
    store.set('ds:ed:hosgeldin', '1');
    setTimeout(() => openChecklist({ welcome: true }), 500);
  } else {
    toast('Düzenleme modu açık ✏️ Yazılara dokunarak değiştirebilirsin.');
  }
}
