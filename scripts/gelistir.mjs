// Bilgisayarda denemek için: `npm run dev` → http://localhost:5173
// public/ klasörünü sunar, /api/* isteklerini api/ klasöründeki fonksiyonlara yönlendirir.
// Fotoğraflar ve içerik Vercel Blob yerine .yerel-depo/ klasörüne kaydedilir.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 5173);
process.env.YEREL_DEPO ||= path.join(ROOT, '.yerel-depo');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

const vercelConfig = JSON.parse(await fs.readFile(path.join(ROOT, 'vercel.json'), 'utf8'));
const globalHeaders = (vercelConfig.headers || []).find((h) => h.source === '/(.*)')?.headers || [];

async function handleApi(req, res, url) {
  const name = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  if (!/^[a-z-]+$/.test(name)) return send(res, 404, 'Bulunamadı');
  const file = path.join(ROOT, 'api', `${name}.js`);
  let mod;
  try {
    mod = await import(`${pathToFileURL(file).href}?t=${(await fs.stat(file)).mtimeMs}`);
  } catch {
    return send(res, 404, 'Bulunamadı');
  }
  const fn = mod[req.method];
  if (typeof fn !== 'function') return send(res, 405, 'İzin verilmeyen yöntem');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
  const response = await fn(request);
  const out = {};
  response.headers.forEach((v, k) => { out[k] = v; });
  res.writeHead(response.status, out);
  if (response.body) {
    for await (const chunk of response.body) res.write(chunk);
  }
  res.end();
}

function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

async function handleStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '/duzenle') rel = '/index.html';
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Yasak');
  try {
    const data = await fs.readFile(file);
    const headers = { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    for (const h of globalHeaders) headers[h.key] = h.value;
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    send(res, 404, 'Bulunamadı');
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await handleStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, 'Sunucu hatası');
    else res.end();
  }
}).listen(PORT, () => {
  console.log(`\n  💌 Site hazır:        http://localhost:${PORT}`);
  console.log(`  ✏️  Düzenleme modu:    http://localhost:${PORT}/duzenle`);
  console.log(`  📁 Yerel depo:        ${process.env.YEREL_DEPO}\n`);
});
