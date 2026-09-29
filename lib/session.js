// Düzenleme şifresi, oturum çerezi ve (açıksa) ziyaretçi kilidi
import { readJson, writeJson, isLocal, ConflictError } from './store.js';
import { randomHex, signToken, verifyToken, readCookie, makeCookie } from './security.js';
import { isLockActive, lockKey } from './content.js';

export const AUTH_PATH = 'ozel/giris.json';
const ADMIN_COOKIE = 'ds_oturum';
const VIEW_COOKIE = 'ds_misafir';
const ADMIN_DAYS = 30;
const VIEW_DAYS = 365;
const DAY_MS = 86_400_000;

let memo = null;

// { key, password: { salt, hash, version } | null }
export async function authDoc({ fresh = false } = {}) {
  // Bellekteki kopya 1 dk geçerli (canlıda her istekte Blob'a gitmemek için)
  if (!fresh && !isLocal && memo && Date.now() - memo.at < 60_000) return memo;
  let doc = await readJson(AUTH_PATH);
  if (!doc) {
    const value = { key: randomHex(32), password: null, createdAt: new Date().toISOString() };
    try {
      const res = await writeJson(AUTH_PATH, value, { create: true });
      doc = { value, etag: res.etag };
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      doc = await readJson(AUTH_PATH);
    }
  }
  memo = { value: doc.value, etag: doc.etag, at: Date.now() };
  return memo;
}

export async function saveAuth(value, etag) {
  const res = await writeJson(AUTH_PATH, value, { etag });
  memo = { value, etag: res.etag, at: Date.now() };
  return res;
}

export const envPassword = () => process.env.DUZENLEME_SIFRESI || '';

export function passwordVersion(value) {
  if (value.password && value.password.version) return value.password.version;
  return envPassword() ? 'ortam' : null;
}

export function adminCookie(value) {
  const token = signToken({ t: 'yonetici', v: passwordVersion(value), exp: Date.now() + ADMIN_DAYS * DAY_MS }, value.key);
  return makeCookie(ADMIN_COOKIE, token, { maxAgeSec: ADMIN_DAYS * 86_400, secure: !isLocal });
}

export const clearAdminCookie = () => makeCookie(ADMIN_COOKIE, '', { maxAgeSec: 0, secure: !isLocal });

export async function isAdmin(request) {
  const token = readCookie(request, ADMIN_COOKIE);
  if (!token) return false;
  const { value } = await authDoc();
  const payload = verifyToken(token, value.key);
  const version = passwordVersion(value);
  return Boolean(payload && payload.t === 'yonetici' && version && payload.v === version);
}

export async function viewerCookie(content) {
  const { value } = await authDoc();
  const token = signToken({ t: 'misafir', k: lockKey(content), exp: Date.now() + VIEW_DAYS * DAY_MS }, value.key);
  return makeCookie(VIEW_COOKIE, token, { maxAgeSec: VIEW_DAYS * 86_400, secure: !isLocal });
}

// Kilit kapalıysa herkes görebilir; açıksa doğru cevabı veren ya da Deniz
export async function canView(request, content) {
  if (!isLockActive(content)) return true;
  const token = readCookie(request, VIEW_COOKIE);
  if (token) {
    const { value } = await authDoc();
    const payload = verifyToken(token, value.key);
    if (payload && payload.t === 'misafir' && payload.k === lockKey(content)) return true;
  }
  return isAdmin(request);
}
