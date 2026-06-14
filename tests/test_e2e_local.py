"""Yerel uçtan uca test: ffmpeg ile sentetik video üretip tüm medya
hattını (ses analizi -> an seçimi -> klip kesimi -> dikey dönüştürme)
gerçek dosyalar üzerinde doğrular. Ağ gerektirmez, ffmpeg gerektirir.
"""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np

from clipmaker.audio_analysis import compute_rms
from clipmaker.highlights import combine_signals, pick_highlights
from clipmaker.media import (cut_clip, extract_analysis_audio,
                             ffprobe_duration, make_thumbnail, make_vertical)

FFMPEG = shutil.which("ffmpeg")


@unittest.skipIf(FFMPEG is None, "ffmpeg kurulu değil")
class TestEndToEndLocal(unittest.TestCase):
    """120 sn'lik test videosu: 60-66 sn arasında yüksek ses patlaması var."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="clipmaker_test_"))
        cls.video = cls.tmp / "vod.mp4"
        # Sessiz ton + 60-66 sn arasında 18 dB daha yüksek bölüm
        audio_expr = "'(0.04+0.85*between(t,60,66))*sin(440*2*PI*t)'"
        subprocess.run([
            FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=duration=120:size=640x360:rate=24",
            "-f", "lavfi", "-i", f"aevalsrc={audio_expr}:s=16000:d=120",
            "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
            "-shortest", str(cls.video),
        ], check=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_01_probe_duration(self):
        dur = ffprobe_duration(str(self.video))
        self.assertIsNotNone(dur)
        self.assertAlmostEqual(dur, 120.0, delta=2.0)

    def test_02_audio_pipeline_finds_burst(self):
        wav = self.tmp / "analysis.wav"
        extract_analysis_audio(str(self.video), wav)
        sig = compute_rms(wav, bucket_s=5.0)
        self.assertIsNotNone(sig)
        peak_time = int(np.argmax(sig.z)) * 5.0
        self.assertTrue(55 <= peak_time <= 70, f"ses zirvesi {peak_time}s'de bulundu")

        # Tam seçim hattı: skor -> highlight, patlamayı yakalamalı
        score = combine_signals(120.0, 5.0, chat=None, audio=sig)
        hl = pick_highlights(score, 5.0, 120.0, num_clips=1, clip_duration=20.0)
        self.assertEqual(len(hl), 1)
        self.assertTrue(hl[0].start_s <= 62 <= hl[0].end_s,
                        f"klip {hl[0].start_s}-{hl[0].end_s} patlamayı kaçırdı")

    def test_03_cut_and_vertical(self):
        clip = self.tmp / "clips" / "clip_01.mp4"
        cut_clip(str(self.video), start_s=55.0, duration_s=20.0, out_path=clip)
        self.assertTrue(clip.exists())
        self.assertAlmostEqual(ffprobe_duration(str(clip)), 20.0, delta=1.5)

        vertical = self.tmp / "clips" / "clip_01_dikey.mp4"
        make_vertical(clip, vertical, title="Test Klip")
        self.assertTrue(vertical.exists())
        # 9:16 çözünürlük doğrulaması
        out = subprocess.run([
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0", str(vertical),
        ], capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(out.split(","), ["1080", "1920"])

        thumb = self.tmp / "thumb.jpg"
        make_thumbnail(clip, thumb)
        self.assertTrue(thumb.exists())
        self.assertGreater(thumb.stat().st_size, 1000)

    def test_04_subtitle_burn(self):
        """Altyazı gömme yolunu whisper olmadan, elle SRT ile doğrula."""
        from clipmaker.subtitles import VERTICAL_STYLE, burn_subtitles

        clip = self.tmp / "clips" / "sub_src.mp4"
        cut_clip(str(self.video), start_s=0.0, duration_s=10.0, out_path=clip)
        srt = self.tmp / "test.srt"
        srt.write_text(
            "1\n00:00:00,500 --> 00:00:03,000\nMerhaba dünya\n\n"
            "2\n00:00:03,500 --> 00:00:06,000\nİkinci satır\n",
            encoding="utf-8",
        )
        # Yatay stil
        h_out = self.tmp / "clips" / "sub_h.mp4"
        burn_subtitles(clip, srt, h_out)
        self.assertTrue(h_out.exists() and h_out.stat().st_size > 1000)

        # Dikey: önce 9:16'ya çevir, sonra büyük stille göm
        vert = self.tmp / "clips" / "sub_v.mp4"
        make_vertical(clip, vert)
        v_out = self.tmp / "clips" / "sub_v_subbed.mp4"
        burn_subtitles(vert, srt, v_out, style=VERTICAL_STYLE)
        self.assertTrue(v_out.exists() and v_out.stat().st_size > 1000)
        self.assertAlmostEqual(ffprobe_duration(str(v_out)), 10.0, delta=1.5)

    def test_05_karaoke_caption_burn(self):
        """ASS karaoke altyazı gömme (libass) yolunu, whisper olmadan doğrula."""
        from clipmaker.captions import write_ass
        from clipmaker.media import burn_ass, cut_clip, make_vertical

        clip = self.tmp / "clips" / "cap_src.mp4"
        cut_clip(str(self.video), start_s=0.0, duration_s=10.0, out_path=clip,
                 normalize_audio=True)  # loudnorm yolu da test edilir
        self.assertTrue(clip.exists())

        words = [{"word": w, "start": s, "end": e} for (w, s, e) in [
            ("Merhaba", 0.2, 0.8), ("dünya", 0.9, 1.4), ("bu", 1.5, 1.8),
            ("bir", 1.9, 2.2), ("karaoke", 2.3, 3.0), ("testi", 3.1, 3.8),
        ]]
        ass = write_ass(words, self.tmp / "clips" / "vertical" / "cap.ass")
        self.assertIsNotNone(ass)

        vert = self.tmp / "clips" / "vertical" / "cap_v.mp4"
        make_vertical(clip, vert)
        out = self.tmp / "clips" / "vertical" / "cap_v_sub.mp4"
        burn_ass(vert, ass, out)
        self.assertTrue(out.exists() and out.stat().st_size > 1000)
        # 9:16 korunmalı
        res = subprocess.run([
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0", str(out),
        ], capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(res.split(","), ["1080", "1920"])


if __name__ == "__main__":
    unittest.main()
