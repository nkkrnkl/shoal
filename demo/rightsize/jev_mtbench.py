"""Jev `reasoning` levels for the shared MT-Bench subset, for both turns of every question.

Three scores per question, one Jev credit each:
  turn1          the first user message
  turn2_context  the second user message, with the first user message given as context
  turn2_alone    the second user message only

Resumable: question ids already in --out are skipped.

    export JEV_API_KEY=...
    python jev_mtbench.py ../../evals/data/mtbench/items.jsonl --out ../../evals/data/mtbench/jev_scores.jsonl
"""
import argparse
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from router_core import JEV_QUESTIONS, JEV_URL


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("items")
    p.add_argument("--out", required=True)
    p.add_argument("--concurrency", type=int, default=3)
    args = p.parse_args()

    client = httpx.Client(timeout=60, headers={"Authorization": f"Bearer {os.environ['JEV_API_KEY'].strip()}"})

    def level(state: dict) -> float:
        r = client.post(JEV_URL, json={"model": "jev-latest", "state": state, "questions": JEV_QUESTIONS})
        r.raise_for_status()
        d = r.json()
        data = d.get("data", d)  # the live API wraps the documented body in {code, message, data}
        return float(data.get("result", data)["answers"]["reasoning"]["score"])

    def one(item: dict) -> dict:
        first, second = item["turns"]
        return {"question_id": item["question_id"], "category": item["category"],
                "turn1": level({"user_query": first}),
                "turn2_context": level({"earlier_user_message": first, "user_query": second}),
                "turn2_alone": level({"user_query": second})}

    out = Path(args.out)
    done = {json.loads(line)["question_id"] for line in out.open()} if out.exists() else set()
    todo = [i for i in map(json.loads, open(args.items)) if i["question_id"] not in done]
    print(f"{len(done)} questions already scored, sending {3 * len(todo)} Jev requests for {len(todo)} questions")
    with out.open("a") as f, ThreadPoolExecutor(args.concurrency) as pool:
        for n, row in enumerate(pool.map(one, todo), 1):
            f.write(json.dumps(row) + "\n")
            f.flush()
            if n % 20 == 0 or n == len(todo):
                print(f"  {n}/{len(todo)} questions scored", flush=True)


if __name__ == "__main__":
    main()
