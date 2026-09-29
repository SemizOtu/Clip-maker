// GET /api/media?p=medya/… → fotoğrafı ya da şarkıyı gösterir (kilit açıksa izin kontrol edilir)
import { route } from '../lib/http.js';
import { loadContent } from '../lib/content.js';
import { canView } from '../lib/session.js';
import { openMedia, MEDIA_RE } from '../lib/store.js';

const text = (status, body) => new Response(body, {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
});

const handlers = route({
  async GET(request) {
    const p = new URL(request.url).searchParams.get('p') || '';
    if (!MEDIA_RE.test(p)) return text(404, 'Bulunamadı');

    const { value } = await loadContent();
    if (!(await canView(request, value))) return text(403, 'Bu içerik kilitli');

    const range = request.headers.get('range');
    const media = await openMedia(p, { range });
    if (!media) return text(404, 'Bulunamadı');
    if (media.invalidRange) {
      return new Response(null, {
        status: 416,
        headers: media.size != null ? { 'Content-Range': `bytes */${media.size}` } : {},
      });
    }

    const headers = {
      'Content-Type': media.contentType,
      // Dosya adları her yüklemede benzersiz olduğu için tarayıcı uzun süre saklayabilir
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    };
    if (media.length) headers['Content-Length'] = media.length;
    if (media.contentRange) headers['Content-Range'] = media.contentRange;
    if (media.etag) headers.ETag = media.etag;
    return new Response(media.stream, { status: media.status, headers });
  },
});

export const GET = handlers.GET;
