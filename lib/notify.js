// Sena sitede bir şey yaptığında Deniz'in telefonuna anında haber verir:
//  • WhatsApp: CallMeBot'un ücretsiz API'si; yalnızca kendi numarana mesaj atabilir
//    (https://www.callmebot.com/blog/free-api-whatsapp-messages/)
//  • ntfy: ücretsiz bildirim uygulaması; hesap gerekmez, tahmin edilemeyecek bir
//    "konu" adına abone olunur (https://ntfy.sh)
// Adresler sadece yerel testlerde sahte bir sunucuya yönlendirmek için değiştirilebilir.
const WA_URL = process.env.CALLMEBOT_URL || 'https://api.callmebot.com/whatsapp.php';
const NTFY_URL = process.env.NTFY_URL || 'https://ntfy.sh/';
const TIMEOUT_MS = 6500;
const MAX_TEXT = 700;

export const TOPIC_RE = /^[A-Za-z0-9_-]{8,64}$/;

const ICONS = { not: '💌', hayal: '💭', kupon: '🎟️', mektup: '✉️', evet: '💍', sinav: '📝', kazi: '🎁', gizli: '🤫' };
const LABELS = { whatsapp: 'WhatsApp', ntfy: 'ntfy' };

// "0532 123 45 67", "+90 532…", "90532…", "532…" → "+905321234567"
export function normalizePhone(raw) {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) {
    if (s.length === 11 && s.startsWith('0')) s = `+90${s.slice(1)}`;
    else if (s.length === 10 && s.startsWith('5')) s = `+90${s}`;
    else s = `+${s}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : '';
}

// Ayarlarda tamamlanmış kanallar
export function notifyTargets(content) {
  const n = (content && content.secret && content.secret.notify) || {};
  const out = [];
  const phone = normalizePhone(n.waPhone);
  const apikey = String(n.waKey || '').trim();
  if (phone && apikey) out.push({ kind: 'whatsapp', phone, apikey });
  const topic = String(n.ntfyTopic || '').trim();
  if (TOPIC_RE.test(topic)) out.push({ kind: 'ntfy', topic });
  return out;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// { head: tek satırlık özet, body: varsa Sena'nın yazdığı }
export function composeMessage(entry, content) {
  const you = String((content && content.names && content.names.you) || 'Sena');
  const title = String(entry.title || '').trim();
  const text = clip(String(entry.text || '').trim(), MAX_TEXT);
  const icon = ICONS[entry.type] || '💌';
  let head;
  let body = '';
  if (entry.type === 'not') {
    head = `${icon} ${you} sana bir not bıraktı`;
    body = text ? `“${text}”` : '';
  } else if (entry.type === 'hayal') {
    head = `${icon} ${you} hayal listenize yeni bir hayal ekledi`;
    body = text ? `“${text}”` : '';
  } else if (entry.type === 'kupon') {
    head = `${icon} ${you} bir aşk kuponu kullandı: ${title}`;
    body = text;
  } else {
    head = `${icon} ${you}: ${title || 'sitede bir şey yaptı'}`;
  }
  if (entry.test) head = `🧪 Deneme · ${head}`;
  return { head, body };
}

async function withTimeout(kind, fn) {
  try {
    return await fn(AbortSignal.timeout(TIMEOUT_MS));
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new Error(`${LABELS[kind]} zamanında yanıt vermedi.`);
    if (e instanceof TypeError) throw new Error(`${LABELS[kind]} sunucusuna ulaşılamadı.`);
    throw e;
  }
}

function waError(status, code) {
  if (/api\s*key/i.test(status)) return 'API anahtarı geçersiz. CallMeBot’un WhatsApp’tan gönderdiği anahtarı kontrol et.';
  if (/phone|number/i.test(status)) return `Telefon numarası kabul edilmedi (${status}). Ülke koduyla yaz, ör. +90 532 123 45 67.`;
  return `WhatsApp mesajı gönderilemedi (${status || `HTTP ${code}`}).`;
}

function sendWhatsApp(t, message) {
  return withTimeout('whatsapp', async (signal) => {
    const qs = [
      `phone=${encodeURIComponent(t.phone)}`,
      `text=${encodeURIComponent(message)}`,
      `apikey=${encodeURIComponent(t.apikey)}`,
    ].join('&');
    const res = await fetch(`${WA_URL}?${qs}`, { signal });
    const html = await res.text();
    // Yanıt: "<p>Message to: …<p>Text to send: …<p>durum". Hata satırı kırmızıdır (HTTP 203).
    const status = html.split(/<p\b[^>]*>/i).pop().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    const failed = !res.ok
      || /color\s*:\s*red/i.test(html)
      || /\binvalid\b|not\s+(?:valid|activated|allowed)|\bbanned\b|\bblocked\b/i.test(status);
    if (failed) throw new Error(waError(status, res.status));
  });
}

function sendNtfy(t, { title, message }, click) {
  return withTimeout('ntfy', async (signal) => {
    const res = await fetch(NTFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: t.topic, title, message, click, priority: 4 }),
      signal,
    });
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error || ''; } catch { /* yanıt boş */ }
      throw new Error(`ntfy bildirimi gönderilemedi (${msg || `HTTP ${res.status}`}).`);
    }
  });
}

function sendTo(t, { head, body }, content, origin) {
  if (t.kind === 'whatsapp') return sendWhatsApp(t, body ? `${head}\n\n${body}` : head);
  const names = (content && content.names) || {};
  const pair = `${names.me || 'Deniz'} & ${names.you || 'Sena'}`;
  return sendNtfy(t, body ? { title: head, message: body } : { title: `💌 ${pair}`, message: head }, `${origin}/duzenle`);
}

// Ayarlı bütün kanallara gönderir. count: başarıyla gidenlerin sayısı
export async function notifyDeniz(content, entry, origin) {
  const targets = notifyTargets(content);
  if (!targets.length) return { count: 0, results: [] };
  const msg = composeMessage(entry, content);
  const settled = await Promise.allSettled(targets.map((t) => sendTo(t, msg, content, origin)));
  const results = settled.map((r, i) => ({
    kind: targets[i].kind,
    ok: r.status === 'fulfilled',
    error: r.status === 'rejected' ? String((r.reason && r.reason.message) || r.reason) : null,
  }));
  for (const r of results) if (!r.ok) console.error(`[bildirim:${r.kind}] ${r.error}`);
  return { count: results.filter((r) => r.ok).length, results };
}

// Ayarlar'daki "Deneme gönder" düğmesi
export function sendTest(target, content, origin) {
  const you = (content && content.names && content.names.you) || 'Sena';
  return sendTo(target, {
    head: '🧪 Deneme bildirimi',
    body: `Her şey hazır! ${you} bir not bıraktığında, hayal eklediğinde ya da bir kupon kullandığında sana burada haber vereceğim 💌`,
  }, content, origin);
}
