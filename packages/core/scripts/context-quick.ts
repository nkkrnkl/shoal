/**
 * Quick context analyzer check (#29, 3-hour cut): run analyzeContext on a paired sample of MT-Bench sessions (#54)
 * and score it against the gold keep / useless labels.
 *
 *   pnpm --filter @shoal/core eval:context --oracle    # free: fake client returns gold labels, checks the scorer
 *   pnpm --filter @shoal/core eval:context --dry-run   # free: prints the sample and estimated cost
 *   pnpm --filter @shoal/core eval:context             # paid: reads GEMINI_API_KEY from the root .env
 *   pnpm --filter @shoal/core eval:context --model=gemini-3.8-flash --per-cell=10
 *
 * The Gemini client here is a throwaway for this script. The real one lands in @shoal/providers (#5).
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  ANALYZER_PROMPT_VERSION,
  AuthError,
  analyzeContext,
  type CompletionRequest,
  type CompletionResult,
  type ContextAnalysis,
  type LLMClient,
  ProviderError,
  RateLimitError,
  type Transcript,
  TranscriptSchema,
} from "../src/index.ts";

const SESSIONS = new URL("../../../evals/data/mtbench/sessions.jsonl", import.meta.url);
const RESULTS = new URL(
  `../../../evals/data/mtbench/context-quick-results-${ANALYZER_PROMPT_VERSION}.json`,
  import.meta.url,
);
// Benchmarks run on Gemini. Gemini 3.5 Flash-Lite paid-tier prices, USD per million tokens (checked 2026-10-10).
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const PRICE = { input: 0.3, output: 2.5 };

interface Session {
  session_id: string;
  question_id: number;
  category: string;
  k: number;
  placement: "clean" | "recent" | "buried";
  gold: Record<string, "keep" | "useless">;
  transcript: Transcript;
}

const args = new Set(process.argv.slice(2));
const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const perCell = Number(flag("per-cell") ?? 10);
// Prices above are for the default model; pass --model= for another Gemini model and treat cost as approximate.
const model = flag("model") ?? DEFAULT_MODEL;

function loadSample(): Session[] {
  const all: Session[] = readFileSync(SESSIONS, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  // Questions round-robin across categories, the same questions in every cell, so k and placement compare pairwise.
  const byCategory = new Map<string, number[]>();
  for (const s of all.filter((x) => x.placement === "clean").sort((a, b) => a.question_id - b.question_id)) {
    byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s.question_id]);
  }
  const questions: number[] = [];
  for (let round = 0; questions.length < perCell && round < 10; round++) {
    for (const ids of byCategory.values()) {
      const id = ids[round];
      if (id !== undefined && questions.length < perCell) questions.push(id);
    }
  }
  // Clean (k = 0) sessions hold no waste, so anything flagged there is a false alarm.
  const cells = [
    { k: 0, placement: "clean" as const },
    ...[4, 12].flatMap((k) => (["recent", "buried"] as const).map((placement) => ({ k, placement }))),
  ];
  return cells.flatMap(({ k, placement }) =>
    all.filter((s) => s.k === k && s.placement === placement && questions.includes(s.question_id)),
  );
}

/** The parts of a generateContent response this script reads. */
interface GeminiResponse {
  error?: { message?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
}

function geminiClient(apiKey: string): LLMClient {
  return {
    provider: "google",
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const started = Date.now();
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
          contents: req.messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            maxOutputTokens: req.maxTokens,
            // Gemini thinking levels are low and high; anything above medium maps to high.
            ...(req.effort
              ? { thinkingConfig: { thinkingLevel: req.effort === "low" || req.effort === "medium" ? "low" : "high" } }
              : {}),
            ...(req.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: req.jsonSchema } : {}),
          },
        }),
      });
      const body = (await res.json()) as GeminiResponse;
      if (res.status === 429) throw new RateLimitError(body.error?.message ?? "rate limited", "google", 429);
      if (res.status === 401 || res.status === 403)
        throw new AuthError(body.error?.message ?? "auth failed", "google", res.status);
      if (!res.ok) throw new ProviderError(body.error?.message ?? `HTTP ${res.status}`, "google", res.status);

      const candidate = body.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");
      const finish = candidate?.finishReason;
      const blocked =
        body.promptFeedback?.blockReason ||
        ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(finish ?? "");
      const stopReason = blocked
        ? "refusal"
        : finish === "STOP"
          ? "end"
          : finish === "MAX_TOKENS"
            ? "max_tokens"
            : "other";
      const u = body.usageMetadata ?? {};
      const inputTokens = u.promptTokenCount ?? 0;
      // Thinking tokens are billed as output.
      const outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
      return {
        text,
        stopReason,
        usage: {
          inputTokens,
          outputTokens,
          costUsd: (inputTokens * PRICE.input + outputTokens * PRICE.output) / 1_000_000,
        },
        latencyMs: Date.now() - started,
        model: body.modelVersion ?? req.model,
      };
    },
    stream() {
      throw new Error("not used by this script");
    },
  };
}

/** Answers with the gold labels, so a correct scorer must report perfect numbers. */
function oracleClient(gold: Record<string, string>, transcript: Transcript): LLMClient {
  return {
    provider: "google",
    async complete(req) {
      const verdicts = transcript.turns.map((t) => ({
        turnIndex: t.index,
        label: gold[t.id] ?? "keep",
        reason: "oracle",
        takeaway: "",
        supersededByIndex: -1,
      }));
      return {
        text: "",
        json: { verdicts },
        stopReason: "end",
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        latencyMs: 0,
        model: req.model,
      };
    },
    stream() {
      throw new Error("not used");
    },
  };
}

interface Row {
  session: Session;
  analysis?: ContextAnalysis;
  error?: string;
}

/**
 * Drafts that point back only by position ("your previous response", "the above"). In a buried session the
 * most recent reply is a distractor, so the gold `keep` on the buried target is questionable for these.
 */
const POSITIONAL = /\b(your|the)\s+((previous|last|earlier|own|original)\s+)?(response|reply|answer)\b|\babove\b/i;

function score(rows: Row[]) {
  // Positive class: flagged for removal (anything but keep) versus gold `useless`. Clean sessions are scored apart.
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let correct = 0;
  let turns = 0;
  const buried = { positional: [0, 0], content: [0, 0] };
  let cleanSessions = 0;
  let cleanAlarms = 0;
  let cost = 0;
  for (const { session, analysis } of rows) {
    if (!analysis) continue;
    cost += analysis.usage.costUsd;
    if (session.placement === "clean") {
      cleanSessions++;
      if (analysis.verdicts.some((v) => v.label !== "keep")) cleanAlarms++;
      continue;
    }
    let droppedNeeded = false;
    for (const v of analysis.verdicts) {
      const flagged = v.label !== "keep";
      const useless = session.gold[v.turnId] === "useless";
      turns++;
      if (flagged === useless) correct++;
      if (flagged && useless) tp++;
      if (flagged && !useless) {
        fp++;
        droppedNeeded = true;
      }
      if (!flagged && useless) fn++;
    }
    if (session.placement === "buried") {
      const group = POSITIONAL.test(session.transcript.draft) ? buried.positional : buried.content;
      group[1] = (group[1] ?? 0) + 1;
      if (droppedNeeded) group[0] = (group[0] ?? 0) + 1;
    }
  }
  const [hp = 0, np = 0] = buried.positional;
  const [hc = 0, nc = 0] = buried.content;
  const ratio = (a: number, b: number) => (b === 0 ? Number.NaN : a / b);
  return {
    sessions: rows.length,
    failed: rows.filter((r) => r.error).length,
    turnAccuracy: ratio(correct, turns),
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    harmfulPruneRateBuried: ratio(hp + hc, np + nc),
    harmfulPruneRateBuriedContentRef: ratio(hc, nc),
    harmfulPruneRateBuriedPositionalRef: ratio(hp, np),
    buriedSessions: { contentRef: nc, positionalRef: np },
    cleanFalseAlarmRate: ratio(cleanAlarms, cleanSessions),
    promptVersion: ANALYZER_PROMPT_VERSION,
    costUsd: cost,
  };
}

async function main() {
  const sample = loadSample();
  for (const s of sample) TranscriptSchema.parse(s.transcript);
  const inputTokens = sample.reduce((sum, s) => sum + s.transcript.turns.reduce((n, t) => n + t.tokens, 0), 0);
  console.log(`${sample.length} sessions, about ${inputTokens} transcript tokens, model ${model}`);

  if (args.has("--dry-run")) {
    // Prompt overhead and output (verdicts plus thinking) estimated at 1,500 and 2,500 tokens per session.
    const est = ((inputTokens + sample.length * 1500) * PRICE.input + sample.length * 2500 * PRICE.output) / 1e6;
    console.log(`estimated cost about $${est.toFixed(3)}`);
    for (const s of sample) console.log(`  ${s.session_id} (${s.transcript.turns.length} turns)`);
    return;
  }

  const oracle = args.has("--oracle");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!oracle && !apiKey) {
    console.error("GEMINI_API_KEY is not set. Add it to the root .env, or use --oracle or --dry-run.");
    process.exit(1);
  }
  const live = oracle || !apiKey ? undefined : geminiClient(apiKey);

  const rows: Row[] = [];
  const queue = [...sample];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const client = live ?? oracleClient(s.gold, s.transcript);
        try {
          rows.push({ session: s, analysis: await analyzeContext(client, s.transcript, { model }) });
        } catch (err) {
          rows.push({ session: s, error: String(err) });
          console.error(`  ${s.session_id}: ${String(err)}`);
        }
      }
    }),
  );

  const result = score(rows);
  console.log(JSON.stringify(result, null, 2));
  if (!oracle) {
    writeFileSync(
      RESULTS,
      JSON.stringify({ ...result, rows: rows.map((r) => ({ id: r.session.session_id, ...r })) }, null, 2),
    );
    console.log(`details written to ${RESULTS.pathname}`);
  }
  if (
    oracle &&
    (result.turnAccuracy !== 1 ||
      result.harmfulPruneRateBuried !== 0 ||
      result.cleanFalseAlarmRate !== 0 ||
      result.failed > 0)
  ) {
    console.error("oracle check FAILED: the scorer or the analyzer plumbing is wrong");
    process.exit(1);
  }
}

await main();
