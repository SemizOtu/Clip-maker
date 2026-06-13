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


class TestSliceWav(unittest.TestCase):
    """Yerel WAV diliminin (transcription için) ağ/ffmpeg olmadan çalıştığını doğrula."""

    def test_slice_offset_and_length(self):
        import tempfile
        import wave
        from pathlib import Path

        from clipmaker.media import slice_wav

        sr = 16000
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "src.wav"
            # 10 sn: her örneğin değeri (frame_index % 1000) — konum doğrulamak için
            frames = bytearray()
            for i in range(sr * 10):
                frames += int(i % 1000).to_bytes(2, "little", signed=True)
            with wave.open(str(src), "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
                w.writeframes(bytes(frames))

            out = Path(d) / "out.wav"
            slice_wav(src, out, start_s=3.0, dur_s=2.0)
            with wave.open(str(out), "rb") as w:
                self.assertEqual(w.getframerate(), sr)
                self.assertEqual(w.getnframes(), sr * 2)        # 2 sn
                first = int.from_bytes(w.readframes(1), "little", signed=True)
            self.assertEqual(first, (3 * sr) % 1000)            # 3. sn'den başladı

    def test_slice_clamps_past_end(self):
        import tempfile
        import wave
        from pathlib import Path

        from clipmaker.media import slice_wav

        sr = 8000
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "s.wav"
            with wave.open(str(src), "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
                w.writeframes(b"\x00\x00" * (sr * 2))  # 2 sn
            out = Path(d) / "o.wav"
            slice_wav(src, out, start_s=5.0, dur_s=3.0)  # dosya sonunun ötesi
            with wave.open(str(out), "rb") as w:
                self.assertEqual(w.getnframes(), 0)  # sınır dışı -> boş, çökmez


if __name__ == "__main__":
    unittest.main()
