"""Export router training pairs (parquet) to prompt,label jsonl for the kNN server.

Lets the server run on RouteLLM's training data before the everyday outcomes exist.
Check the column names and label values in your parquet first.

    python export_pairs.py data/train/routing_pairs.parquet --prompt-col prompt \
        --label-col label --positive "strong" --out data/routing_pairs_knn.jsonl
"""
import argparse
import json

import pandas as pd


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("parquet")
    p.add_argument("--prompt-col", required=True)
    p.add_argument("--label-col", required=True)
    p.add_argument("--positive", required=True, help="label value meaning 'strong model clearly wins'")
    p.add_argument("--out", required=True)
    p.add_argument("--max-rows", type=int, default=None)
    args = p.parse_args()

    df = pd.read_parquet(args.parquet, columns=[args.prompt_col, args.label_col])
    if args.max_rows:
        df = df.sample(n=min(args.max_rows, len(df)), random_state=0)
    positive = df[args.label_col].astype(str) == args.positive
    with open(args.out, "w") as f:
        for prompt, pos in zip(df[args.prompt_col].astype(str), positive):
            f.write(json.dumps({"prompt": prompt, "label": int(pos)}, ensure_ascii=False) + "\n")
    print(f"wrote {len(df)} rows, {positive.mean():.1%} positive -> {args.out}")


if __name__ == "__main__":
    main()
