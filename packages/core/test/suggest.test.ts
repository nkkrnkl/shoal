import { describe, expect, it } from "vitest";
import {
  AnalyzerOutputError,
  type CompletionRequest,
  type ContextAnalysis,
  freshStartSuggestion,
  type LLMClient,
  suggestForDraft,
  type Transcript,
} from "../src/index.ts";

const transcript: Transcript = {
  site: "claude.ai",
  conversationId: "c1",
  draft: "How much should I run today? I'm training for a marathon.",
  capturedAt: "2026-10-10T12:00:00Z",
  turns: [
    { id: "a", index: 0, role: "user", text: "My race is in May.", blocks: [], tokens: 5 },
    { id: "b", index: 1, role: "assistant", text: "Great, plenty of time.", blocks: [], tokens: 5 },
    { id: "c", index: 2, role: "user", text: "Unrelated: best pizza in NYC?", blocks: [], tokens: 7 },
  ],
};

function fake(json: unknown) {
  const calls: CompletionRequest[] = [];
  const client: LLMClient = {
    provider: "google",
    async complete(req) {
      calls.push(req);
      return {
        text: JSON.stringify(json),
        json,
        stopReason: "end",
        usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.0001 },
        latencyMs: 1,
        model: req.model,
      };
    },
    stream() {
      throw new Error("unused");
    },
  };
  return { client, calls };
}

const analysis = (wastePct: number, labels: string[]): ContextAnalysis => ({
  verdicts: labels.map((label, i) => ({
    turnId: ["a", "b", "c", "d", "e", "f"][i] ?? `x${i}`,
    label,
    reason: "",
    takeaway: "",
  })) as ContextAnalysis["verdicts"],
  totalTokens: 100,
  flaggedTokens: wastePct,
  wastePct,
  promptVersion: "analyzer-v1.2",
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
});

describe("suggestForDraft", () => {
  it("returns the model's tips and maps stale references to turn ids", async () => {
    const { client, calls } = fake({
      suggestions: [
        { kind: "add_context", text: " Add your weekly mileage and race date. ", turnIndex: -1 },
        { kind: "stale_reference", text: "Your race date changed later.", turnIndex: 0 },
      ],
    });
    const out = await suggestForDraft(client, transcript, { model: "gemini-3.8-flash" });
    expect(out.suggestions).toEqual([
      { kind: "add_context", text: "Add your weekly mileage and race date." },
      { kind: "stale_reference", text: "Your race date changed later.", turnId: "a" },
    ]);
    expect(calls[0]?.jsonSchema).toBeDefined();
    expect(out.usage.costUsd).toBe(0.0001);
  });

  it("sends only the turns the analysis kept", async () => {
    const { client, calls } = fake({ suggestions: [] });
    await suggestForDraft(client, transcript, { model: "m", analysis: analysis(30, ["keep", "keep", "useless"]) });
    const sent = calls[0]?.messages[0]?.content ?? "";
    expect(sent).toContain("My race is in May.");
    expect(sent).not.toContain("pizza");
  });

  it("skips the call for a short draft", async () => {
    const { client, calls } = fake({ suggestions: [] });
    const out = await suggestForDraft(client, { ...transcript, draft: "hi" }, { model: "m" });
    expect(calls).toHaveLength(0);
    expect(out.suggestions).toEqual([]);
  });

  it("works on a new chat with no turns", async () => {
    const { client, calls } = fake({ suggestions: [{ kind: "clarify", text: "Say which distance.", turnIndex: -1 }] });
    const out = await suggestForDraft(client, { ...transcript, turns: [] }, { model: "m" });
    expect(calls).toHaveLength(1);
    expect(out.suggestions[0]?.kind).toBe("clarify");
  });

  it("rejects malformed output", async () => {
    await expect(
      suggestForDraft(fake({ suggestions: [{ kind: "poem" }] }).client, transcript, { model: "m" }),
    ).rejects.toBeInstanceOf(AnalyzerOutputError);
  });
});

describe("freshStartSuggestion", () => {
  it("suggests a new chat only for long, mostly wasted conversations", () => {
    expect(freshStartSuggestion(analysis(60, ["keep", "useless", "useless", "useless", "keep", "useless"]))?.kind).toBe(
      "start_fresh",
    );
    expect(freshStartSuggestion(analysis(60, ["keep", "useless"]))).toBeUndefined();
    expect(freshStartSuggestion(analysis(20, Array(8).fill("keep")))).toBeUndefined();
    expect(freshStartSuggestion(undefined)).toBeUndefined();
  });
});
