"""Sinyal analizi ve an seçimi testleri (ağ gerektirmez)."""
import unittest

import numpy as np

from clipmaker.chat_analysis import analyze_chat, message_hype_score, robust_z
from clipmaker.highlights import combine_signals, fmt_ts, pick_highlights
from clipmaker.kick_api import ChatMessage


def make_chat_with_burst(duration=600.0, burst_at=300.0, burst_len=20.0):
    """Sakin akış + burst_at anında yoğun hype patlaması."""
    msgs = []
    t = 0.0
    while t < duration:  # arka plan: 6 saniyede bir sıradan mesaj
        msgs.append(ChatMessage(offset_s=t, username=f"u{int(t) % 7}", content="selam nasılsınız"))
        t += 6.0
    t = burst_at
    i = 0
    while t < burst_at + burst_len:  # patlama: saniyede 3 hype mesajı
        msgs.append(ChatMessage(offset_s=t, username=f"hyper{i % 25}",
                                content=["KLİPLEYİN ŞUNU", "HAHAHAHAHA", "OHA NASIL YA",
                                         "[emote:37226:KEKW]", "W"][i % 5]))
        i += 1
        t += 0.33
    return msgs


class TestHypeScore(unittest.TestCase):
    def test_laughter(self):
        self.assertGreater(message_hype_score("hahahahaha"), 0)
        self.assertGreater(message_hype_score("sjsjsjsj"), 0)

    def test_clip_call_strongest(self):
        self.assertGreaterEqual(message_hype_score("kliple şunu"), 2.0)

    def test_turkish_hype(self):
        self.assertGreater(message_hype_score("OHA yok artık"), 1.0)

    def test_emotes(self):
        self.assertGreater(message_hype_score("[emote:37226:KEKW]"),
                           message_hype_score("[emote:1:coolStory]"))

    def test_caps(self):
        self.assertGreater(message_hype_score("NELER OLUYOR BURADA"),
                           message_hype_score("neler oluyor burada"))

    def test_plain_message(self):
        self.assertEqual(message_hype_score("bugün hava güzel"), 0.0)


class TestChatAnalysis(unittest.TestCase):
    def test_burst_detected(self):
        msgs = make_chat_with_burst()
        sig = analyze_chat(msgs, duration_s=600.0, bucket_s=5.0)
        self.assertIsNotNone(sig)
        peak_bucket = int(np.argmax(sig.z))
        peak_time = peak_bucket * 5.0
        self.assertTrue(295 <= peak_time <= 325, f"zirve {peak_time}s'de bulundu")

    def test_empty_returns_none(self):
        self.assertIsNone(analyze_chat([], 600.0))

    def test_top_messages(self):
        msgs = make_chat_with_burst()
        sig = analyze_chat(msgs, 600.0, 5.0)
        top = sig.top_messages(290, 330, k=3)
        self.assertTrue(top)
        self.assertTrue(any("KLİPLEYİN" in m["text"] or "OHA" in m["text"]
                            or "HAHA" in m["text"] or "KEKW" in m["text"] for m in top))


class TestRobustZ(unittest.TestCase):
    def test_constant_signal_no_nan(self):
        z = robust_z(np.ones(100))
        self.assertFalse(np.any(np.isnan(z)))

    def test_spike_high_z(self):
        x = np.ones(100)
        x[50] = 50.0
        self.assertGreater(robust_z(x)[50], 5.0)


class TestPickHighlights(unittest.TestCase):
    def test_non_overlapping(self):
        score = np.zeros(200)
        score[40] = 5.0
        score[42] = 4.9   # 40'a çok yakın; elenmeli
        score[120] = 4.0
        hl = pick_highlights(score, bucket_s=5.0, duration_s=1000.0,
                             num_clips=3, clip_duration=45.0)
        peaks = [h.peak_s for h in hl]
        self.assertEqual(len(hl), 2)  # düşük skorlu üçüncü an seçilmemeli
        for i, a in enumerate(peaks):
            for b in peaks[i + 1:]:
                self.assertGreaterEqual(abs(a - b), 45.0 * 1.2)

    def test_window_clamped_to_vod(self):
        score = np.zeros(20)
        score[0] = 5.0
        score[19] = 4.0
        hl = pick_highlights(score, bucket_s=5.0, duration_s=100.0,
                             num_clips=2, clip_duration=45.0, min_gap_s=10)
        for h in hl:
            self.assertGreaterEqual(h.start_s, 0.0)
            self.assertLessEqual(h.end_s, 100.0)
            self.assertAlmostEqual(h.end_s - h.start_s, 45.0, delta=0.1)

    def test_combine_handles_missing_signal(self):
        msgs = make_chat_with_burst()
        sig = analyze_chat(msgs, 600.0, 5.0)
        score = combine_signals(600.0, 5.0, chat=sig, audio=None)
        self.assertEqual(len(score), 120)
        self.assertGreater(score.max(), 1.0)

    def test_combine_requires_a_signal(self):
        with self.assertRaises(ValueError):
            combine_signals(600.0, 5.0, chat=None, audio=None)


class TestFmtTs(unittest.TestCase):
    def test_format(self):
        self.assertEqual(fmt_ts(0), "00:00:00")
        self.assertEqual(fmt_ts(3725), "01:02:05")


if __name__ == "__main__":
    unittest.main()
