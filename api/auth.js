// GET  /api/auth  → şifre belirlenmiş mi, oturum açık mı
// POST /api/auth  → { action: 'setup' | 'login' | 'logout' | 'change' }
import { json, readJsonBody, assertSameOrigin, clientIp, route } from '../lib/http.js';
import {
  authDoc, saveAuth, adminCookie, clearAdminCookie, isAdmin, envPassword, passwordVersion,
} from '../lib/session.js';
import { hashPassword, verifyPassword, safeEqual, randomHex, allow } from '../lib/security.js';
import { isLocal, ConflictError } from '../lib/store.js';

const MIN_LEN = 6;
const WINDOW = 15 * 60_000;

function checkNew(password) {
  if (typeof password !== 'string' || password.length < MIN_LEN) {
    return `Şifre en az ${MIN_LEN} karakter olmalı.`;
  }
  if (password.length > 200) return 'Şifre çok uzun.';
  return null;
}

async function passwordMatches(value, password) {
  if (typeof password !== 'string' || !password) return false;
  const env = envPassword();
  if (env && safeEqual(password, env)) return true;
  return verifyPassword(password, value.password);
}

const handlers = route({
  async GET(request) {
    const { value } = await authDoc();
    return json({
      setup: Boolean(passwordVersion(value)),
      admin: await isAdmin(request),
      local: isLocal,
    });
  },

  async POST(request) {
    assertSameOrigin(request);
    const body = await readJsonBody(request, 4_000);
    const ip = clientIp(request);

    if (body.action === 'logout') {
      return json({ ok: true }, 200, { 'Set-Cookie': clearAdminCookie() });
    }

    if (!allow(`auth:${ip}`, 12, WINDOW) || !allow('auth:*', 120, WINDOW)) {
      return json({ error: 'Çok fazla deneme yapıldı. 15 dakika sonra tekrar dene.' }, 429);
    }

    if (body.action === 'setup') {
      const doc = await authDoc({ fresh: true });
      if (passwordVersion(doc.value)) {
        return json({ error: 'Şifre zaten belirlenmiş. Giriş yapmayı dene.' }, 409);
      }
      const problem = checkNew(body.password);
      if (problem) return json({ error: problem }, 400);
      const value = {
        ...doc.value,
        password: { ...(await hashPassword(body.password)), version: randomHex(8), setAt: new Date().toISOString() },
      };
      try {
        await saveAuth(value, doc.etag);
      } catch (e) {
        if (e instanceof ConflictError) return json({ error: 'Şifre az önce başka bir yerden belirlendi.' }, 409);
        throw e;
      }
      return json({ ok: true }, 200, { 'Set-Cookie': adminCookie(value) });
    }

    if (body.action === 'login') {
      const doc = await authDoc({ fresh: true });
      if (!passwordVersion(doc.value)) return json({ error: 'Henüz bir şifre belirlenmemiş.', needsSetup: true }, 409);
      if (!(await passwordMatches(doc.value, body.password))) {
        return json({ error: 'Şifre yanlış. Bir daha dener misin?' }, 401);
      }
      return json({ ok: true }, 200, { 'Set-Cookie': adminCookie(doc.value) });
    }

    if (body.action === 'change') {
      if (!(await isAdmin(request))) return json({ error: 'Önce giriş yapmalısın.' }, 401);
      const doc = await authDoc({ fresh: true });
      if (!(await passwordMatches(doc.value, body.password))) {
        return json({ error: 'Mevcut şifre yanlış.' }, 401);
      }
      const problem = checkNew(body.newPassword);
      if (problem) return json({ error: problem }, 400);
      const value = {
        ...doc.value,
        password: { ...(await hashPassword(body.newPassword)), version: randomHex(8), setAt: new Date().toISOString() },
      };
      try {
        await saveAuth(value, doc.etag);
      } catch (e) {
        if (e instanceof ConflictError) return json({ error: 'Şifre az önce başka bir yerden değişti; tekrar dene.' }, 409);
        throw e;
      }
      return json({ ok: true }, 200, { 'Set-Cookie': adminCookie(value) });
    }

    return json({ error: 'Bilinmeyen işlem.' }, 400);
  },
});

export const GET = handlers.GET;
export const POST = handlers.POST;
