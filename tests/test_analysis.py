"""Sinyal analizi ve an seçimi testleri (ağ gerektirmez)."""
import unittest

import numpy as np

from clipmaker.audio_analysis import AudioSignal
from clipmaker.chat_analysis import (ChatSignal, analyze_chat, is_bot_or_noise,
                                     is_noise_message, message_hype_score, robust_z,
                                     rolling_baseline, shift_earlier)
from clipmaker.highlights import combine_signals, fmt_ts, pick_highlights
from clipmaker.kick_api import ChatMessage


def fake_chat_signal(z, bucket_s=5.0):
    n = len(z)
    zeros = np.zeros(n)
    return ChatSignal(bucket_s=bucket_s, counts=zeros, hype=zeros, unique_senders=zeros,
                      repeat=zeros, raw=zeros, z=np.asarray(z, dtype=float))


def fake_audio_signal(z, bucket_s=5.0):
    zeros = np.zeros(len(z))
    return AudioSignal(bucket_s=bucket_s, rms=zeros, novelty=zeros, z=np.asarray(z, dtype=float))


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


class TestNoiseFilter(unittest.TestCase):
    def test_commands_and_links_are_noise(self):
        self.assertTrue(is_noise_message("!discord"))
        self.assertTrue(is_noise_message("https://example.com"))
        self.assertTrue(is_noise_message("   "))

    def test_system_messages_are_noise(self):
        self.assertTrue(is_noise_message("Thanks for the follow @emir"))
        self.assertTrue(is_noise_message("@semizotucan has accepted the duel against @joe"))
        self.assertTrue(is_noise_message("ahmet has subscribed for 3 months"))

    def test_real_messages_not_noise(self):
        self.assertFalse(is_noise_message("OHA NASIL YA"))
        self.assertFalse(is_noise_message("hahaha"))

    def test_bot_usernames_filtered(self):
        self.assertTrue(is_bot_or_noise("Botrix", "normal mesaj"))
        self.assertTrue(is_bot_or_noise("ali", "!commands"))
        self.assertFalse(is_bot_or_noise("ali", "hahaha çok komik"))

    def test_bots_excluded_from_signal(self):
        # Bot mesajları yoğunluk patlaması yaratmamalı
        msgs = [ChatMessage(offset_s=300 + i * 0.2, username="Botrix",
                            content="Thanks for the follow @user") for i in range(50)]
        msgs += [ChatMessage(offset_s=t, username=f"u{int(t) % 3}", content="selam")
                 for t in range(0, 600, 30)]
        sig = analyze_chat(msgs, 600.0, 5.0, lag_s=0.0)
        # 50 bot mesajı kovayı şişirmemeli (en fazla 1 meşru 'selam' kalır)
        self.assertLessEqual(sig.counts[60], 1.0)
        # bot patlaması zirve OLMAMALI (sinyal düz kalmalı)
        self.assertLess(float(np.max(sig.z)), 3.0)


class TestSignalHelpers(unittest.TestCase):
    def test_shift_earlier(self):
        a = np.array([0.0, 0, 0, 5, 0, 0])
        shifted = shift_earlier(a, 2)
        self.assertEqual(int(np.argmax(shifted)), 1)  # zirve 2 pencere öne kaydı

    def test_rolling_baseline_tracks_drift(self):
        x = np.concatenate([np.ones(50), np.ones(50) * 5])
        base = rolling_baseline(x, win=11)
        self.assertLess(base[10], base[90])  # temel çizgi artışı izliyor


class TestChatLagCompensation(unittest.TestCase):
    def test_peak_shifts_earlier_with_lag(self):
        msgs = make_chat_with_burst(burst_at=300.0)
        no_lag = analyze_chat(msgs, 600.0, 5.0, lag_s=0.0)
        with_lag = analyze_chat(msgs, 600.0, 5.0, lag_s=10.0)
        peak_no = int(np.argmax(no_lag.z)) * 5.0
        peak_lag = int(np.argmax(with_lag.z)) * 5.0
        self.assertLess(peak_lag, peak_no)  # gecikme telafisi zirveyi öne çeker
        self.assertAlmostEqual(peak_no - peak_lag, 10.0, delta=5.0)


class TestRepeatDetection(unittest.TestCase):
    def test_copypasta_boosts_signal(self):
        # Aynı mesajın 40 kişiden gelmesi (kopyala-yapıştır dalgası) güçlü sinyal
        msgs = [ChatMessage(offset_s=t, username=f"u{int(t) % 5}", content="merhaba")
                for t in np.arange(0, 600, 5)]
        spam_t = 300.0
        for i in range(40):
            msgs.append(ChatMessage(offset_s=spam_t + i * 0.1, username=f"sp{i}",
                                    content="AYNI KOPYALA MESAJ"))
        sig = analyze_chat(msgs, 600.0, 5.0, lag_s=0.0)
        peak = int(np.argmax(sig.z)) * 5.0
        self.assertTrue(295 <= peak <= 310)
        self.assertGreater(sig.repeat[int(spam_t // 5)], 30)


class TestAudioNovelty(unittest.TestCase):
    def test_sudden_onset_beats_sustained_loud(self):
        from clipmaker.audio_analysis import compute_rms
        import tempfile, wave, struct
        sr = 8000
        n = 120  # saniye
        samples = []
        for s in range(n):
            # 0-40s sürekli yüksek (müzik gibi), 80s'de ani kısa patlama
            if s < 40:
                amp = 0.5
            elif 80 <= s < 83:
                amp = 0.9
            else:
                amp = 0.05
            block = (np.random.default_rng(s).standard_normal(sr) * amp * 32767 * 0.3)
            samples.append(np.clip(block, -32767, 32767).astype(np.int16))
        pcm = np.concatenate(samples)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            path = f.name
        with wave.open(path, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes(pcm.tobytes())
        sig = compute_rms(path, bucket_s=5.0)
        self.assertIsNotNone(sig)
        # Ani patlama (80s) bölgesi, sürekli yüksek başlangıçtan (0-40s) daha yüksek z almalı
        onset_z = sig.z[16]   # ~80s
        sustained_z = max(sig.z[1], sig.z[5])  # müzikli başlangıç
        self.assertGreater(onset_z, sustained_z)


class TestAgreementBonus(unittest.TestCase):
    def test_both_signals_beat_single(self):
        n = 60
        cz = np.zeros(n); az = np.zeros(n)
        cz[10] = 3.0            # yalnızca chat
        az[20] = 3.0            # yalnızca ses
        cz[30] = 3.0; az[30] = 3.0  # ikisi birden -> en güçlü
        score = combine_signals(n * 5.0, 5.0,
                                chat=fake_chat_signal(cz), audio=fake_audio_signal(az),
                                chat_weight=0.6, audio_weight=0.4, agreement_weight=0.7)
        self.assertGreater(score[30], score[10])
        self.assertGreater(score[30], score[20])

    def test_no_bonus_without_both(self):
        n = 20
        cz = np.zeros(n); cz[5] = 3.0
        score = combine_signals(n * 5.0, 5.0, chat=fake_chat_signal(cz), audio=None,
                                agreement_weight=0.7)
        self.assertAlmostEqual(score[5], 3.0, delta=1e-6)  # bonus yok


if __name__ == "__main__":
    unittest.main()
