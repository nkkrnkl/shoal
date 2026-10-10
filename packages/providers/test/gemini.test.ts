import { AuthError, ProviderError, RateLimitError } from "@shoal/core";
import { describe, expect, it } from "vitest";
import { checkGeminiKey, GeminiClient } from "../src/index.ts";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}

const ok = (text: string, finishReason = "STOP") => ({
  candidates: [{ finishReason, content: { parts: [{ text: "thinking...", thought: true }, { text }] } }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 100 },
  modelVersion: "gemini-3.8-flash",
});

const req = {
  model: "gemini-3.8-flash",
  system: "Be brief.",
  messages: [{ role: "user" as const, content: "hi" }],
  maxTokens: 500,
  effort: "low" as const,
};

describe("GeminiClient", () => {
  it("sends the request in Gemini's shape and maps the response", async () => {
    const { fetch, calls } = fakeFetch(200, ok('{"a":1}'));
    const client = new GeminiClient({ apiKey: "k", fetch });
    const result = await client.complete({ ...req, jsonSchema: { type: "object" } });

    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(calls[0]?.url).toContain("/models/gemini-3.8-flash:generateContent");
    expect(new Headers(calls[0]?.init?.headers).get("x-goog-api-key")).toBe("k");
    expect(body.systemInstruction.parts[0].text).toBe("Be brief.");
    expect(body.generationConfig).toMatchObject({
      maxOutputTokens: 500,
      thinkingConfig: { thinkingLevel: "low" },
      responseMimeType: "application/json",
    });

    expect(result.text).toBe('{"a":1}');
    expect(result.json).toEqual({ a: 1 });
    expect(result.stopReason).toBe("end");
    expect(result.usage.outputTokens).toBe(200);
    // 1,000 input at $0.75 and 200 output at $3.75 per million.
    expect(result.usage.costUsd).toBeCloseTo(0.0015, 8);
  });

  it("maps finish reasons", async () => {
    for (const [finish, stop] of [
      ["MAX_TOKENS", "max_tokens"],
      ["SAFETY", "refusal"],
      ["OTHER", "other"],
    ] as const) {
      const client = new GeminiClient({ apiKey: "k", fetch: fakeFetch(200, ok("x", finish)).fetch });
      expect((await client.complete(req)).stopReason).toBe(stop);
    }
  });

  it("throws typed errors", async () => {
    const make = (status: number, message: string) =>
      new GeminiClient({ apiKey: "k", fetch: fakeFetch(status, { error: { message } }).fetch });
    await expect(make(429, "quota").complete(req)).rejects.toBeInstanceOf(RateLimitError);
    await expect(make(400, "API key not valid. Please pass a valid API key.").complete(req)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(make(500, "boom").complete(req)).rejects.toBeInstanceOf(ProviderError);
  });

  it("checks a key with the models list", async () => {
    const good = fakeFetch(200, { models: [] });
    await expect(checkGeminiKey("k", good.fetch)).resolves.toBeUndefined();
    expect(good.calls[0]?.url).toContain("/models?pageSize=1");
    await expect(
      checkGeminiKey("bad", fakeFetch(400, { error: { message: "API key not valid" } }).fetch),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
