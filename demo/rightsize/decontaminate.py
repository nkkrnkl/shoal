"""Drop test prompts that match router training prompts exactly or nearly.

    python decontaminate.py data/everyday.jsonl data/wildchat_sample.jsonl \
        --train data/train/routing_pairs.parquet --prompt-col prompt --out data/everyday_clean.jsonl

Exact match after lowercasing and collapsing whitespace, or MiniLM cosine >= --threshold.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer


def norm(text: str) -> str:
    return " ".join(text.lower().split())


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("inputs", nargs="+")
    p.add_argument("--train", required=True)
    p.add_argument("--prompt-col", default="prompt")
    p.add_argument("--threshold", type=float, default=0.95)
    p.add_argument("--embedder", default="sentence-transformers/all-MiniLM-L12-v2")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    rows = [json.loads(line) for path in args.inputs for line in open(path)]
    train = pd.read_parquet(args.train, columns=[args.prompt_col])[args.prompt_col].astype(str).tolist()
    train_exact = {norm(t) for t in train}

    model = SentenceTransformer(args.embedder)
    train_emb = model.encode(train, batch_size=256, normalize_embeddings=True, show_progress_bar=True)
    test_emb = model.encode([r["prompt"] for r in rows], batch_size=256, normalize_embeddings=True)

    best_sim = np.full(len(rows), -np.inf, dtype=np.float32)
    best_idx = np.zeros(len(rows), dtype=np.int64)
    for start in range(0, len(train_emb), 50000):
        sims = test_emb @ train_emb[start:start + 50000].T
        chunk_best = sims.max(axis=1)
        better = chunk_best > best_sim
        best_idx = np.where(better, sims.argmax(axis=1) + start, best_idx)
        best_sim = np.where(better, chunk_best, best_sim)

    kept, dropped = [], []
    for r, sim, idx in zip(rows, best_sim, best_idx):
        if norm(r["prompt"]) in train_exact or sim >= args.threshold:
            dropped.append((r["id"], float(sim), train[idx][:80]))
        else:
            kept.append(r)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as f:
        for r in kept:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"kept {len(kept)}, dropped {len(dropped)} (threshold {args.threshold}) -> {out}")
    for rid, sim, match in dropped:
        print(f"  dropped {rid}  cos={sim:.3f}  matches: {match!r}")


if __name__ == "__main__":
    main()
