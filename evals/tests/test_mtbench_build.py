"""Offline tests for the shared MT-Bench builder, using synthetic fixtures (no network, no MT-Bench data)."""

import json
import re
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from shoal_evals.mtbench import build as b

CATEGORIES = ["writing", "roleplay", "reasoning", "math", "coding", "extraction", "stem", "humanities"]
PER_CATEGORY = 4


def write_fixture(raw: Path) -> None:
    raw.mkdir(parents=True)
    questions, answers, refs = [], [], []
    qid = 100
    for cat in CATEGORIES:
        for _ in range(PER_CATEGORY):
            questions.append({"question_id": qid, "category": cat, "turns": [f"Q{qid} first", f"Q{qid} follow-up"]})
            answers.append({"question_id": qid, "choices": [{"index": 0, "turns": [f"A{qid} one", f"A{qid} two"]}]})
            if cat in ("math", "reasoning", "coding"):
                refs.append({"question_id": qid, "choices": [{"index": 0, "turns": [f"R{qid} one", f"R{qid} two"]}]})
            qid += 1
    for name, rows in (("question.jsonl", questions), ("answers.jsonl", answers), ("reference.jsonl", refs)):
        (raw / name).write_text("".join(json.dumps(r) + "\n" for r in rows))
    (raw / "judge_prompts.jsonl").write_text(json.dumps({"name": "single-v1"}) + "\n")


class BuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        write_fixture(root / "raw")
        cls.manifest = b.build(root / "raw", root / "out", download=False)
        cls.items = b.read_jsonl(root / "out" / "items.jsonl")
        cls.sessions = b.read_jsonl(root / "out" / "sessions.jsonl")
        cls.root = root

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_build_is_deterministic(self):
        again = b.build(self.root / "raw", self.root / "out2", download=False)
        self.assertEqual(self.manifest["outputs"], again["outputs"])

    def test_router_split_is_stratified(self):
        counts = Counter((i["category"], i["split"]) for i in self.items)
        for cat in CATEGORIES:
            self.assertEqual(counts[(cat, "pool")], b.POOL_PER_CATEGORY)
            self.assertEqual(counts[(cat, "test")], PER_CATEGORY - b.POOL_PER_CATEGORY)

    def test_references_only_where_available(self):
        for item in self.items:
            has_ref = item["category"] in ("math", "reasoning", "coding")
            self.assertEqual(item["reference"] is not None, has_ref)

    def test_session_count(self):
        per_question = 1 + (len(b.DISTRACTOR_COUNTS) - 1) * len(b.PLACEMENTS)
        self.assertEqual(len(self.sessions), len(self.items) * per_question)

    def test_transcripts_match_contract(self):
        for s in self.sessions:
            t = s["transcript"]
            self.assertEqual(set(t), {"site", "conversationId", "turns", "draft", "capturedAt"})
            self.assertRegex(t["capturedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
            self.assertEqual([turn["index"] for turn in t["turns"]], list(range(len(t["turns"]))))
            self.assertEqual(len({turn["id"] for turn in t["turns"]}), len(t["turns"]))
            self.assertEqual([turn["role"] for turn in t["turns"]], ["user", "assistant"] * (len(t["turns"]) // 2))
            self.assertEqual(t["draft"], f"Q{s['question_id']} follow-up")
            self.assertEqual(s["context_tokens"], sum(turn["tokens"] for turn in t["turns"]))

    def test_gold_labels_and_placement(self):
        for s in self.sessions:
            turns = s["transcript"]["turns"]
            keep = [turn["id"] for turn in turns if s["gold"][turn["id"]] == "keep"]
            self.assertEqual(keep, [f"q{s['question_id']}.t1.user", f"q{s['question_id']}.t1.assistant"])
            self.assertEqual(len(turns), 2 + 4 * s["k"])
            positions = [i for i, turn in enumerate(turns) if turn["id"] in keep]
            expected = {"clean": [0, 1], "buried": [0, 1], "recent": [len(turns) - 2, len(turns) - 1]}
            self.assertEqual(positions, expected[s["placement"]])

    def test_distractors_are_other_categories_and_shared_across_placements(self):
        by_key = {}
        cat = {i["question_id"]: i["category"] for i in self.items}
        for s in self.sessions:
            d = s["distractor_question_ids"]
            self.assertEqual(len(d), s["k"])
            self.assertEqual(len(set(d)), len(d))
            self.assertTrue(all(cat[x] != s["category"] for x in d))
            by_key.setdefault((s["question_id"], s["k"]), set()).add(tuple(d))
        self.assertTrue(all(len(v) == 1 for v in by_key.values()))

    def test_session_ids_unique(self):
        ids = [s["session_id"] for s in self.sessions]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(re.fullmatch(r"mtb-q\d+-k\d+-(clean|recent|buried)", i) for i in ids))


if __name__ == "__main__":
    unittest.main()
