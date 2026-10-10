import type { ContextAnalysis, Transcript, TurnLabel } from "@shoal/core";

/** One flagged turn, ready to render. Turn numbers are 1-based, as people count them. */
export interface FlaggedTurn {
  turnId: string;
  turnNumber: number | null;
  role: "user" | "assistant" | null;
  tokens: number;
  label: Exclude<TurnLabel, "keep">;
  reason: string;
  takeaway: string;
  /** Turn number of the replacing turn, for `expired` verdicts that name one we can find. */
  updatedAtTurn: number | null;
}

export interface ContextHealthSummary {
  totalTokens: number;
  flaggedTokens: number;
  wastePct: number;
  flagged: FlaggedTurn[];
  keptCount: number;
}

/** Resolves a turn id to its 1-based turn number, or null when the transcript has no such turn. */
export function turnNumberOf(transcript: Transcript, turnId: string | undefined): number | null {
  if (turnId === undefined) return null;
  const turn = transcript.turns.find((t) => t.id === turnId);
  return turn ? turn.index + 1 : null;
}

/** Joins analyzer verdicts with the transcript they describe. */
export function summarizeContext(analysis: ContextAnalysis, transcript: Transcript): ContextHealthSummary {
  const turnsById = new Map(transcript.turns.map((t) => [t.id, t]));
  const flagged: FlaggedTurn[] = [];
  let keptCount = 0;
  for (const v of analysis.verdicts) {
    if (v.label === "keep") {
      keptCount++;
      continue;
    }
    const turn = turnsById.get(v.turnId);
    flagged.push({
      turnId: v.turnId,
      turnNumber: turn ? turn.index + 1 : null,
      role: turn?.role ?? null,
      tokens: turn?.tokens ?? 0,
      label: v.label,
      reason: v.reason,
      takeaway: v.takeaway,
      updatedAtTurn: v.label === "expired" ? turnNumberOf(transcript, v.supersededBy) : null,
    });
  }
  return {
    totalTokens: analysis.totalTokens,
    flaggedTokens: analysis.flaggedTokens,
    wastePct: analysis.wastePct,
    flagged,
    keptCount,
  };
}

/** Formats a token count compactly: 842, 4.2k, 12k, 1.3M. */
export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 999_500) {
    const k = v / 1000;
    return `${k < 10 ? trim(k.toFixed(1)) : Math.round(k)}k`;
  }
  return `${trim((v / 1_000_000).toFixed(1))}M`;
}

/** Formats a 0 to 100 percentage: one decimal under 10, whole numbers above. */
export function formatPct(pct: number): string {
  const v = clampPct(pct);
  if (v > 0 && v < 10) return `${trim(v.toFixed(1))}%`;
  return `${Math.round(v)}%`;
}

/** Clamps a percentage to 0 to 100 for the meter bar width. */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

function trim(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}
