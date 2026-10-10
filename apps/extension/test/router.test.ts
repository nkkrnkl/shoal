import { afterEach, describe, expect, it, vi } from "vitest";
import { pickModelLabel } from "../lib/draft";
import { appForSite, fetchRoute, parseRouteResult } from "../lib/router";

/** An answer of the Right-size service, as `demo/rightsize/server.py` returns it. */
const ANSWER = {
  p_strong: 0.24,
  raw_score: 1.97,
  threshold: 0.18,
  recommend: "frontier",
  current_tier: "frontier",
  usage_ratio: null,
  message: "Worth the big model (24% chance it does clearly better).",
  why: "Jev rates it as a few reasoning steps (level 2.0 of 3).",
  router: "jev-reasoning",
  latency_ms: 0.1,
};

describe("parseRouteResult", () => {
  it("converts a service answer", () => {
    expect(parseRouteResult(ANSWER)).toEqual({
      recommend: "frontier",
      pStrong: 0.24,
      threshold: 0.18,
      message: ANSWER.message,
      why: ANSWER.why,
      router: "jev-reasoning",
      latencyMs: 0.1,
    });
  });

  it("accepts an answer without a why line", () => {
    expect(parseRouteResult({ ...ANSWER, why: null }).why).toBeNull();
  });

  it.each([
    ["not an object", null],
    ["a missing number", { ...ANSWER, p_strong: undefined }],
    ["a number sent as text", { ...ANSWER, threshold: "0.18" }],
    ["an unknown recommendation", { ...ANSWER, recommend: "medium" }],
    ["a missing message", { ...ANSWER, message: undefined }],
  ])("rejects %s", (_name, value) => {
    expect(() => parseRouteResult(value)).toThrow();
  });
});

describe("fetchRoute", () => {
  afterEach(() => vi.unstubAllGlobals());

  const request = {
    text: "Find the bug",
    site: "claude.ai",
    model: "Opus 5.5",
    budget: 30,
    savingForLater: true,
  } as const;

  it("posts the draft in the service's field names", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ANSWER), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRoute(request, { url: "http://localhost:9000" });

    expect(result.recommend).toBe("frontier");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:9000/route");
    expect(JSON.parse(String(init.body))).toEqual({
      text: "Find the bug",
      app: "claude",
      current_model: "Opus 5.5",
      budget_left: 0.3,
      save_for_later: true,
    });
  });

  it("reports the status and body when the service fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Jev request failed", { status: 502 })),
    );
    await expect(fetchRoute(request)).rejects.toThrow("router returned 502: Jev request failed");
  });
});

describe("appForSite", () => {
  it.each([
    ["claude.ai", "claude"],
    ["gemini.google.com", "gemini"],
    ["chatgpt.com", "chatgpt"],
    ["generic", null],
  ] as const)("%s -> %s", (site, app) => {
    expect(appForSite(site)).toBe(app);
  });
});

describe("pickModelLabel", () => {
  it("picks the model picker's label", () => {
    expect(pickModelLabel(["New chat", "  Opus 5.5 High ", "Share"], "claude.ai")).toBe("Opus 5.5 High");
  });

  it("skips upsell buttons and long labels", () => {
    expect(pickModelLabel(["Upgrade to Pro", "Try Opus for free"], "claude.ai")).toBeNull();
    expect(pickModelLabel(["A long chat title that happens to mention Sonnet and more"], "claude.ai")).toBeNull();
  });

  it("uses the names of the given site only", () => {
    expect(pickModelLabel(["Opus 5.5"], "chatgpt.com")).toBeNull();
    expect(pickModelLabel(["Opus 5.5"], "generic")).toBeNull();
  });
});
