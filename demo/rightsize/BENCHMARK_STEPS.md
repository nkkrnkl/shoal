_This is the original README of the `rightsize` folder. It was written for the folder sitting at the root of the LLM-Router repo, so paths such as `../data/train/` refer to that repo. For the demo, see [README.md](README.md)._

# rightsize/

Scripts for EVERYDAY_ROUTER_PLAN.md. Put this folder at the root of the LLM-Router repo.

```bash
pip install -r rightsize/requirements.txt
cd rightsize
```

## 1. Everyday benchmark

```bash
python everyday_prompts.py                                  # data/everyday.jsonl (142 curated)
python sample_wildchat.py --n 150                           # data/wildchat_sample.jsonl (real traffic)
python decontaminate.py data/everyday.jsonl data/wildchat_sample.jsonl \
    --train ../data/train/routing_pairs.parquet --prompt-col <prompt column> --out data/everyday_clean.jsonl

# Weak, strong and judge models: any OpenAI-compatible endpoint. Fix these choices before running.
export WEAK_BASE_URL=...   WEAK_MODEL=...   WEAK_API_KEY=...
export STRONG_BASE_URL=... STRONG_MODEL=... STRONG_API_KEY=...
export JUDGE_BASE_URL=...  JUDGE_MODEL=...  JUDGE_API_KEY=...  JUDGE_TEMPERATURE=0
# Local weak model on the GPU box instead: vllm serve Qwen/Qwen3-8B --port 8001
#   WEAK_BASE_URL=http://localhost:8001/v1 WEAK_MODEL=Qwen/Qwen3-8B
#   WEAK_EXTRA_BODY='{"chat_template_kwargs": {"enable_thinking": false}}'

python make_outcomes.py data/everyday_clean.jsonl --out data/everyday_outcomes.jsonl --limit 5   # smoke test
python make_outcomes.py data/everyday_clean.jsonl --out data/everyday_outcomes.jsonl              # full run, resumable
python category_gaps.py data/everyday_outcomes.jsonl --csv everyday_category_gaps.csv            # slide 1
```

## 2. Router service

```bash
# Before outcomes exist, run kNN on the RouteLLM training pairs (check the column names and label values first):
python export_pairs.py ../data/train/routing_pairs.parquet --prompt-col <col> --label-col <col> \
    --positive <value meaning strong clearly wins> --out data/routing_pairs_knn.jsonl --max-rows 50000
ROUTER=knn KNN_DATA=data/routing_pairs_knn.jsonl KNN_K=100 uvicorn server:app --port 8000

# Once the everyday outcomes exist (demo only; reported numbers come from the repo's evaluator):
ROUTER=knn KNN_DATA=data/everyday_outcomes.jsonl,data/routing_pairs_knn.jsonl KNN_K=50 uvicorn server:app --port 8000

# Jev: wire JevScorer.score() in router_core.py to the repo's Jev client first.
# CALIBRATION is a jsonl of {id, score} for the everyday prompts (the raw `reasoning` level).
ROUTER=jev CALIBRATION=data/jev_reasoning_everyday.jsonl uvicorn server:app --port 8000

curl -s localhost:8000/route -H 'content-type: application/json' \
  -d '{"text":"suggest something to eat, I am tired","current_model":"Fable","app":"claude"}'
```

Budget dial: go frontier iff P(strong clearly better) ≥ τ, with τ = min(1, (c_frontier − c_small)·s/κ) and s = 1 + (1 − budget_left) + 0.5·[save_for_later]. The defaults (C_SMALL=1, C_FRONTIER=10, KAPPA=30) give τ = 0.30 at full budget, 0.51 at 30% left, and 0.66 at 30% left while saving for later.

## 3. Chrome extension

Go to `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `extension/`. Open claude.ai and type; the card appears about 0.7 s after you stop typing. The toolbar popup has the budget slider, the "saving for later" checkbox, a model-tier override and the router address.

The model picker names live in `content.js` (`PICKER_NAMES`) and `router_core.py` (`APP_MODELS`). Update both to match what the apps show today.
