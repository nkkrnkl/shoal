import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VoiceDock } from "../components/VoiceDock";
import { sampleAnalysis } from "../lib/fixtures";
import type { RouteResult } from "../lib/router";
import { describeContext, describeRecommendation, describeUsage } from "../lib/voice-tools";

describe("VoiceDock", () => {
  it("is one button at rest, with no session controls", () => {
    const html = renderToStaticMarkup(<VoiceDock />);
    expect(html).toContain('aria-label="Talk to Shoal"');
    expect(html).toContain("Talk to Shoal");
    expect(html).not.toContain("Or type a question");
    expect(html).not.toContain("Stop");
  });
});

describe("voice tools", () => {
  const result: RouteResult = {
    recommend: "small",
    pStrong: 0.075,
    threshold: 0.18,
    message: "A small model handles this. Try Haiku.",
    why: "Jev rates it as no step-by-step reasoning.",
    router: "jev-reasoning",
    latencyMs: 1,
  };

  it("gives the verdict and the numbers, not the prompt", () => {
    expect(describeRecommendation({ status: "ready", result, refreshing: false }, 63)).toEqual({
      has_prompt: true,
      recommendation: "a small model is enough",
      advice: "A small model handles this. Try Haiku.",
      reason: "Jev rates it as no step-by-step reasoning.",
      chance_big_model_helps_percent: 8,
      threshold_percent: 18,
      plan_usage_left_percent: 63,
    });
  });

  it("says so when there is no prompt or no router", () => {
    expect(describeRecommendation({ status: "idle" }, 100)).toMatchObject({ has_prompt: false });
    expect(describeRecommendation({ status: "error", message: "x" }, 100).note).toContain("not reachable");
  });

  it("reports plan usage, or that it is unknown", () => {
    const usage = { usedPct: 37, windows: [{ name: "session", usedPct: 37, resetsAt: null }] };
    expect(describeUsage(usage, 63)).toEqual({
      known: true,
      plan_usage_left_percent: 63,
      windows: [{ name: "session", used_percent: 37, resets_at: null }],
    });
    expect(describeUsage(null, 80)).toMatchObject({ known: false, plan_usage_left_percent_set_by_hand: 80 });
  });

  it("summarizes the context check with a few flagged turns", () => {
    const { analysis, transcript } = sampleAnalysis();
    const context = describeContext({ status: "ready", analysis, transcript }, true);
    expect(context).toMatchObject({ known: true, turns: transcript.turns.length, stale_percent: 26, flagged_turns: 4 });
    expect(context.examples).toHaveLength(3);
    expect((context.examples as { turn: number; label: string; reason: string }[])[0]).toMatchObject({
      turn: expect.any(Number),
      label: expect.any(String),
      reason: expect.any(String),
    });
  });

  it("says why there is no context check", () => {
    expect(describeContext({ status: "idle" }, false).note).toContain("Gemini key");
    expect(describeContext({ status: "idle" }, true)).toMatchObject({ known: false });
    expect(describeContext({ status: "loading" }, true).note).toContain("being checked");
    expect(describeContext({ status: "error", message: "x" }, true).note).toContain("could not read");
  });
});
