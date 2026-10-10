import { AuthError, type LLMClient, RateLimitError, type Transcript } from "@shoal/core";
import { describe, expect, it } from "vitest";
import { AnalysisError, runLiveAnalysis, toAnalysisError } from "../lib/live-analysis";
import type { Settings } from "../lib/settings";

const settings: Settings = { geminiApiKey: "k", analyzerModel: "gemini-3.8-flash", autoAnalyze: true };

const transcript: Transcript = {
  site: "claude.ai",
  conversationId: "c1",
  draft: "Now add tests.",
  capturedAt: "2026-10-10T12:00:00Z",
  turns: [
    { id: "a", index: 0, role: "user", text: "Write a sort.", blocks: [], tokens: 4 },
    { id: "b", index: 1, role: "assistant", text: "def sort(xs): ...", blocks: [], tokens: 6 },
  ],
};

function client(complete: LLMClient["complete"]): LLMClient {
  return {
    provider: "google",
    complete,
    stream() {
      throw new Error("unused");
    },
  };
}

const okClient = client(async (req) => ({
  text: "",
  json: {
    standingInstructionTurns: [],
    draftCandidateTurns: [0],
    verdicts: [0, 1].map((i) => ({ turnIndex: i, label: "keep", reason: "", takeaway: "", supersededByIndex: -1 })),
  },
  stopReason: "end",
  usage: { inputTokens: 10, outputTokens: 5, costUsd: 0 },
  latencyMs: 1,
  model: req.model,
}));

describe("runLiveAnalysis", () => {
  it("analyzes the page transcript with the chosen model", async () => {
    let model = "";
    const c = client(async (req) => {
      model = req.model;
      return okClient.complete(req);
    });
    const { analysis } = await runLiveAnalysis(async () => transcript, settings, c);
    expect(model).toBe("gemini-3.8-flash");
    expect(analysis.verdicts).toHaveLength(2);
  });

  it("asks for a key before reading the page", async () => {
    let read = false;
    const err = await runLiveAnalysis(
      async () => {
        read = true;
        return transcript;
      },
      { ...settings, geminiApiKey: "" },
      okClient,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnalysisError);
    expect((err as AnalysisError).needsSettings).toBe(true);
    expect(read).toBe(false);
  });

  it("explains an empty page", async () => {
    await expect(runLiveAnalysis(async () => ({ ...transcript, turns: [] }), settings, okClient)).rejects.toThrow(
      /No conversation found/,
    );
  });

  it("turns provider errors into plain messages", async () => {
    const rejected = client(async () => {
      throw new AuthError("API key not valid", "google", 400);
    });
    const err = (await runLiveAnalysis(async () => transcript, settings, rejected).catch(
      (e: unknown) => e,
    )) as AnalysisError;
    expect(err.message).toMatch(/rejected your API key/);
    expect(err.needsSettings).toBe(true);
    expect(toAnalysisError(new RateLimitError("slow", "google", 429)).message).toMatch(/rate limit/);
    expect(toAnalysisError(new TypeError("Failed to fetch")).message).toMatch(/reach Gemini/);
  });
});
