import { z } from "zod";

/**
 * LLM client contract (ADR-001, contract 1).
 * Implemented in @shoal/providers. Used by the router, analyzer and coach.
 */

export const ProviderSchema = z.enum(["anthropic", "google", "openai"]);
export type Provider = z.infer<typeof ProviderSchema>;

export const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof EffortSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Serializable part of a request. `signal` is added in the TypeScript type below. */
export const CompletionRequestSchema = z.object({
  /** Catalog model ID, for example "claude-haiku-5-5". */
  model: z.string().min(1),
  system: z.string().optional(),
  messages: z.array(ChatMessageSchema).min(1),
  maxTokens: z.number().int().positive(),
  /** Ignored by models without effort control. */
  effort: EffortSchema.optional(),
  /** Request structured output that matches this JSON Schema. */
  jsonSchema: z.record(z.string(), z.unknown()).optional(),
});

/** Structural subset of AbortSignal, so core needs no DOM types. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
}

export type CompletionRequest = z.infer<typeof CompletionRequestSchema> & {
  signal?: AbortSignalLike;
};

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  /** Computed from the model catalog. */
  costUsd: z.number().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const StopReasonSchema = z.enum(["end", "max_tokens", "refusal", "other"]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const CompletionResultSchema = z.object({
  text: z.string(),
  /** Parsed output when `jsonSchema` was given. Check `stopReason` before using it. */
  json: z.unknown().optional(),
  stopReason: StopReasonSchema,
  usage: UsageSchema,
  latencyMs: z.number().nonnegative(),
  model: z.string().min(1),
});
export type CompletionResult = z.infer<typeof CompletionResultSchema>;

export type CompletionStream = AsyncIterable<string> & {
  final(): Promise<CompletionResult>;
};

export interface LLMClient {
  readonly provider: Provider;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  stream(req: CompletionRequest): CompletionStream;
}

/** Typed errors every LLMClient implementation throws. */
export class ProviderError extends Error {
  override readonly name: string = "ProviderError";
  constructor(
    message: string,
    readonly provider: Provider,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class RateLimitError extends ProviderError {
  override readonly name = "RateLimitError";
}

export class AuthError extends ProviderError {
  override readonly name = "AuthError";
}

export class RefusalError extends ProviderError {
  override readonly name = "RefusalError";
}
