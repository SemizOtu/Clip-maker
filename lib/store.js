// Depolama katmanı: canlıda Vercel Blob (özel mağaza), bilgisayarda denerken
// YEREL_DEPO ortam değişkeninin gösterdiği klasör kullanılır.
import { createHash } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { put, get, del, list, BlobPreconditionFailedError } from '@vercel/blob';

const LOCAL_DIR = process.env.YEREL_DEPO || '';
export const isLocal = Boolean(LOCAL_DIR);

export const MEDIA_RE = /^medya\/[A-Za-z0-9._-]{1,160}$/;

export class ConflictError extends Error {
  constructor() {
    super('Çakışma');
    this.conflict = true;
  }
}

const etagOf = (buf) => `"${createHash('sha1').update(buf).digest('hex')}"`;

function localPath(pathname) {
  const clean = String(pathname).replace(/\\/g, '/');
  if (!clean || clean.includes('..') || clean.startsWith('/')) throw new Error(`Geçersiz yol: ${pathname}`);
  return path.join(LOCAL_DIR, ...clean.split('/'));
}

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.wav': 'audio/wav', '.json': 'application/json',
};
export const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

/* ------------------------------------------------------------------ */
/* JSON belgeleri (içerik, giriş bilgisi, gelen kutusu)                */
/* ------------------------------------------------------------------ */
export async function readJson(pathname) {
  if (isLocal) {
    try {
      const buf = await fs.readFile(localPath(pathname));
      return { value: JSON.parse(buf.toString('utf8')), etag: etagOf(buf) };
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  // useCache:false → her zaman en güncel sürüm (yazdıktan hemen sonra okurken şart)
  const res = await get(pathname, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const text = await new Response(res.stream).text();
  return { value: JSON.parse(text), etag: res.blob.etag };
}

// etag verilirse sadece belge hâlâ o sürümdeyse yazar; create:true ise yalnızca yoksa oluşturur
export async function writeJson(pathname, value, { etag = null, create = false } = {}) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (isLocal) {
    const file = localPath(pathname);
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (etag || create) {
      let current = null;
      try { current = await fs.readFile(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (create && current) throw new ConflictError();
      if (etag && (!current || etagOf(current) !== etag)) throw new ConflictError();
    }
    await fs.writeFile(file, body);
    return { etag: etagOf(Buffer.from(body)) };
  }
  try {
    const res = await put(pathname, body, {
      access: 'private',
      contentType: 'application/json; charset=utf-8',
      addRandomSuffix: false,
      allowOverwrite: !create,
      cacheControlMaxAge: 60,
      ...(etag ? { ifMatch: etag } : {}),
    });
    return { etag: res.etag };
  } catch (e) {
    if (e instanceof BlobPreconditionFailedError || /already exists/i.test(String(e && e.message))) {
      throw new ConflictError();
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Fotoğraf ve şarkılar                                                */
/* ------------------------------------------------------------------ */
function parseRange(range, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(range || '').trim());
  if (!m) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start == null && end == null) return null;
  if (start == null) { start = Math.max(0, size - end); end = size - 1; }
  if (end == null || end >= size) end = size - 1;
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

// Medyayı akış olarak açar; range (bayt aralığı) desteği iOS'ta şarkı çalabilmek için gerekli
export async function openMedia(pathname, { range = null } = {}) {
  if (isLocal) {
    const file = localPath(pathname);
    let stat;
    try { stat = await fs.stat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const r = range ? parseRange(range, stat.size) : null;
    if (r === 'invalid') return { invalidRange: true, size: stat.size };
    const opts = r ? { start: r.start, end: r.end } : {};
    return {
      stream: Readable.toWeb(createReadStream(file, opts)),
      status: r ? 206 : 200,
      contentType: mimeOf(pathname),
      length: String(r ? r.end - r.start + 1 : stat.size),
      contentRange: r ? `bytes ${r.start}-${r.end}/${stat.size}` : null,
      etag: `"${stat.size}-${Math.round(stat.mtimeMs)}"`,
    };
  }
  let res;
  try {
    res = await get(pathname, { access: 'private', headers: range ? { range } : undefined });
  } catch (e) {
    if (range && /416/.test(String(e && e.message))) return { invalidRange: true };
    throw e;
  }
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const contentRange = res.headers.get('content-range');
  return {
    stream: res.stream,
    status: contentRange ? 206 : 200,
    contentType: res.blob.contentType || mimeOf(pathname),
    length: res.headers.get('content-length'),
    contentRange,
    etag: res.blob.etag,
  };
}

// Yüklenmiş bütün fotoğraf ve şarkılar (Hobby planda her çağrı 1 “gelişmiş işlem” sayılır)
export async function listMedia() {
  if (isLocal) {
    const dir = localPath('medya');
    let names = [];
    try { names = await fs.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const out = [];
    for (const name of names) {
      const st = await fs.stat(path.join(dir, name));
      if (st.isFile()) out.push({ pathname: `medya/${name}`, size: st.size, uploadedAt: st.mtime.toISOString() });
    }
    return out;
  }
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: 'medya/', limit: 1000, cursor });
    for (const b of page.blobs) {
      out.push({ pathname: b.pathname, size: b.size, uploadedAt: new Date(b.uploadedAt).toISOString() });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export async function removeFiles(pathnames) {
  const list = [...new Set(pathnames)].filter((p) => MEDIA_RE.test(p));
  if (!list.length) return;
  if (isLocal) {
    await Promise.all(list.map((p) => fs.rm(localPath(p), { force: true })));
    return;
  }
  await del(list);
}

// Sadece yerel geliştirme: tarayıcıdan gelen dosyayı klasöre yazar
export async function saveLocalFile(pathname, buffer) {
  if (!isLocal) throw new Error('Yalnızca yerel geliştirmede kullanılabilir');
  const file = localPath(pathname);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
}
