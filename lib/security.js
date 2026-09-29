// Şifre özeti, imzalı oturum çerezleri ve basit hız sınırlama
import { scrypt as scryptCb, randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

export const randomHex = (bytes = 32) => randomBytes(bytes).toString('hex');
export const sha256 = (text) => createHash('sha256').update(String(text)).digest('hex');

export async function hashPassword(password, salt = randomHex(16)) {
  const key = await scrypt(String(password).normalize('NFC'), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt, hash: key.toString('hex') };
}

export async function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const { hash } = await hashPassword(password, record.salt);
  return safeEqual(hash, record.hash);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ------------------------------------------------------------------ */
/* İmzalı belirteçler                                                  */
/* ------------------------------------------------------------------ */
export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Çerezler                                                            */
/* ------------------------------------------------------------------ */
export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function makeCookie(name, value, { maxAgeSec, secure = true }) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

/* ------------------------------------------------------------------ */
/* Hız sınırı (sunucu örneği başına, bellekte)                         */
/* ------------------------------------------------------------------ */
const buckets = new Map();

export function allow(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  }
  return b.count <= limit;
}

/* ------------------------------------------------------------------ */
/* Kilit cevaplarını karşılaştırmak için sadeleştirme                  */
/* ------------------------------------------------------------------ */
const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

export function normalizeAnswer(text) {
  return String(text || '')
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => TR_MAP[ch] || ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
