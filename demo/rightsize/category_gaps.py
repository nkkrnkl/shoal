"""Per-category quality of the weak and strong model on the everyday set (slide 1).

    python category_gaps.py data/everyday_outcomes.jsonl --csv everyday_category_gaps.csv
"""
import argparse
import csv
import json
from collections import defaultdict


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("outcomes")
    p.add_argument("--gap", type=float, default=2.0, help="strong - weak >= gap counts as clearly better")
    p.add_argument("--csv", default=None)
    args = p.parse_args()

    rows = [json.loads(line) for line in open(args.outcomes)]
    scored = [r for r in rows if r["weak_score"] is not None and r["strong_score"] is not None]
    groups = defaultdict(list)
    for r in scored:
        groups[r["category"]].append(r)
    groups["ALL"] = scored

    table = []
    for cat, rs in groups.items():
        weak = sum(r["weak_score"] for r in rs) / len(rs)
        strong = sum(r["strong_score"] for r in rs) / len(rs)
        clearly = sum(r["strong_score"] - r["weak_score"] >= args.gap for r in rs) / len(rs)
        table.append({"category": cat, "n": len(rs), "weak": round(weak, 2), "strong": round(strong, 2),
                      "gap": round(strong - weak, 2), "strong_clearly_better_pct": round(100 * clearly, 1)})
    table.sort(key=lambda t: (t["category"] == "ALL", t["gap"]))

    print(f"{len(scored)} of {len(rows)} rows scored; clearly better = gap >= {args.gap}\n")
    print(f"{'category':<20}{'n':>5}{'weak':>8}{'strong':>8}{'gap':>7}{'clearly better':>17}")
    for t in table:
        print(f"{t['category']:<20}{t['n']:>5}{t['weak']:>8.2f}{t['strong']:>8.2f}{t['gap']:>7.2f}"
              f"{t['strong_clearly_better_pct']:>16.1f}%")
    if args.csv:
        with open(args.csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(table[0]))
            w.writeheader()
            w.writerows(table)
        print(f"\nwrote {args.csv}")


if __name__ == "__main__":
    main()
