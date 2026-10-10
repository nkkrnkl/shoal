import { z } from "zod";
import type { LLMClient } from "./llm.ts";
import { UsageSchema } from "./llm.ts";
import type { Transcript } from "./transcript.ts";

/**
 * Context analyzer output contract (#24, with staleness from #25).
 * Produced by analyzeContext in @shoal/core. Read by the context health UI (#27) and the context evals (#29).
 */

export const TurnLabelSchema = z.enum(["keep", "useless", "redundant", "expired"]);
export type TurnLabel = z.infer<typeof TurnLabelSchema>;

export const TurnVerdictSchema = z
  .object({
    /** Turn.id from the analyzed transcript. */
    turnId: z.string().min(1),
    label: TurnLabelSchema,
    /** Short reason shown to the user. */
    reason: z.string(),
    /** What to keep from the turn if it is dropped. Empty for `keep`. */
    takeaway: z.string(),
    /** Turn.id of the later turn that replaces this one. Only on `expired`. */
    supersededBy: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.supersededBy !== undefined && v.label !== "expired") {
      ctx.addIssue({
        code: "custom",
        path: ["supersededBy"],
        message: "supersededBy is only allowed on expired turns",
      });
    }
  });
export type TurnVerdict = z.infer<typeof TurnVerdictSchema>;

export const ContextAnalysisSchema = z
  .object({
    /** One verdict per transcript turn, in turn order. */
    verdicts: z.array(TurnVerdictSchema),
    /** Sum of Turn.tokens over the transcript. */
    totalTokens: z.number().int().nonnegative(),
    /** Tokens in turns not labeled `keep`. */
    flaggedTokens: z.number().int().nonnegative(),
    /** flaggedTokens / totalTokens, 0 to 100. */
    wastePct: z.number().min(0).max(100),
    /** Analyzer prompt version that produced this output. */
    promptVersion: z.string().min(1),
    /** Cost of the analyzer call itself. */
    usage: UsageSchema,
  })
  .superRefine((a, ctx) => {
    if (a.flaggedTokens > a.totalTokens) {
      ctx.addIssue({ code: "custom", path: ["flaggedTokens"], message: "flaggedTokens exceeds totalTokens" });
    }
    const ids = new Set<string>();
    for (const [i, v] of a.verdicts.entries()) {
      if (ids.has(v.turnId)) {
        ctx.addIssue({ code: "custom", path: ["verdicts", i, "turnId"], message: `duplicate verdict for ${v.turnId}` });
      }
      ids.add(v.turnId);
    }
  });
export type ContextAnalysis = z.infer<typeof ContextAnalysisSchema>;

/** Signature of the analyzer entry point, implemented in #24. */
export type AnalyzeContext = (client: LLMClient, transcript: Transcript) => Promise<ContextAnalysis>;
