"""Answer each everyday prompt with a weak and a strong Gemini model, then grade each answer 1-10.

Grading uses MT-Bench's single-answer judge prompt. Each answer is judged on its own; the judge
never sees both answers. No output limit is set below the model's own maximum.

Spend is computed from the token usage of every response. The run stops starting new calls once
--budget-usd is reached. Resumable: ids already in --out are skipped, so a rerun pays only for
what is missing.

This is the Gemini-native version of make_outcomes.py. It adds cost tracking and the budget stop,
and writes the same fields, so category_gaps.py and the server read its output unchanged.

    export GEMINI_API_KEY=...
    python make_outcomes_gemini.py data/everyday.jsonl --out data/everyday_outcomes.jsonl --budget-usd 2 --limit 5
    python make_outcomes_gemini.py data/everyday.jsonl --out data/everyday_outcomes.jsonl --budget-usd 20
"""
import argparse
import asyncio
import json
import os
import re
import time
from pathlib import Path

import httpx

API = "https://generativelanguage.googleapis.com/v1beta/models"

# USD per 1M tokens (input, output including thinking), paid Standard tier, prompts up to 200k tokens.
# Read from https://ai.google.dev/gemini-api/docs/pricing on 2026-10-10. Output limits are from the Models API.
PRICES = {
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gemini-3.1-pro-preview": (2.00, 12.00),
    "gemini-3.8-flash": (0.75, 3.75),
}
MAX_OUTPUT_TOKENS = 65536

JUDGE_TEMPLATE = """[Instruction]
Please act as an impartial judge and evaluate the quality of the response provided by an AI assistant to the user question displayed below. Your evaluation should consider factors such as the helpfulness, relevance, accuracy, depth, creativity, and level of detail of the response. Begin your evaluation by providing a short explanation. Be as objective as possible. After providing your explanation, you must rate the response on a scale of 1 to 10 by strictly following this format: "[[rating]]", for example: "Rating: [[5]]".

[Question]
{question}

[The Start of Assistant's Answer]
{answer}
[The End of Assistant's Answer]"""

RATING = re.compile(r"\[\[(\d+(?:\.\d+)?)\]\]")


class Budget:
    def __init__(self, cap: float):
        self.cap, self.spent = cap, 0.0

    def check(self) -> None:
        if self.spent >= self.cap:
            raise SystemExit(f"budget cap reached: spent ${self.spent:.2f} of ${self.cap:.2f}; rerun to resume")


async def generate(client: httpx.AsyncClient, budget: Budget, model: str, content: str) -> dict:
    """One call. Returns the visible text, the finish reason, token usage, cost and latency."""
    body = {"contents": [{"role": "user", "parts": [{"text": content}]}],
            "generationConfig": {"maxOutputTokens": MAX_OUTPUT_TOKENS}}
    for attempt in range(7):
        budget.check()
        t0 = time.perf_counter()
        r = await client.post(f"{API}/{model}:generateContent", json=body)
        if r.status_code in (429, 500, 502, 503, 504):
            await asyncio.sleep(min(60, 2 ** attempt * 2))
            continue
        if r.status_code != 200:
            raise SystemExit(f"{model} HTTP {r.status_code}: {r.text[:400]}")
        d = r.json()
        u = d.get("usageMetadata", {})
        tokens_in = u.get("promptTokenCount", 0)
        tokens_out = u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)
        price_in, price_out = PRICES[model]
        cost = (tokens_in * price_in + tokens_out * price_out) / 1e6
        budget.spent += cost
        cand = (d.get("candidates") or [{}])[0]
        parts = cand.get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        return {"text": text, "finish": cand.get("finishReason"), "tokens_in": tokens_in,
                "tokens_out": u.get("candidatesTokenCount", 0), "tokens_thinking": u.get("thoughtsTokenCount", 0),
                "cost_usd": round(cost, 6), "latency_s": round(time.perf_counter() - t0, 2)}
    raise SystemExit(f"{model}: gave up after repeated 429/5xx")


async def judge(client, budget, model: str, question: str, answer: dict) -> tuple[float | None, dict]:
    if not answer["text"].strip():  # blocked or empty answer: nothing to grade
        return None, {"text": "", "cost_usd": 0.0}
    out = await generate(client, budget, model, JUDGE_TEMPLATE.format(question=question, answer=answer["text"]))
    m = RATING.search(out["text"])
    return (float(m.group(1)) if m else None), out


async def run_one(row: dict, args, client, budget, sem: asyncio.Semaphore) -> dict:
    async with sem:
        weak, strong = await asyncio.gather(generate(client, budget, args.weak, row["prompt"]),
                                            generate(client, budget, args.strong, row["prompt"]))
        (weak_score, weak_j), (strong_score, strong_j) = await asyncio.gather(
            judge(client, budget, args.judge, row["prompt"], weak),
            judge(client, budget, args.judge, row["prompt"], strong))
    usage = {k: v for k, v in (("weak", weak), ("strong", strong), ("weak_judge", weak_j), ("strong_judge", strong_j))}
    return {**row, "weak_model": args.weak, "strong_model": args.strong, "judge_model": args.judge,
            "weak_answer": weak["text"], "strong_answer": strong["text"],
            "weak_score": weak_score, "strong_score": strong_score,
            "weak_judgment": weak_j["text"], "strong_judgment": strong_j["text"],
            "usage": {name: {k: v for k, v in u.items() if k != "text"} for name, u in usage.items()}}


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("inputs", nargs="+")
    p.add_argument("--out", required=True)
    p.add_argument("--weak", default="gemini-3.5-flash-lite")
    p.add_argument("--strong", default="gemini-3.1-pro-preview")
    p.add_argument("--judge", default="gemini-3.8-flash")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--budget-usd", type=float, required=True, help="stop starting new calls at this spend")
    args = p.parse_args()

    out = Path(args.out)
    done = {json.loads(line)["id"] for line in out.open()} if out.exists() else set()
    rows = [json.loads(line) for path in args.inputs for line in open(path)]
    todo = [r for r in rows if r["id"] not in done][: args.limit]
    print(f"{len(rows)} prompts, {len(done)} already done, running {len(todo)}; "
          f"weak={args.weak} strong={args.strong} judge={args.judge}", flush=True)

    budget = Budget(args.budget_usd)
    sem = asyncio.Semaphore(args.concurrency)
    missing = 0
    async with httpx.AsyncClient(timeout=900, headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"].strip()}) as client:
        tasks = [asyncio.create_task(run_one(r, args, client, budget, sem)) for r in todo]
        with out.open("a") as f:
            for n, fut in enumerate(asyncio.as_completed(tasks), 1):
                result = await fut
                missing += result["weak_score"] is None or result["strong_score"] is None
                f.write(json.dumps(result, ensure_ascii=False) + "\n")
                f.flush()
                if args.limit or n % 10 == 0 or n == len(tasks):
                    print(f"  {n}/{len(tasks)} done, {missing} without both ratings, spent ${budget.spent:.2f}", flush=True)
    print(f"spent in this run: ${budget.spent:.2f}")
    if missing:
        print(f"{missing} rows lack a rating; see weak_judgment / strong_judgment and usage.*.finish in {out}")


if __name__ == "__main__":
    asyncio.run(main())
