"""Sample real single-turn English prompts from WildChat-1M (public, ODC-BY).

WildChat is not part of RouteLLM's router training data (Arena-55k, Nectar, MMLU val),
so it can be used to test routers trained on that data. Still run decontaminate.py.

    python sample_wildchat.py --n 150 --out data/wildchat_sample.jsonl
"""
import argparse
import json
import random
from pathlib import Path

from datasets import load_dataset

# Templated prompts that dominate WildChat and are not everyday use.
SKIP_SUBSTRINGS = ["midjourney", "as a prompt generator", "[inst]", "ignore all previous instructions"]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=150)
    p.add_argument("--out", default="data/wildchat_sample.jsonl")
    p.add_argument("--scan", type=int, default=60000, help="rows to stream before sampling")
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()

    ds = load_dataset("allenai/WildChat-1M", split="train", streaming=True)
    pool, seen = [], set()
    for row in ds.take(args.scan):
        if row["language"] != "English" or row["turn"] != 1 or row["toxic"] or row["redacted"]:
            continue
        first = row["conversation"][0]
        if first["role"] != "user":
            continue
        text = first["content"].strip()
        key = " ".join(text.lower().split())
        if not 16 <= len(text) <= 1500 or key in seen or any(s in key for s in SKIP_SUBSTRINGS):
            continue
        seen.add(key)
        pool.append({"hash": row["conversation_hash"], "prompt": text})

    sample = random.Random(args.seed).sample(pool, args.n)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as f:
        for i, r in enumerate(sample):
            row = {"id": f"wildchat-{i:03d}", "category": "wildchat", "source": "wildchat",
                   "wildchat_hash": r["hash"], "prompt": r["prompt"]}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"scanned {args.scan} rows, {len(pool)} eligible, wrote {len(sample)} to {out}")


if __name__ == "__main__":
    main()
