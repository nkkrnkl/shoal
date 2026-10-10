import { z } from "zod";
import {
  type ContextAnalysis,
  ContextAnalysisSchema,
  type TurnLabel,
  TurnLabelSchema,
  type TurnVerdict,
} from "../contracts/analyzer.ts";
import { type Effort, type LLMClient, ProviderError, RefusalError } from "../contracts/llm.ts";
import type { Transcript, Turn } from "../contracts/transcript.ts";
import { ANALYZER_JSON_SCHEMA, ANALYZER_PROMPT_VERSION, ANALYZER_SYSTEM_PROMPT } from "../prompts/analyzer.ts";

/**
 * Context analyzer v1 (#24, with staleness from #25): one structured-output call labels every turn.
 * Missing or unusable verdicts fall back to `keep`, because dropping a needed turn costs more than keeping waste.
 */

export const DEFAULT_ANALYZER_MODEL = "claude-haiku-5-5";

/** Longer transcripts need the recursive strategy (#26), which v1 does not have. */
export const MAX_ANALYZER_INPUT_TOKENS = 150_000;

export interface AnalyzerOptions {
  model?: string;
  /** Defaults to low; the analyzer runs before every send, so it has to stay cheap. */
  effort?: Effort;
  maxInputTokens?: number;
}

/** The model returned output that does not match the analyzer schema. */
export class AnalyzerOutputError extends Error {
  override readonly name = "AnalyzerOutputError";
}

/** The transcript is too long for a single analyzer call. */
export class TranscriptTooLongError extends Error {
  override readonly name = "TranscriptTooLongError";
  constructor(
    readonly tokens: number,
    readonly limit: number,
  ) {
    super(`transcript has about ${tokens} tokens; the analyzer handles up to ${limit}`);
  }
}

const RawVerdictSchema = z.object({
  turnIndex: z.number().int(),
  label: TurnLabelSchema,
  reason: z.string(),
  takeaway: z.string(),
  supersededByIndex: z.number().int(),
});
const RawOutputSchema = z.object({
  standingInstructionTurns: z.array(z.number().int()).default([]),
  draftCandidateTurns: z.array(z.number().int()).default([]),
  verdicts: z.array(RawVerdictSchema),
});

export async function analyzeContext(
  client: LLMClient,
  transcript: Transcript,
  options: AnalyzerOptions = {},
): Promise<ContextAnalysis> {
  const model = options.model ?? DEFAULT_ANALYZER_MODEL;
  const limit = options.maxInputTokens ?? MAX_ANALYZER_INPUT_TOKENS;
  const effort = options.effort ?? "low";
  const turns = transcript.turns;
  const totalTokens = turns.reduce((sum, t) => sum + t.tokens, 0);

  if (turns.length === 0) {
    return summarize([], turns, { inputTokens: 0, outputTokens: 0, costUsd: 0 });
  }
  if (totalTokens > limit) throw new TranscriptTooLongError(totalTokens, limit);

  const call = async () => {
    const result = await client.complete({
      model,
      system: ANALYZER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: renderTranscript(transcript) }],
      maxTokens: outputBudget(turns.length, effort),
      effort,
      jsonSchema: ANALYZER_JSON_SCHEMA,
    });
    if (result.stopReason === "refusal") throw new RefusalError("analyzer call was refused", client.provider);
    if (result.stopReason === "max_tokens") {
      throw new ProviderError("analyzer output was cut off at max_tokens", client.provider);
    }
    const raw = parseOutput(result.json ?? result.text);
    return { raw, usage: result.usage, covered: coveredTurns(raw, turns.length) };
  };

  let best = await call();
  let usage = best.usage;
  // A response that skips turns gets one retry; the more complete answer wins and both calls are billed.
  if (best.covered < turns.length) {
    const retry = await call();
    usage = addUsage(usage, retry.usage);
    if (retry.covered > best.covered) best = retry;
  }
  return summarize(toVerdicts(best.raw, turns), turns, usage);
}

/** Renders turns as delimited data. Tag-like text inside turns is escaped so it cannot close the delimiters. */
export function renderTranscript(transcript: Transcript): string {
  const body = transcript.turns
    .map((t) => `<turn index="${t.index}" role="${t.role}" tokens="${t.tokens}">\n${escapeTags(t.text)}\n</turn>`)
    .join("\n");
  const n = transcript.turns.length;
  return `<conversation turns="${n}" indexes="0-${n - 1}">\n${body}\n</conversation>\n\n<draft>\n${escapeTags(transcript.draft)}\n</draft>`;
}

/** Room for one short verdict per turn plus thinking, which grows with effort. */
export function outputBudget(turnCount: number, effort: Effort): number {
  const thinking = effort === "low" ? 2_000 : effort === "medium" ? 6_000 : 16_000;
  return Math.min(32_000, thinking + 150 * turnCount);
}

function coveredTurns(raw: z.infer<typeof RawOutputSchema>, count: number): number {
  return new Set(raw.verdicts.map((v) => v.turnIndex).filter((i) => i >= 0 && i < count)).size;
}

function addUsage(a: ContextAnalysis["usage"], b: ContextAnalysis["usage"]): ContextAnalysis["usage"] {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
    ...(a.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined
      ? { cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) }
      : {}),
  };
}

function escapeTags(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseOutput(value: unknown): z.infer<typeof RawOutputSchema> {
  let data = value;
  if (typeof value === "string") {
    try {
      data = JSON.parse(value);
    } catch {
      throw new AnalyzerOutputError("analyzer output is not valid JSON");
    }
  }
  const parsed = RawOutputSchema.safeParse(data);
  if (!parsed.success)
    throw new AnalyzerOutputError(`analyzer output does not match the schema: ${parsed.error.message}`);
  return parsed.data;
}

/**
 * Turns the model named as standing instructions or as threads the draft may continue, plus the assistant
 * answers that follow each of them. These are kept whatever label the model gave them.
 */
function protectedTurns(raw: z.infer<typeof RawOutputSchema>, turns: Turn[]): Map<number, string> {
  const reasons = new Map<number, string>();
  const protect = (start: number, reason: string) => {
    if (start < 0 || start >= turns.length) return;
    reasons.set(start, reasons.get(start) ?? reason);
    if (turns[start]?.role !== "user") return;
    // A protected request keeps the answer to it.
    for (let i = start + 1; turns[i]?.role === "assistant"; i++) reasons.set(i, reasons.get(i) ?? reason);
  };
  for (const i of raw.standingInstructionTurns) protect(i, "Kept: sets an instruction that still applies.");
  for (const i of raw.draftCandidateTurns) protect(i, "Kept: the draft may continue this thread.");
  return reasons;
}

function toVerdicts(raw: z.infer<typeof RawOutputSchema>, turns: Turn[]): TurnVerdict[] {
  const keepReasons = protectedTurns(raw, turns);
  const byIndex = new Map<number, z.infer<typeof RawVerdictSchema>>();
  for (const v of raw.verdicts) {
    if (v.turnIndex >= 0 && v.turnIndex < turns.length && !byIndex.has(v.turnIndex)) byIndex.set(v.turnIndex, v);
  }
  return turns.map((turn, i) => {
    const v = byIndex.get(i);
    const forced = keepReasons.get(i);
    if (forced && v?.label !== "keep") return { turnId: turn.id, label: "keep", reason: forced, takeaway: "" };
    if (!v) return { turnId: turn.id, label: "keep", reason: "Not reviewed, kept to be safe.", takeaway: "" };
    const label: TurnLabel = v.label;
    const verdict: TurnVerdict = {
      turnId: turn.id,
      label,
      reason: v.reason,
      takeaway: label === "keep" ? "" : v.takeaway,
    };
    // Only a later turn can supersede an earlier one.
    const by = turns[v.supersededByIndex];
    if (label === "expired" && v.supersededByIndex > i && by) verdict.supersededBy = by.id;
    return verdict;
  });
}

function summarize(verdicts: TurnVerdict[], turns: Turn[], usage: ContextAnalysis["usage"]): ContextAnalysis {
  const totalTokens = turns.reduce((sum, t) => sum + t.tokens, 0);
  const flaggedTokens = turns.reduce((sum, t, i) => sum + (verdicts[i]?.label !== "keep" ? t.tokens : 0), 0);
  return ContextAnalysisSchema.parse({
    verdicts,
    totalTokens,
    flaggedTokens,
    wastePct: totalTokens === 0 ? 0 : Math.round((flaggedTokens / totalTokens) * 1000) / 10,
    promptVersion: ANALYZER_PROMPT_VERSION,
    usage,
  });
}
