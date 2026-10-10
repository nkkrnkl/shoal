import type { RecommendationState } from "@/components/Recommendation";
import type { PlanUsage } from "@/lib/usage";

/**
 * What the voice model is told when it calls a tool. Plain facts and numbers from the panel's state.
 * The draft prompt itself is never included: the voice model gets Shoal's verdict, not the page text.
 */

export function describeRecommendation(state: RecommendationState, budget: number): Record<string, unknown> {
  if (state.status === "idle") return { has_prompt: false, note: "There is no prompt in the chat box yet." };
  if (state.status === "loading")
    return { has_prompt: true, note: "The advice is still loading. Ask again in a moment." };
  if (state.status === "error") {
    return { has_prompt: true, note: "The router is not reachable, so there is no advice right now." };
  }
  const { result } = state;
  return {
    has_prompt: true,
    recommendation: result.recommend === "small" ? "a small model is enough" : "use a frontier model",
    advice: result.message,
    reason: result.why,
    chance_big_model_helps_percent: Math.round(result.pStrong * 100),
    threshold_percent: Math.round(result.threshold * 100),
    plan_usage_left_percent: budget,
  };
}

export function describeUsage(usage: PlanUsage | null, budget: number): Record<string, unknown> {
  if (!usage) {
    return {
      known: false,
      note: "The chat site did not report the plan usage. The panel uses the value set by hand.",
      plan_usage_left_percent_set_by_hand: budget,
    };
  }
  return {
    known: true,
    plan_usage_left_percent: Math.round(100 - usage.usedPct),
    windows: usage.windows.map((w) => ({ name: w.name, used_percent: Math.round(w.usedPct), resets_at: w.resetsAt })),
  };
}
