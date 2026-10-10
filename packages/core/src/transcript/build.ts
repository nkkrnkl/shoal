import { type Site, type Transcript, TranscriptSchema, type Turn, type TurnBlock } from "../contracts/transcript.ts";
import { fnv1a } from "./hash.ts";

/** A turn as read from the page, before normalization. */
export interface RawTurn {
  role: Turn["role"];
  text: string;
  blocks?: TurnBlock[];
}

export interface BuildTranscriptInput {
  site: Site;
  conversationId: string;
  draft: string;
  turns: RawTurn[];
  /** ISO 8601. Defaults to now. */
  capturedAt?: string;
}

/** Rough token estimate: about 4 characters per token, at least 1 for non-empty text. */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Stable turn ID from position plus a short hash of role and text, so re-reading the page gives the same IDs. */
export function turnId(index: number, role: Turn["role"], text: string): string {
  return `t${index}-${fnv1a(`${role}\u0000${text}`)}`;
}

/**
 * Normalizes turns read by a site adapter into a validated `Transcript`.
 * Turns whose text is empty after trimming are dropped before indexing.
 */
export function buildTranscript(input: BuildTranscriptInput): Transcript {
  const turns: Turn[] = [];
  for (const raw of input.turns) {
    const text = raw.text.trim();
    if (text.length === 0) continue;
    const index = turns.length;
    turns.push({
      id: turnId(index, raw.role, text),
      index,
      role: raw.role,
      text,
      blocks: raw.blocks ?? [{ kind: "text", text }],
      tokens: estimateTokens(text),
    });
  }
  return TranscriptSchema.parse({
    site: input.site,
    conversationId: input.conversationId || "new",
    turns,
    draft: input.draft,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  });
}
