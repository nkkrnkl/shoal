"""Outcome table for the shared MT-Bench subset: a weak and a strong Gemini model answer both turns
of every question, and a judge grades each turn 1-10.

It follows MT-Bench's own protocol (FastChat llm_judge, single-answer grading):
  - Each model holds its own two-turn conversation: turn 2 is answered after its own turn-1 answer.
  - Turn 1 is graded with `single-v1`, turn 2 with `single-v1-multi-turn`.
  - Math, reasoning and coding questions use the `single-math-v1` variants with the reference answers.
The judge prompts are the pinned ones from build.py, so both tracks grade the same way.

No output limit is set below the model's own maximum. Spend is computed from the token usage of
every response, and the run stops starting new calls once --budget-usd is reached. Resumable:
question ids already in --out are skipped.

Usage (from the evals/ directory, after `python -m shoal_evals.mtbench.build --check`):
  export GEMINI_API_KEY=...
  python -m shoal_evals.mtbench.outcomes --out data/mtbench/outcomes_gemini.jsonl --budget-usd 2 --ids 81,101
  python -m shoal_evals.mtbench.outcomes --out data/mtbench/outcomes_gemini.jsonl --budget-usd 20

Needs httpx.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import time
from pathlib import Path

import httpx

from shoal_evals.mtbench.build import DEFAULT_OUT

API = "https://generativelanguage.googleapis.com/v1beta/models"

# USD per 1M tokens (input, output including thinking), paid Standard tier, prompts up to 200k tokens.
# Read from https://ai.google.dev/gemini-api/docs/pricing on 2026-10-10. Output limit is from the Models API.
PRICES = {
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gemini-3.1-pro-preview": (2.00, 12.00),
    "gemini-3.8-flash": (0.75, 3.75),
}
MAX_OUTPUT_TOKENS = 65536

RATING = re.compile(r"\[\[(\d+\.?\d*)\]\]")
RATING_BACKUP = re.compile(r"\[(\d+\.?\d*)\]")  # FastChat's fallback pattern


class Budget:
    def __init__(self, cap: float):
        self.cap, self.spent = cap, 0.0

    def check(self) -> None:
        if self.spent >= self.cap:
            raise SystemExit(f"budget cap reached: spent ${self.spent:.2f} of ${self.cap:.2f}; rerun to resume")


async def generate(client: httpx.AsyncClient, budget: Budget, model: str, turns: list[str], system: str | None = None) -> dict:
    """One call. `turns` alternates user, model, user. Returns visible text, finish reason, usage, cost, latency."""
    body: dict = {
        "contents": [{"role": "user" if i % 2 == 0 else "model", "parts": [{"text": t}]} for i, t in enumerate(turns)],
        "generationConfig": {"maxOutputTokens": MAX_OUTPUT_TOKENS},
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    for attempt in range(7):
        budget.check()
        t0 = time.perf_counter()
        r = await client.post(f"{API}/{model}:generateContent", json=body)
        if r.status_code in (429, 500, 502, 503, 504):
            await asyncio.sleep(min(60, 2**attempt * 2))
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
        return {
            "text": "".join(p.get("text", "") for p in parts if not p.get("thought")),
            "finish": cand.get("finishReason"),
            "tokens_in": tokens_in,
            "tokens_out": u.get("candidatesTokenCount", 0),
            "tokens_thinking": u.get("thoughtsTokenCount", 0),
            "cost_usd": round(cost, 6),
            "latency_s": round(time.perf_counter() - t0, 2),
        }
    raise SystemExit(f"{model}: gave up after repeated 429/5xx")


async def answer_both_turns(client, budget, model: str, item: dict) -> list[dict]:
    first = await generate(client, budget, model, [item["turns"][0]])
    second = await generate(client, budget, model, [item["turns"][0], first["text"], item["turns"][1]])
    return [first, second]


async def judge_turn(client, budget, judge: str, prompts: dict, item: dict, answers: list[dict], turn: int) -> dict:
    """Grades turn 0 or 1 of one model's conversation with the matching MT-Bench single-answer prompt."""
    if not all(a["text"].strip() for a in answers[: turn + 1]):  # blocked or empty answer: nothing to grade
        return {"score": None, "text": "", "cost_usd": 0.0}
    ref = item.get("reference")
    name = ("single-math-v1" if ref else "single-v1") + ("-multi-turn" if turn else "")
    fields = {"ref_answer_1": ref[0], "ref_answer_2": ref[1]} if ref else {}
    if turn == 0:
        fields |= {"question": item["turns"][0], "answer": answers[0]["text"]}
    else:
        fields |= {"question_1": item["turns"][0], "answer_1": answers[0]["text"],
                   "question_2": item["turns"][1], "answer_2": answers[1]["text"]}  # fmt: skip
    out = await generate(client, budget, judge, [prompts[name]["prompt_template"].format(**fields)],
                         system=prompts[name]["system_prompt"])  # fmt: skip
    m = RATING.search(out["text"]) or RATING_BACKUP.search(out["text"])
    return {**out, "score": float(m.group(1)) if m else None, "judge_prompt": name}


async def run_one(item: dict, args, prompts: dict, client, budget, sem: asyncio.Semaphore) -> dict:
    async with sem:
        weak, strong = await asyncio.gather(answer_both_turns(client, budget, args.weak, item),
                                            answer_both_turns(client, budget, args.strong, item))  # fmt: skip
        grades = await asyncio.gather(*(judge_turn(client, budget, args.judge, prompts, item, answers, turn)
                                        for answers in (weak, strong) for turn in (0, 1)))  # fmt: skip
    weak_j, strong_j = grades[:2], grades[2:]

    def slim(calls: list[dict]) -> list[dict]:
        return [{k: v for k, v in c.items() if k not in ("text", "score")} for c in calls]

    return {
        "question_id": item["question_id"], "category": item["category"], "split": item["split"],
        "turns": item["turns"],
        "weak_model": args.weak, "strong_model": args.strong, "judge_model": args.judge,
        "weak_answers": [a["text"] for a in weak], "strong_answers": [a["text"] for a in strong],
        "weak_scores": [j["score"] for j in weak_j], "strong_scores": [j["score"] for j in strong_j],
        "weak_judgments": [j["text"] for j in weak_j], "strong_judgments": [j["text"] for j in strong_j],
        "usage": {"weak": slim(weak), "strong": slim(strong), "weak_judge": slim(weak_j), "strong_judge": slim(strong_j)},
    }  # fmt: skip


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--items", default=str(DEFAULT_OUT / "items.jsonl"))
    p.add_argument("--judge-prompts", default=str(DEFAULT_OUT / "judge_prompts.jsonl"))
    p.add_argument("--out", required=True)
    p.add_argument("--weak", default="gemini-3.5-flash-lite")
    p.add_argument("--strong", default="gemini-3.1-pro-preview")
    p.add_argument("--judge", default="gemini-3.8-flash")
    p.add_argument("--ids", default=None, help="comma-separated question ids, for a smoke test")
    p.add_argument("--concurrency", type=int, default=6)
    p.add_argument("--budget-usd", type=float, required=True, help="stop starting new calls at this spend")
    args = p.parse_args()

    out = Path(args.out)
    done = {json.loads(line)["question_id"] for line in out.open()} if out.exists() else set()
    items = [json.loads(line) for line in open(args.items)]
    prompts = {j["name"]: j for j in map(json.loads, open(args.judge_prompts))}
    only = {int(i) for i in args.ids.split(",")} if args.ids else None
    todo = [i for i in items if i["question_id"] not in done and (only is None or i["question_id"] in only)]
    print(f"{len(items)} questions, {len(done)} already done, running {len(todo)}; "
          f"weak={args.weak} strong={args.strong} judge={args.judge}", flush=True)  # fmt: skip

    budget = Budget(args.budget_usd)
    sem = asyncio.Semaphore(args.concurrency)
    missing = 0
    async with httpx.AsyncClient(timeout=900, headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"].strip()}) as client:
        tasks = [asyncio.create_task(run_one(i, args, prompts, client, budget, sem)) for i in todo]
        with out.open("a") as f:
            for n, fut in enumerate(asyncio.as_completed(tasks), 1):
                row = await fut
                missing += None in row["weak_scores"] or None in row["strong_scores"]
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
                f.flush()
                if args.ids or n % 10 == 0 or n == len(tasks):
                    print(f"  {n}/{len(tasks)} done, {missing} without all four ratings, spent ${budget.spent:.2f}", flush=True)
    print(f"spent in this run: ${budget.spent:.2f}")


if __name__ == "__main__":
    asyncio.run(main())
