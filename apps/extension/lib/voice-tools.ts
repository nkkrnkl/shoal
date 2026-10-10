import type { ContextHealthState } from "@/components/ContextHealth";
import type { RecommendationState } from "@/components/Recommendation";
import { summarizeContext } from "@/lib/context-health";
import type { PlanUsage } from "@/lib/usage";

/** At most this many flagged turns are described to the voice model. */
const MAX_FLAGGED = 3;

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

export function describeContext(
  health: ContextHealthState | { status: "idle" },
  hasKey: boolean,
): Record<string, unknown> {
  if (!hasKey) return { known: false, note: "Context checks need a Gemini key. The user can add one in the settings." };
  if (health.status === "loading")
    return { known: false, note: "The chat is being checked right now. Ask again in a moment." };
  if (health.status === "error") return { known: false, note: "Shoal could not read this chat." };
  if (health.status !== "ready") return { known: false, note: "There is no check of this chat yet." };
  const summary = summarizeContext(health.analysis, health.transcript);
  return {
    known: true,
    turns: health.transcript.turns.length,
    stale_percent: Math.round(summary.wastePct),
    flagged_turns: summary.flagged.length,
    kept_turns: summary.keptCount,
    examples: summary.flagged
      .slice(0, MAX_FLAGGED)
      .map((f) => ({ turn: f.turnNumber, label: f.label, reason: f.reason })),
  };
}
