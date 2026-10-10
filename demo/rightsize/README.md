# Right-size demo

Right-size tells you, before you send a prompt, whether a small model is enough. It shows a card on claude.ai, gemini.google.com and chatgpt.com while you type.

This folder is the hackathon demo of Shoal's router. It is not the product architecture from [ADR-001](../../docs/adr/001-architecture.md): it uses a local Python server and a plain JavaScript extension, because that was the fastest path to a working demo.

## Run it

You need Python 3.10 or later, Chrome, and a Jev API key.

**1. Start the router.**

```sh
cd demo/rightsize
pip install -r requirements.txt
export JEV_API_KEY=your-key
./run.sh
```

Check it with `curl localhost:8000/health`. The answer must contain `"router":"jev-reasoning"`.

**2. Load the extension.** Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose `demo/rightsize/extension`.

**3. Type a prompt** on claude.ai. The card appears about one second after you stop typing.

If the router runs on another machine, forward its port to your laptop first, for example `ssh -L 8000:localhost:8000 <machine>`. The address can also be changed in the extension popup.

## Demo script

Set the model on claude.ai to the largest one. Open the extension popup to reach the budget slider.

| Step | Prompt | Card at 100% budget | Card at 30% budget | Judge score, small / big model |
|---|---|---|---|---|
| 1 | Suggest something to eat. I'm tired and don't want to cook. | Small model is enough | Small model is enough | 10 / 10 |
| 2 | The binary-search bug (`everyday-coding-11` in `data/jev_everyday.jsonl`) | Use a frontier model | Small model is enough | 10 / 10 |
| 3 | The meeting-scheduling puzzle (`everyday-reasoning_planning-00`) | Use a frontier model | Use a frontier model | 3 / 10 |

Step 2 is the one that flips when you move the slider. The card updates while the slider moves. Step 3 is a prompt where the small model really fails, and the card keeps the big model even on a low budget. The scores are from the Gemini run described below.

The 142 prompts in `data/jev_everyday.jsonl` are answered from a local cache, with no network call. Any other text costs one Jev credit and about one second.

## How it decides

1. **Score.** The router sends the prompt to Jev with one fixed question: how much careful multi-step reasoning does the answer need? Jev returns a level from 0 (none) to 3 (many careful steps).
2. **Probability.** A small formula turns the level into the chance that a big model gives a clearly better answer. "Clearly better" means 2 points or more on a judge scale of 1 to 10.
3. **Threshold.** The router recommends the big model when that chance is at or above a threshold. The threshold is 18% at a full budget. It rises as the budget slider goes down: 31% at 30% left, and 40% at 30% left with "saving for later" on.

## What was measured

**The 142 everyday prompts.** These have hand-written categories. Math, coding and reasoning count as heavy (36 prompts), and the other 106 count as light. Take one heavy and one light prompt at random. Jev's reasoning level is higher for the heavy one 94% of the time. A kNN router on sentence embeddings reaches 85% on the same test.

Share of the 142 prompts sent to the big model:

| Budget setting | Share sent to the big model |
|---|---|
| 100% left | 37% |
| 30% left | 6% |
| 30% left, saving for later | 0% |

**Today's models on the 142 everyday prompts.** On 2026-10-10 each prompt was answered by a small model (`gemini-3.5-flash-lite`) and a big model (`gemini-3.1-pro-preview`). A third model (`gemini-3.8-flash`) graded each answer alone, on a scale of 1 to 10. The run cost $3.45. The answers and grades are in `data/everyday_outcomes.jsonl`, and `everyday_report.py` prints the numbers below.

- The small model scored the same or higher on 119 of 142 prompts (84%).
- The big model was clearly better, by 2 points or more, on 12 prompts (8%).
- The big model cost 15 times more per answer, and took 17 seconds against 2 seconds.
- The small model failed mostly on money calculations, planning puzzles, and date or time-zone conversions. It did not fail on the coding prompts.

What the router does with these outcomes:

| Policy | Prompts sent to the big model | Mean score | Cost saved | Caught, of the 12 prompts where big is clearly better |
|---|---|---|---|---|
| Always the big model | 100% | 9.98 | 0% | 12 |
| Right-size, 100% budget left | 37% | 9.85 | 54% | 8 |
| Right-size, 30% budget left | 6% | 9.67 | 85% | 2 |
| Always the small model | 0% | 9.56 | 93% | 0 |

A random choice of 37% of the prompts would catch about 4 of the 12. "Cost saved" is the measured answer cost. It does not include the Jev call.

**MT-Bench with today's models, two turns per question.** On 2026-10-10 the shared MT-Bench subset (80 questions, built by `evals/shoal_evals/mtbench/build.py`) was answered by the same small and big Gemini models. Each model answered both turns of every question, and the same judge graded each turn with MT-Bench's own judge prompts. The run cost $4.70. `evals/shoal_evals/mtbench/outcomes.py` makes the answers, `mtbench_report.py` prints the numbers below, and the grades are in `evals/reports/mtbench_gemini_scores.jsonl`.

- The small model scored the same or higher on 55 of 80 questions (69%).
- The big model was clearly better on 9 questions (11%).
- The gap is larger on the follow-up turn: 0.66 points, against 0.26 on the first turn. Six of the nine lost questions were fine on turn 1 and failed on turn 2.
- The big model cost 17 times more per question, and took 35 seconds against 4 seconds.
- **The router is at chance on this benchmark.** The router decides once, on turn 1. Its APGR is 0.50, with a 95% interval of 0.35 to 0.65. APGR is 0.5 for a random choice and 1.0 for a perfect one. At the demo threshold the router sends 54% of the questions to the big model, saves 44% of the cost, and catches 5 of the 9 lost questions. A random 54% would catch about the same.
- This is not special to Jev. All 35 router scores stored from the September study (kNN, BERT, fine-tuned Laya and others) were tested on the 72 questions they share with this run. None has an interval that lies above 0.5.
- A likely reason: the routers find prompts that need calculation or code, which is where 2023's small models failed. Today's small model got 10 of 10 on every MT-Bench math question. It fails on follow-ups that add a rule to its earlier answer, and the first prompt does not show that.

**MT-Bench, 72 questions, GPT-4 against Mixtral.** These scores come from an earlier study. Every router below reaches about 98% of GPT-4's average judge score. "Cost saved" assumes that a big-model call costs 10 times a small-model call.

| Router | Prompts sent to the big model | Cost saved |
|---|---|---|
| Jev reasoning question | 51% | 44% |
| kNN on sentence embeddings | 43% | 51% |
| Random choice | 81% | 18% |
| Perfect router | 18% | 74% |

## Limits

- **The router beats chance on the everyday prompts, but not on MT-Bench with today's models.** Do not claim that it picks the right prompts in general. The cost and speed numbers, and the share of prompts where the small model is enough, do not depend on the router.
- **Twelve prompts carry the everyday router result.** The big model is clearly better on only 12 of 142 prompts, so "8 of 12 caught" can move a lot with a different prompt set. On the ranking test from above, Jev scores 0.68 for these 12 prompts, where 0.5 is chance.
- **All three Gemini models come from one company.** The judge is neither of the two models it grades, but it may still favour answers in its own family's style.
- **The scores are top-heavy.** The big model got 9 or more on every prompt. The judge sees clear mistakes, but not small differences in quality.
- **The card names Claude models, the outcomes are from Gemini models.** No Claude key was available for the run.
- **The probability is rough.** Its formula was fit on the 72 MT-Bench questions, with models from 2023. Only 14 of those questions are positive examples. A refit on the everyday outcomes gives slope 0.762 and intercept -3.393; it is not switched on, because it also needs a new `KAPPA`. See `data/calibration_mtbench.json`.
- **The MT-Bench numbers are rough too.** 72 questions give wide error bars.
- **Typed text leaves the machine.** While the extension is on, the text of the prompt box on the three chat sites goes to the local server and from there to the Jev API. The server also writes it to `logs/`. Turn the extension off when you are not demoing.
- **Model detection is best-effort.** If the card names the wrong model, set "Model I'm using" in the popup.

## Files

The demo:

| Path | What it is |
|---|---|
| `server.py` | The `/route` endpoint and the card text |
| `router_core.py` | Jev scorer with cache, kNN scorer, calibration, budget threshold |
| `run.sh` | Starts the server with the demo settings |
| `data/jev_everyday.jsonl` | The 142 everyday prompts with the reasoning level Jev returned on 2026-10-10 |
| `data/calibration_mtbench.json` | The two numbers of the probability formula, and what they were fit on |
| `extension/` | The Chrome extension |

The everyday benchmark, from the original Right-size plan:

| Path | What it is |
|---|---|
| `EVERYDAY_ROUTER_PLAN.md` | The full plan: benchmark, router service, extension, demo slides |
| `BENCHMARK_STEPS.md` | The original command list for the benchmark steps |
| `everyday_prompts.py` | Writes `data/everyday.jsonl`, the 142 curated prompts |
| `sample_wildchat.py` | Samples real single-turn prompts from WildChat-1M |
| `decontaminate.py` | Drops prompts that match router training prompts |
| `make_outcomes.py` | Answers and grades every prompt through any OpenAI-compatible endpoint |
| `make_outcomes_gemini.py` | The same for Gemini models, with cost tracking and a budget stop |
| `data/everyday_outcomes.jsonl` | Both answers, both grades, token counts and cost for each of the 142 prompts |
| `everyday_report.py` | Prints the slide numbers from the outcomes and the Jev scores |
| `category_gaps.py` | Prints the quality gap between the weak and the strong model per category |
| `jev_mtbench.py` | Gets Jev's reasoning level for both turns of the 80 MT-Bench questions |
| `mtbench_report.py` | Prints the MT-Bench numbers from the two-turn outcomes and the Jev scores |
| `export_pairs.py` | Exports router training pairs for the kNN router |
| `requirements-benchmark.txt` | Packages for these scripts |
