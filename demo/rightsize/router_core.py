"""Routing logic shared by the server: scorers, calibration, budget dial, model-tier lookup."""
import json
import math
import os
import threading
from pathlib import Path

import numpy as np

# Relative usage cost per tier. Rough; only used for the threshold and the "uses ~N× more" message.
TIER_COST = {"small": float(os.getenv("C_SMALL", 1)), "medium": float(os.getenv("C_MEDIUM", 3)),
             "frontier": float(os.getenv("C_FRONTIER", 10))}
KAPPA = float(os.getenv("KAPPA", 30))  # penalty for a bad answer, in the same units as TIER_COST
CLEARLY_BETTER_GAP = float(os.getenv("CLEARLY_BETTER_GAP", 2))

# Names as they appear in each app's model picker. Edit to match what the pickers show today.
APP_MODELS = {
    "claude": {"small": ["Haiku"], "medium": ["Sonnet"], "frontier": ["Opus", "Fable"]},
    "gemini": {"small": ["Flash-Lite", "Flash Lite", "Fast"], "medium": ["Flash"], "frontier": ["Pro", "Deep Think", "Thinking"]},
    "chatgpt": {"small": ["mini", "nano", "Instant"], "medium": ["Auto"], "frontier": ["Thinking", "Pro"]},
}


def threshold(budget_left: float, save_for_later: bool) -> float:
    """Cost threshold from R2V-Agent: go frontier iff P(strong clearly better) >= tau.

    Scarcity raises the effective price of the frontier model as the plan runs low."""
    scarcity = 1 + (1 - budget_left) + (0.5 if save_for_later else 0)
    return min(1.0, (TIER_COST["frontier"] - TIER_COST["small"]) * scarcity / KAPPA)


def detect_tier(model_name: str, app: str | None = None) -> tuple[str, str] | None:
    """Longest name match, so 'Flash-Lite' wins over 'Flash'. Only searches `app` when given.

    Returns (app, tier)."""
    best = None
    lowered = model_name.lower()
    apps = {app: APP_MODELS[app]} if app else APP_MODELS
    for app_name, tiers in apps.items():
        for tier, names in tiers.items():
            for name in names:
                if name.lower() in lowered and (best is None or len(name) > best[0]):
                    best = (len(name), app_name, tier)
    return (best[1], best[2]) if best else None


def label(row: dict) -> float:
    """1 if the strong model is clearly better on this prompt. Accepts outcomes rows or prompt,label rows."""
    if "label" in row:
        return float(row["label"])
    return float(row["strong_score"] - row["weak_score"] >= CLEARLY_BETTER_GAP)


def load_labeled(paths: list[str]) -> list[dict]:
    rows = []
    for path in paths:
        for line in open(path):
            r = json.loads(line)
            if "label" in r or (r.get("weak_score") is not None and r.get("strong_score") is not None):
                rows.append(r)
    return rows


class KnnScorer:
    """Similarity-weighted kNN on MiniLM embeddings: the strong baseline from REPORT_1, Part 2."""

    name = "knn-minilm"

    def __init__(self, paths: list[str], k: int, embedder: str = "sentence-transformers/all-MiniLM-L12-v2"):
        from sentence_transformers import SentenceTransformer

        rows = load_labeled(paths)
        self.k = min(k, len(rows))
        self.labels = np.array([label(r) for r in rows])
        self.model = SentenceTransformer(embedder)
        self.emb = self.model.encode([r["prompt"] for r in rows], batch_size=256, normalize_embeddings=True)
        print(f"kNN router: {len(rows)} labeled prompts, k={self.k}, base rate {self.labels.mean():.2f}")

    def score(self, text: str) -> float:
        q = self.model.encode([text], normalize_embeddings=True)[0]
        sims = self.emb @ q
        idx = np.argpartition(-sims, self.k - 1)[: self.k]
        w = np.clip(sims[idx], 1e-6, None)
        return float((w * self.labels[idx]).sum() / w.sum())

    def describe(self, raw: float) -> str:
        return f"The big model won on {raw:.0%} of the {self.k} most similar past prompts."


JEV_URL = "https://thejevai.com/v1/systemone"
# Copied from LLM-Router llmrouter/questions.py. All five questions ride in one request (1 credit),
# exactly as when the `reasoning` signal was evaluated, so the live score is the evaluated one.
JEV_QUESTIONS = {
    "strong_better": {
        "type": "noul",
        "instructions": "A user sent this query to an AI assistant. Would a frontier model such as GPT-4 "
                        "give a clearly better answer than a smaller, cheaper open model such as Mixtral-8x7B?",
    },
    "weak_fails": {
        "type": "noul",
        "instructions": "Is a smaller, cheaper language model likely to answer this query incorrectly or poorly?",
    },
    "difficulty": {
        "type": "score",
        "instructions": "How difficult is it for an AI assistant to answer this query correctly and well?",
        "criteria": ["trivial", "easy", "moderate", "hard", "very hard"],
    },
    "reasoning": {
        "type": "score",
        "instructions": "How much careful multi-step reasoning, math or calculation does answering this query need?",
        "criteria": ["none (lookup, chit-chat or style)", "a single step", "a few steps", "many careful steps"],
    },
    "task_type": {
        "type": "choice",
        "instructions": "What kind of task is the user asking for?",
        "criteria": {
            "open_qa": "open-ended question answering from general knowledge",
            "closed_qa": "answering a question with a single correct answer, including multiple choice",
            "summarization": "summarizing a given text",
            "text_generation": "creative or long-form writing",
            "code_generation": "writing or fixing code",
            "chatbot": "casual conversation or role-play",
            "classification": "labeling or categorizing something",
            "rewrite": "rewriting, editing or translating a given text",
            "brainstorming": "generating ideas or lists",
            "extraction": "pulling specific information out of a given text",
            "other": "anything else, including math word problems",
        },
    },
}


class JevScorer:
    """Jev's pre-committed `reasoning` signal: the expected level on a 0-3 scale.

    The request body matches the jev backend of LLM-Router scripts/score.py. That repo cannot be
    imported here, because the demo server must also run on a laptop without it.

    Answers are cached by whitespace-normalized prompt. `seed` is a read-only jsonl of
    {prompt, reasoning} shipped with the demo. New answers are appended to `cache`.
    Set CALIBRATION so the raw level becomes a probability before the threshold is applied."""

    name = "jev-reasoning"
    LEVELS = ["no step-by-step reasoning", "about one reasoning step", "a few reasoning steps",
              "many careful reasoning steps"]

    def __init__(self, seed: str | None, cache: str):
        import httpx

        self.client = httpx.Client(timeout=20, headers={"Authorization": f"Bearer {os.environ['JEV_API_KEY'].strip()}"})
        self.cache_path = Path(cache)
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.known = {}
        for path in (seed, cache):
            if path and Path(path).exists():
                for line in open(path):
                    r = json.loads(line)
                    self.known[self.key(r["prompt"])] = r["reasoning"]
        print(f"Jev router: {len(self.known)} cached prompts")

    @staticmethod
    def key(text: str) -> str:
        return " ".join(text.split())

    def score(self, text: str) -> float:
        k = self.key(text)
        if k in self.known:
            return self.known[k]
        r = self.client.post(JEV_URL, json={"model": "jev-latest", "state": {"user_query": text},
                                            "questions": JEV_QUESTIONS})
        r.raise_for_status()
        d = r.json()
        data = d.get("data", d)  # the live API wraps the documented body in {code, message, data}
        level = float(data.get("result", data)["answers"]["reasoning"]["score"])
        with self.lock:
            self.known[k] = level
            with self.cache_path.open("a") as f:
                f.write(json.dumps({"prompt": k, "reasoning": level}, ensure_ascii=False) + "\n")
        return level

    def describe(self, raw: float) -> str:
        return f"Jev rates it as {self.LEVELS[min(3, round(raw))]} (level {raw:.1f} of 3)."


class Calibrator:
    """1-D logistic regression from a raw router score to P(strong clearly better).

    `scores_path` is one of:
      a jsonl of {id, score} for the everyday prompts, joined with outcome labels by id and fit here;
      a json of {slope, intercept} that was fit elsewhere."""

    def __init__(self, scores_path: str | None, outcomes_paths: list[str]):
        self.coef = None
        if not scores_path:
            return
        if scores_path.endswith(".json"):
            c = json.load(open(scores_path))
            self.coef = (c["slope"], c["intercept"])
            print(f"calibration: slope {c['slope']}, intercept {c['intercept']} from {scores_path}")
            return
        from sklearn.linear_model import LogisticRegression

        labels = {r["id"]: label(r) for r in load_labeled(outcomes_paths) if "id" in r}
        pairs = [(s["score"], labels[s["id"]]) for s in map(json.loads, open(scores_path)) if s["id"] in labels]
        x = np.array([[p[0]] for p in pairs])
        y = np.array([p[1] for p in pairs])
        model = LogisticRegression().fit(x, y)
        self.coef = (float(model.coef_[0, 0]), float(model.intercept_[0]))
        print(f"calibration: fit on {len(pairs)} scored prompts from {scores_path}")

    def __call__(self, raw: float) -> float:
        if self.coef is None:
            return float(np.clip(raw, 0, 1))
        slope, intercept = self.coef
        return 1 / (1 + math.exp(-(slope * raw + intercept)))
