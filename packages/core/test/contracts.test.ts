import { describe, expect, it } from "vitest";
import {
  CompletionRequestSchema,
  CompletionResultSchema,
  ProviderError,
  RateLimitError,
  type RouterOutput,
  RouterOutputSchema,
  type Transcript,
  TranscriptSchema,
  type Turn,
} from "../src/index.ts";

const now = "2026-10-10T12:00:00Z";

const t0: Turn = {
  id: "t0",
  index: 0,
  role: "user",
  text: "Write a sort",
  blocks: [{ kind: "text", text: "Write a sort" }],
  tokens: 4,
};

const t1: Turn = {
  id: "t1",
  index: 1,
  role: "assistant",
  text: "def sort(xs): ...",
  blocks: [{ kind: "code", text: "def sort(xs): ...", language: "python" }],
  tokens: 6,
  ts: now,
};

const transcript: Transcript = {
  site: "claude.ai",
  conversationId: "abc",
  draft: "Now make it faster",
  capturedAt: now,
  turns: [t0, t1],
};

const routerOutput: RouterOutput = {
  difficulty: 3,
  category: "coding",
  capabilities: [],
  recommendation: [
    {
      tier: "mid",
      model: "claude-sonnet-5-5",
      effort: "medium",
      strategy: "single",
      estCostUsd: 0.01,
      estLatencyMs: 4000,
    },
  ],
  confidence: 0.7,
  rationale: "Moderate coding task with clear requirements.",
  promptVersion: "router-v0",
};

describe("TranscriptSchema", () => {
  it("accepts a valid transcript", () => {
    expect(TranscriptSchema.parse(transcript)).toEqual(transcript);
  });

  it("rejects turn indexes that do not match position", () => {
    const bad = { ...transcript, turns: [{ ...t1, index: 0 }, t0] };
    expect(TranscriptSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects duplicate turn ids", () => {
    const bad = { ...transcript, turns: [t0, { ...t1, id: "t0" }] };
    expect(TranscriptSchema.safeParse(bad).success).toBe(false);
  });
});

describe("RouterOutputSchema", () => {
  it("accepts a valid output", () => {
    expect(RouterOutputSchema.parse(routerOutput)).toEqual(routerOutput);
  });

  it.each([
    ["difficulty out of range", { difficulty: 6 }],
    ["no recommendation", { recommendation: [] }],
    ["confidence above 1", { confidence: 1.5 }],
    ["unknown category", { category: "poetry" }],
  ])("rejects %s", (_name, patch) => {
    expect(RouterOutputSchema.safeParse({ ...routerOutput, ...patch }).success).toBe(false);
  });
});

describe("LLM contract", () => {
  it("validates requests and results", () => {
    expect(
      CompletionRequestSchema.safeParse({
        model: "claude-haiku-5-5",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 256,
        effort: "low",
      }).success,
    ).toBe(true);
    expect(CompletionRequestSchema.safeParse({ model: "x", messages: [], maxTokens: 1 }).success).toBe(false);
    expect(
      CompletionResultSchema.safeParse({
        text: "hello",
        stopReason: "end",
        usage: { inputTokens: 3, outputTokens: 1, costUsd: 0.000001 },
        latencyMs: 120,
        model: "claude-haiku-5-5",
      }).success,
    ).toBe(true);
  });

  it("keeps typed errors distinguishable", () => {
    const err = new RateLimitError("slow down", "anthropic", 429);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe("RateLimitError");
    expect(err.status).toBe(429);
  });
});
