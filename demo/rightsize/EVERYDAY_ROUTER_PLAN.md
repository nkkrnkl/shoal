# Everyday routing benchmark and Right-size demo

Brief for Claude Code. Hackathon day (Sat Oct 10, 2026, Betaworks NYC). Two people. The teammate owns context management; do not touch that code.

## What we are building

**Right-size** tells you, before you send a prompt in Claude, Gemini or ChatGPT, whether a small model is enough. Example: "You're using Fable to pick dinner. A small model handles this, and Fable uses roughly 10× more of the plan you want for tonight's coding."

Three parts:

1. **Everyday benchmark.** Real-use prompts with weak-model and strong-model quality scores, so every router in this repo can be scored on everyday traffic. This is the evidence for the pitch.
2. **Router service.** `POST /route` returns P(strong model clearly better) and a recommendation, with a budget dial.
3. **Chrome extension.** Shows the recommendation on claude.ai, gemini.google.com and chatgpt.com as you type.

Voice comes later and is out of scope here until steps 1–5 are done.

## What already exists (from docs/REPORT_1)

- Repo `LLM-Router`:
  - `llmrouter/benchmarks.py`: loads and decontaminates MT-Bench, GSM8K and MMLU.
  - `llmrouter/questions.py`: the Jev and Laya questions.
  - `llmrouter/metrics.py`: exact call-performance curve, APGR, CPT, AUROC and bootstrap CI.
  - `scripts/score.py --backend {jev,laya-ft,p2l,...} --bench ...`: writes `results/scores/<backend>/<bench>.jsonl`.
  - `scripts/train_encoder_router.py` and `scripts/embedding_routers.py`: ModernBERT, kNN, MLP and MF routers.
  - `scripts/compare_routers.py`: tables, paired bootstrap and figures.
- Jev: `JEV_API_KEY` in `.env`. One credit and about 0.75 s per prompt; all questions go in one call. The plan limits concurrent requests (3 or 10).
- Findings to respect:
  - Jev's `difficulty`, `strong_better` and `weak_fails` rank well within one domain but point the wrong way across domains. They call roleplay hard and math easy.
  - Jev's `reasoning` question was fixed in advance and works across domains (MT-Bench 0.672, GSM8K 0.600, MMLU 0.571).
  - Trained routers sit at mean APGR 0.60–0.62. Plain kNN on MiniLM embeddings ties the best of them.
  - Human Arena votes carry almost no routing signal (validation AUROC about 0.50). Judge labels do (about 0.81).
  - On MT-Bench, GPT-4 beat Mixtral by under 0.1 judge points on writing, roleplay and humanities, and by 1.5–2.6 points on extraction, math and coding.

## Rules

- Read the relevant files before editing anything. Make the smallest change that works. Don't refactor existing code.
- No try/except that swallows errors. Let errors surface.
- Write new outputs to new paths. Never overwrite `results/` or `docs/` files from earlier studies.
- **Fix everything before running the everyday evaluation:** the models, the judge prompt, the Jev and Laya questions, the label threshold and the main signal per router. Write those choices into `docs/everyday_preregistration.md` first. This is the same rule the report applied to MT-Bench.
- No router reported on the everyday set may be trained or tuned on everyday prompts. kNN in the live demo server may include them; reported numbers may not.

## Step 0: Read (10 min)

Read these and note how MT-Bench is represented, so `everyday` can mirror it:

- `llmrouter/benchmarks.py`
- `llmrouter/questions.py`
- `llmrouter/metrics.py`
- `scripts/score.py`
- `scripts/compare_routers.py`
- `scripts/prepare_train_data.py`

Note:
- how per-prompt quality is stored for each model
- how routing uses the first turn only
- how decontamination works
- where `data/train/routing_pairs.parquet` is written and what its prompt column is called

## Step 1: Build the everyday benchmark (about 45 min, mostly waiting on APIs)

Inputs, all in `rightsize/`:

- **`data/everyday.jsonl`:** 142 curated prompts, 15 categories, from `everyday_prompts.py`.
  - Light: food, messages, quick facts, conversions, shopping and gifts, travel, home life, fun, simple explanations.
  - Medium: writing, work documents, money.
  - Heavy: math, coding, reasoning and planning.
  - Fields: `id`, `category`, `source`, `prompt`. Routers must never see `category`.
- **Real traffic (recommended):** `python sample_wildchat.py --n 150 --out data/wildchat_sample.jsonl`.
  - Source: public WildChat-1M (ODC-BY), first user turns, English, single-turn, 16–1,500 characters.
  - Do not use Arena-55k. The trained routers learned from it, so it would leak.
- **Decontaminate both sets against the router training prompts:**
  - Drop exact matches and near-duplicates (MiniLM cosine ≥ 0.95) against the prompt column of `data/train/routing_pairs.parquet`.
  - Reuse the repo's decontamination code if it fits. Otherwise use `decontaminate.py`.
  - Report how many were dropped.

Produce outcomes with `make_outcomes.py`, or with the repo's own clients if they already wrap these models:

- **Models (fix in advance):**
  - Weak: the small tier of the app we demo, e.g. Claude Haiku. Alternative: a local 8B on vLLM.
  - Strong: that app's frontier model, e.g. Claude Opus or Fable.
  - Judge: a strong model from a *different* family than the strong model, to limit self-preference.
- **Judge prompt:** MT-Bench single-answer grading, score 1–10. This matches how MT-Bench quality is stored in this repo. Judge each answer on its own; never show the judge both answers.
- **Output `data/everyday_outcomes.jsonl`** with fields:
  - `id`, `category`, `source`, `prompt`
  - `weak_model`, `strong_model`, `judge_model`
  - `weak_answer`, `strong_answer`
  - `weak_score`, `strong_score`, `weak_judgment`, `strong_judgment`
- **Resumable:** rerunning skips ids already written.

Acceptance:

- At least 95% of rows have both scores. List the ones that don't.
- `python category_gaps.py data/everyday_outcomes.jsonl` prints per category: n, mean weak score, mean strong score, gap, and % of prompts where the strong model is clearly better (gap ≥ 2).

## Step 2: Register the benchmark (15 min)

- Add `everyday` to `llmrouter/benchmarks.py`, loading `data/everyday_outcomes.jsonl` the same way MT-Bench is represented:
  - quality = judge score
  - router input = the prompt
- Also add `everyday_curated` and `everyday_wildchat` subsets filtered by `source`, so real traffic can be reported separately.
- Check that a constant router gives exactly APGR 0.5 on `everyday`, as `metrics.py` guarantees for MT-Bench.

## Step 3: Fix the router signals (10 min, before any scoring)

- **Jev:** the pre-committed main signal is `reasoning`, unchanged. Report every other Jev signal in the appendix only.
- **Optional new Jev question** `tier_needed`, added as a new entry; don't edit existing ones:
  - Type: typed choice, 3 options.
  - Options: "a small fast model is enough", "a mid-size model is needed", "a frontier model is needed".
  - Score: P(frontier) + 0.5 × P(mid).
  - It is secondary and was written after seeing MT-Bench. Say so in the report.
- **Laya fine-tuned:** P(frontier better), as in Part 2.
- **Trained routers:** use the existing checkpoints as they are (ModernBERT-large, kNN-MiniLM k=100, MF-Qwen3, RouteLLM BERT, P2L-7B).
- **Reference rule using hand labels:** send math, coding and reasoning_planning to strong. It uses categories no router sees, so label it as a reference, not a router.
- Write all of this into `docs/everyday_preregistration.md` before running anything.

## Step 4: Score and compare (about 30 min)

```bash
$PY scripts/score.py --backend jev --bench everyday
$PY scripts/score.py --backend laya-ft --ckpt <best laya-router-all> --name laya-ft-all --bench everyday
# plus the encoder, embedding and released routers, the same way as for MT-Bench
$PY scripts/compare_routers.py   # write to docs/everyday_metrics.csv and docs/figures/everyday_*.png
```

Report:
- APGR with 95% bootstrap CI, CPT(50%), CPT(80%) and AUROC: for all prompts, curated only, and WildChat only.
- The category gap table from step 1.

With 140–290 prompts the intervals will be wide; say so next to the numbers.

## Step 5: Router service and extension (about 45 min; code in `rightsize/`)

`server.py` (FastAPI):

- **`POST /route`** takes `{text, current_model?, current_tier?, budget_left: 0–1, save_for_later: bool}` and returns:
  - `p_strong`, `threshold`, `recommend` ("small" or "frontier")
  - `current_tier`, `usage_ratio`, `message`, `router`, `latency_ms`
- **Router (`ROUTER` env var):**
  - `knn`: works out of the box. MiniLM kNN over `data/everyday_outcomes.jsonl`, plus any `prompt,label` jsonl you pass. Export `routing_pairs.parquet` to that format to cover more than the everyday set.
  - `jev`: `JevScorer.p_strong()` must call the repo's existing Jev client with the `reasoning` question. Don't write a new Jev client.
- **Calibration:** turn the raw router score into P(strong clearly better) with a 1-D logistic regression fit on the everyday outcomes (label = strong − weak ≥ 2). Fit it on the scores from step 4. Use this only for the product threshold, never for reported metrics.
- **Budget dial** (cost threshold from R2V-Agent, arXiv 2605.16604):
  - Go frontier iff `p_strong ≥ τ`.
  - `τ = min(1, (c_frontier − c_small) · s / κ)`, with `s = 1 + (1 − budget_left) + 0.5·[save_for_later]`.
  - Defaults: `c_small = 1`, `c_frontier = 10`, `κ = 30`.
  - So τ = 0.30 at full budget, 0.51 with 30% left, 0.66 when also saving for later.
- **Log** every request to `logs/routes.jsonl` for the demo counter.

`extension/` (Chrome MV3):

- Load it at `chrome://extensions` with Developer mode on, then **Load unpacked**.
- The content script reads the focused prompt box on claude.ai, gemini.google.com and chatgpt.com.
- After 700 ms without typing it sends the text to `/route` through the background worker (avoids CORS and private-network blocks), then shows a card in the bottom-right corner.
- The popup has a budget slider, a "saving for later" checkbox and a manual model-tier override, because detecting the current model from the page is best-effort.
- Run the server on the demo laptop. kNN-MiniLM runs on CPU. If the server stays on the GPU box: `ssh -L 8000:localhost:8000 <gpu-box>`.

Acceptance:

- `curl -s localhost:8000/route -H 'content-type: application/json' -d '{"text":"suggest something to eat","current_model":"Fable"}'` returns `recommend: "small"` with a usage message.
- The binary-search bug prompt (`everyday-coding-11`) returns `frontier` at full budget.

## Step 6: Demo assets (30 min)

- **Slide 1, the problem:** the category gap table. Everyday categories show small gaps, while coding, math and reasoning show large ones. Cite the matching MT-Bench gaps from REPORT_1.
- **Slide 2, the router works on everyday traffic:**
  - the PGR curve on `everyday` for Jev `reasoning`, kNN-MiniLM, ModernBERT-large and random
  - CPT(80%): "80% of the quality gap recovered while sending only X% of prompts to the frontier model"
- **Slide 3, the budget dial:** how the share sent to frontier changes at budget 100%, 30%, and 30% plus saving for later.
- **Live demo, three prompts on claude.ai with the model set to Fable:**
  1. "suggest something to eat, I'm tired" → small
  2. the binary-search bug → frontier
  3. the cover letter → borderline; move the budget slider and watch it flip

## Out of scope today

- Context management (teammate).
- Training anything new for reported numbers.
- Step-level escalation from R2V-Agent. That would be a stretch: a vLLM 8B model with 5 samples and test-based checks on HumanEval+. Only if everything above is done.
