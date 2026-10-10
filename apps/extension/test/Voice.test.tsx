import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Voice, type VoiceProps } from "../components/Voice";
import type { RouteResult } from "../lib/router";
import { describeRecommendation, describeUsage } from "../lib/voice-tools";

function render(props: Partial<VoiceProps>): string {
  const noop = () => {};
  return renderToStaticMarkup(
    <Voice
      status="off"
      problem={null}
      lines={[]}
      onStart={noop}
      onStop={noop}
      onSend={noop}
      onOpenSettings={noop}
      {...props}
    />,
  );
}

describe("Voice", () => {
  it("offers to start when off, with no text box", () => {
    const html = render({});
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Talk to Shoal");
    expect(html).not.toContain("Or type a question");
  });

  it("shows the state, the conversation and the text box while on", () => {
    const html = render({
      status: "speaking",
      lines: [
        { who: "user", text: "Which model should I use?" },
        { who: "shoal", text: "A small model is enough." },
      ],
    });
    expect(html).toContain("Stop voice");
    expect(html).toContain('<span class="tag" role="status">speaking</span>');
    expect(html).toContain('<span class="tag">You</span> Which model should I use?');
    expect(html).toContain('<span class="tag">Shoal</span> A small model is enough.');
    expect(html).toContain("Or type a question");
  });

  it("explains a missing key, a blocked microphone and a failure", () => {
    expect(render({ problem: { kind: "no-key" } })).toContain("Voice needs a Gemini API key");
    const blocked = render({ status: "listening", problem: { kind: "mic-blocked" } });
    expect(blocked).toContain("The microphone is blocked");
    expect(blocked).toContain("Open settings");
    expect(render({ problem: { kind: "failed", message: "API key not valid" } })).toContain(
      "Voice stopped: API key not valid",
    );
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
});

describe("Gemini key storage", () => {
  it("keeps the key in the shared settings object and leaves other settings alone", async () => {
    const { fakeBrowser } = await import("wxt/testing/fake-browser");
    const { readGeminiKey, saveGeminiKey } = await import("../lib/use-voice");
    fakeBrowser.reset();
    expect(await readGeminiKey()).toBe("");
    await fakeBrowser.storage.local.set({ settings: { analyzerModel: "gemini-3.5-flash-lite", autoAnalyze: false } });
    await saveGeminiKey("  key-123  ");
    expect(await readGeminiKey()).toBe("key-123");
    expect((await fakeBrowser.storage.local.get("settings")).settings).toEqual({
      analyzerModel: "gemini-3.5-flash-lite",
      autoAnalyze: false,
      geminiApiKey: "key-123",
    });
  });
});
