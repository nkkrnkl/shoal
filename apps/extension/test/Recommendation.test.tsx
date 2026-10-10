import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Recommendation, type RecommendationState } from "../components/Recommendation";
import type { RouteResult } from "../lib/router";

const SETTINGS = { budget: 30, savingForLater: true, auto: true };
const USAGE = {
  usedPct: 37,
  windows: [
    { name: "session", usedPct: 37, resetsAt: null },
    { name: "week", usedPct: 12.4, resetsAt: null },
  ],
};

const RESULT: RouteResult = {
  recommend: "frontier",
  pStrong: 0.24,
  threshold: 0.18,
  message: "Worth the big model (24% chance it does clearly better).",
  why: "Jev rates it as a few reasoning steps (level 2.0 of 3).",
  router: "jev-reasoning",
  latencyMs: 812.4,
};

function render(state: RecommendationState, usage: typeof USAGE | null = null, settings = SETTINGS): string {
  const budget = settings.auto && usage ? Math.round(100 - usage.usedPct) : settings.budget;
  return renderToStaticMarkup(
    <Recommendation state={state} settings={settings} onSettingsChange={() => {}} usage={usage} budget={budget} />,
  );
}

describe("Recommendation", () => {
  it("renders the verdict, the chance against the threshold, and the reason", () => {
    const html = render({ status: "ready", result: RESULT, refreshing: false, site: "claude.ai" });
    expect(html).toContain('<p class="route-verdict route-frontier">Use Opus 5.5</p>');
    expect(html).toContain(RESULT.message);
    expect(html).toContain("big model helps <b>24%</b>");
    expect(html).toContain("threshold <b>18%</b>");
    expect(html).toContain('<meter class="meter" min="0" max="100" value="24"');
    expect(html).toContain('style="left:18%"');
    expect(html).toContain("a few reasoning steps");
    expect(html).toContain("jev-reasoning · 812 ms");
  });

  it("renders the small-model verdict", () => {
    const html = render({
      status: "ready",
      result: { ...RESULT, recommend: "small", why: null },
      refreshing: true,
      site: "gemini.google.com",
    });
    expect(html).toContain('<p class="route-verdict route-small">Flash-Lite is enough</p>');
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

  it("renders the slider when the site reports no plan usage", () => {
    const html = render({ status: "idle" });
    expect(html).toContain("plan usage left <b>30%</b>");
    expect(html).toContain('type="range"');
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(html).not.toContain("Set the usage by hand");
  });

  it("takes the budget from the site's plan usage, and names its source", () => {
    const html = render({ status: "idle" }, USAGE);
    expect(html).toContain("plan usage left <b>63%</b>");
    expect(html).toContain("Read from your plan: session 37% used · week 12% used");
    expect(html).not.toContain('type="range"');
    expect(html).toContain("Set the usage by hand");
  });

  it("returns to the slider when the user sets the usage by hand", () => {
    const html = render({ status: "idle" }, USAGE, { ...SETTINGS, auto: false });
    expect(html).toContain("plan usage left <b>30%</b>");
    expect(html).toContain('type="range"');
    expect(html).not.toContain("Read from your plan");
  });
});
