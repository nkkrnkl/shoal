"""Router numbers on the shared MT-Bench subset, from the two-turn outcome table and the Jev scores.

Protocol of RouteLLM: the router decides once, on turn 1, and the chosen model answers both turns.
The quality of a question is the mean judge score over its two turns. APGR, CPT and the exact
call-performance curve follow the definitions of the LLM-Router study (llmrouter/metrics.py).

    python mtbench_report.py ../../evals/data/mtbench/outcomes_gemini.jsonl \
        --scores ../../evals/data/mtbench/jev_scores.jsonl

Needs numpy only.
"""
import argparse
import json

import numpy as np
from router_core import TIER_COST

GAP = 2.0  # strong - weak >= GAP counts as "clearly better", as everywhere in Right-size
trapezoid = getattr(np, "trapezoid", None) or np.trapz


def curve(score, strong, weak):
    """x[k] = share of questions sent to the strong model, perf[k] = mean quality. Ties share their gain."""
    order = np.argsort(-score, kind="stable")
    s, g = score[order], (strong - weak)[order]
    _, inv, counts = np.unique(-s, return_inverse=True, return_counts=True)
    g = (np.bincount(inv, g) / counts)[inv]
    return np.arange(len(s) + 1) / len(s), (weak.sum() + np.concatenate([[0.0], np.cumsum(g)])) / len(s)


def apgr(score, strong, weak) -> float:
    x, perf = curve(score, strong, weak)
    return float(trapezoid((perf - weak.mean()) / (strong.mean() - weak.mean()), x))


def cpt(score, strong, weak, target: float) -> float:
    x, perf = curve(score, strong, weak)
    pgr = (perf - weak.mean()) / (strong.mean() - weak.mean())
    return float(100 * x[np.argmax(pgr >= target)])


def ci(score, strong, weak, n_boot=2000, seed=0) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(score), (n_boot, len(score)))
    vals = [apgr(score[i], strong[i], weak[i]) for i in idx if strong[i].mean() != weak[i].mean()]
    lo, hi = np.percentile(vals, [2.5, 97.5])
    return float(lo), float(hi)


def auroc(positive, score) -> float:
    """Chance that a positive question gets a higher score than a negative one. Ties count as half."""
    pos, neg = score[positive], score[~positive]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    diff = pos[:, None] - neg[None, :]
    return float(((diff > 0).sum() + 0.5 * (diff == 0).sum()) / diff.size)


def router_line(name: str, score, strong, weak) -> str:
    lo, hi = ci(score, strong, weak)
    return (f"   {name:<34}{apgr(score, strong, weak):>6.3f}  [{lo:.2f}, {hi:.2f}]{cpt(score, strong, weak, 0.5):>9.0f}%"
            f"{cpt(score, strong, weak, 0.8):>9.0f}%{auroc(strong > weak, score):>8.3f}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("outcomes")
    p.add_argument("--scores", required=True, help="jsonl from jev_mtbench.py")
    p.add_argument("--calibration", default="data/calibration_mtbench.json")
    p.add_argument("--kappa", type=float, default=50, help="the KAPPA that run.sh uses")
    args = p.parse_args()

    rows = [json.loads(line) for line in open(args.outcomes)]
    ok = [r for r in rows if None not in r["weak_scores"] and None not in r["strong_scores"]]
    print(f"{len(ok)} of {len(rows)} questions have all four grades")
    for r in rows:
        if r not in ok:
            print(f"   incomplete: q{r['question_id']} weak={r['weak_scores']} strong={r['strong_scores']}")
    print(f"weak = {ok[0]['weak_model']}, strong = {ok[0]['strong_model']}, judge = {ok[0]['judge_model']}\n")

    w = np.array([r["weak_scores"] for r in ok])  # shape (n, 2): turn 1, turn 2
    s = np.array([r["strong_scores"] for r in ok])
    weak, strong = w.mean(1), s.mean(1)
    cat = np.array([r["category"] for r in ok])
    test = np.array([r["split"] == "test" for r in ok])

    print("1. Quality (judge score, 1 to 10)")
    print(f"   {'':<12}{'small':>7}{'big':>7}{'gap':>7}   small same or higher   big clearly better (>= 2)")
    for name, a, b in (("turn 1", w[:, 0], s[:, 0]), ("turn 2", w[:, 1], s[:, 1]), ("both turns", weak, strong)):
        print(f"   {name:<12}{a.mean():>7.2f}{b.mean():>7.2f}{b.mean() - a.mean():>7.2f}{100 * (a >= b).mean():>17.0f}%"
              f"{100 * (b - a >= GAP).mean():>20.0f}%  ({int((b - a >= GAP).sum())})")
    print("\n   per category, both turns:")
    for c in sorted(set(cat), key=lambda c: (strong - weak)[cat == c].mean()):
        m = cat == c
        print(f"     {c:<12} n={m.sum():>2}  small {weak[m].mean():5.2f}  big {strong[m].mean():5.2f}  gap {(strong - weak)[m].mean():5.2f}")

    def total(role: str, key: str) -> np.ndarray:
        return np.array([sum(c[key] for c in r["usage"][role]) for r in ok], float)

    cw, cs = total("weak", "cost_usd"), total("strong", "cost_usd")
    print("\n2. Cost and time per question, both turns (measured)")
    print(f"   cost: small ${cw.mean():.4f}, big ${cs.mean():.4f}  -> big costs {cs.mean() / cw.mean():.0f}x more")
    print(f"   time: small {np.median(total('weak', 'latency_s')):.1f} s, big {np.median(total('strong', 'latency_s')):.1f} s (median)")

    jev = {r["question_id"]: r for r in map(json.loads, open(args.scores))}
    t1 = np.array([jev[r["question_id"]]["turn1"] for r in ok])
    t2c = np.array([jev[r["question_id"]]["turn2_context"] for r in ok])
    t2a = np.array([jev[r["question_id"]]["turn2_alone"] for r in ok])

    print("\n3. Router: one decision on turn 1, quality over both turns")
    print(f"   {'':<34}{'APGR':>6}  {'95% interval':<14}{'CPT(50%)':>9}{'CPT(80%)':>10}{'AUROC':>8}")
    for name, m in ((f"all {len(ok)} questions", np.ones(len(ok), bool)), (f"test split, {test.sum()} questions", test)):
        print(router_line(f"Jev reasoning, {name}", t1[m], strong[m], weak[m]))
    print(router_line("perfect router, all", strong - weak, strong, weak))
    print("   random router: APGR 0.500, CPT(50%) 50%, CPT(80%) 80%")

    cal = json.load(open(args.calibration))
    prob = 1 / (1 + np.exp(-(cal["slope"] * t1 + cal["intercept"])))
    step = TIER_COST["frontier"] - TIER_COST["small"]
    always_big = cs.sum()
    print(f"\n   the demo's thresholds, all {len(ok)} questions:")
    print(f"   {'policy':<28}{'sent to big':>12}{'mean score':>12}{'cost saved':>12}{'caught of ' + str(int((strong - weak >= GAP).sum())):>14}")
    print(f"   {'always big':<28}{'100%':>12}{strong.mean():>12.2f}{'0%':>12}{int((strong - weak >= GAP).sum()):>14}")
    for name, scarcity in (("Right-size, 100% budget", 1.0), ("Right-size, 30% budget", 1.7)):
        big = prob >= min(1.0, step * scarcity / args.kappa)
        cost = np.where(big, cs, cw).sum()
        print(f"   {name:<28}{100 * big.mean():>11.0f}%{np.where(big, strong, weak).mean():>12.2f}"
              f"{100 * (1 - cost / always_big):>11.0f}%{int((big & (strong - weak >= GAP)).sum()):>14}")
    print(f"   {'always small':<28}{'0%':>12}{weak.mean():>12.2f}{100 * (1 - cw.sum() / always_big):>11.0f}%{0:>14}")

    print("\n4. Follow-up turn: which Jev score predicts where the big model helps on turn 2?")
    print(f"   {'':<34}{'APGR':>6}  {'95% interval':<14}{'CPT(50%)':>9}{'CPT(80%)':>10}{'AUROC':>8}")
    for name, score in (("turn 2 with turn 1 as context", t2c), ("turn 2 alone", t2a), ("turn 1 score reused", t1)):
        print(router_line(name, score, s[:, 1], w[:, 1]))


if __name__ == "__main__":
    main()
