"""Klip editörü testleri."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from clipmaker.config import Settings
from clipmaker.editor import is_video_file, parse_timestamp, run_editor

FFMPEG = shutil.which("ffmpeg")


class TestParseTimestamp(unittest.TestCase):
    def test_seconds(self):
        self.assertEqual(parse_timestamp("35"), 35.0)
        self.assertEqual(parse_timestamp("12.5"), 12.5)

    def test_mm_ss(self):
        self.assertEqual(parse_timestamp("1:30"), 90.0)

    def test_hh_mm_ss(self):
        self.assertEqual(parse_timestamp("01:02:03"), 3723.0)

    def test_none_and_empty(self):
        self.assertIsNone(parse_timestamp(None))
        self.assertIsNone(parse_timestamp(""))


class TestIsVideoFile(unittest.TestCase):
    def test_extensions(self):
        self.assertTrue(is_video_file("klibim.mp4"))
        self.assertTrue(is_video_file("a/b/c.MOV"))
        self.assertFalse(is_video_file("https://kick.com/kanal"))
        self.assertFalse(is_video_file("kanaladi"))


@unittest.skipIf(FFMPEG is None, "ffmpeg kurulu değil")
class TestEditorEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="cm_editor_"))
        cls.clip = cls.tmp / "klibim.mp4"
        subprocess.run([
            FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=duration=12:size=1280x720:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=330:duration=12:sample_rate=48000",
            "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest",
            str(cls.clip),
        ], check=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _res(self, path):
        out = subprocess.run([
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path),
        ], capture_output=True, text=True, check=True).stdout.strip()
        return out.split(",")

    def test_vertical_and_square_with_trim(self):
        # Altyazısız (whisper'a bağımlı olmasın) ama tam format/kırpma yolu test edilir
        s = Settings(out_dir=self.tmp / "out", formats=("vertical", "square"),
                     trim_start=2.0, trim_end=8.0, captions=False, title="izle bunu")
        rc = run_editor([self.clip], s)
        self.assertEqual(rc, 0)
        base = self.tmp / "out" / "klibim_hazir"
        vert = base / "vertical.mp4"
        sq = base / "square.mp4"
        self.assertTrue(vert.exists() and sq.exists())
        self.assertEqual(self._res(vert), ["1080", "1920"])
        self.assertEqual(self._res(sq), ["1080", "1080"])
        # kırpma uygulanmış olmalı (~6 sn)
        from clipmaker.media import ffprobe_duration
        self.assertAlmostEqual(ffprobe_duration(str(vert)), 6.0, delta=1.5)
        # yan ürünler
        self.assertTrue((base / "kapak.jpg").exists())
        self.assertTrue((base / "paylasim_metni.txt").exists())

    def test_missing_file_errors(self):
        s = Settings(out_dir=self.tmp / "out2", captions=False)
        self.assertEqual(run_editor([Path("yok_boyle_dosya.mp4")], s), 1)


if __name__ == "__main__":
    unittest.main()
