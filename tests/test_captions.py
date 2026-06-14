"""Karaoke altyazı (ASS) üretim testleri — ağ/whisper gerektirmez."""
import unittest

from clipmaker.captions import (_ass_time, _chunk_words, build_ass, write_ass)


def words(*specs):
    """('kelime', start, end) üçlülerinden kelime listesi."""
    return [{"word": w, "start": s, "end": e} for (w, s, e) in specs]


class TestAssTime(unittest.TestCase):
    def test_format(self):
        self.assertEqual(_ass_time(0), "0:00:00.00")
        self.assertEqual(_ass_time(3661.5), "1:01:01.50")

    def test_negative_clamped(self):
        self.assertEqual(_ass_time(-3), "0:00:00.00")


class TestChunking(unittest.TestCase):
    def test_splits_on_word_count(self):
        ws = words(*[(f"k{i}", i * 0.4, i * 0.4 + 0.3) for i in range(10)])
        chunks = _chunk_words(ws)
        self.assertTrue(all(len(c) <= 4 for c in chunks))
        self.assertEqual(sum(len(c) for c in chunks), 10)

    def test_splits_on_time_gap(self):
        ws = words(("bir", 0.0, 0.3), ("iki", 0.4, 0.7), ("üç", 5.0, 5.3))
        chunks = _chunk_words(ws)
        # 5 sn'lik boşluk yeni satır açmalı
        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[1][0]["word"], "üç")


class TestBuildAss(unittest.TestCase):
    def setUp(self):
        self.ws = words(("merhaba", 0.0, 0.5), ("dünya", 0.6, 1.0), ("nasılsın", 1.1, 1.6))
        self.ass = build_ass(self.ws)

    def test_has_header_and_resolution(self):
        self.assertIn("[Script Info]", self.ass)
        self.assertIn("PlayResX: 1080", self.ass)
        self.assertIn("PlayResY: 1920", self.ass)
        self.assertIn("[V4+ Styles]", self.ass)

    def test_one_dialogue_per_word(self):
        dialogues = [l for l in self.ass.splitlines() if l.startswith("Dialogue:")]
        self.assertEqual(len(dialogues), 3)  # her kelime için bir vurgu satırı

    def test_active_word_highlighted(self):
        # İlk kelime aktifken sarı renk kodu bulunmalı
        first = [l for l in self.ass.splitlines() if l.startswith("Dialogue:")][0]
        self.assertIn("&H00FFFF&", first)       # parlak sarı (aktif kelime)
        self.assertIn("merhaba", first)
        self.assertIn("dünya", first)            # diğer kelimeler de görünür

    def test_escapes_braces(self):
        a = build_ass(words(("{kötü}", 0.0, 0.4)))
        self.assertNotIn("{kötü}", a)            # süslü parantez kaçışlandı

    def test_empty_returns_header_only(self):
        a = build_ass([])
        self.assertNotIn("Dialogue:", a)


class TestWriteAss(unittest.TestCase):
    def test_none_for_empty(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(write_ass([], Path(d) / "x.ass"))

    def test_writes_file(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            p = write_ass(words(("a", 0.0, 0.3)), Path(d) / "x.ass")
            self.assertTrue(p.exists())
            self.assertIn("Dialogue:", p.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
