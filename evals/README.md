# evals

Python project (uv) for benchmark outcome tables, router and context experiments, and reports.

Paid runs never happen in pull request CI. See the experiment issues for budgets.

## Shared MT-Bench subset

The router track and the context-manager track use **the same MT-Bench subset**. Both people run the same builder and get byte-identical files, checked against [MANIFEST.json](shoal_evals/mtbench/MANIFEST.json).

```sh
cd evals
uv run python -m shoal_evals.mtbench.build --check
```

This downloads MT-Bench from pinned revisions (FastChat commit `587d5cf`, Hugging Face space `lmsys/mt-bench` revision `a4b674c`). It verifies their SHA-256 hashes and writes the outputs to `evals/data/mtbench/`, which is gitignored. If `--check` prints a mismatch, do not run experiments on that data.

### What gets built

| File | Rows | Used by |
|---|---|---|
| `items.jsonl` | 80 questions: 8 categories x 10, two turns each, a reference answer for the 30 math, reasoning and coding questions, and a router `split` of 24 `pool` and 56 `test` (3 and 7 per category) | Router experiments |
| `sessions.jsonl` | 400 conversations in the ADR-001 Transcript shape, with a gold `keep` or `useless` label per turn | Context-manager experiments |
| `judge_prompts.jsonl` | MT-Bench judge prompts, including `single-v1-multi-turn` and `single-math-v1-multi-turn` | Both, so grading is identical |

### How the context sessions are built

Each MT-Bench question has two turns, and turn 2 depends on turn 1. A session puts the target question's first exchange (user turn 1 and the pre-generated answer) into a longer conversation. The draft prompt is the target's turn 2.

- **Distractors:** `k` other MT-Bench conversations from different categories, chosen with a fixed seed. `k` is 0, 4 or 12, giving a median of about 300, 2,800 and 8,300 context tokens.
- **Placement:**
  - `recent` puts the distractors first and the target's first exchange last.
  - `buried` puts the target's first exchange first, then the distractors. It tests whether pruning wrongly drops old context that is still needed.
  - `k=0` has a single `clean` session: the plain two-turn MT-Bench conversation.
- **Gold labels:** the target's first exchange is `keep`, and every distractor turn is `useless`. This scores the waste classifier without hand-labeling.
- Distractors for a given question and `k` are the same in both placements, so the comparison is paired.

### How the two tracks share results

- The router scores every model on both turns of the 56 test questions. Its turn-2 score on a `clean` session is the context track's **oracle arm**. One paid run therefore serves both tracks.
- Both tracks use the same judge model and the same MT-Bench judge prompts. Pick the judge once in the outcome-table pipeline issue and never change it mid-experiment.

### Limits

- **Small:** 80 questions means wide confidence intervals. Only differences of about 10 points or more on the 1 to 10 judge scale aggregate are detectable. Use it for direction, and confirm with the improved experiments.
- **Short:** sessions top out around 12,000 tokens. This tests waste detection and harmful pruning, not long-context scale. LongMemEval and BEAM stay in the improved context experiment for that.
- **Contamination:** MT-Bench dates from 2023 and is probably in training data. Absolute scores matter less than paired differences between arms.
- **Staleness not covered:** MT-Bench has no planted fact updates. The staleness detector still needs the synthetic planted-update chats.
- **Redistribution:** the pre-generated assistant answers are GPT-4 outputs, which is why the data is built locally and never committed.

### Tests

```sh
cd evals
uv run python -m unittest discover -s tests
```

The tests use synthetic fixtures and need no network.
