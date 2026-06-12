"""URL/zaman/playlist çözümleme testleri (ağ gerektirmez)."""
import unittest
from datetime import timezone

from clipmaker.kick_api import (KickAPIError, normalize_duration,
                                parse_kick_time, parse_vod_url)
from clipmaker.media import parse_master_playlist, pick_analysis_source, pick_variant

UUID = "9f10b2c3-4d5e-6f70-8192-a3b4c5d6e7f8"


class TestParseVodUrl(unittest.TestCase):
    def test_channel_video_url(self):
        kind, val = parse_vod_url(f"https://kick.com/kanalim/videos/{UUID}")
        self.assertEqual((kind, val), ("video", UUID))

    def test_legacy_video_url(self):
        kind, val = parse_vod_url(f"https://kick.com/video/{UUID}")
        self.assertEqual((kind, val), ("video", UUID))

    def test_bare_uuid(self):
        kind, val = parse_vod_url(UUID.upper())
        self.assertEqual((kind, val), ("video", UUID))

    def test_channel_url(self):
        kind, val = parse_vod_url("https://kick.com/KanalIm/")
        self.assertEqual(kind, "channel")
        self.assertEqual(val, "kanalim")

    def test_url_with_query(self):
        kind, val = parse_vod_url(f"https://kick.com/abc/videos/{UUID}?t=123")
        self.assertEqual((kind, val), ("video", UUID))

    def test_invalid(self):
        with self.assertRaises(KickAPIError):
            parse_vod_url("https://twitch.tv/birisi")


class TestParseKickTime(unittest.TestCase):
    def test_iso_with_z(self):
        dt = parse_kick_time("2026-01-05T18:30:00.000000Z")
        self.assertEqual(dt.tzinfo, timezone.utc)
        self.assertEqual(dt.hour, 18)

    def test_plain_format(self):
        dt = parse_kick_time("2026-01-05 18:30:00")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.minute, 30)

    def test_iso_offset(self):
        dt = parse_kick_time("2026-01-05T20:30:00+02:00")
        self.assertEqual(dt.hour, 18)  # UTC'ye çevrilmiş

    def test_invalid(self):
        self.assertIsNone(parse_kick_time("bozuk"))
        self.assertIsNone(parse_kick_time(None))


class TestNormalizeDuration(unittest.TestCase):
    def test_milliseconds(self):
        self.assertAlmostEqual(normalize_duration(7_200_000), 7200.0)  # 2 saat

    def test_seconds_passthrough(self):
        self.assertAlmostEqual(normalize_duration(7200), 7200.0)

    def test_invalid(self):
        self.assertIsNone(normalize_duration(None))
        self.assertIsNone(normalize_duration("x"))
        self.assertIsNone(normalize_duration(0))


MASTER = """#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="audio",DEFAULT=YES,URI="160p30/audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,CODECS="avc1"
1080p60/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=640x360
360p30/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=284x160
160p30/playlist.m3u8
"""


class TestMasterPlaylist(unittest.TestCase):
    def setUp(self):
        self.base = "https://stream.kick.com/ivs/v1/x/y/2026/1/master.m3u8"
        self.pl = parse_master_playlist(MASTER, self.base)

    def test_variants_sorted(self):
        bws = [v["bandwidth"] for v in self.pl["variants"]]
        self.assertEqual(bws, sorted(bws))
        self.assertEqual(len(self.pl["variants"]), 3)

    def test_relative_urls_joined(self):
        self.assertTrue(self.pl["variants"][0]["url"].startswith("https://stream.kick.com/"))
        self.assertIn("160p30/playlist.m3u8", self.pl["variants"][0]["url"])

    def test_pick_best_worst(self):
        best = pick_variant(self.pl, "best", self.base)
        worst = pick_variant(self.pl, "worst", self.base)
        self.assertIn("1080p60", best)
        self.assertIn("160p30", worst)

    def test_analysis_prefers_audio(self):
        self.assertIn("audio.m3u8", pick_analysis_source(self.pl, self.base))

    def test_empty_playlist_falls_back_to_master(self):
        pl = parse_master_playlist("#EXTM3U\n", self.base)
        self.assertEqual(pick_variant(pl, "best", self.base), self.base)


if __name__ == "__main__":
    unittest.main()
