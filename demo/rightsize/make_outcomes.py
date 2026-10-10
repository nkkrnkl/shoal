"""Answer each prompt with a weak and a strong model, then grade each answer 1-10.

Grading uses MT-Bench's single-answer judge prompt, so scores sit on the same scale as
MT-Bench quality in the LLM-Router repo. Each answer is judged on its own.

Every role talks to an OpenAI-compatible endpoint (vLLM, OpenAI, or a provider's
compatibility endpoint). Configure with environment variables:

    WEAK_BASE_URL   WEAK_MODEL   WEAK_API_KEY   [WEAK_EXTRA_BODY='{"...": ...}']   [WEAK_TEMPERATURE]
    STRONG_BASE_URL STRONG_MODEL STRONG_API_KEY ...
    JUDGE_BASE_URL  JUDGE_MODEL  JUDGE_API_KEY  ...

    python make_outcomes.py data/everyday_clean.jsonl --out data/everyday_outcomes.jsonl --limit 10
    python make_outcomes.py data/everyday_clean.jsonl --out data/everyday_outcomes.jsonl

Resumable: ids already in --out are skipped.
"""
import argparse
import asyncio
import json
import os
import re
from pathlib import Path

from openai import AsyncOpenAI

JUDGE_TEMPLATE = """[Instruction]
Please act as an impartial judge and evaluate the quality of the response provided by an AI assistant to the user question displayed below. Your evaluation should consider factors such as the helpfulness, relevance, accuracy, depth, creativity, and level of detail of the response. Begin your evaluation by providing a short explanation. Be as objective as possible. After providing your explanation, you must rate the response on a scale of 1 to 10 by strictly following this format: "[[rating]]", for example: "Rating: [[5]]".

[Question]
{question}

[The Start of Assistant's Answer]
{answer}
[The End of Assistant's Answer]"""

RATING = re.compile(r"\[\[(\d+(?:\.\d+)?)\]\]")


class Role:
    def __init__(self, name: str):
        self.model = os.environ[f"{name}_MODEL"]
        self.client = AsyncOpenAI(base_url=os.environ[f"{name}_BASE_URL"],
                                  api_key=os.environ.get(f"{name}_API_KEY", "EMPTY"), max_retries=6)
        extra = os.environ.get(f"{name}_EXTRA_BODY")
        self.extra_body = json.loads(extra) if extra else None
        temp = os.environ.get(f"{name}_TEMPERATURE")
        self.temperature = float(temp) if temp else None

    async def chat(self, content: str) -> str:
        kwargs = {"model": self.model, "messages": [{"role": "user", "content": content}]}
        if self.extra_body is not None:
            kwargs["extra_body"] = self.extra_body
        if self.temperature is not None:
            kwargs["temperature"] = self.temperature
        resp = await self.client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content or ""


async def judge(j: Role, question: str, answer: str) -> tuple[float | None, str]:
    text = await j.chat(JUDGE_TEMPLATE.format(question=question, answer=answer))
    m = RATING.search(text)
    return (float(m.group(1)) if m else None), text


async def run_one(row: dict, weak: Role, strong: Role, j: Role, sem: asyncio.Semaphore) -> dict:
    async with sem:
        weak_answer, strong_answer = await asyncio.gather(weak.chat(row["prompt"]), strong.chat(row["prompt"]))
        (weak_score, weak_judgment), (strong_score, strong_judgment) = await asyncio.gather(
            judge(j, row["prompt"], weak_answer), judge(j, row["prompt"], strong_answer))
    return {**row, "weak_model": weak.model, "strong_model": strong.model, "judge_model": j.model,
            "weak_answer": weak_answer, "strong_answer": strong_answer,
            "weak_score": weak_score, "strong_score": strong_score,
            "weak_judgment": weak_judgment, "strong_judgment": strong_judgment}


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("inputs", nargs="+")
    p.add_argument("--out", required=True)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--concurrency", type=int, default=6)
    args = p.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    done = {json.loads(line)["id"] for line in out.open()} if out.exists() else set()
    rows = [json.loads(line) for path in args.inputs for line in open(path)]
    todo = [r for r in rows if r["id"] not in done][: args.limit]
    print(f"{len(rows)} prompts, {len(done)} already done, running {len(todo)}")

    weak, strong, j = Role("WEAK"), Role("STRONG"), Role("JUDGE")
    sem = asyncio.Semaphore(args.concurrency)
    tasks = [asyncio.create_task(run_one(r, weak, strong, j, sem)) for r in todo]
    missing = 0
    with out.open("a") as f:
        for n, fut in enumerate(asyncio.as_completed(tasks), 1):
            result = await fut
            missing += result["weak_score"] is None or result["strong_score"] is None
            f.write(json.dumps(result, ensure_ascii=False) + "\n")
            f.flush()
            if n % 10 == 0 or n == len(tasks):
                print(f"  {n}/{len(tasks)} done, {missing} without a parsed rating")
    if missing:
        print(f"{missing} rows lack a [[rating]]; see weak_judgment / strong_judgment in {out}")


if __name__ == "__main__":
    asyncio.run(main())
