"""Slide numbers from the everyday outcomes: how often the small model is enough, what the big model
costs, and what the Jev router saves at the demo thresholds.

    python everyday_report.py data/everyday_outcomes.jsonl --scores data/jev_everyday.jsonl

Needs scikit-learn (requirements-benchmark.txt).
"""
import argparse
import json

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

from router_core import TIER_COST

GAP = 2.0  # strong - weak >= GAP counts as "clearly better", as everywhere in Right-size


def pct(x) -> str:
    return f"{100 * float(np.mean(x)):.0f}%"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("outcomes")
    p.add_argument("--scores", required=True, help="jsonl of {id, reasoning}: the raw router score per prompt")
    p.add_argument("--calibration", default="data/calibration_mtbench.json")
    p.add_argument("--kappa", type=float, default=50, help="the KAPPA that run.sh uses")
    args = p.parse_args()

    rows = [json.loads(line) for line in open(args.outcomes)]
    scored = [r for r in rows if r["weak_score"] is not None and r["strong_score"] is not None]
    print(f"{len(scored)} of {len(rows)} prompts have both scores")
    for r in rows:
        if r not in scored:
            print(f"   no score: {r['id']}  weak={r['weak_score']} strong={r['strong_score']} "
                  f"finish={r['usage']['weak'].get('finish')}/{r['usage']['strong'].get('finish')}")
    r0 = scored[0]
    print(f"weak = {r0['weak_model']}, strong = {r0['strong_model']}, judge = {r0['judge_model']}\n")

    weak = np.array([r["weak_score"] for r in scored])
    strong = np.array([r["strong_score"] for r in scored])
    gap = strong - weak
    print("1. How often is the small model enough? (judge score, 1 to 10)")
    print(f"   mean score: small {weak.mean():.2f}, big {strong.mean():.2f}")
    print(f"   small scores the same or higher:   {pct(gap <= 0)}  ({int((gap <= 0).sum())} prompts)")
    print(f"   big is higher by less than {GAP:.0f}:        {pct((gap > 0) & (gap < GAP))}  ({int(((gap > 0) & (gap < GAP)).sum())})")
    print(f"   big is clearly better ({GAP:.0f} or more):   {pct(gap >= GAP)}  ({int((gap >= GAP).sum())})")
    print(f"   score spread: small gets 9 or more on {pct(weak >= 9)}, big on {pct(strong >= 9)}")

    def usage(role: str, key: str) -> np.ndarray:
        return np.array([r["usage"][role][key] for r in scored], float)

    cw, cs = usage("weak", "cost_usd"), usage("strong", "cost_usd")
    print("\n2. What does the big model cost? (measured on these answers)")
    print(f"   cost per answer:  small ${cw.mean():.4f}, big ${cs.mean():.4f}  -> big costs {cs.mean() / cw.mean():.0f}x more")
    print(f"   time per answer:  small {np.median(usage('weak', 'latency_s')):.1f} s, "
          f"big {np.median(usage('strong', 'latency_s')):.1f} s (median)")

    level = {json.loads(line)["id"]: json.loads(line)["reasoning"] for line in open(args.scores)}
    x = np.array([level[r["id"]] for r in scored])
    cal = json.load(open(args.calibration))
    prob = 1 / (1 + np.exp(-(cal["slope"] * x + cal["intercept"])))
    print("\n3. The Jev router on these outcomes")
    for name, y in ((f"big clearly better (gap >= {GAP:.0f})", gap >= GAP), ("big better at all (gap > 0)", gap > 0)):
        if 0 < y.sum() < len(y):
            print(f"   AUROC for '{name}': {roc_auc_score(y, x):.3f}  ({int(y.sum())} positive of {len(y)})")
        else:
            print(f"   AUROC for '{name}': not defined, {int(y.sum())} positive of {len(y)}")

    print(f"\n   {'budget setting':<28}{'sent to big':>12}{'mean score':>12}{'cost':>10}{'saved':>8}{'misses':>8}")
    always_big = cs.sum()
    step = TIER_COST["frontier"] - TIER_COST["small"]
    for name, scarcity in (("100% left", 1.0), ("30% left", 1.7), ("30% left, saving for later", 2.2)):
        big = prob >= min(1.0, step * scarcity / args.kappa)
        cost = np.where(big, cs, cw).sum()
        misses = int((~big & (gap >= GAP)).sum())  # sent to small, although big was clearly better
        print(f"   {name:<28}{pct(big):>12}{np.where(big, strong, weak).mean():>12.2f}{'$%.2f' % cost:>10}"
              f"{pct([1 - cost / always_big]):>8}{misses:>8}")
    print(f"   {'always big':<28}{'100%':>12}{strong.mean():>12.2f}{'$%.2f' % always_big:>10}{'0%':>8}{0:>8}")
    print(f"   {'always small':<28}{'0%':>12}{weak.mean():>12.2f}{'$%.2f' % cw.sum():>10}"
          f"{pct([1 - cw.sum() / always_big]):>8}{int((gap >= GAP).sum()):>8}")
    print("   cost is the answer cost only; the Jev call is not included.")

    y = (gap >= GAP).astype(float)
    if 5 <= y.sum() <= len(y) - 5:
        fit = LogisticRegression().fit(x[:, None], y)
        print(f"\n4. Calibration refit on these outcomes: slope {fit.coef_[0, 0]:.4f}, intercept {fit.intercept_[0]:.4f} "
              f"(MT-Bench interim: slope {cal['slope']}, intercept {cal['intercept']})")
    else:
        print(f"\n4. Calibration refit skipped: only {int(y.sum())} prompts where big is clearly better.")


if __name__ == "__main__":
    main()
