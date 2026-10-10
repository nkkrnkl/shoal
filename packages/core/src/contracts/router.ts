import { z } from "zod";
import { EffortSchema } from "./llm.ts";

/**
 * Router output contract (ADR-001, contract 3).
 * The rubric that fills `difficulty` and `category` is finalized in the routing taxonomy issue.
 * Read by the side panel, feedback log, voice tools and the context analyzer,
 * which uses `tier` to set how aggressively it prunes.
 */

export const TierSchema = z.enum(["small", "mid", "large", "frontier"]);
export type Tier = z.infer<typeof TierSchema>;

export const CategorySchema = z.enum([
  "coding",
  "math_logic",
  "writing",
  "factual_qa",
  "summarization",
  "extraction",
  "multi_step",
  "conversation",
]);
export type Category = z.infer<typeof CategorySchema>;

export const CapabilitySchema = z.enum(["tools", "long_context", "vision", "current_info"]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const RouteOptionSchema = z.object({
  tier: TierSchema,
  /** Catalog model ID. */
  model: z.string().min(1),
  effort: EffortSchema.optional(),
  strategy: z.enum(["single", "executor_plus_advisor"]),
  estCostUsd: z.number().nonnegative(),
  estLatencyMs: z.number().nonnegative(),
});
export type RouteOption = z.infer<typeof RouteOptionSchema>;

export const RouterOutputSchema = z.object({
  difficulty: z.number().int().min(1).max(5),
  category: CategorySchema,
  capabilities: z.array(CapabilitySchema),
  /** Best first, at most 3. */
  recommendation: z.array(RouteOptionSchema).min(1).max(3),
  /** 0 to 1. */
  confidence: z.number().min(0).max(1),
  /** One or two sentences shown to the user. */
  rationale: z.string().min(1),
  /** Router prompt version that produced this output. */
  promptVersion: z.string().min(1),
});
export type RouterOutput = z.infer<typeof RouterOutputSchema>;
