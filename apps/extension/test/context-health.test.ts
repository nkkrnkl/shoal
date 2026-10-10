import { describe, expect, it } from "vitest";
import { clampPct, formatPct, formatTokens, summarizeContext, turnNumberOf } from "../lib/context-health";
import { sampleAnalysis } from "../lib/fixtures";

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [842, "842"],
    [1000, "1k"],
    [4249, "4.2k"],
    [12_400, "12k"],
    [999_999, "1M"],
    [1_340_000, "1.3M"],
    [-5, "0"],
  ])("%d -> %s", (n, out) => {
    expect(formatTokens(n)).toBe(out);
  });
});

describe("formatPct", () => {
  it.each([
    [0, "0%"],
    [3.14, "3.1%"],
    [5, "5%"],
    [25.5, "26%"],
    [140, "100%"],
    [Number.NaN, "0%"],
  ])("%d -> %s", (n, out) => {
    expect(formatPct(n)).toBe(out);
  });

  it("clamps the bar width", () => {
    expect(clampPct(-1)).toBe(0);
    expect(clampPct(42)).toBe(42);
    expect(clampPct(101)).toBe(100);
  });
});

describe("turnNumberOf", () => {
  const { transcript } = sampleAnalysis();

  it("resolves an id to a 1-based turn number", () => {
    expect(turnNumberOf(transcript, "t9")).toBe(9);
    expect(turnNumberOf(transcript, "t1")).toBe(1);
  });

  it("returns null for missing or unknown ids", () => {
    expect(turnNumberOf(transcript, undefined)).toBeNull();
    expect(turnNumberOf(transcript, "nope")).toBeNull();
  });
});

describe("summarizeContext", () => {
  const { analysis, transcript } = sampleAnalysis();
  const summary = summarizeContext(analysis, transcript);

  it("lists only flagged turns, in order", () => {
    expect(summary.flagged.map((t) => t.turnId)).toEqual(["t1", "t3", "t4", "t7"]);
    expect(summary.keptCount).toBe(6);
  });

  it("resolves supersededBy for expired turns only", () => {
    const expired = summary.flagged.find((t) => t.label === "expired");
    expect(expired?.updatedAtTurn).toBe(9);
    expect(summary.flagged.filter((t) => t.label !== "expired").every((t) => t.updatedAtTurn === null)).toBe(true);
  });

  it("carries turn tokens and roles from the transcript", () => {
    const redundant = summary.flagged.find((t) => t.label === "redundant");
    expect(redundant).toMatchObject({ turnNumber: 7, role: "user", tokens: 628 });
  });

  it("handles verdicts for turns missing from the transcript", () => {
    const orphan = summarizeContext(
      { ...analysis, verdicts: [{ turnId: "gone", label: "expired", reason: "r", takeaway: "", supersededBy: "x" }] },
      transcript,
    );
    expect(orphan.flagged[0]).toMatchObject({ turnNumber: null, role: null, tokens: 0, updatedAtTurn: null });
  });
});

describe("sample fixture", () => {
  it("is consistent with its transcript", () => {
    const { analysis, transcript } = sampleAnalysis();
    expect(analysis.verdicts.map((v) => v.turnId)).toEqual(transcript.turns.map((t) => t.id));
    expect(analysis.totalTokens).toBe(transcript.turns.reduce((sum, t) => sum + t.tokens, 0));
    expect(analysis.wastePct).toBeCloseTo((analysis.flaggedTokens / analysis.totalTokens) * 100, 1);
  });
});
