"""İzleyici-klip eşleme/kümeleme/sıralama testleri (ağ gerektirmez)."""
import unittest
from datetime import datetime, timedelta, timezone

from clipmaker.clips_source import (cluster_moments, map_clips_to_vod,
                                    select_clip_moments)
from clipmaker.kick_api import Clip

VOD_START = datetime(2026, 6, 7, 20, 0, 0, tzinfo=timezone.utc)
VOD_DUR = 3600.0  # 1 saat


def clip(offset_min, dur=40, views=100, title="an", cid=None):
    return Clip(
        id=cid or f"c{offset_min}",
        started_at=VOD_START + timedelta(minutes=offset_min),
        duration_s=dur, views=views, likes=0, title=title,
    )


class TestMapClips(unittest.TestCase):
    def test_offset_computed(self):
        ms = map_clips_to_vod([clip(10)], VOD_START, VOD_DUR)
        self.assertEqual(len(ms), 1)
        self.assertAlmostEqual(ms[0].offset_s, 600.0)  # 10 dk

    def test_filters_out_of_window(self):
        # VOD'dan önce ve sonra olan klipler elenir
        before = Clip(id="b", started_at=VOD_START - timedelta(minutes=5),
                      duration_s=30, views=999, likes=0, title="başka yayın")
        after = Clip(id="a", started_at=VOD_START + timedelta(hours=2),
                     duration_s=30, views=999, likes=0, title="başka yayın")
        ms = map_clips_to_vod([before, after, clip(30)], VOD_START, VOD_DUR)
        self.assertEqual(len(ms), 1)
        self.assertAlmostEqual(ms[0].offset_s, 1800.0)

    def test_no_started_at_none_vod(self):
        self.assertEqual(map_clips_to_vod([clip(10)], None, VOD_DUR), [])


class TestCluster(unittest.TestCase):
    def test_overlapping_merge_and_sum_views(self):
        # Aynı anı 3 izleyici kliplemiş (10. dk civarı) -> tek güçlü an
        ms = map_clips_to_vod([clip(10, views=100), clip(10, dur=45, views=200),
                               clip(10, views=50)], VOD_START, VOD_DUR)
        merged = cluster_moments(ms)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].views, 350)   # toplam
        self.assertEqual(merged[0].count, 3)
        self.assertEqual(merged[0].title, "an")  # hepsi 'an' ama en çok izlenenin başlığı

    def test_distant_clips_not_merged(self):
        ms = map_clips_to_vod([clip(5), clip(40)], VOD_START, VOD_DUR)
        merged = cluster_moments(ms)
        self.assertEqual(len(merged), 2)

    def test_title_from_most_viewed(self):
        ms = map_clips_to_vod([clip(10, views=50, title="zayıf"),
                               clip(10, views=500, title="EFSANE AN")], VOD_START, VOD_DUR)
        merged = cluster_moments(ms)
        self.assertEqual(merged[0].title, "EFSANE AN")


class TestSelect(unittest.TestCase):
    def test_ranks_by_views_and_clamps_length(self):
        clips = [clip(5, dur=200, views=50, title="uzun-az"),
                 clip(20, dur=40, views=900, title="popüler"),
                 clip(40, dur=40, views=300, title="orta")]
        moments = select_clip_moments(clips, VOD_START, VOD_DUR, num_clips=2)
        self.assertEqual(len(moments), 2)
        self.assertEqual(moments[0].title, "popüler")     # en çok izlenen önce
        self.assertEqual(moments[1].title, "orta")
        # 200 sn'lik klip seçilseydi 75 sn'ye kırpılırdı
        for m in moments:
            self.assertLessEqual(m.duration_s, 75.0)
            self.assertGreaterEqual(m.duration_s, 18.0)


if __name__ == "__main__":
    unittest.main()
