import {
  type ContextAnalysis,
  ContextAnalysisSchema,
  type Transcript,
  TranscriptSchema,
  type TurnVerdict,
} from "@shoal/core";

/**
 * Sample conversation and analysis for the context health panel.
 * Stands in for the analyzer client until it lands in the extension. Never shown as real data.
 */

type RawTurn = { id: string; role: "user" | "assistant"; text: string; tokens: number; code?: string };

const RAW_TURNS: RawTurn[] = [
  {
    id: "t1",
    role: "user",
    text: "I'm building a Postgres-backed job queue in Node 22. Target is Postgres 14, so no MERGE. Can you sketch the schema?",
    tokens: 38,
  },
  {
    id: "t2",
    role: "assistant",
    text: "Here is a jobs table with a status enum, run_at, attempts and a partial index on pending jobs. Workers claim rows with SELECT ... FOR UPDATE SKIP LOCKED.",
    code: "create table jobs (\n  id bigserial primary key,\n  status job_status not null default 'pending',\n  run_at timestamptz not null default now(),\n  attempts int not null default 0,\n  payload jsonb not null\n);",
    tokens: 412,
  },
  { id: "t3", role: "user", text: "Nice, thanks! That's really helpful.", tokens: 9 },
  {
    id: "t4",
    role: "assistant",
    text: "Glad it helps. Let me know if you want retries or dead-lettering next.",
    tokens: 18,
  },
  {
    id: "t5",
    role: "user",
    text: "The worker crashes with: error: could not serialize access due to concurrent update. Full stack trace below.",
    code: "error: could not serialize access due to concurrent update\n    at Parser.parseErrorMessage (node_modules/pg-protocol/dist/parser.js:283:98)\n    at claimNext (src/worker.ts:41:17)",
    tokens: 640,
  },
  {
    id: "t6",
    role: "assistant",
    text: "You are running the claim at REPEATABLE READ. Drop to READ COMMITTED for the claim transaction; SKIP LOCKED already prevents double claims.",
    tokens: 236,
  },
  {
    id: "t7",
    role: "user",
    text: "Still failing, here's the same trace again in case it helps.",
    code: "error: could not serialize access due to concurrent update\n    at Parser.parseErrorMessage (node_modules/pg-protocol/dist/parser.js:283:98)\n    at claimNext (src/worker.ts:41:17)",
    tokens: 628,
  },
  {
    id: "t8",
    role: "assistant",
    text: "The trace is identical, so the isolation level is still set on the pool. Check the default_transaction_isolation option in your pool config.",
    tokens: 164,
  },
  {
    id: "t9",
    role: "user",
    text: "Found it, that was it. Also, correction: we upgraded, production is on Postgres 16 now, so MERGE is fine.",
    tokens: 31,
  },
  {
    id: "t10",
    role: "assistant",
    text: "Good catch. On 16 you can use MERGE for upserting recurring jobs. Here is the retry path with exponential backoff and a dead-letter status.",
    code: "merge into jobs j using (values ($1::text, $2::jsonb)) as s(key, payload)\non j.key = s.key\nwhen matched then update set payload = s.payload, run_at = now()\nwhen not matched then insert (key, payload) values (s.key, s.payload);",
    tokens: 538,
  },
];

const VERDICTS: TurnVerdict[] = [
  {
    turnId: "t1",
    label: "expired",
    reason: "Says the target is Postgres 14 with no MERGE. Turn 9 moves production to Postgres 16.",
    takeaway: "Postgres-backed job queue in Node 22.",
    supersededBy: "t9",
  },
  { turnId: "t2", label: "keep", reason: "Defines the schema the rest of the chat builds on.", takeaway: "" },
  {
    turnId: "t3",
    label: "useless",
    reason: "Thanks only. No information for the model.",
    takeaway: "",
  },
  {
    turnId: "t4",
    label: "useless",
    reason: "Pleasantry with an offer that was not taken up.",
    takeaway: "",
  },
  {
    turnId: "t5",
    label: "keep",
    reason: "First report of the serialization error, with the trace.",
    takeaway: "",
  },
  { turnId: "t6", label: "keep", reason: "Diagnosis that led to the fix.", takeaway: "" },
  {
    turnId: "t7",
    label: "redundant",
    reason: "Pastes the same stack trace as turn 5.",
    takeaway: "The first fix did not work on its own.",
  },
  {
    turnId: "t8",
    label: "keep",
    reason: "Points at the pool setting that turned out to be the cause.",
    takeaway: "",
  },
  { turnId: "t9", label: "keep", reason: "Current Postgres version and confirmation of the fix.", takeaway: "" },
  { turnId: "t10", label: "keep", reason: "Latest code for upserts and retries.", takeaway: "" },
];

function buildTranscript(): unknown {
  return {
    site: "claude.ai",
    conversationId: "sample-job-queue",
    turns: RAW_TURNS.map((t, index) => ({
      id: t.id,
      index,
      role: t.role,
      text: t.code ? `${t.text}\n\n${t.code}` : t.text,
      blocks: [
        { kind: "text", text: t.text },
        ...(t.code ? [{ kind: "code", text: t.code, language: t.code.startsWith("error") ? "text" : "sql" }] : []),
      ],
      tokens: t.tokens,
      ts: new Date(Date.UTC(2026, 9, 10, 14, index * 3)).toISOString(),
    })),
    draft: "Now add a cron-style scheduler that enqueues recurring jobs.",
    capturedAt: "2026-10-10T14:31:00.000Z",
  };
}

function buildAnalysis(): unknown {
  const tokensById = new Map(RAW_TURNS.map((t) => [t.id, t.tokens]));
  const totalTokens = RAW_TURNS.reduce((sum, t) => sum + t.tokens, 0);
  const flaggedTokens = VERDICTS.filter((v) => v.label !== "keep").reduce(
    (sum, v) => sum + (tokensById.get(v.turnId) ?? 0),
    0,
  );
  return {
    verdicts: VERDICTS,
    totalTokens,
    flaggedTokens,
    wastePct: totalTokens === 0 ? 0 : Math.round((flaggedTokens / totalTokens) * 1000) / 10,
    promptVersion: "analyzer-v1.0",
    usage: { inputTokens: 3180, outputTokens: 742, costUsd: 0.0021 },
  };
}

export interface SampleAnalysis {
  transcript: Transcript;
  analysis: ContextAnalysis;
}

/** Builds the sample and validates it against the core contracts. Throws if either fails. */
export function sampleAnalysis(): SampleAnalysis {
  return {
    transcript: TranscriptSchema.parse(buildTranscript()),
    analysis: ContextAnalysisSchema.parse(buildAnalysis()),
  };
}

/** Resolves the sample after a short delay so the panel's loading state is visible. */
export function loadSampleAnalysis(delayMs = 900): Promise<SampleAnalysis> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(sampleAnalysis());
      } catch (err) {
        reject(err);
      }
    }, delayMs);
  });
}
