"""Build the shared MT-Bench subset used by both the router and the context-manager experiments.

Both tracks run this same builder, so they evaluate on identical items, splits and sessions.
Third-party data is never committed: the builder downloads it from pinned revisions, checks
the SHA-256 of every source, and writes outputs to ``evals/data/mtbench/`` (gitignored).
``--check`` compares the outputs against ``MANIFEST.json`` so both people know they match.

Outputs:
  items.jsonl          80 questions with category, both turns, reference answers when available,
                       and the router split (pool or test). Used by the router experiment.
  sessions.jsonl       Conversations in the Transcript contract shape (ADR-001) with gold labels
                       per turn. Used by the context-manager experiment.
  judge_prompts.jsonl  The MT-Bench judge prompts, pinned, so both tracks grade the same way.

Usage (from the evals/ directory):
  uv run python -m shoal_evals.mtbench.build            # build and print output hashes
  uv run python -m shoal_evals.mtbench.build --check    # build and verify against MANIFEST.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVALS_DIR = HERE.parent.parent
DEFAULT_OUT = EVALS_DIR / "data" / "mtbench"
MANIFEST_PATH = HERE / "MANIFEST.json"

BUILDER_VERSION = "1"
SEED = 20261010
POOL_PER_CATEGORY = 3  # router few-shot / retrieval pool; the rest of each category is test
DISTRACTOR_COUNTS = (0, 4, 12)  # k=0 is the clean two-turn conversation (the oracle arm)
PLACEMENTS = ("recent", "buried")
CAPTURED_AT = "2026-01-01T00:00:00Z"  # fixed so outputs are byte-identical across machines

FASTCHAT_REV = "587d5cfa1609a43d192cedb8441cac3c17db105d"
HF_SPACE_REV = "a4b674ca573c24143824ac7f60d9173e7081e37d"
_FC = f"https://raw.githubusercontent.com/lm-sys/FastChat/{FASTCHAT_REV}/fastchat/llm_judge/data"

SOURCES = {
    "question.jsonl": f"{_FC}/mt_bench/question.jsonl",
    "reference.jsonl": f"{_FC}/mt_bench/reference_answer/gpt-4.jsonl",
    "judge_prompts.jsonl": f"{_FC}/judge_prompts.jsonl",
    "answers.jsonl": f"https://huggingface.co/spaces/lmsys/mt-bench/resolve/{HF_SPACE_REV}/data/mt_bench/model_answer/gpt-4.jsonl",
}


@dataclass(frozen=True)
class Question:
    qid: int
    category: str
    turns: tuple[str, str]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def dumps_jsonl(rows: list[dict]) -> bytes:
    return "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows).encode("utf-8")


def estimate_tokens(text: str) -> int:
    """Rough estimate (4 characters per token). Replace with the catalog tokenizer when it exists."""
    return math.ceil(len(text) / 4)


def download_sources(raw_dir: Path) -> dict[str, str]:
    raw_dir.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name, url in SOURCES.items():
        path = raw_dir / name
        if not path.exists():
            with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 - pinned https URLs
                path.write_bytes(resp.read())
        hashes[name] = sha256(path.read_bytes())
    return hashes


def load_questions(raw_dir: Path) -> list[Question]:
    out = []
    for row in read_jsonl(raw_dir / "question.jsonl"):
        turns = row["turns"]
        if len(turns) != 2:
            raise ValueError(f"question {row['question_id']} has {len(turns)} turns, expected 2")
        out.append(Question(int(row["question_id"]), row["category"], (turns[0], turns[1])))
    return sorted(out, key=lambda q: q.qid)


def load_turn_pairs(path: Path) -> dict[int, tuple[str, str]]:
    pairs = {}
    for row in read_jsonl(path):
        turns = row["choices"][0]["turns"]
        pairs[int(row["question_id"])] = (turns[0], turns[1])
    return pairs


def router_splits(questions: list[Question]) -> dict[int, str]:
    """Stratified split: POOL_PER_CATEGORY per category go to the pool, the rest to test."""
    by_cat: dict[str, list[int]] = {}
    for q in questions:
        by_cat.setdefault(q.category, []).append(q.qid)
    split = {}
    for cat in sorted(by_cat):
        qids = sorted(by_cat[cat])
        random.Random(f"{SEED}:split:{cat}").shuffle(qids)
        for i, qid in enumerate(qids):
            split[qid] = "pool" if i < POOL_PER_CATEGORY else "test"
    return split


def build_items(questions, references, split) -> list[dict]:
    rows = []
    for q in questions:
        ref = references.get(q.qid)
        rows.append(
            {
                "question_id": q.qid,
                "category": q.category,
                "turns": list(q.turns),
                "reference": list(ref) if ref else None,
                "split": split[q.qid],
            }
        )
    return rows


def _turn(qid: int, turn_no: int, role: str, text: str) -> dict:
    return {
        "id": f"q{qid}.t{turn_no}.{role}",
        "role": role,
        "text": text,
        "blocks": [{"kind": "text", "text": text}],
        "tokens": estimate_tokens(text),
    }


def _conversation(q: Question, answers: dict[int, tuple[str, str]], include_second: bool = True) -> list[dict]:
    a = answers[q.qid]
    turns = [_turn(q.qid, 1, "user", q.turns[0]), _turn(q.qid, 1, "assistant", a[0])]
    if include_second:
        turns += [_turn(q.qid, 2, "user", q.turns[1]), _turn(q.qid, 2, "assistant", a[1])]
    return turns


def pick_distractors(target: Question, questions: list[Question], k: int) -> list[Question]:
    """k conversations from other categories, chosen deterministically per target and k."""
    candidates = [q for q in questions if q.category != target.category]
    rng = random.Random(f"{SEED}:distractors:{target.qid}:{k}")
    return rng.sample(candidates, k)


def build_sessions(questions, answers, references) -> list[dict]:
    sessions = []
    for target in questions:
        target_first = _conversation(target, answers, include_second=False)
        for k in DISTRACTOR_COUNTS:
            distractors = pick_distractors(target, questions, k)
            distractor_turns = [t for d in distractors for t in _conversation(d, answers)]
            placements = ("clean",) if k == 0 else PLACEMENTS
            for placement in placements:
                if placement == "buried":
                    turns = target_first + distractor_turns
                else:  # "recent" and "clean": the target's first exchange is the latest context
                    turns = distractor_turns + target_first
                turns = [{**t, "index": i} for i, t in enumerate(turns)]
                target_ids = {t["id"] for t in target_first}
                gold = {t["id"]: ("keep" if t["id"] in target_ids else "useless") for t in turns}
                session_id = f"mtb-q{target.qid}-k{k}-{placement}"
                sessions.append(
                    {
                        "session_id": session_id,
                        "question_id": target.qid,
                        "category": target.category,
                        "k": k,
                        "placement": placement,
                        "distractor_question_ids": [d.qid for d in distractors],
                        "transcript": {
                            "site": "generic",
                            "conversationId": session_id,
                            "turns": turns,
                            "draft": target.turns[1],
                            "capturedAt": CAPTURED_AT,
                        },
                        "gold": gold,
                        "reference_turn2": references[target.qid][1] if target.qid in references else None,
                        "context_tokens": sum(t["tokens"] for t in turns),
                    }
                )
    return sessions


def build(raw_dir: Path, out_dir: Path, *, download: bool = True) -> dict:
    source_hashes = download_sources(raw_dir) if download else {n: sha256((raw_dir / n).read_bytes()) for n in SOURCES}
    questions = load_questions(raw_dir)
    answers = load_turn_pairs(raw_dir / "answers.jsonl")
    references = load_turn_pairs(raw_dir / "reference.jsonl")
    missing = [q.qid for q in questions if q.qid not in answers]
    if missing:
        raise ValueError(f"no pre-generated answers for questions {missing}")

    split = router_splits(questions)
    outputs = {
        "items.jsonl": dumps_jsonl(build_items(questions, references, split)),
        "sessions.jsonl": dumps_jsonl(build_sessions(questions, answers, references)),
        "judge_prompts.jsonl": (raw_dir / "judge_prompts.jsonl").read_bytes(),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, data in outputs.items():
        (out_dir / name).write_bytes(data)

    return {
        "builder_version": BUILDER_VERSION,
        "seed": SEED,
        "params": {
            "pool_per_category": POOL_PER_CATEGORY,
            "distractor_counts": list(DISTRACTOR_COUNTS),
            "placements": list(PLACEMENTS),
        },
        "sources": {n: {"url": SOURCES[n], "sha256": source_hashes[n]} for n in sorted(SOURCES)},
        "outputs": {n: sha256(d) for n, d in sorted(outputs.items())},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--check", action="store_true", help="fail if outputs differ from MANIFEST.json")
    parser.add_argument("--write-manifest", action="store_true", help="overwrite MANIFEST.json (maintainers only)")
    args = parser.parse_args(argv)

    manifest = build(args.out / "raw", args.out)
    rendered = json.dumps(manifest, indent=2, sort_keys=True) + "\n"

    if args.write_manifest:
        MANIFEST_PATH.write_text(rendered, encoding="utf-8")
        print(f"wrote {MANIFEST_PATH}")
    if args.check:
        expected = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        if expected != manifest:
            for section in ("sources", "outputs"):
                for name, value in manifest[section].items():
                    if expected.get(section, {}).get(name) != value:
                        print(f"MISMATCH {section}/{name}", file=sys.stderr)
            print("Build does not match MANIFEST.json. Do not run experiments on this data.", file=sys.stderr)
            return 1
        print("OK: sources and outputs match MANIFEST.json")
    for name, digest in manifest["outputs"].items():
        print(f"{digest}  {args.out / name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
