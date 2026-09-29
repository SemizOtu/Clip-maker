// Düzenleme modu: yazıları değiştir, fotoğraf seç → kırp → ekle, GitHub'a kaydet.
import { CONFIG } from './config.js';
import { h } from './app.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const STORE_KEY = 'ask-sitesi-duzenleme';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?' + new URLSearchParams({
  name: 'Ask Sitesi Duzenleme',
  description: 'Sevgilim sitesindeki fotograf ve yazilari kaydetmek icin',
  expires_in: 'none',
  contents: 'write',
  metadata: 'read',
}).toString();

const LISTS = {
  'story.items': { add: '+ Yeni anı ekle', make: () => ({ date: 'Tarih', title: 'Yeni anımız', text: 'Bu anıyı buraya yaz…', photo: '' }) },
  'gallery.items': { add: '+ Fotoğraf ekle', photoFirst: true },
  'reasons.items': { add: '+ Yeni sebep ekle', make: () => 'Seni seviyorum çünkü…' },
  'surprise.coupons': { add: '+ Yeni kupon ekle', make: () => ({ icon: '💝', title: 'Yeni Kupon', text: 'Kuponun açıklamasını yaz…' }) },
  'home.rotating': { add: '+ Kelime', make: () => 'yeni kelime', onlyDelete: true },
};

const ASPECT_NAMES = { '1': 'Kare', '4/5': 'Dikey', '3/4': 'Dikey', '4/3': 'Yatay', '16/9': 'Geniş' };

let app;
const S = {
  gh: null,
  settings: null,
  baseline: '',
  pending: new Map(),
  known: new Set(),
  saving: false,
  queued: false,
  queuedReason: '',
  preview: false,
  lastError: '',
  textTimer: 0,
};

/* ------------------------------------------------------------------ */
/* Ayarlar (sadece bu cihazda saklanır)                                */
/* ------------------------------------------------------------------ */
function detectRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return m && seg ? { owner: m[1], repo: seg } : {};
}

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; }
}

function readSettings() {
  const saved = loadStore();
  const o = saved.overrides || {};
  const det = detectRepo();
  return {
    token: saved.token || '',
    owner: o.owner || det.owner || CONFIG.owner,
    repo: o.repo || det.repo || CONFIG.repo,
    branch: o.branch || CONFIG.branch,
    mirrors: CONFIG.mirrorBranches || [],
  };
}

// token her zaman; depo bilgileri sadece “Gelişmiş”ten elle değiştirilirse saklanır
function writeSettings(patch, { overrides = false } = {}) {
  S.settings = { ...S.settings, ...patch };
  const store = loadStore();
  store.token = S.settings.token || '';
  if (overrides) store.overrides = { owner: S.settings.owner, repo: S.settings.repo, branch: S.settings.branch };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* yok say */ }
  applySettings();
}

function applySettings() {
  const { owner, repo, branch } = S.settings;
  S.gh = new GitHub(S.settings);
  app.setRawBase(`https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/${branch}/`);
}

/* ------------------------------------------------------------------ */
/* GitHub istemcisi                                                    */
/* ------------------------------------------------------------------ */
class GitHub {
  constructor(cfg) { this.cfg = cfg; }

  get base() { return `https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}`; }

  static ref(branch) { return branch.split('/').map(encodeURIComponent).join('/'); }

  async req(method, path, body, accept) {
    const headers = { Accept: accept || 'application/vnd.github+json' };
    if (this.cfg.token) headers.Authorization = `Bearer ${this.cfg.token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch { /* yok say */ }
      const err = new Error(msg || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return accept && accept.includes('raw') ? res.text() : res.json();
  }

  async checkAccess() {
    const r = await this.req('GET', '');
    // Gerçek yazma izni testi: bağlanmamış küçük bir blob oluştur (zararsız)
    await this.req('POST', '/git/blobs', { content: btoa('ask'), encoding: 'base64' });
    return { push: true, fullName: r.full_name };
  }

  readContent() {
    return this.req('GET', `/contents/content.json?ref=${encodeURIComponent(this.cfg.branch)}&t=${Date.now()}`, null, 'application/vnd.github.raw+json');
  }

  async commitOnce(files, message) {
    const ref = await this.req('GET', `/git/ref/heads/${GitHub.ref(this.cfg.branch)}`);
    const headSha = ref.object.sha;
    const head = await this.req('GET', `/git/commits/${headSha}`);
    let removals = files.filter((f) => f.remove);
    if (removals.length) {
      const tree = await this.req('GET', `/git/trees/${head.tree.sha}?recursive=1`);
      const existing = new Set((tree.tree || []).map((t) => t.path));
      removals = removals.filter((f) => existing.has(f.path));
    }
    const entries = [];
    for (const f of files) {
      if (f.remove) continue;
      if (f.blob) {
        const b64 = await blobToBase64(f.blob);
        const blob = await this.req('POST', '/git/blobs', { content: b64, encoding: 'base64' });
        entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
      } else {
        entries.push({ path: f.path, mode: '100644', type: 'blob', content: f.text });
      }
    }
    for (const f of removals) entries.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
    const tree = await this.req('POST', '/git/trees', { base_tree: head.tree.sha, tree: entries });
    const commit = await this.req('POST', '/git/commits', { message, tree: tree.sha, parents: [headSha] });
    await this.req('PATCH', `/git/refs/heads/${GitHub.ref(this.cfg.branch)}`, { sha: commit.sha, force: false });
    return { sha: commit.sha, tree: tree.sha };
  }

  async commit(files, message) {
    try {
      return await this.commitOnce(files, message);
    } catch (e) {
      if (e.status === 409 || e.status === 422) return this.commitOnce(files, message);
      throw e;
    }
  }

  // GitHub Pages dalına aynı içeriği, geçmişi silmeden yeni bir commit olarak ekler
  async mirror(treeSha, message) {
    for (const b of this.cfg.mirrors || []) {
      if (!b || b === this.cfg.branch) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const ref = await this.req('GET', `/git/ref/heads/${GitHub.ref(b)}`);
          const parent = ref.object.sha;
          const parentCommit = await this.req('GET', `/git/commits/${parent}`);
          if (parentCommit.tree.sha === treeSha) break;
          const c = await this.req('POST', '/git/commits', { message: `${message} (Pages)`, tree: treeSha, parents: [parent] });
          await this.req('PATCH', `/git/refs/heads/${GitHub.ref(b)}`, { sha: c.sha, force: false });
          break;
        } catch (e) {
          if (e.status === 404) break;
          if (attempt === 1) console.warn('Pages dalı güncellenemedi:', b, e);
        }
      }
    }
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function explain(e) {
  const msg = String((e && e.message) || '');
  if (e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'İnternet bağlantısı yok gibi görünüyor. Bağlantını kontrol edip tekrar dene.';
  if (e.status === 401) return 'GitHub anahtarı geçersiz ya da süresi dolmuş. Ayarlar’dan yeni bir anahtar gir.';
  if (e.status === 403 && /rate limit/i.test(msg)) return 'GitHub şu an çok fazla istek aldı; birkaç dakika sonra tekrar dene.';
  if (e.status === 403) return 'Anahtarın bu depoya yazma izni yok. Anahtarı oluştururken “Contents: Read and write” iznini seçmelisin.';
  if (e.status === 404) return 'Depo bulunamadı. Anahtarı oluştururken bu depoyu seçtiğinden emin ol (Only select repositories).';
  if (e.status === 409 || e.status === 422) return 'Kaydederken bir çakışma oldu. Sayfayı yenileyip tekrar dene.';
  return `Bir hata oluştu: ${msg || 'bilinmeyen hata'}`;
}

/* ------------------------------------------------------------------ */
/* Değişiklik takibi & kaydetme                                        */
/* ------------------------------------------------------------------ */
const serialize = (c) => JSON.stringify(c, null, 2) + '\n';
const isManaged = (p) => typeof p === 'string' && (p.startsWith(`${CONFIG.photoDir}/`) || p.startsWith(`${CONFIG.musicDir}/`));

function collectMedia(obj, out = new Set()) {
  if (typeof obj === 'string') { if (isManaged(obj)) out.add(obj); }
  else if (Array.isArray(obj)) obj.forEach((v) => collectMedia(v, out));
  else if (obj && typeof obj === 'object') Object.values(obj).forEach((v) => collectMedia(v, out));
  return out;
}

function isDirty() {
  return S.pending.size > 0 || serialize(app.content) !== S.baseline;
}

function setStatus(kind, text) {
  const bar = $('.ed-bar');
  if (!bar) return;
  const labels = {
    saved: 'Her şey kaydedildi',
    dirty: 'Kaydedilmemiş değişiklikler var',
    saving: '⏳ Kaydediliyor…',
    error: '⚠️ Kaydedilemedi',
    nokey: '🔑 Kaydetmek için anahtar gerekli',
  };
  bar.dataset.state = kind;
  $('.ed-status-text', bar).textContent = text || labels[kind] || '';
}

function refreshStatus() {
  if (S.saving) return setStatus('saving');
  if (!isDirty()) return setStatus('saved');
  if (!S.settings.token) return setStatus('nokey');
  return setStatus('dirty');
}

function markDirty() {
  refreshStatus();
}

function scheduleTextSave() {
  clearTimeout(S.textTimer);
  if (!S.settings.token) return;
  S.textTimer = setTimeout(() => { if (isDirty()) save('✏️ Yazılar güncellendi', { quiet: true }); }, 30000);
}

async function save(reason = '💕 Site güncellendi', { quiet = false } = {}) {
  clearTimeout(S.textTimer);
  if (!S.settings.token) {
    refreshStatus();
    if (!quiet) openKeyModal();
    return false;
  }
  if (S.saving) {
    S.queued = true;
    S.queuedReason = reason;
    return false;
  }
  if (!isDirty()) {
    refreshStatus();
    if (!quiet) app.toast('Kaydedilecek yeni bir değişiklik yok ✓');
    return true;
  }
  S.saving = true;
  setStatus('saving');
  const text = serialize(app.content);
  const referenced = collectMedia(app.content);
  for (const p of [...S.pending.keys()]) if (!referenced.has(p)) S.pending.delete(p);
  const uploads = [...S.pending.entries()];
  const removals = [...S.known].filter((p) => !referenced.has(p));
  const files = [
    ...uploads.map(([path, blob]) => ({ path, blob })),
    { path: 'content.json', text },
    ...removals.map((path) => ({ path, remove: true })),
  ];
  const photoCount = uploads.filter(([p]) => p.startsWith(`${CONFIG.photoDir}/`)).length;
  const message = photoCount > 1 ? `${reason} (${photoCount} fotoğraf)` : reason;
  let ok = false;
  try {
    const result = await S.gh.commit(files, message);
    uploads.forEach(([p]) => S.pending.delete(p));
    S.baseline = text;
    referenced.forEach((p) => S.known.add(p));
    removals.forEach((p) => S.known.delete(p));
    await S.gh.mirror(result.tree, message);
    ok = true;
    S.lastError = '';
    if (!quiet) app.toast('Kaydedildi! Site 1-2 dakika içinde güncellenecek ❤', { ms: 4500 });
  } catch (e) {
    console.error(e);
    S.lastError = explain(e);
    app.toast(S.lastError, { error: true, ms: 8000 });
  } finally {
    S.saving = false;
  }
  if (ok) refreshStatus(); else setStatus('error', `⚠️ ${S.lastError}`);
  if (S.queued) {
    S.queued = false;
    save(S.queuedReason, { quiet: true });
  }
  return ok;
}

/* ------------------------------------------------------------------ */
/* Yazı düzenleme                                                      */
/* ------------------------------------------------------------------ */
function readText(el) {
  let v = (el.innerText || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n');
  if (el.hasAttribute('data-multiline')) {
    v = v.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } else {
    v = v.replace(/\s*\n\s*/g, ' ').trim();
  }
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
    app.setPath(app.content, path, readText(el));
    app.syncBinds(path);
    markDirty();
    scheduleTextSave();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !el.hasAttribute('data-multiline')) {
      e.preventDefault();
      el.blur();
    }
  });
  el.addEventListener('paste', (e) => {
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
  });
  el.addEventListener('blur', () => {
    const path = el.dataset.edit;
    const v = app.getPath(app.content, path);
    if (typeof v === 'string' && el.innerText.trim() !== v) el.textContent = v;
  });
}

/* ------------------------------------------------------------------ */
/* Fotoğraf: seç → kırp → ekle                                         */
/* ------------------------------------------------------------------ */
function chooseFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, class: 'ed-hidden-input' });
    document.body.append(input);
    let done = false;
    const finish = (f) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener('change', () => finish((input.files && input.files[0]) || null));
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

let cropperLoading = null;
function loadCropper() {
  if (window.Cropper) return Promise.resolve();
  if (cropperLoading) return cropperLoading;
  cropperLoading = new Promise((resolve, reject) => {
    const link = h('link', { rel: 'stylesheet', href: 'vendor/cropper.min.css' });
    document.head.append(link);
    const s = h('script', { src: 'vendor/cropper.min.js' });
    s.onload = () => resolve();
    s.onerror = () => { cropperLoading = null; reject(new Error('Kırpma aracı yüklenemedi')); };
    document.head.append(s);
  });
  return cropperLoading;
}

function parseAspects(str) {
  return String(str || '1').split(',').map((a) => a.trim()).filter(Boolean).map((a) => {
    const [w, hh] = a.split('/').map(Number);
    return { key: a, value: hh ? w / hh : w, label: ASPECT_NAMES[a] || a };
  });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}

async function cropDialog(file, aspectsStr) {
  try { await loadCropper(); } catch (e) { app.toast(e.message, { error: true }); return null; }
  const aspects = parseAspects(aspectsStr);
  const url = URL.createObjectURL(file);
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
    const hint = h('p', { class: 'ed-note' }, 'Çerçeveyi sürükleyip köşelerinden boyutlandır; fotoğrafı iki parmakla yakınlaştırabilirsin.');
    const okBtn = h('button', { type: 'button', class: 'ed-b primary', disabled: true }, '✂️ Kırp ve ekle');
    const cancelBtn = h('button', { type: 'button', class: 'ed-b' }, 'Vazgeç');
    const m = modal({
      title: 'Fotoğrafı kırp',
      wide: true,
      body: [area, aspectBtns, tools, hint],
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
    okBtn.addEventListener('click', () => {
      if (!cropper) return;
      okBtn.disabled = true;
      okBtn.textContent = '⏳ Hazırlanıyor…';
      let canvas = null;
      try {
        canvas = cropper.getCroppedCanvas({
          maxWidth: CONFIG.maxPhotoPx,
          maxHeight: CONFIG.maxPhotoPx,
          fillColor: '#fff',
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
        });
      } catch (e) { console.error(e); }
      if (!canvas) {
        app.toast('Fotoğraf kırpılamadı, başka bir fotoğraf dene.', { error: true });
        finish(null);
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) app.toast('Fotoğraf kaydedilemedi, başka bir fotoğraf dene.', { error: true });
        finish(blob || null);
      }, 'image/jpeg', CONFIG.photoQuality);
    });

    img.addEventListener('load', () => {
      cropper = new window.Cropper(img, {
        viewMode: 1,
        dragMode: 'move',
        aspectRatio: current.value,
        autoCropArea: 0.92,
        background: false,
        responsive: true,
        restore: false,
        checkOrientation: false,
        toggleDragModeOnDblclick: false,
        ready() { okBtn.disabled = false; },
      });
    }, { once: true });
    img.addEventListener('error', () => {
      app.toast('Bu fotoğraf açılamadı. JPG ya da PNG bir fotoğraf dener misin?', { error: true, ms: 6000 });
      finish(null);
    }, { once: true });
    img.src = url;
  });
}

async function pickPhoto(path, aspects) {
  const file = await chooseFile('image/*');
  if (!file) return false;
  const blob = await cropDialog(file, aspects);
  if (!blob) return false;
  const name = `${CONFIG.photoDir}/${stamp()}.jpg`;
  S.pending.set(name, blob);
  app.setPhotoOverride(name, URL.createObjectURL(blob));
  app.setPath(app.content, path, name);
  app.rerender();
  markDirty();
  if (S.settings.token) {
    app.toast('Fotoğraf eklendi, kaydediliyor… ❤');
    save('📷 Fotoğraf eklendi', { quiet: false });
  } else {
    app.toast('Fotoğraf eklendi ❤ Kalıcı olması için anahtarını girip kaydetmelisin.', { ms: 5000 });
    openKeyModal();
  }
  return true;
}

async function removePhoto(path) {
  const ok = await app.dialog({ icon: '🗑️', text: 'Bu fotoğraf kaldırılsın mı?', yes: 'Evet, kaldır', no: 'Vazgeç' });
  if (!ok) return;
  app.setPath(app.content, path, '');
  app.rerender();
  markDirty();
}

function decoratePhoto(slot) {
  const path = slot.dataset.photo;
  const host = slot.closest('.heart-frame') ? slot.closest('.heart-wrap') : slot;
  if (!host || host.querySelector(':scope > .ed-photo-btns')) return;
  const has = !!app.getPath(app.content, path);
  const aspects = slot.dataset.aspects;
  host.append(h('div', { class: 'ed-ui ed-photo-btns' },
    h('button', {
      type: 'button',
      class: 'ed-photo-btn',
      onclick: (e) => { e.stopPropagation(); pickPhoto(path, aspects); },
    }, has ? '📷 Değiştir' : '📷 Fotoğraf seç'),
    has ? h('button', {
      type: 'button',
      class: 'ed-photo-btn ed-photo-del',
      title: 'Fotoğrafı kaldır',
      onclick: (e) => { e.stopPropagation(); removePhoto(path); },
    }, 'Kaldır') : null));
  if (!has) {
    slot.addEventListener('click', (e) => {
      if (e.target.closest('.ed-photo-btns')) return;
      pickPhoto(path, aspects);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Listeler: ekle / sırala / sil                                       */
/* ------------------------------------------------------------------ */
function listOf(path) {
  let arr = app.getPath(app.content, path);
  if (!Array.isArray(arr)) {
    arr = [];
    app.setPath(app.content, path, arr);
  }
  return arr;
}

function moveItem(path, i, d) {
  const arr = listOf(path);
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  app.rerender();
  markDirty();
  scheduleTextSave();
}

async function deleteItem(path, i) {
  const ok = await app.dialog({ icon: '🗑️', text: 'Bu öğe silinsin mi?', yes: 'Evet, sil', no: 'Vazgeç' });
  if (!ok) return;
  listOf(path).splice(i, 1);
  app.rerender();
  markDirty();
  scheduleTextSave();
}

async function addItem(path) {
  const spec = LISTS[path];
  if (!spec) return;
  const arr = listOf(path);
  if (spec.photoFirst) {
    arr.push({ photo: '', caption: 'Yeni anımız ❤' });
    const idx = arr.length - 1;
    const added = await pickPhoto(`${path}.${idx}.photo`, '4/5,1,4/3');
    if (!added && !arr[idx].photo) {
      arr.splice(idx, 1);
      app.rerender();
    }
    return;
  }
  arr.push(spec.make());
  app.rerender();
  markDirty();
  scheduleTextSave();
  const list = $(`[data-list="${path}"]`);
  const item = list && $$(':scope > [data-index]', list).pop();
  if (item) {
    item.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const first = item.matches('[data-edit]') ? item : $('[data-edit]', item);
    if (first) setTimeout(() => first.focus(), 450);
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
    item.append(h('div', { class: 'ed-ui ed-item-ctrl' },
      spec.onlyDelete ? null : btn('↑', 'Yukarı taşı', () => moveItem(path, i, -1)),
      spec.onlyDelete ? null : btn('↓', 'Aşağı taşı', () => moveItem(path, i, 1)),
      btn('✕', 'Sil', () => deleteItem(path, i), 'del')));
  }
  const tag = list.tagName === 'OL' || list.tagName === 'UL' ? 'li' : 'div';
  list.append(h(tag, { class: 'ed-ui ed-add' },
    h('button', { type: 'button', onclick: () => addItem(path) }, spec.add)));
}

/* ------------------------------------------------------------------ */
/* Sayfayı düzenlenebilir hale getir                                   */
/* ------------------------------------------------------------------ */
function decorate() {
  if (S.preview || !app.state.editing) return;
  $$('[data-edit]').forEach(makeEditable);
  $$('[data-photo]').forEach(decoratePhoto);
  $$('[data-list]').forEach(decorateList);

  const counter = $('[data-counter]');
  if (counter && !counter.querySelector('.ed-counter-btn')) {
    counter.append(h('div', { class: 'ed-ui ed-inline-tools' },
      h('button', { type: 'button', class: 'ed-b primary ed-counter-btn', onclick: openDateModal }, '📅 Başlangıç tarihini değiştir')));
  }
  const finale = $('#ch-finale .finale-btns');
  if (finale && !finale.parentElement.querySelector('.ed-finale-note')) {
    finale.after(h('div', { class: 'ed-ui ed-inline-tools ed-finale-note' },
      h('button', { type: 'button', class: 'ed-b', onclick: () => openSettings('game') }, '🏃 Kaçan “Hayır” butonunun yazıları')));
  }
  const home = $('#ch-home .hero');
  if (home && !home.querySelector('.ed-chapter-names')) {
    home.append(h('div', { class: 'ed-ui ed-inline-tools ed-chapter-names' },
      h('button', { type: 'button', class: 'ed-b', onclick: () => openSettings('chapters') }, '📖 Bölüm adlarını düzenle')));
  }
}

/* ------------------------------------------------------------------ */
/* Pencereler                                                          */
/* ------------------------------------------------------------------ */
function modal({ title, body, actions, wide = false, onClose }) {
  const back = h('div', { class: 'ed-ui ed-modal-back' });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    if (!$('.ed-modal-back')) document.body.classList.remove('ed-lock');
    if (onClose) onClose();
  };
  const box = h('div', { class: `ed-modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'ed-modal-head' },
      h('h3', {}, title),
      h('button', { type: 'button', class: 'ed-x', 'aria-label': 'Kapat', onclick: close }, '✕')),
    h('div', { class: 'ed-modal-body' }, body),
    actions ? h('div', { class: 'ed-modal-actions' }, actions) : null);
  back.append(box);
  back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.append(back);
  document.body.classList.add('ed-lock');
  return { back, box, close };
}

function field(label, input, hint) {
  return h('div', { class: 'ed-field' }, h('label', {}, label, input), hint ? h('small', {}, hint) : null);
}

function boundInput(path, { type = 'text', placeholder = '', after } = {}) {
  const v = app.getPath(app.content, path);
  const el = h('input', { class: 'ed-input', type, placeholder, value: v == null ? '' : String(v) });
  el.addEventListener('input', () => {
    app.setPath(app.content, path, el.value);
    app.syncBinds(path);
    markDirty();
    if (after) after(el.value);
  });
  return el;
}

function shareUrl() {
  return location.origin + location.pathname;
}

function helpBody() {
  return [
    h('ol', { class: 'ed-steps' },
      h('li', {}, h('b', {}, '✏️ Yazılar: '), 'Kesik çizgili her yazıya dokun ve değiştir. Bitince alttaki ', h('b', {}, '💾 Kaydet'), '’e bas.'),
      h('li', {}, h('b', {}, '📷 Fotoğraflar: '), 'Fotoğraf alanındaki “Fotoğraf seç” butonuna dokun → fotoğrafını seç → kırp → “Kırp ve ekle”. Fotoğraf kendiliğinden kaydedilir.'),
      h('li', {}, h('b', {}, '➕ Ekle / sırala / sil: '), 'Listelerin altındaki “+ Ekle” butonlarını kullan. ↑ ↓ ile sırala, ✕ ile sil.'),
      h('li', {}, h('b', {}, '⚙️ Ayarlar: '), 'Tanışma tarihini, şarkınızı, WhatsApp numaranı ve bölüm adlarını buradan değiştirebilirsin.'),
      h('li', {}, h('b', {}, '👁 Önizle: '), 'Sevgilinin göreceği hâli görmek için.')),
    h('p', { class: 'ed-note' }, 'Kaydettiğin değişiklikler 1-2 dakika içinde siteye yansır. Sevgiline göndereceğin adres (düzenleme kısmı olmadan):'),
    h('div', { class: 'ed-row ed-share' },
      h('input', { class: 'ed-input', readonly: true, value: shareUrl() }),
      h('button', {
        type: 'button', class: 'ed-b primary',
        onclick: async (e) => {
          try { await navigator.clipboard.writeText(shareUrl()); e.currentTarget.textContent = '✓ Kopyalandı'; } catch { app.toast('Kopyalanamadı, adresi elle seçebilirsin.'); }
        },
      }, 'Kopyala')),
    h('h4', { class: 'ed-h4' }, '🔑 Bir kereye mahsus: GitHub anahtarı'),
    tokenSteps(),
  ];
}

function tokenSteps() {
  return h('div', {},
    h('p', {}, 'Değişikliklerin siteye kaydedilebilmesi için GitHub’dan bir anahtar (token) alman gerekiyor. Sadece bir kere yapman yeterli:'),
    h('ol', { class: 'ed-steps' },
      h('li', {}, h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener', class: 'ed-link' }, 'Anahtar oluşturma sayfasını aç ↗'), ' (GitHub hesabınla giriş yap).'),
      h('li', {}, 'İsim ve izinler çoğunlukla hazır gelir. ', h('b', {}, 'Expiration'), ' kısmında “No expiration” ya da uzun bir süre seç.'),
      h('li', {}, h('b', {}, 'Repository access'), ' → ', h('b', {}, 'Only select repositories'), ' → listeden ', h('b', {}, `${S.settings.repo}`), ' deposunu seç.'),
      h('li', {}, h('b', {}, 'Permissions'), ' kısmında ', h('b', {}, 'Contents'), ' izninin ', h('b', {}, 'Read and write'), ' olduğundan emin ol (yoksa “Add permissions” ile ekle).'),
      h('li', {}, 'En alttaki yeşil ', h('b', {}, 'Generate token'), ' butonuna bas ve çıkan ', h('code', {}, 'github_pat_…'), ' ile başlayan anahtarı kopyala.'),
      h('li', {}, 'Buradaki “GitHub anahtarı” kutusuna yapıştırıp ', h('b', {}, 'Kaydet ve test et'), '’e bas.')),
    h('p', { class: 'ed-note' }, '🔒 Anahtar sadece bu cihazın tarayıcısında saklanır; siteye ya da depoya yazılmaz. Sevgilin bu kısmı hiçbir zaman görmez.'));
}

function tokenBox(onDone) {
  const input = h('input', {
    class: 'ed-input', type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false',
    value: S.settings.token || '',
  });
  const show = h('button', { type: 'button', class: 'ed-b', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; } }, '👁');
  const result = h('p', { class: 'ed-result' });
  const test = h('button', {
    type: 'button', class: 'ed-b primary',
    onclick: async () => {
      const token = input.value.trim();
      if (!token) { result.textContent = 'Önce anahtarı yapıştır.'; result.className = 'ed-result bad'; return; }
      writeSettings({ token });
      result.textContent = '⏳ Kontrol ediliyor…';
      result.className = 'ed-result';
      try {
        const info = await S.gh.checkAccess();
        if (!info.push) throw Object.assign(new Error('no push'), { status: 403 });
        result.textContent = `✓ Harika! ${info.fullName} deposuna kaydetmeye hazırsın.`;
        result.className = 'ed-result good';
        await syncFromGitHub(true);
        refreshStatus();
        if (onDone) onDone();
      } catch (e) {
        result.textContent = explain(e);
        result.className = 'ed-result bad';
      }
    },
  }, 'Kaydet ve test et');
  return h('div', { class: 'ed-tokenbox' },
    field('GitHub anahtarı (token)', h('div', { class: 'ed-row' }, input, show)),
    h('div', { class: 'ed-row' }, test),
    result);
}

function openKeyModal() {
  if ($('.ed-key-modal')) return;
  const m = modal({
    title: '🔑 Kaydetmek için anahtar gerekli',
    body: [tokenSteps(), tokenBox(() => setTimeout(() => { m.close(); if (isDirty()) save(); }, 900))],
    actions: [h('button', { type: 'button', class: 'ed-b', onclick: () => m.close() }, 'Şimdilik kapat')],
  });
  m.box.classList.add('ed-key-modal');
}

function openHelp() {
  const m = modal({
    title: '💌 Düzenleme modu nasıl kullanılır?',
    body: helpBody(),
    actions: [h('button', { type: 'button', class: 'ed-b primary', onclick: () => m.close() }, 'Anladım')],
  });
}

function openWelcome() {
  const m = modal({
    title: '💌 Düzenleme moduna hoş geldin!',
    body: [
      h('p', {}, 'Burada sitedeki bütün yazıları değiştirebilir, fotoğraflarınızı ekleyip kırpabilirsin. Sevgilin bu düzenleme kısmını görmez; sadece sonucu görür.'),
      h('h4', { class: 'ed-h4' }, 'Önce bir kereye mahsus kurulum'),
      tokenSteps(),
      tokenBox(() => setTimeout(() => m.close(), 1200)),
    ],
    actions: [h('button', { type: 'button', class: 'ed-b', onclick: () => m.close() }, 'Şimdilik anahtarsız bak')],
  });
}

function openDateModal() {
  const v = String(app.getPath(app.content, 'site.since') || '').slice(0, 16);
  const input = h('input', { class: 'ed-input', type: 'datetime-local', value: v });
  input.addEventListener('input', () => {
    if (!input.value) return;
    app.setPath(app.content, 'site.since', input.value);
    markDirty();
    scheduleTextSave();
  });
  const m = modal({
    title: '📅 Birlikteliğimizin başladığı an',
    body: [
      field('Tarih ve saat', input, 'Sayaç bu andan itibaren geçen zamanı gösterir. Saati bilmiyorsan 00:00 bırakabilirsin.'),
    ],
    actions: [h('button', { type: 'button', class: 'ed-b primary', onclick: () => m.close() }, 'Tamam')],
  });
}

async function pickMusic(onChange) {
  const file = await chooseFile('audio/*,.mp3,.m4a');
  if (!file) return;
  if (file.size > CONFIG.maxMusicMB * 1024 * 1024) {
    app.toast(`Şarkı dosyası çok büyük (en fazla ${CONFIG.maxMusicMB} MB olmalı).`, { error: true, ms: 6000 });
    return;
  }
  const extMatch = file.name.match(/\.(mp3|m4a|aac|ogg|oga|wav)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'mp3';
  const name = `${CONFIG.musicDir}/${stamp()}.${ext}`;
  S.pending.set(name, file);
  app.setPhotoOverride(name, URL.createObjectURL(file));
  const music = app.content.site.music || (app.content.site.music = { src: '', title: '' });
  music.src = name;
  if (!music.title || music.title === 'Bizim Şarkımız') music.title = file.name.replace(/\.[^.]+$/, '');
  app.rerender();
  markDirty();
  if (onChange) onChange();
  if (S.settings.token) save('🎵 Şarkımız eklendi');
  else openKeyModal();
}

function openSettings(focus) {
  const c = app.content;
  const since = h('input', { class: 'ed-input', type: 'datetime-local', value: String(c.site.since || '').slice(0, 16) });
  since.addEventListener('input', () => { if (since.value) { app.setPath(c, 'site.since', since.value); markDirty(); } });

  const musicInfo = h('p', { class: 'ed-note' });
  const updateMusicInfo = () => {
    const src = c.site.music && c.site.music.src;
    musicInfo.textContent = src ? `🎵 Şu an: ${c.site.music.title || src}` : 'Henüz şarkı eklenmedi. Zarf açılınca çalacak bir şarkı ekleyebilirsin.';
  };
  updateMusicInfo();

  const noTexts = h('textarea', { class: 'ed-input', rows: '6' });
  noTexts.value = (c.finale.noTexts || []).join('\n');
  noTexts.addEventListener('input', () => {
    c.finale.noTexts = noTexts.value.split('\n').map((t) => t.trim()).filter(Boolean);
    markDirty();
  });

  const chapterFields = app.CHAPTERS.map((ch, i) => h('div', { class: 'ed-chapter-row' },
    h('span', { class: 'ed-chapter-num' }, app.ROMAN[i]),
    h('div', { class: 'ed-chapter-inputs' },
      boundInput(`${ch.key}.title`, { placeholder: 'Bölüm adı' }),
      boundInput(`${ch.key}.desc`, { placeholder: 'Kısa açıklama' }))));

  const adv = h('details', { class: 'ed-adv' },
    h('summary', {}, 'Gelişmiş (depo bilgileri)'),
    (() => {
      const owner = h('input', { class: 'ed-input', value: S.settings.owner });
      const repo = h('input', { class: 'ed-input', value: S.settings.repo });
      const branch = h('input', { class: 'ed-input', value: S.settings.branch });
      const saveBtn = h('button', {
        type: 'button', class: 'ed-b',
        onclick: () => { writeSettings({ owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim() }, { overrides: true }); app.toast('Depo bilgileri güncellendi'); },
      }, 'Depo bilgilerini kaydet');
      return h('div', {}, field('Kullanıcı adı', owner), field('Depo adı', repo), field('Dal (branch)', branch), saveBtn);
    })());

  const sections = {
    general: h('section', { class: 'ed-section' },
      h('h4', {}, '💞 Genel'),
      field('Sekmede görünen başlık', boundInput('site.title')),
      field('Birlikteliğimizin başladığı an', since, 'Ana sayfadaki sayaç bu andan itibaren sayar.'),
      field('WhatsApp numaran (isteğe bağlı)', boundInput('site.whatsapp', { type: 'tel', placeholder: '905xxxxxxxxx' }),
        'Sevgilin bir aşk kuponunu kullanınca mesaj doğrudan sana gelsin diye. Ülke koduyla, + olmadan yaz (ör. 905321234567).')),
    music: h('section', { class: 'ed-section' },
      h('h4', {}, '🎵 Şarkımız'),
      musicInfo,
      h('div', { class: 'ed-row' },
        h('button', { type: 'button', class: 'ed-b primary', onclick: () => pickMusic(updateMusicInfo) }, '🎵 Şarkı seç (MP3)'),
        h('button', {
          type: 'button', class: 'ed-b danger',
          onclick: () => { if (c.site.music) c.site.music.src = ''; app.rerender(); markDirty(); updateMusicInfo(); },
        }, 'Şarkıyı kaldır')),
      field('Şarkının adı', boundInput('site.music.title')),
      h('p', { class: 'ed-note' }, `Zarf açıldığında çalmaya başlar. Dosya en fazla ${CONFIG.maxMusicMB} MB olabilir.`)),
    chapters: h('section', { class: 'ed-section' },
      h('h4', {}, '📖 Bölüm adları'),
      h('p', { class: 'ed-note' }, 'Menüde ve sayfa geçişlerindeki kalpli kartta görünen adlar.'),
      chapterFields),
    game: h('section', { class: 'ed-section' },
      h('h4', {}, '🏃 Kaçan “Hayır” butonu'),
      field('Hayır butonu kaçarken yazanlar (her satıra bir tane)', noTexts),
      field('Buton tamamen kaybolunca çıkan yazı', boundInput('finale.noGone'))),
    github: h('section', { class: 'ed-section' },
      h('h4', {}, '🔑 GitHub bağlantısı'),
      tokenBox(),
      h('p', {}, h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener', class: 'ed-link' }, 'Yeni anahtar oluştur ↗'), ' · ',
        h('button', { type: 'button', class: 'ed-linkbtn', onclick: openHelp }, 'Adım adım anlatım')),
      adv,
      h('button', {
        type: 'button', class: 'ed-b danger',
        onclick: () => { writeSettings({ token: '' }); refreshStatus(); app.toast('Anahtar bu cihazdan silindi'); },
      }, 'Anahtarı bu cihazdan sil')),
  };

  const m = modal({
    title: '⚙️ Ayarlar',
    wide: true,
    body: Object.values(sections),
    actions: [h('button', { type: 'button', class: 'ed-b primary', onclick: () => m.close() }, 'Tamam')],
    onClose: () => { app.rerender(); refreshStatus(); },
  });
  if (focus && sections[focus]) setTimeout(() => sections[focus].scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
}

/* ------------------------------------------------------------------ */
/* Alt araç çubuğu                                                     */
/* ------------------------------------------------------------------ */
function buildBar() {
  const btn = (icon, label, action, cls = '') => h('button', { type: 'button', class: `ed-btn ${cls}`, 'data-ed': action },
    h('span', { class: 'ic', 'aria-hidden': 'true' }, icon), h('span', { class: 'lb' }, label));
  const bar = h('div', { class: 'ed-ui ed-bar', 'data-state': 'saved', role: 'toolbar', 'aria-label': 'Düzenleme araçları' },
    h('div', { class: 'ed-status' }, h('span', { class: 'ed-dot' }), h('span', { class: 'ed-status-text' }, 'Düzenleme modu')),
    btn('⚙️', 'Ayarlar', 'settings'),
    btn('❓', 'Yardım', 'help'),
    btn('👁', 'Önizle', 'preview', 'ed-preview-btn'),
    btn('💾', 'Kaydet', 'save', 'ed-primary'));
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ed]');
    if (!b) return;
    const a = b.dataset.ed;
    if (a === 'settings') openSettings();
    if (a === 'help') openHelp();
    if (a === 'save') save();
    if (a === 'preview') togglePreview(b);
  });
  $('.ed-status', bar).addEventListener('click', () => {
    if (bar.dataset.state === 'nokey') openKeyModal();
    else if (bar.dataset.state === 'error' && S.lastError) app.toast(S.lastError, { error: true, ms: 8000 });
  });
  document.body.append(bar);
}

function togglePreview(btn) {
  S.preview = !S.preview;
  document.body.classList.toggle('ed-previewing', S.preview);
  $('.ic', btn).textContent = S.preview ? '✏️' : '👁';
  $('.lb', btn).textContent = S.preview ? 'Düzenle' : 'Önizle';
  app.setEditing(!S.preview);
  app.toast(S.preview ? 'Önizleme: sevgilinin göreceği hâli bu 💕' : 'Düzenlemeye geri döndün ✏️');
}

/* ------------------------------------------------------------------ */
/* Başlangıç                                                           */
/* ------------------------------------------------------------------ */
async function syncFromGitHub(silent) {
  try {
    const text = await S.gh.readContent();
    const latest = JSON.parse(text);
    const dirtyNow = S.baseline && isDirty();
    if (!dirtyNow && serialize(latest) !== serialize(app.content)) {
      app.setContent(latest);
      app.rerender();
    }
    if (!dirtyNow) S.baseline = serialize(latest);
    collectMedia(latest, S.known);
    return true;
  } catch (e) {
    if (!silent) console.warn('İçerik GitHub’dan okunamadı, sitedeki kopya kullanılıyor.', e);
    return false;
  }
}

export async function startEditor(appApi) {
  app = appApi;
  S.settings = readSettings();
  applySettings();
  const link = h('link', { rel: 'stylesheet', href: 'css/editor.css' });
  document.head.append(link);
  await new Promise((r) => { link.onload = r; link.onerror = r; setTimeout(r, 1500); });

  S.baseline = serialize(app.content);
  collectMedia(app.content, S.known);
  buildBar();
  document.addEventListener('app:render', decorate);
  decorate();
  refreshStatus();
  loadCropper().catch(() => {});

  await syncFromGitHub();
  refreshStatus();

  window.addEventListener('beforeunload', (e) => {
    if (isDirty() || S.saving) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isDirty() && S.settings.token && !S.saving) save('✏️ Yazılar güncellendi', { quiet: true });
  });

  if (!S.settings.token) openWelcome();
  else app.toast('Düzenleme modu açık ✏️ Yazılara dokunarak değiştirebilirsin.');
}
