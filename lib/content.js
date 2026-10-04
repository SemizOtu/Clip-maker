// Site içeriğinin okunması, doğrulanması ve kaydedilmesi
import { DEFAULT_CONTENT } from './defaults.js';
import { readJson, writeJson, MEDIA_RE } from './store.js';
import { HttpError } from './http.js';
import { sha256, normalizeAnswer } from './security.js';

export const CONTENT_PATH = 'ozel/icerik.json';
const MAX_BYTES = 900_000;
const MAX_STRING = 20_000;
const CACHE_MS = 15_000;

const isPlain = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

// Eksik alanları varsayılanlardan tamamlar (listelere dokunmaz)
export function fillDefaults(value, defaults = DEFAULT_CONTENT) {
  const out = isPlain(value) ? value : {};
  for (const [k, def] of Object.entries(defaults)) {
    if (out[k] === undefined || out[k] === null) out[k] = clone(def);
    else if (isPlain(def) && isPlain(out[k])) fillDefaults(out[k], def);
  }
  return out;
}

let memo = null;
let inflight = null;

export async function loadContent({ fresh = false } = {}) {
  if (!fresh && memo && Date.now() - memo.at < CACHE_MS) return memo;
  if (!fresh && inflight) return inflight;
  const task = (async () => {
    const doc = await readJson(CONTENT_PATH);
    memo = doc
      ? { value: fillDefaults(doc.value), etag: doc.etag, at: Date.now() }
      : { value: clone(DEFAULT_CONTENT), etag: null, at: Date.now() };
    return memo;
  })();
  if (!fresh) inflight = task;
  try {
    return await task;
  } finally {
    if (!fresh) inflight = null;
  }
}

// etag varsa sadece belge hâlâ o sürümdeyse yazar; yoksa yalnızca ilk kez oluşturur.
// force:true → koşulsuz üzerine yazar.
export async function saveContent(value, { etag = null, force = false } = {}) {
  let opts = { create: true };
  if (force) opts = {};
  else if (etag) opts = { etag };
  const res = await writeJson(CONTENT_PATH, value, opts);
  memo = { value, etag: res.etag, at: Date.now() };
  return res;
}

export function mediaRefs(value, out = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('medya/')) out.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => mediaRefs(v, out));
  } else if (isPlain(value)) {
    Object.values(value).forEach((v) => mediaRefs(v, out));
  }
  return out;
}

// Ziyaretçiye gidecek hâl: gizli alanlar çıkarılır
export function publicView(value) {
  const out = clone(value);
  delete out.secret;
  // Eski sürümde kuponlar için tutulan WhatsApp numarası artık ziyaretçiye gitmez
  if (out.site) delete out.site.whatsapp;
  return out;
}

// Kilitliyken sadece kapak ve kilit ekranı için gerekenler gönderilir
export function lockedView(value) {
  const { names, intro, site } = value;
  return {
    names: clone(names),
    intro: clone(intro),
    site: {
      title: site.title,
      lock: { enabled: true, question: site.lock.question, hint: site.lock.hint, wrong: site.lock.wrong },
    },
  };
}

export function lockAnswers(value) {
  const list = (value.secret && Array.isArray(value.secret.lockAnswers)) ? value.secret.lockAnswers : [];
  return list.map(normalizeAnswer).filter(Boolean);
}

export function isLockActive(value) {
  return Boolean(value.site && value.site.lock && value.site.lock.enabled) && lockAnswers(value).length > 0;
}

// Kilit cevapları değişirse eski ziyaretçi çerezleri geçersiz olsun diye
export function lockKey(value) {
  return sha256(`kilit|${lockAnswers(value).sort().join('|')}`).slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Kaydedilen içeriğin doğrulanması                                    */
/* ------------------------------------------------------------------ */
function sanitize(value, pathLabel, depth = 0) {
  if (depth > 12) throw new HttpError(400, 'İçerik çok iç içe.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) throw new HttpError(400, `Bir yazı çok uzun (${pathLabel}).`);
    if (value.startsWith('medya/') && !MEDIA_RE.test(value)) throw new HttpError(400, 'Geçersiz dosya yolu.');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 400) throw new HttpError(400, 'Bir listede çok fazla öğe var.');
    return value.map((v, i) => sanitize(v, `${pathLabel}.${i}`, depth + 1));
  }
  if (isPlain(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = sanitize(v, pathLabel ? `${pathLabel}.${k}` : k, depth + 1);
    }
    return out;
  }
  return null;
}

export function validateContent(input) {
  if (!isPlain(input)) throw new HttpError(400, 'İçerik okunamadı.');
  const raw = JSON.stringify(input);
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new HttpError(413, 'İçerik çok büyük.');
  const clean = fillDefaults(sanitize(input, ''));
  clean.version = DEFAULT_CONTENT.version;
  const answers = Array.isArray(clean.secret.lockAnswers) ? clean.secret.lockAnswers : [];
  clean.secret.lockAnswers = answers.filter((a) => typeof a === 'string' && a.trim()).slice(0, 20).map((a) => a.trim().slice(0, 120));
  const n = isPlain(clean.secret.notify) ? clean.secret.notify : {};
  const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');
  clean.secret.notify = { waPhone: str(n.waPhone, 32), waKey: str(n.waKey, 64), ntfyTopic: str(n.ntfyTopic, 64) };
  return clean;
}
