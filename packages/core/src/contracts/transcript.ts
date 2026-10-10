import { z } from "zod";

/**
 * Transcript contract (ADR-001, contract 2).
 * Produced by the site adapters, normalized in the transcript model.
 * Consumed by the analyzer, staleness detector, coach and router.
 */

export const SiteSchema = z.enum(["claude.ai", "chatgpt.com", "gemini.google.com", "generic"]);
export type Site = z.infer<typeof SiteSchema>;

export const TurnBlockSchema = z.object({
  kind: z.enum(["text", "code", "attachment", "image"]),
  /** Text or code content. */
  text: z.string().optional(),
  /** Language of a code block. */
  language: z.string().optional(),
  /** File name of an attachment. */
  name: z.string().optional(),
});
export type TurnBlock = z.infer<typeof TurnBlockSchema>;

export const TurnSchema = z.object({
  /** Stable across re-renders of the page. */
  id: z.string().min(1),
  /** 0-based position in the conversation. */
  index: z.number().int().nonnegative(),
  role: z.enum(["user", "assistant"]),
  /** Plain text of all blocks, used for token counting. */
  text: z.string(),
  blocks: z.array(TurnBlockSchema),
  /** Estimate from the model catalog tokenizer. */
  tokens: z.number().int().nonnegative(),
  /** ISO 8601, when the site exposes it. */
  ts: z.iso.datetime().optional(),
});
export type Turn = z.infer<typeof TurnSchema>;

export const TranscriptSchema = z
  .object({
    site: SiteSchema,
    conversationId: z.string().min(1),
    turns: z.array(TurnSchema),
    /** The prompt currently being written. */
    draft: z.string(),
    /** ISO 8601. */
    capturedAt: z.iso.datetime(),
  })
  .superRefine((t, ctx) => {
    t.turns.forEach((turn, i) => {
      if (turn.index !== i) {
        ctx.addIssue({
          code: "custom",
          path: ["turns", i, "index"],
          message: `turn index ${turn.index} does not match its position ${i}`,
        });
      }
    });
    const ids = new Set<string>();
    for (const [i, turn] of t.turns.entries()) {
      if (ids.has(turn.id)) {
        ctx.addIssue({ code: "custom", path: ["turns", i, "id"], message: `duplicate turn id ${turn.id}` });
      }
      ids.add(turn.id);
    }
  });
export type Transcript = z.infer<typeof TranscriptSchema>;
