"""Yapay zeka jürisi testleri (ağ/gerçek LLM gerektirmez).

Sahte bir jüri ve sahte bir Claude istemcisiyle uçtan uca davranış
doğrulanır: jüri puanının sinyal sıralamasını gerçekten geçersiz kıldığı,
çözümleme ve kademeli çöküşün çalıştığı.
"""
import json
import tempfile
import unittest
from pathlib import Path

from clipmaker import ai_judge
from clipmaker.ai_judge import (AIJudgeError, Candidate, Verdict,
                                _coerce_verdicts, _extract_json,
                                build_user_prompt, select_judge)
from clipmaker.config import Settings
from clipmaker.highlights import Highlight

try:
    import anthropic  # noqa: F401
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False


class TestExtractJson(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(_extract_json('{"a":1}'), {"a": 1})

    def test_fenced(self):
        self.assertEqual(_extract_json('```json\n{"a":2}\n```'), {"a": 2})

    def test_embedded(self):
        self.assertEqual(_extract_json('İşte sonuç: {"a":3} bitti'), {"a": 3})

    def test_garbage(self):
        self.assertIsNone(_extract_json("hiç json yok"))
        self.assertIsNone(_extract_json(""))


class TestCoerceVerdicts(unittest.TestCase):
    def test_valid_and_clamp(self):
        raw = {"clips": [
            {"index": 1, "score": 150, "category": "komik", "title": "T", "reason": "R"},
            {"index": 2, "score": -5, "category": "tepki", "title": "U", "reason": "S"},
        ]}
        vs = _coerce_verdicts(raw, {1, 2})
        self.assertEqual(vs[0].score, 100.0)  # üst sınıra kırpıldı
        self.assertEqual(vs[1].score, 0.0)    # alt sınıra kırpıldı

    def test_filters_unknown_index(self):
        raw = {"clips": [{"index": 99, "score": 50, "category": "", "title": "", "reason": ""}]}
        self.assertEqual(_coerce_verdicts(raw, {1, 2}), [])

    def test_ignores_malformed(self):
        raw = {"clips": ["notdict", {"index": "x", "score": 1}]}
        self.assertEqual(_coerce_verdicts(raw, {1}), [])


class TestBuildPrompt(unittest.TestCase):
    def test_contains_candidates(self):
        cands = [
            Candidate(1, "00:01:00", "00:01:30", "merhaba dünya",
                      [{"user": "ali", "text": "OHA"}]),
            Candidate(2, "00:05:00", "00:05:30", "", []),
        ]
        p = build_user_prompt(cands, num_clips=1)
        self.assertIn("Aday 1", p)
        self.assertIn("merhaba dünya", p)
        self.assertIn("ali: OHA", p)
        self.assertIn("(konuşma metni yok)", p)  # boş transcript


class TestSelectJudge(unittest.TestCase):
    def setUp(self):
        self._orig = (ai_judge.claude_available, ai_judge.ollama_available)

    def tearDown(self):
        ai_judge.claude_available, ai_judge.ollama_available = self._orig

    def test_off(self):
        judge, reason = select_judge("off")
        self.assertIsNone(judge)

    def test_auto_prefers_claude(self):
        ai_judge.claude_available = lambda: True
        ai_judge.ollama_available = lambda: True
        judge, reason = select_judge("auto")
        self.assertEqual(judge.name, "Claude API")

    def test_auto_falls_to_ollama(self):
        ai_judge.claude_available = lambda: False
        ai_judge.ollama_available = lambda: True
        judge, reason = select_judge("auto")
        self.assertIn("Ollama", judge.name)

    def test_auto_none_when_nothing(self):
        ai_judge.claude_available = lambda: False
        ai_judge.ollama_available = lambda: False
        judge, reason = select_judge("auto")
        self.assertIsNone(judge)
        self.assertTrue(reason)

    def test_claude_requested_but_unavailable(self):
        ai_judge.claude_available = lambda: False
        judge, reason = select_judge("claude")
        self.assertIsNone(judge)


def _make_candidates():
    """3 aday: sinyal sırası 1>2>3 (skor 9,8,7)."""
    cands = []
    for rank, (score, t) in enumerate([(9.0, 100), (8.0, 300), (7.0, 500)], start=1):
        cands.append(Highlight(rank=rank, peak_s=t, start_s=t, end_s=t + 30, score=score,
                               top_messages=[{"user": f"u{rank}", "text": "tepki"}]))
    return cands


class FakeJudge:
    name = "Fake"

    def __init__(self, scores):
        self.scores = scores  # {index: score}

    def judge(self, cands, num_clips):
        return [Verdict(index=i, score=s, category="komik", title=f"Başlık {i}",
                        reason="çünkü komik") for i, s in self.scores.items()]


class FailingJudge:
    name = "Fail"

    def judge(self, cands, num_clips):
        raise AIJudgeError("boom")


class TestAISelectOverridesSignal(unittest.TestCase):
    def _settings(self):
        return Settings(num_clips=2, transcribe=False)

    def test_ai_reorders_against_signal(self):
        from clipmaker.pipeline import _ai_select
        cands = _make_candidates()
        # Sinyalde en zayıf olan 2. aday (rank2) AI'da en yüksek puanı alıyor
        judge = FakeJudge({1: 10.0, 2: 95.0, 3: 60.0})
        with tempfile.TemporaryDirectory() as d:
            chosen = _ai_select(judge, cands, "unused", Path(d), self._settings())
        self.assertEqual(len(chosen), 2)
        # AI'ın tercihi: önce 95 puanlı (eski rank2), sonra 60 puanlı (eski rank3)
        self.assertEqual(chosen[0].ai_score, 95.0)
        self.assertEqual(chosen[0].title, "Başlık 2")
        self.assertEqual(chosen[1].ai_score, 60.0)
        # En yüksek sinyalli ama düşük AI puanlı aday (10) elendi
        self.assertNotIn(10.0, [h.ai_score for h in chosen])
        # rütbeler 1..n yeniden numaralandı
        self.assertEqual([h.rank for h in chosen], [1, 2])

    def test_fallback_on_judge_error(self):
        from clipmaker.pipeline import _ai_select
        cands = _make_candidates()
        with tempfile.TemporaryDirectory() as d:
            chosen = _ai_select(FailingJudge(), cands, "unused", Path(d), self._settings())
        # Jüri patlayınca sinyal sıralamasına döner: en yüksek skorlu ilk 2
        self.assertEqual(len(chosen), 2)
        self.assertEqual([h.rank for h in chosen], [1, 2])
        self.assertEqual(chosen[0].score, 9.0)


@unittest.skipUnless(HAS_ANTHROPIC, "anthropic kurulu değil")
class TestClaudeJudgeParsing(unittest.TestCase):
    """ClaudeJudge'ı sahte bir anthropic istemcisiyle doğrula (gerçek API yok)."""

    def test_parses_structured_response(self):
        import anthropic
        from clipmaker.ai_judge import ClaudeJudge

        canned = json.dumps({"clips": [
            {"index": 1, "score": 88, "category": "komik", "title": "Efsane an", "reason": "güldürdü"},
            {"index": 2, "score": 30, "category": "diğer", "title": "Sönük", "reason": "sıradan"},
        ]})

        class FakeBlock:
            type = "text"
            text = canned

        class FakeResp:
            stop_reason = "end_turn"
            content = [FakeBlock()]

        class FakeMessages:
            def create(self, **kwargs):
                # output_config + thinking gibi parametreleri kabul ettiğimizi doğrula
                assert kwargs.get("model")
                assert "messages" in kwargs
                return FakeResp()

        class FakeClient:
            def __init__(self, *a, **k):
                self.messages = FakeMessages()

        orig = anthropic.Anthropic
        anthropic.Anthropic = FakeClient
        try:
            cands = [Candidate(1, "0:00", "0:30", "espri", [{"user": "a", "text": "haha"}]),
                     Candidate(2, "1:00", "1:30", "boş", [])]
            verdicts = ClaudeJudge("claude-opus-4-8").judge(cands, num_clips=1)
        finally:
            anthropic.Anthropic = orig

        by_idx = {v.index: v for v in verdicts}
        self.assertEqual(by_idx[1].score, 88.0)
        self.assertEqual(by_idx[1].title, "Efsane an")
        self.assertEqual(by_idx[2].score, 30.0)


if __name__ == "__main__":
    unittest.main()
