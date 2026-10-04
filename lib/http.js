// API yanıtları için küçük yardımcılar

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export async function readJsonBody(request, maxBytes = 20_000) {
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) throw new HttpError(413, 'Gönderilen veri çok büyük.');
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('nesne değil');
    return data;
  } catch {
    throw new HttpError(400, 'Geçersiz veri.');
  }
}

// Durum değiştiren isteklerin bu sitenin kendisinden geldiğini doğrular (CSRF koruması)
export function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  let ok = false;
  try { ok = new URL(origin).host === host; } catch { ok = false; }
  if (!ok) throw new HttpError(403, 'Bu istek kabul edilmedi.');
}

// Sitenin adresi (bildirimdeki "Gelen kutusunu aç" bağlantısı için)
export function originOf(request) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return new URL(request.url).origin;
  const proto = request.headers.get('x-forwarded-proto') || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https');
  return `${proto.split(',')[0].trim()}://${host}`;
}

export function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'yerel';
}

// Her fonksiyonu hata yakalayıcıyla sarar; beklenmeyen hatalar kayda düşer
export function route(handlers) {
  const wrapped = {};
  for (const [method, fn] of Object.entries(handlers)) {
    wrapped[method] = async (request) => {
      try {
        return await fn(request);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error(`[${method} ${new URL(request.url).pathname}]`, err);
        return json({ error: 'Sunucuda bir sorun oluştu, biraz sonra tekrar dene.' }, 500);
      }
    };
  }
  return wrapped;
}
