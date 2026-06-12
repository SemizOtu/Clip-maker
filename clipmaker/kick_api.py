"""Kick.com (resmi olmayan) API istemcisi.

Kick, Cloudflare arkasında çalışır; sıradan HTTP istemcileri 403 alır.
curl_cffi gerçek bir tarayıcının TLS parmak izini taklit ettiği için
buradaki herkese açık JSON uç noktalarına erişim sağlar.

Kullanılan uç noktalar (topluluk tarafından belgelenmiştir):
  GET /api/v1/channels/{slug}                      -> kanal bilgisi
  GET /api/v2/channels/{slug}/videos               -> geçmiş yayınlar (VOD listesi)
  GET /api/v1/video/{uuid}                         -> VOD bilgisi + m3u8 kaynağı
  GET /api/v2/channels/{id}/messages?start_time=.. -> VOD chat tekrarı
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterator, Optional

from curl_cffi import requests as cffi_requests

BASE_URL = "https://kick.com"
IMPERSONATE_TARGETS = ("chrome", "safari", "firefox", "edge")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

UUID_RE = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"

# kick.com/<slug> şeklinde olup kanal OLMAYAN yollar
_NON_CHANNEL_SLUGS = {"video", "videos", "api", "categories", "category", "browse", "search", "clips", "community-guidelines", "terms-of-service", "dashboard"}


class KickAPIError(RuntimeError):
    pass


@dataclass
class VodInfo:
    uuid: str
    title: str = ""
    source_url: Optional[str] = None          # HLS master playlist (m3u8)
    duration_s: Optional[float] = None
    started_at: Optional[datetime] = None     # yayının başlama anı (UTC) — chat eşlemesi için
    channel_slug: str = ""
    channel_id: Optional[int] = None
    thumbnail: Optional[str] = None
    views: Optional[int] = None


@dataclass
class ChatMessage:
    offset_s: float       # VOD başlangıcına göre saniye
    username: str
    content: str


def parse_vod_url(url: str) -> tuple[str, str]:
    """Bağlantıyı çöz: ("video", uuid) ya da ("channel", slug) döndürür."""
    u = (url or "").strip().rstrip("/")
    if re.fullmatch(UUID_RE, u):
        return ("video", u.lower())
    m = re.search(rf"kick\.com/video/({UUID_RE})", u)
    if m:
        return ("video", m.group(1).lower())
    m = re.search(rf"kick\.com/[^/?#]+/videos/({UUID_RE})", u)
    if m:
        return ("video", m.group(1).lower())
    m = re.search(r"kick\.com/([^/?#]+)", u)
    if m:
        slug = m.group(1).lower()
        if slug in _NON_CHANNEL_SLUGS:
            raise KickAPIError(f"Bu bağlantıdan kanal/VOD çözülemedi: {url}")
        return ("channel", slug)
    raise KickAPIError(
        f"Anlaşılamayan bağlantı: {url}\n"
        "Desteklenen biçimler: https://kick.com/KANAL, "
        "https://kick.com/KANAL/videos/UUID, https://kick.com/video/UUID"
    )


def parse_kick_time(value) -> Optional[datetime]:
    """Kick'in tarih biçimlerini UTC datetime'a çevirir."""
    if not value:
        return None
    s = str(value).strip().replace("Z", "+00:00")
    dt = None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                dt = datetime.strptime(s, fmt)
                break
            except ValueError:
                continue
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def normalize_duration(value) -> Optional[float]:
    """Kick, yayın süresini milisaniye olarak raporlar; saniyeye çevir.

    3 günden (259200 sn) büyük değerler kesin olarak milisaniyedir. Daha
    küçük değerler belirsiz kalabilir; pipeline bunu ffprobe ile doğrular.
    """
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v <= 0:
        return None
    if v > 259200:
        return v / 1000.0
    return v


class KickClient:
    def __init__(self, request_delay: float = 0.35):
        self.request_delay = request_delay
        self._session = None
        self._target_idx = 0

    # ---- düşük seviye ----

    def _new_session(self):
        target = IMPERSONATE_TARGETS[self._target_idx % len(IMPERSONATE_TARGETS)]
        self._target_idx += 1
        return cffi_requests.Session(impersonate=target, timeout=30)

    def _request(self, url: str, params: dict | None = None, max_attempts: int = 4):
        last_err: Exception | None = None
        for attempt in range(max_attempts):
            if self._session is None:
                self._session = self._new_session()
            try:
                r = self._session.get(url, params=params, headers={"Accept": "application/json"})
                if r.status_code == 200:
                    return r
                if r.status_code == 404:
                    raise KickAPIError(f"Bulunamadı (404): {url}")
                if r.status_code in (403, 429, 503):
                    # Cloudflare engeli ya da hız sınırı: tarayıcı profilini değiştirip bekle
                    last_err = KickAPIError(f"HTTP {r.status_code}: {url}")
                    self._session = None
                    time.sleep(1.5 * (attempt + 1))
                    continue
                r.raise_for_status()
            except KickAPIError:
                raise
            except Exception as e:  # ağ hatası, zaman aşımı vb.
                last_err = e
                self._session = None
                time.sleep(1.0 * (attempt + 1))
        raise KickAPIError(
            f"Kick API'sine ulaşılamadı: {url}\n"
            f"Son hata: {last_err}\n"
            "Olası nedenler:\n"
            "  - Cloudflare bu IP'yi engelliyor (sunucu/VPN IP'leri sık engellenir;"
            " ev internetinden deneyin)\n"
            "  - Ağ kısıtlaması: kick.com'a giden trafiğe izin verildiğinden emin olun\n"
            "Alternatif: klibi --m3u8 <kaynak-url> ile elle verebilirsiniz"
            " (tarayıcıda VOD açıkken ağ sekmesinden master.m3u8 adresini kopyalayın)."
        )

    def get_json(self, url: str, params: dict | None = None):
        r = self._request(url, params=params)
        try:
            return r.json()
        except Exception as e:
            raise KickAPIError(f"Geçersiz JSON yanıtı ({url}): {e}") from e

    def get_text(self, url: str) -> str:
        return self._request(url).text

    # ---- yüksek seviye ----

    def get_channel(self, slug: str) -> dict:
        return self.get_json(f"{BASE_URL}/api/v1/channels/{slug}")

    def get_video(self, uuid: str) -> VodInfo:
        data = self.get_json(f"{BASE_URL}/api/v1/video/{uuid}")
        ls = data.get("livestream") or {}
        ch = ls.get("channel") or data.get("channel") or {}
        started = parse_kick_time(
            ls.get("start_time") or ls.get("created_at") or data.get("created_at")
        )
        return VodInfo(
            uuid=str(data.get("uuid") or uuid),
            title=str(ls.get("session_title") or data.get("session_title") or "").strip(),
            source_url=data.get("source"),
            duration_s=normalize_duration(ls.get("duration") or data.get("duration")),
            started_at=started,
            channel_slug=str(ch.get("slug") or ""),
            channel_id=ch.get("id"),
            thumbnail=(ls.get("thumbnail") or {}).get("src")
            if isinstance(ls.get("thumbnail"), dict) else ls.get("thumbnail"),
            views=data.get("views"),
        )

    def list_videos(self, slug: str) -> list[VodInfo]:
        data = self.get_json(f"{BASE_URL}/api/v2/channels/{slug}/videos")
        items = data if isinstance(data, list) else (data.get("data") or [])
        vods: list[VodInfo] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            video = it.get("video") or {}
            uuid = video.get("uuid") or it.get("uuid")
            if not uuid:
                continue
            vods.append(VodInfo(
                uuid=str(uuid),
                title=str(it.get("session_title") or "").strip(),
                duration_s=normalize_duration(it.get("duration")),
                started_at=parse_kick_time(it.get("start_time") or it.get("created_at")),
                channel_slug=slug,
                channel_id=it.get("channel_id"),
                views=it.get("views"),
            ))
        return vods

    def resolve_vod(self, url: str, pick_index: int = 0) -> VodInfo:
        """Verilen bağlantıdan VOD bilgisini çıkarır (kanal linkiyse VOD seçer)."""
        kind, value = parse_vod_url(url)
        if kind == "video":
            vod = self.get_video(value)
        else:
            vods = self.list_videos(value)
            if not vods:
                raise KickAPIError(f"'{value}' kanalında kayıtlı VOD bulunamadı.")
            if pick_index >= len(vods):
                raise KickAPIError(
                    f"'{value}' kanalında {len(vods)} VOD var; --pick {pick_index} geçersiz."
                )
            vod = self.get_video(vods[pick_index].uuid)
        # Kanal kimliği eksikse kanal bilgisinden tamamla (chat için gerekli)
        if vod.channel_id is None and vod.channel_slug:
            try:
                ch = self.get_channel(vod.channel_slug)
                vod.channel_id = ch.get("id")
            except KickAPIError:
                pass
        return vod

    def fetch_chat(
        self,
        channel_id: int,
        started_at: datetime,
        duration_s: float,
        progress: Optional[Callable[[float, int], None]] = None,
        empty_step_s: float = 120.0,
    ) -> list[ChatMessage]:
        """VOD chat tekrarını baştan sona tarar.

        Uç nokta, verilen start_time'dan itibaren bir sayfa mesaj döndürür;
        imleci son mesajın zamanına taşıyarak ilerleriz. Boş aralıklarda
        empty_step_s kadar atlanır.
        """
        end_at = started_at + timedelta(seconds=duration_s)
        cursor = started_at
        seen: set = set()
        out: list[ChatMessage] = []
        requests_made = 0

        while cursor < end_at:
            data = self.get_json(
                f"{BASE_URL}/api/v2/channels/{channel_id}/messages",
                params={"start_time": cursor.strftime("%Y-%m-%d %H:%M:%S")},
            )
            msgs = self._extract_messages(data)
            requests_made += 1

            newest: Optional[datetime] = None
            for m in msgs:
                ts = parse_kick_time(m.get("created_at"))
                if ts is None:
                    continue
                if newest is None or ts > newest:
                    newest = ts
                mid = m.get("id") or (str(ts), str(m.get("content"))[:50])
                if mid in seen:
                    continue
                seen.add(mid)
                off = (ts - started_at).total_seconds()
                if off < 0 or off > duration_s + 30:
                    continue
                sender = m.get("sender") or {}
                out.append(ChatMessage(
                    offset_s=off,
                    username=str(sender.get("username") or ""),
                    content=str(m.get("content") or ""),
                ))

            if newest is None or newest <= cursor:
                cursor += timedelta(seconds=empty_step_s)
            else:
                cursor = newest + timedelta(seconds=1)

            if progress:
                done = min(1.0, (cursor - started_at).total_seconds() / max(duration_s, 1.0))
                progress(done, len(out))
            time.sleep(self.request_delay)

        out.sort(key=lambda m: m.offset_s)
        return out

    @staticmethod
    def _extract_messages(data) -> list[dict]:
        if isinstance(data, list):
            return [m for m in data if isinstance(m, dict)]
        if isinstance(data, dict):
            inner = data.get("data")
            if isinstance(inner, dict) and isinstance(inner.get("messages"), list):
                return [m for m in inner["messages"] if isinstance(m, dict)]
            if isinstance(inner, list):
                return [m for m in inner if isinstance(m, dict)]
            if isinstance(data.get("messages"), list):
                return [m for m in data["messages"] if isinstance(m, dict)]
        return []


def resolve_source_via_ytdlp(url: str) -> Optional[str]:
    """API başarısız olursa m3u8 kaynağını yt-dlp ile çözmeyi dener."""
    try:
        import yt_dlp  # type: ignore
    except ImportError:
        return None
    try:
        opts = {"quiet": True, "no_warnings": True, "skip_download": True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        if not info:
            return None
        if info.get("manifest_url"):
            return info["manifest_url"]
        if info.get("url") and ".m3u8" in str(info["url"]):
            return info["url"]
        for f in reversed(info.get("formats") or []):
            if f.get("manifest_url"):
                return f["manifest_url"]
            if f.get("url") and ".m3u8" in str(f.get("url")):
                return f["url"]
    except Exception:
        return None
    return None
