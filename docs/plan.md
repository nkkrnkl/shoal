# Shoal plan: model router, context analyzer and voice assistant

## Context

`nkkrnkl/shoal` is an empty private repo (issues enabled, default labels only, no milestones). The goal is an assistant that watches the prompt you are writing, tells you which model (and how much reasoning) the task deserves, warns when the conversation context has gone stale, helps rewrite the prompt, and can do all of this by voice through Gemini. Routing starts with in-context learning and later moves to a fine-tuned classifier.

Research pulled for this plan (abstracts/HTML fetched today):

| Source | What it is | How Shoal uses it |
|---|---|---|
| arXiv 2509.23586 **AgentDiet** (Xiao et al., FSE 2026) | Inference-time trajectory reduction. A cheap "reflection" LLM runs after each step, rewrites step `s-2` into a short takeaway if it is >500 tokens, with a 1-step lookahead window. Taxonomy: **useless / redundant / expired**. 40–60% fewer input tokens, pass rate unchanged. Agent self-pruning failed; rules failed; LLM reflection worked. | Core of the context analyzer: classify conversation turns as keep/useless/redundant/expired, replace with takeaways, delayed window so recent turns are untouched. |
| arXiv 2512.24601 **Recursive Language Models** (Zhang, Kraska, Khattab) | Treat a long prompt as an external environment in a REPL; root model inspects metadata, slices, and recursively sub-calls over chunks. | Strategy for analyzing conversations longer than the analyzer's budget: chunk, sub-call, aggregate instead of one giant call. |
| arXiv 2507.05257 **MemoryAgentBench**, arXiv 2410.10813 **LongMemEval**, arXiv 2402.17753 **LoCoMo** | Benchmarks for long-term conversational memory: accurate retrieval, knowledge updates, temporal reasoning, selective forgetting, abstention. | Evaluation sets for the staleness detector. LongMemEval "knowledge-update" questions are a direct test of "which earlier fact is now expired". |
| Advisor strategy (Anthropic `advisor_20260301` tool, beta header `advisor-tool-2026-03-01`; three blog posts) | Cheap executor (Sonnet/Haiku) runs the task, consults a stronger advisor (Opus) 2–3 times per task. Sonnet+Opus advisor: +2.7 on SWE-bench Multilingual at −11.9% cost; Haiku+Opus: BrowseComp 19.7→41.2. | A third routing outcome besides "small model" / "big model": "mid model + advisor" for multi-step tasks. Only applies when Shoal executes prompts itself through the API. |
| alphaxiv 2610.08773 **AdvSim2Real** | Adversarial training of web agents against prompt injection in page content. | Not a routing paper. Relevant as a reminder: the extension reads third-party page DOM, so page text must be treated as data, never as instructions to the router/analyzer LLM. |
| openreview `WLJL9YYjzv` | Could not be fetched (OpenReview bot check) and the ID matches nothing in search. | Placeholder task in the literature-review issue; user supplies title/PDF. |

### Newer work (2026) that changes the design

| Paper | Finding | Design change |
|---|---|---|
| **The Routing Plateau** (arXiv 2606.07587, Lu et al., v2 Sep 2026) | 21 routers on 5 benchmarks cluster in a narrow accuracy band far below oracle; kNN is as good as most. More data, bigger encoders, fine-tuning add only ~1.2 pts. Routers learn global model averages, not query-specific signals. | Router eval must include a kNN baseline and the oracle gap. Fine-tuning (M5) is justified for latency/cost, not expected accuracy jumps. Add post-hoc signals (see cascade issue). |
| **VDAR-Router** (arXiv 2607.18098, EMNLP 2026 Findings) | Training-free: verbalize difficulty analysis, retrieve past queries with similar difficulty profiles, score models with cost-aware reward. | Becomes the explicit design for router v1 + retrieval (issues 8–9). |
| **LLM Router with Prefill Activations** (arXiv 2603.20895) | Open-weight encoder's residual-stream activations predict correctness of closed target models (Encoder-Target Decoupling). Closes 45.6% of gap to oracle, 74% cost savings. | M5 spike: small open model (e.g., Qwen3 0.6B–1.7B) activations as router features instead of only text embeddings. |
| **LLMRouter / xRouteBench** (arXiv 2608.06867) | Open infra with 16+ routers, unified quality+cost evaluation; learned routers beat best fixed model by 14.6%. | Use as baseline suite and data source in the eval harness instead of hand-building every baseline. |
| **RouterArena** (ICLR 2026) | Leaderboard with difficulty-level analysis and commercial routers. | Report our router on its protocol for external comparability. |
| **ACON** (arXiv 2510.00615, ICML 2026) | Optimizes natural-language compression guidelines from failure analysis, then distills compressor to small models. −26–54% peak tokens with higher success. | Context analyzer prompt is tuned ACON-style from failures, and later distilled into the on-device model. |
| **AdaCoM** (arXiv 2605.30785) | RL-trained external manager edits a frozen agent's context: keeps constraints + progress, drops stale content. Stronger models want higher-fidelity context; weaker ones need aggressive compression. | Pruning aggressiveness becomes a function of the target model tier chosen by the router. Links feature 1 and feature 2. |
| **ACE** (arXiv 2606.31564) | Keeps full trajectory in a side store so compression decisions stay revisable. | Never destroy originals: pruned turns are restorable from IndexedDB. |
| **Less Context, Better Agents** (arXiv 2606.10209) | Keeping only the last 5 tool call/response pairs beat full context; old tool results describe superseded state. | Cheap heuristic baseline for the analyzer eval. |
| **Beyond Token Savings** (arXiv 2609.32961) | 35k runs: fewer tokens can mean 20–80% *slower*; same policy behaves differently across models. | Analyzer eval measures latency, cost, and task success, not just compression ratio. |
| **BEAM + LIGHT** (ICLR 2026) | 100K–10M token conversations; tests contradiction resolution and changing information. | Primary staleness benchmark alongside LongMemEval knowledge-update. |
| **GEPA** (arXiv 2507.19457, ICLR 2026 oral) | Reflective Pareto prompt evolution, beats GRPO with 35× fewer rollouts; in DSPy as `dspy.GEPA`. | Used offline to optimize Shoal's own router, analyzer, and coach prompts against the eval sets. |

Routing landscape checked: RouterBench (withmartian/routerbench, 30k+ prompts × 11 models with correctness + cost), RouterArena leaderboard (NotDiamond and RouteLLM mid-pack; small encoder classifiers like MIRT-BERT and DistilBERT multi-task heads at the top), VDAR-Router (training-free: verbalize difficulty, retrieve similar past prompts as few-shot). NotDiamond's model: recommend-only router, client executes, per-request quality/cost/latency tradeoff, custom routers trained from uploaded eval data.

## Decision: Chrome extension, yes, but as a thin shell over a shared core plus a tiny backend

**Recommendation: Manifest V3 Chrome extension with a side panel, content-script site adapters, and an offscreen document, built on a surface-agnostic TypeScript core, with a small backend only for what the browser cannot do.**

Why an extension is the right primary surface: the assistant must see the prompt as you draft it and the conversation history on claude.ai / chatgpt.com / gemini.google.com. Only a content script can read that. A standalone web app or desktop app would force copy-paste and lose the "assistant while you work" value. A pure API gateway (RouteLLM/OpenRouter style) serves developer traffic, not interactive chat use, and has no voice surface.

Why not *only* an extension:
- **MV3 service workers are ephemeral.** Long-lived WebSockets (Gemini Live) and audio must live in the side panel page or an offscreen document, not the worker.
- **Gemini Live from a browser needs ephemeral tokens** minted server-side (BYOK direct keys are fine for personal use; distribution needs the token endpoint).
- **Fine-tuned router inference can run in-browser** (ONNX via transformers.js in an offscreen document), so no inference server is needed. Training lives in a Python `ml/` package.
- **Same core, more surfaces later**: an MCP server or CLI proxy for coding tools reuses `packages/core` unchanged.

Assumptions (stated, not blocking): you mostly use web chat UIs; keys are bring-your-own stored in `chrome.storage`; data stays local by default with opt-in export for training; Node/TypeScript for the extension, Python (uv) for ML.

## Architecture

```
shoal/
  apps/extension/        WXT (Vite) MV3: side panel (React), content scripts + site adapters,
                         offscreen doc (audio + ONNX), options page, service worker (messaging only)
  supabase/              Supabase project as code: migrations (Postgres + RLS), Edge Functions (Deno):
                         Gemini ephemeral tokens, remote config, opt-in telemetry/dataset ingest;
                         Auth, Storage (ONNX weights, eval artifacts), Cron
  packages/core/         pure TS: model catalog + cost model, router (ICL, retrieval, hybrid),
                         context analyzer (Context Diet), staleness detector, prompt coach, schemas (zod)
  packages/providers/    thin clients: Anthropic (messages + advisor tool), Gemini (generate + Live), OpenAI
  ml/                    Python: dataset build, labeling, training (ModernBERT/DeBERTa multi-head), eval, ONNX export
  evals/                 router + context-analyzer eval harness and data (RouterBench subset, LongMemEval subset, seed set)
  docs/                  ADRs, research notes, issue bodies (docs/planning/issues/*.md), privacy policy
```

Data flow: content script observes draft prompt + turns → normalized transcript → core router / analyzer (LLM via providers, or on-device ONNX) → side panel shows recommendation, context health, prompt suggestions → user accepts/overrides → feedback logged to IndexedDB (future training data) → optional voice loop via Gemini Live with function declarations that call the same core functions.

## Milestones and issues (dependency order)

Issue body template (every issue gets all sections): **Why** · **Scope** (checklist) · **Out of scope** · **Design notes & references** (paper/API citations, exact model IDs, prompts or schemas where known) · **Acceptance criteria** · **Dependencies** (`Blocked by #n`) · **Estimate** (S/M/L).

Labels to create: `area:extension`, `area:core`, `area:backend`, `area:ml`, `area:evals`, `area:docs`, `type:spike`, `type:epic`, `priority:p0`, `priority:p1`. Milestones: M0–M7 below.

## Supabase: what to use and what to skip

Recommendation: **use Supabase as the single backend and drop the Cloudflare Worker.** Auth, database, functions and file storage then live in one project you can manage from the CLI and from Claude Code.

| Supabase feature | Use in Shoal | Issue |
|---|---|---|
| **Auth** (Google/GitHub OAuth) | Signs the extension in through `chrome.identity.launchWebAuthFlow` with `signInWithOAuth({ skipBrowserRedirect: true })`, then `exchangeCodeForSession`. Session stored in `chrome.storage`. Replaces the insecure "extension-issued secret". | D2 |
| **Edge Functions** (Deno, TypeScript) | Gemini Live ephemeral-token minting, remote config, telemetry ingest, optional hosted-key proxy. `packages/core` must stay free of Node-only APIs so functions can import it. | D3 |
| **Postgres + Row Level Security** | Opt-in feedback log and training data, user settings sync, remote config tables, eval results. RLS keeps each user's rows private. | D1, D4, D8 |
| **pgvector** | Optional shared retrieval pool for VDAR few-shot examples and kNN router experiments. Local index stays the default. | 9 |
| **Storage** | ONNX router and compressor weights downloaded on demand with a hash check; eval outcome tables and reports. | 27, D9 |
| **Cron** | Daily data-retention deletion, weekly model-price refresh check, usage rollups. | D6, D8 |
| **CLI + branching + GitHub integration** | Migrations in the repo, local stack for development, separate dev and prod projects. | D1 |
| Realtime, Queues, GraphQL | Not needed now. | none |

**Agent tooling for development.** Supabase publishes agent skills (`supabase/agent-skills`, including `supabase` and `supabase-postgres-best-practices`) and an official Supabase MCP server. I found the skill names and install command only on third-party directories, so confirm them against the repo README before installing. Connect the MCP server to the **dev project only**, never prod, because it can run SQL and deploy functions. Supabase is not among the connectors already authorized in this Claude Code session.

## Deployment review: gaps found and fixes

What "deployed" means here: the extension is on the Chrome Web Store, first unlisted and later public. The Supabase prod project serves it, and every release goes through CI.

**Gaps in the original issue list.**
1. **Deployment came last.** Packaging was issue 32, after all ML work. Fix: ship a walking skeleton to an unlisted Web Store listing at the end of M1, then release every milestone.
2. **Backend auth was insecure.** A secret bundled in the extension can be extracted, and anyone could mint Gemini tokens on your bill. Fix: Supabase Auth plus per-user rate limits and quotas.
3. **Browser calls to Anthropic need an explicit opt-in.** The SDK requires `dangerouslyAllowBrowser: true`, which sends the `anthropic-dangerous-direct-browser-access` header. Without it, calls from the side panel fail on CORS. Added to issue 4.
4. **On-device ONNX needs a CSP change.** WebAssembly in extension pages needs `'wasm-unsafe-eval'` in the extension CSP. Model weights must be downloaded as data, never as code, to satisfy the MV3 remote-code rule. Added to issue 27.
5. **No stable extension ID.** OAuth redirect URLs and CORS allow-lists depend on it. Fix: pin the manifest `key` for dev and prod builds.
6. **Site adapters break silently** when claude.ai, chatgpt.com or gemini.google.com change their markup. Fix: selectors in remote config, an adapter health ping, and a fallback "paste your prompt" mode.
7. **Catalog changes forced re-releases.** Model prices and IDs change monthly. Fix: model catalog, selectors and prompt versions served as validated JSON data from Supabase, with a bundled fallback.
8. **No observability or spend control.** Fix: error reporting for the extension and functions, a cost table, alerts, and hard caps on any key you own.
9. **Training data never left the device.** Issue 25 needs user feedback, but issue 13 was local-only. Fix: opt-in upload with redaction, retention limits and delete-my-data.
10. **Web Store review was unplanned.** Fix: a hosted privacy policy, written justifications for each permission and host, a single-purpose statement, and Limited Use disclosures.
11. **Evals in CI would spend money on every PR.** Fix: manual or nightly workflow with a budget cap. Pull requests run only mocked tests.
12. **No environments.** Fix: dev and prod Supabase projects, dev and prod extension builds, secrets in GitHub Actions and Supabase secrets.

**Open product decision, assumed for now.** BYOK (bring your own key) is assumed for all LLM calls. With BYOK, the user's Gemini key can open Live sessions from the browser directly, so ephemeral tokens matter only if you pay for other people's usage. The backend is still needed for auth, sync, remote config and the training data pipeline.

**New deployment issues (D-series).**
- **D1 Supabase projects as code.** Dev and prod projects, CLI local stack, migrations in `supabase/`, RLS on every table with tests, GitHub integration, secrets documented. Deps: 2.
- **D2 Extension sign-in with Supabase Auth.** `launchWebAuthFlow` + PKCE, session in `chrome.storage`, refresh handling, pinned manifest `key`, redirect URLs registered per environment. Deps: D1.
- **D3 Edge Functions v0 (replaces issue 22).** Gemini ephemeral-token mint locked to the Live model, remote config endpoint, telemetry ingest. Requires a signed-in user, per-user rate limit and daily quota, and a CORS allow-list of the extension origin. Deps: D1, D2.
- **D4 Remote config.** Model catalog, prices, site selectors and prompt versions stored as tables, served as JSON, validated with zod, cached, with a bundled fallback. Deps: D1, 3, 11.
- **D5 Release pipeline (moved up from issue 32).** Web Store developer account, unlisted listing, hosted privacy policy, permission justifications, version bump, GitHub Action upload with the Web Store API, staged rollout, release checklist. Deps: 2, D1.
- **D6 Observability and spend control.** Error reporting in extension and functions, structured logs, provider cost table and dashboard view, alerts, hard caps on owned keys. Deps: D3.
- **D7 Adapter health and fallback.** Opt-in adapter failure pings, remotely updated selectors, "paste prompt" fallback, weekly manual smoke checklist per site. Deps: 11, D4, D6.
- **D8 Data governance.** Opt-in upload of feedback with PII redaction, retention job on Cron, delete-my-data function, RLS tests. Deps: D1, 13.
- **D9 Paid evals in CI.** Manual and nightly workflows with a budget cap; outcome tables and reports stored in Supabase Storage. Deps: E1, D1.

**Changes to existing issues.**
- Every issue template gains a **Deploy & rollout notes** section, and acceptance criteria require the change to work in the production build.
- Issue 4: add the browser-access opt-in for Anthropic and a note that keys never go to Supabase.
- Issue 9: optional shared pgvector pool behind a setting.
- Issue 13: add opt-in sync to Supabase through D8.
- Issue 22: replaced by D3. Issue 23 now depends on D3.
- Issue 27: add the CSP change and weights from Supabase Storage with a hash check.
- Issue 31: end-to-end tests run on every pull request with mocked providers and gate releases.
- Issue 32: becomes "public listing" only, since the pipeline moves to D5.

**Release train.**

| Release | Contents | Channel |
|---|---|---|
| v0.1 | Router recommendation card (issues 1–12), sign-in, remote config, release pipeline | Unlisted Web Store, you only |
| v0.2 | Context analyzer and fresh-start brief, observability | Unlisted, a few testers |
| v0.3 | Prompt coach, onboarding, data governance | Unlisted beta |
| v0.4 | Voice | Unlisted beta |
| v1.0 | On-device router, execution mode, public listing | Public |

### M0 Foundation
1. **ADR-001 Product surface and architecture** (docs). Record the decision above, alternatives, MV3 constraints, BYOK + local-first privacy stance. AC: ADR merged, diagram of data flow. Deps: none.
2. **Monorepo scaffold + CI** (extension/core). pnpm workspaces, TS strict, WXT extension skeleton with side panel + content script + offscreen doc, Vitest, Biome, GitHub Actions (typecheck/lint/test/build). AC: `pnpm build` yields a loadable unpacked extension; CI green. Deps: 1.
3. **Model catalog + cost model** (core). JSON catalog: provider, model id, tier (small/mid/large/frontier), context window, input/output price, capabilities (thinking, effort levels, tools, vision). Token estimator, cost-per-option calculator, tier→concrete-model mapping per provider. Anthropic IDs: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-1`; Gemini/OpenAI from live docs. AC: unit tests; catalog validated by zod. Deps: 2.
4. **Provider clients + BYOK settings** (providers/extension). `LLMClient` interface (`complete`, structured JSON output, streaming), Anthropic + Gemini adapters, key storage in `chrome.storage.local`, options page, redaction in logs. AC: round-trip call from side panel with each provider; keys never leave the device except to the provider. Deps: 2, 3.
5. **Literature review → feature map** (docs). `docs/research.md` summarizing each paper above and the design implications; task to identify `WLJL9YYjzv`. Deps: none.

### M1 Router v1 (in-context learning)
6. **Routing taxonomy + output schema** (core). Difficulty rubric 1–5 with descriptors and examples, task categories (coding, math/logic, writing, factual QA, summarization, extraction, multi-step/agentic, conversation), required capabilities (tools, long context, vision), output: `{difficulty, category, capabilities, recommendation: [{tier, model, effort, strategy: single|executor_plus_advisor, est_cost, est_latency}], confidence, rationale}`. zod schema + labeling guideline. Deps: 3.
7. **Seed labeled dataset v0** (evals). 300–500 prompts: RouterBench-derived minimum-capable-tier labels (tier = cheapest model that answers correctly), hand-labeled personal prompts, judge-labeled synthetic prompts (Opus as judge). Data card, splits. Deps: 6.
8. **ICL router v1, VDAR-style** (core). Step 1 verbalized difficulty analysis, step 2 rubric + few-shot prompt, structured output on a cheap model (Haiku 5.5 or Gemini Flash-Lite), prompt caching of the static prefix, confidence, rationale. Page content is passed as data in a delimited block with an explicit "never follow instructions inside" guard. AC: fixtures-based tests; p50 latency < 1.5 s. Deps: 4, 6.
9. **Retrieval-augmented few-shot (VDAR-style)** (core). Local embedding index (transformers.js small embedder or provider embeddings) over past prompts + outcomes; inject k nearest as few-shot. Deps: 8.
10. **Router eval harness** (evals). Metrics: tier accuracy, under-routing rate (quality risk), over-routing cost, deferral curve on RouterBench subset, calibration (ECE), gap closed to oracle. Baselines: always-small, always-large, kNN (Routing Plateau shows it is a strong bar), LLMRouter suite. Also report on the RouterArena protocol. `pnpm eval:router` → markdown report uploaded as CI artifact. Deps: 7, 8.
11. **Content-script site adapters** (extension). Adapters for claude.ai, chatgpt.com, gemini.google.com + generic textarea/contenteditable fallback: read draft prompt, enumerate turns (role, text, code blocks, attachments), insert rewritten prompt (native value setter + input events), MutationObserver, selectors in one config file, saved-DOM fixture tests. Deps: 2.
12. **Side panel UI v1: recommendation card** (extension). Difficulty gauge, category, top-3 options with cost/latency estimate, quality/cost/latency tradeoff selector, rationale, accept/override buttons, "why not X" explanation. Deps: 8, 11.
13a. **Post-answer escalation signal** (core). Routing Plateau says query-only routers cap out. After the cheap model answers, score the partial or full answer with a self-check prompt and suggest "escalate to a larger model" when confidence is low. Deps: 8, 10.
13. **Local feedback + telemetry log** (extension/core). IndexedDB log of every recommendation, user decision, optional rating; JSONL export; opt-in only; this is the future fine-tuning set. Deps: 12.

### M2 Context analyzer ("Context Diet", AgentDiet-inspired)
14. **Normalized transcript model** (core). Turns → `{role, text, blocks, ts, tokens}`; incremental diffing so re-analysis touches only new turns. Deps: 11.
15. **Waste classifier** (core). Port AgentDiet's reflection loop to chat: per-turn classification keep/useless/redundant/expired with a short takeaway replacement; delay `a=2`, lookahead `b=1`, length gate θ≈500 tokens; apply only if savings > θ; structured output; prompt in `packages/core/prompts/`. Aggressiveness depends on the routed model tier, per AdaCoM. Originals stay restorable in IndexedDB, per ACE. Deps: 14, 4.
16. **Staleness detector** (core). Extract facts/decisions/requirements with turn index; detect supersession (knowledge updates, changed requirements, edited files); flag draft prompt references to expired facts. Deps: 15.
17. **Long-conversation strategy (RLM-style)** (core). When transcript exceeds the analyzer budget: chunk, sub-call per chunk, aggregate takeaways; recursion depth 1; cost cap. Deps: 15.
18. **Context health UI + fresh-start brief** (extension). Token meter, waste %, flagged spans with reasons, "Generate fresh-start brief" (kept takeaways + current state + open questions) with copy/insert into a new chat. Deps: 15, 16, 12.
19. **Context analyzer eval** (evals). Test set from BEAM (contradiction and changing information), LongMemEval (knowledge-update, temporal), LoCoMo samples, synthetic chats with planted updates. Metrics: expired-fact precision/recall, compression ratio, downstream QA accuracy retained, latency and cost per Beyond Token Savings. Baseline: keep last-N turns heuristic. Deps: 15, 16.
19a. **Prompt optimization loop for Shoal's own prompts** (evals/ml). ACON-style failure analysis plus GEPA (`dspy.GEPA`) to optimize router, analyzer, and coach prompts against issues 10 and 19. Deps: 10, 19.

### M3 Prompt coach
20. **Prompt critique + rewrite** (core/extension). Given draft + chosen model: missing context, ambiguity, output format, constraints, examples; model-aware guidance (frontier reasoning models prefer less prescriptive prompts; small models need explicit structure); one-click apply via adapter. Deps: 8, 11.
21. **Onboarding + privacy UX** (extension). First run, key setup, per-site permissions, what is read/stored, opt-in export. Deps: 4, 12.

### M4 Voice (Gemini)
22. **Backend v0** (backend). Hono on Cloudflare Workers: `POST /live/token` minting Gemini ephemeral tokens (`uses`, `expireTime`, `newSessionExpireTime`, locked to the Live model), optional provider proxy, opt-in telemetry ingest; auth via extension-issued secret. Deps: 2.
23. **Voice I/O in side panel** (extension). Gemini Live WebSocket client, mic via `getUserMedia` + AudioWorklet (16 kHz PCM), playback queue, push-to-talk and VAD modes, barge-in. Runs in the side panel/offscreen doc, not the service worker. Deps: 22.
24. **Voice tools** (extension/core). Live API function declarations wrapping router, analyzer, prompt coach: "what model should I use?", "is my context stale?", "rewrite this prompt", "read me the recommendation". Deps: 23, 8, 15, 20.

### M5 Fine-tuned router
25. **Training dataset build** (ml). Merge seed set, RouterBench-derived labels, exported user feedback, judge-labeled diverse prompts (e.g., WildChat/LMSYS samples); dedupe, splits, data card. Deps: 7, 13.
26. **Train small encoder router** (ml). ModernBERT-base / DeBERTa-v3-small multi-head (tier, category, capabilities); calibration; compare to ICL router on the harness; model card. Deps: 25, 10.
27. **In-browser inference + hybrid routing** (extension/core). ONNX export → transformers.js in offscreen doc; p50 < 50 ms; hybrid: on-device classifier first, ICL router when confidence low or capabilities uncertain. Deps: 26.
28. **Spike: generative router via Gemini supervised fine-tuning** (ml, type:spike). Compare explanation quality and cost against the encoder. Deps: 25.
28a. **Spike: prefill-activation router** (ml, type:spike). Encoder-Target Decoupling from arXiv 2603.20895: small open model's residual-stream activations feed a shared MLP that predicts correctness per closed target model. Compare to the text-encoder router. Deps: 25, 10.
28b. **Distilled on-device context compressor** (ml). Distill the analyzer from issue 15 into a small model, per ACON, for offline pruning. Deps: 19a, 25.

### M6 Execution mode (BYOK)
29. **Execute from the side panel** (extension/providers). Run the prompt with the recommended model, streaming, applying Context Diet to the message array first; show real cost from `usage`. Deps: 4, 15.
30. **Advisor strategy integration** (providers/core). For `executor_plus_advisor` recommendations call Anthropic with `tools: [{type: "advisor_20260301", name: "advisor", model: "claude-opus-5-5", max_uses: 3}]` and beta `advisor-tool-2026-03-01`; executor `claude-sonnet-5-5` or `claude-haiku-5-5`; handle `advisor_redacted_result` (replay only), track `usage.iterations`; eval three arms (executor alone / +advisor / advisor alone) on a task subset. Deps: 29, 10.

### M7 Quality and release
31. **E2E tests with Playwright** (extension). Load unpacked extension, fixture pages for each adapter, side panel flows, mocked providers. Deps: 11, 12, 18.
32. **Chrome Web Store packaging + release workflow** (extension/docs). Manifest permissions review, privacy policy, screenshots, versioned release action. Deps: 31, 21.

Plus **#0 Epic: Shoal roadmap** (type:epic) holding the dependency graph and milestone checklist, created last so it can link all numbers.

Dependency graph (edges = blocked by): 2←1; 3←2; 4←2,3; 6←3; 7←6; 8←4,6; 9←8; 10←7,8; 11←2; 12←8,11; 13←12; 14←11; 15←14,4; 16←15; 17←15; 18←15,16,12; 19←15,16; 20←8,11; 21←4,12; D1←2; D2←D1; D3←D1,D2 (replaces 22); D4←D1,3,11; D5←2,D1; D6←D3; D7←11,D4,D6; D8←D1,13; D9←E1,D1; 23←D3; 24←23,8,15,20; 13a←8,10; 19a←10,19; 25←7,13; 26←25,10; 27←26; 28←25; 28a←25,10; 28b←19a,25; 29←4,15; 30←29,10; 31←11,12,18; 32←31,21.

## Experiments: quick test and improved version (general tasks, not coding)

### Shared method (applies to both tracks)

- **Generate once, evaluate routers offline.** Run every candidate model on every item once and store an *outcome table* (`item_id, model, effort, correct/score, input_tokens, output_tokens, cost_usd, latency_ms`) as parquet. Every router and baseline is then scored against this table for free, and new router ideas cost only the router's own calls. Use the Message Batches API (50% cheaper) for the table, and a live pass on a subset for latency.
- **Harness:** Python + `uv` + Inspect (`inspect_ai`, `inspect_evals`) which already ships MMLU-Pro, GPQA, GSM8K, MATH, IFEval with graders, logs every call, and supports Anthropic + Gemini.
- **Statistics:** paired comparisons on the same items. 95% CIs by paired bootstrap (2,000 resamples) and McNemar for accuracy differences. With ~100 test items, only gaps of roughly ≥10 points in accuracy are detectable. Cost differences are detectable much earlier. The quick test is for direction and bugs, the improved version is for claims.
- **Repeats:** newer Claude models do not accept `temperature`, so run-to-run variance is measured by 3 repeats on the improved version.
- **Prompt-injection hygiene:** benchmark text goes to router and analyzer inside a delimited data block, the same as in production.

### Track R: router

**Model pool (actions).** `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` at effort `medium`, plus `claude-opus-5-5` at effort `low`. The last arm tests the advice that "most capable model at lower effort" may beat a cross-model cascade. The improved version adds current Gemini Flash-Lite / Flash / Pro for cross-provider routing.

**Benchmark mix (auto-gradable first, general reasoning).**

| Source | What it covers | Grader | Quick n | Improved n |
|---|---|---|---|---|
| MMLU-Pro | broad knowledge, 14 domains | exact match | 30 | 150 |
| GPQA-Diamond | hard science reasoning | exact match | 15 | 60 |
| GSM8K | easy multi-step math | numeric match | 20 | 60 |
| MATH-500 | math with built-in difficulty levels 1–5 | answer equivalence | 25 | 100 |
| IFEval | instruction following, formatting | programmatic checker | 30 | 100 |
| Arena-Hard / MT-Bench style open prompts | writing, advice, analysis | pairwise judge vs Opus reference | 30 | 130 |
| **Total** | | | **150** | **600** |

MATH levels give a free ground-truth difficulty signal for checking the router's difficulty estimates. Before spending any money, run a zero-cost sanity pass on **RouterBench's precomputed outcomes** (withmartian/routerbench, 11 older models) to debug the router code and metrics.

**Splits.** Quick: 50 items as retrieval/few-shot pool, 100 test. Improved: 5-fold cross-validation so every item is tested once.

**Arms.**

| Arm | Description | Paper basis |
|---|---|---|
| B1–B4 | always-Haiku, always-Sonnet, always-Opus, always-Opus-low | baselines |
| B5 | random routing at the same cost as the best router | sanity |
| B6 | oracle: cheapest model that got the item right | upper bound |
| R1 | kNN on prompt embeddings (k=10), predicts per-model correctness | Routing Plateau says this is a strong bar |
| R2 | ICL zero-shot: rubric → difficulty 1–5 + tier, Haiku as router | issue 8 |
| R3 | ICL few-shot with fixed examples | issue 8 |
| R4 | VDAR-style: verbalize difficulty, retrieve similar items with outcomes, choose | VDAR-Router |
| R5 | Cascade: Haiku answers, self-check prompt scores confidence, escalate if low | Routing Plateau (post-hoc signals) |
| R6 (improved) | R4 + R5 hybrid | |
| R7 (improved) | small fine-tuned encoder (ModernBERT) on the outcome table | issue 26 |
| R8 (improved, spike) | prefill-activation router with a small open model | arXiv 2603.20895 |

Each router outputs a score, so sweep its threshold to trace a cost–quality curve instead of reporting one point.

**Metrics.**
- Accuracy and **cost per task including router overhead**.
- **Cost per correct answer**: the single headline number.
- **APGR** (average performance gap recovered, from RouteLLM) = (router acc − Haiku acc) / (Opus acc − Haiku acc).
- **Oracle gap closed** = (router − best single model) / (oracle − best single model).
- **CPT(80%)**: share of calls sent to Opus needed to reach 80% of Opus-minus-Haiku quality gap.
- **Under-routing rate** (sent small, small failed, a larger model succeeded) and over-routing waste.
- Router latency p50/p95, and difficulty-estimate correlation with MATH level (Spearman).
- Per-category breakdown: knowledge, math, instruction following, open-ended.

**Hypotheses.**
1. R2–R4 reach ≥90% of Opus accuracy at ≤40% of Opus cost.
2. R1 (kNN) lands within CI of R2–R4, as Routing Plateau predicts.
3. R4 beats R2 on under-routing.
4. R5 beats every pre-routing arm on math and GPQA, where answer checking is informative.
5. Opus-low is a hard-to-beat baseline on cost per correct answer.

**Estimated cost (rough, at listed prices, batch discount not applied).** Quick: about $15–25 total. Improved: about $100–200, mostly Opus outputs with thinking and 3 repeats.

### Track C: context analyzer

**Benchmarks.**

| Source | Why | Quick n | Improved n |
|---|---|---|---|
| LongMemEval_S | ~115k-token chat histories; categories include knowledge-update, temporal reasoning, multi-session, abstention; turns carry `has_answer` evidence labels | 40 (knowledge-update 15, temporal 10, multi-session 10, abstention 5) | 200 stratified across all 7 categories |
| Synthetic planted-update chats | 20–60 turn chats where a requirement or fact changes 1–3 times; gold labels for expired turns | 30 | 100 |
| BEAM (ICLR 2026) | 100K–10M tokens, contradiction resolution and changing facts | none | ~80 from the 100K–1M tiers |
| LoCoMo | very long multi-session dialogue, cheap | none | 2 conversations |

**Arms.**

| Arm | Description | Paper basis |
|---|---|---|
| A0 | full context | baseline |
| A1 | keep last N turns (N tuned on 10 items) | Less Context, Better Agents |
| A2 | single summary of everything before the last N turns | standard compaction |
| A3 | per-turn reduction with takeaways, delay a=2, lookahead b=1, gate θ=500 tokens | AgentDiet |
| A4 | A3 + staleness detector: superseded facts dropped or marked "updated at turn k" | issue 16 |
| A5 | fresh-start brief only (what the user would paste in a new chat) | issue 18 |
| A6 | oracle: evidence sessions only | upper bound |
| A7 (improved) | A4 with guidelines tuned from failure analysis on a held-out set | ACON |
| A8 (improved) | chunked recursive analysis for BEAM's longest tier | RLM |

Analyzer model: Haiku 5.5. Answerer models: Haiku 5.5 and Sonnet 5.5 in the quick test, plus Opus 5.5 in the improved version. This tests the AdaCoM claim that weaker answerers benefit more from pruning.

**Metrics.**
- QA accuracy with the LongMemEval judge protocol, using one fixed judge model throughout. Report overall and per category, especially knowledge-update and abstention.
- **Evidence retention**: share of `has_answer` turns that survive pruning. This needs no answerer calls, so run it first.
- **Harmful-prune rate**: right with A0, wrong after pruning.
- Staleness detector precision/recall/F1 on the synthetic set.
- Answerer input tokens, compression ratio, and **total cost and wall-clock latency including the analyzer**, because Beyond Token Savings showed fewer tokens can be slower.
- Cost per correct answer.

**Hypotheses.**
1. A3 keeps ≥95% of A0 accuracy with ≤50% of answerer input tokens.
2. A4 beats A0 on knowledge-update, because stale facts mislead the answerer.
3. A2 loses the most on temporal reasoning.
4. The Haiku answerer gains more from A3/A4 than Sonnet or Opus.
5. Analyzer overhead is under 15% of total cost, matching AgentDiet's 5–15%.

**Estimated cost.** Quick: about $30–50, dominated by Sonnet reading full 115k-token histories. Improved: about $200–400.

### Joint experiment (improved only)

Run router + analyzer together on LongMemEval and the synthetic chats. Question: does pruning let the router pick a cheaper tier without losing accuracy? Headline metric is end-to-end cost per correct answer for the four combinations (router on/off × analyzer on/off).

### Order of work

1. Outcome-table pipeline + RouterBench zero-cost sanity pass.
2. Evidence-retention check for A1–A5 (no answerer cost).
3. Quick router track, then quick context track. Review results, fix prompts.
4. Improved versions only for arms that survived the quick test.
5. Write results to `evals/reports/` with Pareto plots.

### Issue changes

These experiments become issues in the `area:evals` set: **E1** outcome-table pipeline and Inspect harness (replaces part of issue 10), **E2** quick router experiment, **E3** quick context experiment, **E4** improved router experiment, **E5** improved context experiment, **E6** joint router + analyzer experiment. E2 depends on issues 8 and E1. E3 depends on issues 15, 16, and E1. E4 depends on E2, 9, and 13a. E5 depends on E3 and 19a. E6 depends on E4 and E5.


