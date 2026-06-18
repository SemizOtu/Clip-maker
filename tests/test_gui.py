"""GUI ayar üretici testleri (Tkinter penceresi açmadan, saf mantık)."""
import unittest
from pathlib import Path

from clipmaker.gui import build_editor_settings


class TestBuildEditorSettings(unittest.TestCase):
    def test_defaults(self):
        s = build_editor_settings(["vertical"], True, "base", "tr",
                                  "", "", "", True, "output")
        self.assertEqual(s.formats, ("vertical",))
        self.assertTrue(s.captions)
        self.assertIsNone(s.trim_start)
        self.assertIsNone(s.trim_end)
        self.assertIsNone(s.title)
        self.assertEqual(s.out_dir, Path("output"))

    def test_multiple_formats_and_trim(self):
        s = build_editor_settings(["vertical", "square", "bad"], True, "small", "en",
                                  "0:05", "0:35", "izle bunu", False, "C:/out")
        self.assertEqual(s.formats, ("vertical", "square"))  # geçersiz format elendi
        self.assertEqual(s.caption_model, "small")
        self.assertEqual(s.language, "en")
        self.assertAlmostEqual(s.trim_start, 5.0)
        self.assertAlmostEqual(s.trim_end, 35.0)
        self.assertEqual(s.title, "izle bunu")
        self.assertFalse(s.normalize_audio)

    def test_empty_formats_falls_back_to_vertical(self):
        s = build_editor_settings([], True, "base", "tr", "", "", "", True, "output")
        self.assertEqual(s.formats, ("vertical",))


if __name__ == "__main__":
    unittest.main()
