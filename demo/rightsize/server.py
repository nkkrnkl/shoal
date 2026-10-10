"""Right-size router service.

    ./run.sh                                                    # the demo: Jev, MT-Bench calibration
    ROUTER=knn KNN_DATA=data/everyday_outcomes.jsonl uvicorn server:app --port 8000

POST /route  {"text": "...", "current_model": "Fable", "budget_left": 1.0, "save_for_later": false}
"""
import json
import os
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from router_core import TIER_COST, Calibrator, JevScorer, KnnScorer, detect_tier, threshold

KNN_DATA = os.getenv("KNN_DATA", "data/everyday_outcomes.jsonl").split(",")
ROUTER = os.getenv("ROUTER", "knn")
SCORER = (KnnScorer(KNN_DATA, k=int(os.getenv("KNN_K", 10))) if ROUTER == "knn"
          else JevScorer(os.getenv("JEV_SEED", "data/jev_everyday.jsonl"), os.getenv("JEV_CACHE", "logs/jev_cache.jsonl")))
CALIBRATE = Calibrator(os.getenv("CALIBRATION"), KNN_DATA)
LOG = Path(os.getenv("ROUTE_LOG", "logs/routes.jsonl"))
LOG.parent.mkdir(parents=True, exist_ok=True)

SMALL_NAME = {"claude": "Haiku", "gemini": "Flash-Lite", "chatgpt": "a mini model"}
FRONTIER_NAME = {"claude": "Opus or Fable", "gemini": "Pro", "chatgpt": "a Thinking model"}

app = FastAPI(title="Right-size")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class RouteIn(BaseModel):
    text: str
    current_model: str | None = None
    current_tier: str | None = None  # "small" | "medium" | "frontier"; overrides current_model
    app: str | None = None           # "claude" | "gemini" | "chatgpt"
    budget_left: float = 1.0
    save_for_later: bool = False


def message(rec: str, p: float, borderline: bool, cur_tier: str | None, cur_name: str | None,
            app_name: str | None) -> tuple[str, float | None]:
    pct = round(100 * p)
    small = SMALL_NAME.get(app_name or "", "a small model")
    big = FRONTIER_NAME.get(app_name or "", "a frontier model")
    on = f"You're on {cur_name}" if cur_name else "Your current model"
    if rec == "small":
        ratio = TIER_COST[cur_tier] / TIER_COST["small"] if cur_tier in ("medium", "frontier") else None
        if borderline:
            lead = f"Borderline ({pct}% chance a bigger model does clearly better). To save your plan, use {small}."
        elif cur_tier == "small":
            return f"Good pick. A small model fits this ({pct}% chance a bigger one helps).", None
        else:  # a bigger model, or the model could not be read from the page
            lead = f"A small model handles this ({pct}% chance a bigger one helps). Try {small}."
        if ratio:
            lead += f" {on}, which uses about {ratio:.0f}× more of your plan."
        return lead, ratio
    if cur_tier in ("small", "medium"):
        return f"This looks hard ({pct}% chance a bigger model does clearly better). Consider {big}.", None
    return f"Worth the big model ({pct}% chance it does clearly better).", None


@app.get("/health")
def health() -> dict:
    return {"ok": True, "router": SCORER.name, "calibrated": CALIBRATE.coef is not None}


@app.post("/route")
def route(req: RouteIn) -> dict:
    t0 = time.perf_counter()
    try:
        raw = SCORER.score(req.text)
    except httpx.HTTPError as e:  # Jev is unreachable or refused the request: tell the extension why
        raise HTTPException(502, f"Jev request failed: {e}") from e
    p = CALIBRATE(raw)
    tau = threshold(req.budget_left, req.save_for_later)
    rec = "frontier" if p >= tau else "small"

    borderline = rec == "small" and p >= threshold(1.0, False)  # would go frontier at a full budget

    detected = detect_tier(req.current_model, req.app) if req.current_model else None
    app_name = req.app or (detected[0] if detected else None)
    cur_tier = req.current_tier or (detected[1] if detected else None)
    text, ratio = message(rec, p, borderline, cur_tier, req.current_model, app_name)

    out = {"p_strong": round(p, 3), "raw_score": round(raw, 3), "threshold": round(tau, 3), "recommend": rec,
           "current_tier": cur_tier, "usage_ratio": ratio, "message": text, "why": SCORER.describe(raw),
           "router": SCORER.name,
           "latency_ms": round(1000 * (time.perf_counter() - t0), 1)}
    with LOG.open("a") as f:
        f.write(json.dumps({"ts": time.time(), "text": req.text[:500], "budget_left": req.budget_left,
                            "save_for_later": req.save_for_later, **out}) + "\n")
    return out
