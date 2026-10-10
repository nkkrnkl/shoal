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

| Step | Prompt | Card at 100% budget | Card at 30% budget |
|---|---|---|---|
| 1 | Suggest something to eat. I'm tired and don't want to cook. | Small model is enough | Small model is enough |
| 2 | The binary-search bug (`everyday-coding-11` in `data/jev_everyday.jsonl`) | Use a frontier model | Small model is enough |
| 3 | The meeting-scheduling puzzle (`everyday-reasoning_planning-00`) | Use a frontier model | Use a frontier model |

Step 2 is the one that flips when you move the slider. The card updates while the slider moves.

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

**MT-Bench, 72 questions, GPT-4 against Mixtral.** These scores come from an earlier study. Every router below reaches about 98% of GPT-4's average judge score. "Cost saved" assumes that a big-model call costs 10 times a small-model call.

| Router | Prompts sent to the big model | Cost saved |
|---|---|---|
| Jev reasoning question | 51% | 44% |
| kNN on sentence embeddings | 43% | 51% |
| Random choice | 81% | 18% |
| Perfect router | 18% | 74% |

## Limits

- **No answer-quality scores on the everyday prompts yet.** The 94% above tests the router against hand-written categories, not against real model answers.
- **The probability is rough.** Its formula was fit on the 72 MT-Bench questions, with models from 2023. Only 14 of those questions are positive examples. Refit it when everyday outcomes exist. See `data/calibration_mtbench.json`.
- **The MT-Bench numbers are rough too.** 72 questions give wide error bars.
- **Typed text leaves the machine.** While the extension is on, the text of the prompt box on the three chat sites goes to the local server and from there to the Jev API. The server also writes it to `logs/`. Turn the extension off when you are not demoing.
- **Model detection is best-effort.** If the card names the wrong model, set "Model I'm using" in the popup.

## Files

| Path | What it is |
|---|---|
| `server.py` | The `/route` endpoint and the card text |
| `router_core.py` | Jev scorer with cache, kNN scorer, calibration, budget threshold |
| `run.sh` | Starts the server with the demo settings |
| `data/jev_everyday.jsonl` | The 142 everyday prompts with the reasoning level Jev returned on 2026-10-10 |
| `data/calibration_mtbench.json` | The two numbers of the probability formula, and what they were fit on |
| `extension/` | The Chrome extension |
