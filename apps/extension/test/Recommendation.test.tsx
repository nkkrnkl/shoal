import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Recommendation, type RecommendationState } from "../components/Recommendation";
import type { RouteResult } from "../lib/router";

const SETTINGS = { budget: 30, savingForLater: true };

const RESULT: RouteResult = {
  recommend: "frontier",
  pStrong: 0.24,
  threshold: 0.18,
  message: "Worth the big model (24% chance it does clearly better).",
  why: "Jev rates it as a few reasoning steps (level 2.0 of 3).",
  router: "jev-reasoning",
  latencyMs: 812.4,
};

function render(state: RecommendationState): string {
  return renderToStaticMarkup(<Recommendation state={state} settings={SETTINGS} onSettingsChange={() => {}} />);
}

describe("Recommendation", () => {
  it("renders the verdict, the chance against the threshold, and the reason", () => {
    const html = render({ status: "ready", result: RESULT, refreshing: false });
    expect(html).toContain('<p class="route-verdict route-frontier">Use a frontier model</p>');
    expect(html).toContain(RESULT.message);
    expect(html).toContain("big model helps <b>24%</b>");
    expect(html).toContain("threshold <b>18%</b>");
    expect(html).toContain('<meter class="meter" min="0" max="100" value="24"');
    expect(html).toContain('style="left:18%"');
    expect(html).toContain("a few reasoning steps");
    expect(html).toContain("jev-reasoning · 812 ms");
  });

  it("renders the small-model verdict", () => {
    const html = render({ status: "ready", result: { ...RESULT, recommend: "small", why: null }, refreshing: true });
    expect(html).toContain('<p class="route-verdict route-small">Small model is enough</p>');
    expect(html).toContain('aria-busy="true"');
  });

  it("renders the idle, loading and error states", () => {
    expect(render({ status: "idle" })).toContain("Type a prompt on the chat page");
    expect(render({ status: "loading" })).toContain('role="status"');
    const error = render({ status: "error", message: "Failed to fetch" });
    expect(error).toContain('role="alert"');
    expect(error).toContain("Router not reachable: Failed to fetch");
    expect(error).toContain("demo/rightsize/run.sh");
  });

  it("always renders the budget controls with the current settings", () => {
    const html = render({ status: "idle" });
    expect(html).toContain("plan usage left <b>30%</b>");
    expect(html).toContain('type="range"');
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
  });
});
