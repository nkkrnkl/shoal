import type { Site } from "@shoal/core";

/**
 * Client for the Right-size router service in `demo/rightsize` (`POST /route`).
 * This is the hackathon router: a local Python server that scores a prompt with Jev.
 * The router contract in `@shoal/core` (`RouterOutput`) replaces this shape when the in-extension router lands.
 */

export const DEFAULT_ROUTER_URL = "http://localhost:8000";

/** The name the router service uses for each chat app. */
export type RouterApp = "claude" | "gemini" | "chatgpt";

export interface RouteRequest {
  /** The draft prompt. Page text is data for the router and is never treated as instructions. */
  text: string;
  site: Site;
  /** The model name read from the page's picker, when one was found. */
  model: string | null;
  /** Share of plan usage left, 0 to 100. */
  budget: number;
  savingForLater: boolean;
}

/** The user's budget controls. They move the router's threshold. */
export interface RouterSettings {
  /** Share of plan usage left, 0 to 100. */
  budget: number;
  savingForLater: boolean;
}

export interface RouteResult {
  recommend: "small" | "frontier";
  /** Chance from 0 to 1 that a big model gives a clearly better answer. */
  pStrong: number;
  /** The router recommends the big model when `pStrong` is at or above this. */
  threshold: number;
  message: string;
  why: string | null;
  router: string;
  latencyMs: number;
}

const APPS: Partial<Record<Site, RouterApp>> = {
  "claude.ai": "claude",
  "gemini.google.com": "gemini",
  "chatgpt.com": "chatgpt",
};

export function appForSite(site: Site): RouterApp | null {
  return APPS[site] ?? null;
}

/** Checks the service's JSON answer and converts it. Throws when a field is missing or has the wrong type. */
export function parseRouteResult(value: unknown): RouteResult {
  if (typeof value !== "object" || value === null) throw new Error("router answer is not an object");
  const v = value as Record<string, unknown>;
  const num = (key: string): number => {
    const n = v[key];
    if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`router answer has no number "${key}"`);
    return n;
  };
  const str = (key: string): string => {
    const s = v[key];
    if (typeof s !== "string") throw new Error(`router answer has no text "${key}"`);
    return s;
  };
  const recommend = str("recommend");
  if (recommend !== "small" && recommend !== "frontier") throw new Error(`unknown recommendation "${recommend}"`);
  return {
    recommend,
    pStrong: num("p_strong"),
    threshold: num("threshold"),
    message: str("message"),
    why: typeof v.why === "string" ? v.why : null,
    router: str("router"),
    latencyMs: num("latency_ms"),
  };
}

/** Asks the router service whether a small model is enough for this draft. */
export async function fetchRoute(
  req: RouteRequest,
  options: { url?: string; signal?: AbortSignal } = {},
): Promise<RouteResult> {
  const response = await fetch(`${options.url ?? DEFAULT_ROUTER_URL}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: req.text,
      app: appForSite(req.site),
      current_model: req.model,
      budget_left: Math.min(100, Math.max(0, req.budget)) / 100,
      save_for_later: req.savingForLater,
    }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`router returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return parseRouteResult(await response.json());
}
