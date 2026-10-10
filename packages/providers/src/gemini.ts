import {
  AuthError,
  type CompletionRequest,
  type CompletionResult,
  type CompletionStream,
  type LLMClient,
  ProviderError,
  RateLimitError,
  type StopReason,
} from "@shoal/core";

/**
 * Gemini adapter for the LLMClient contract, calling the Gemini API's generateContent endpoint with the user's key.
 * The API allows chrome-extension:// origins, so extension pages call it directly with no host permission.
 */

const API = "https://generativelanguage.googleapis.com/v1beta";

/** Paid-tier prices, USD per million tokens (checked 2026-10-10). Output includes thinking tokens. */
export const GEMINI_MODELS = {
  "gemini-3.8-flash": { label: "Gemini 3.8 Flash", inputPerMTok: 0.75, outputPerMTok: 3.75 },
  "gemini-3.5-flash-lite": { label: "Gemini 3.5 Flash-Lite", inputPerMTok: 0.3, outputPerMTok: 2.5 },
} as const;
export type GeminiModel = keyof typeof GEMINI_MODELS;

/** Best analyzer results in the quick context eval (#29). */
export const DEFAULT_GEMINI_MODEL: GeminiModel = "gemini-3.8-flash";

export function isGeminiModel(id: string): id is GeminiModel {
  return Object.hasOwn(GEMINI_MODELS, id);
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeminiClientOptions {
  apiKey: string;
  /** For tests. Defaults to the global fetch. */
  fetch?: Fetch;
}

/** The parts of a generateContent response this client reads. */
interface GenerateContentResponse {
  error?: { message?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
}

const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

export class GeminiClient implements LLMClient {
  readonly provider = "google" as const;
  readonly #apiKey: string;
  readonly #fetch: Fetch;

  constructor(options: GeminiClientOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const res = await this.#fetch(`${API}/models/${encodeURIComponent(req.model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": this.#apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        contents: req.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          maxOutputTokens: req.maxTokens,
          // Gemini thinking levels are low and high; medium and below map to low.
          ...(req.effort
            ? { thinkingConfig: { thinkingLevel: req.effort === "low" || req.effort === "medium" ? "low" : "high" } }
            : {}),
          ...(req.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: req.jsonSchema } : {}),
        },
      }),
      ...(req.signal ? { signal: req.signal as AbortSignal } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as GenerateContentResponse;
    throwForStatus(res.status, body);

    const candidate = body.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    const finish = candidate?.finishReason;
    const stopReason: StopReason =
      body.promptFeedback?.blockReason || BLOCKED.has(finish ?? "")
        ? "refusal"
        : finish === "STOP"
          ? "end"
          : finish === "MAX_TOKENS"
            ? "max_tokens"
            : "other";
    const u = body.usageMetadata ?? {};
    const inputTokens = u.promptTokenCount ?? 0;
    const outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    const price = isGeminiModel(req.model) ? GEMINI_MODELS[req.model] : undefined;
    const costUsd = price ? (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000 : 0;
    return {
      text,
      ...(req.jsonSchema && stopReason === "end" ? { json: parseJson(text) } : {}),
      stopReason,
      usage: { inputTokens, outputTokens, costUsd },
      latencyMs: Date.now() - started,
      model: body.modelVersion ?? req.model,
    };
  }

  /** Not streamed yet: yields the whole answer once. Execution mode (#48) will need real streaming. */
  stream(req: CompletionRequest): CompletionStream {
    const result = this.complete(req);
    return {
      async *[Symbol.asyncIterator]() {
        yield (await result).text;
      },
      final: () => result,
    };
  }
}

/** Checks a key with a free models list call. */
export async function checkGeminiKey(apiKey: string, fetchImpl: Fetch = (i, init) => fetch(i, init)): Promise<void> {
  const res = await fetchImpl(`${API}/models?pageSize=1`, { headers: { "x-goog-api-key": apiKey } });
  throwForStatus(res.status, (await res.json().catch(() => ({}))) as GenerateContentResponse);
}

function throwForStatus(status: number, body: GenerateContentResponse): void {
  if (status >= 200 && status < 300) return;
  const message = body.error?.message ?? `Gemini API returned HTTP ${status}`;
  if (status === 429) throw new RateLimitError(message, "google", status);
  // Gemini answers an invalid key with 400 API_KEY_INVALID.
  if (status === 401 || status === 403 || /api key/i.test(message)) throw new AuthError(message, "google", status);
  throw new ProviderError(message, "google", status);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Left for the caller, which validates json and falls back to text.
    return undefined;
  }
}
