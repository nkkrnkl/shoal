# Shoal

Shoal is a Chrome extension that helps you get better answers from chat assistants. While you work on claude.ai, chatgpt.com or gemini.google.com, it reads the conversation in a side panel. It tells you:

- what your next message is missing
- which parts of a long chat have gone stale
- whether a smaller model would do

It runs on your own API key, and nothing is stored outside your browser.

> **Status: early development.** Shoal is not on the Chrome Web Store yet. You load it unpacked, and features are still landing. See [What works today](#what-works-today).

## What works today

| Feature | Status | Notes |
|---|---|---|
| **Context health**: flags turns that are useless, redundant or out of date, and the share of tokens they waste | Works | Re-runs after every reply. Labels 91–95% of turns correctly on the [MT-Bench eval](evals/README.md), but can still drop needed context when a follow-up is vague ([#29](https://github.com/nkkrnkl/shoal/issues/29)). |
| **Draft tips**: up to three tips on what your message needs, such as missing context or an outdated reference | Works | Runs about 2 seconds after you stop typing. |
| **Model choice**: says whether a small model is enough for the prompt | Works with a local router | Needs the [Right-size router](demo/rightsize/README.md) on `localhost:8000`. |
| **Reading the chat page** on claude.ai, chatgpt.com and gemini.google.com | **Needs live testing** | The selectors are tested only against saved HTML. If a site isn't read, paste the conversation instead. |
| **Voice** | Partial | The fish orb reacts to your microphone. Spoken answers come with Gemini Live ([#37](https://github.com/nkkrnkl/shoal/issues/37)). |

The full plan is in [docs/plan.md](docs/plan.md), and work is tracked in [GitHub Issues](https://github.com/nkkrnkl/shoal/issues). Start from the [roadmap epic](https://github.com/nkkrnkl/shoal/issues/51).

## Quick start

**You need:**
- Node 22 or later (the repo pins it in `.nvmrc`), with corepack enabled for pnpm
- Chrome
- A free [Gemini API key](https://aistudio.google.com/apikey)

```sh
corepack enable
pnpm install
pnpm --filter @shoal/extension build:dev
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose `apps/extension/dist/chrome-mv3-dev`.
3. Click the Shoal icon to open the side panel, then **Settings**. Paste your Gemini key and click **Test & save**.
4. Open a chat on claude.ai, chatgpt.com or gemini.google.com. Reload the tab if it was already open, then start typing.

For hot reload during development, run `pnpm dev` instead. It opens a Chrome window with the extension already loaded.

## Configuration

| Where | Variable | Needed for | Required |
|---|---|---|---|
| Shoal settings page | Gemini API key | Context health and draft tips | Yes |
| Root `.env` | `GEMINI_API_KEY` | Running the paid eval script (`pnpm --filter @shoal/core eval:context`) | Only for evals |
| `apps/extension/.env.development`, `.env.production` | `SHOAL_EXTENSION_KEY` | Pinning the extension ID | No; leave it empty |

Copy each `*.example` file to create its real counterpart. Every `.env` file is gitignored. **Never commit a key**, and never put one in source code.

## Privacy

- **Your key** is stored in `chrome.storage.local` on your device and sent only to Google.
- **When Shoal reads**: only while the side panel is open on a supported site. It reads the open conversation and the message you are typing, and sends them to the Gemini API with your key. It sends nothing anywhere else. There is no Shoal server, account or analytics.
- **Text on the chat page** is treated as data to analyze. Shoal never treats it as instructions.
- **The microphone** is used only during a voice session. Nothing is recorded or sent.
- **Turning it off**: you can turn off automatic analysis in Settings.

## How it works

```
chat page ──content script──▶ side panel ──your key──▶ Gemini API
 (claude.ai,   reads turns      analyzer, tips,
  chatgpt.com, and the draft     model choice
  gemini…)     when the page
               settles
```

- **The content script** watches the page and sends the conversation to the panel once a reply finishes or the draft changes.
- **The analyzer** labels every turn in one structured-output call. It keeps any turn it is unsure about, because dropping needed context is worse than keeping waste.
- **The design**, including the contracts between the parts, is recorded in [ADR-001](docs/adr/001-architecture.md).

## Repository layout

| Path | What it is |
|---|---|
| `apps/extension/` | The Chrome extension: WXT, React, Manifest V3 |
| `packages/core/` | Shared, runtime-agnostic TypeScript: contracts (zod), analyzer, transcript builder, draft tips. Must run in browsers and Deno. |
| `packages/providers/` | LLM clients implementing the `LLMClient` contract (Gemini today) |
| `evals/` | Python (uv): the shared MT-Bench subset and experiment tooling |
| `ml/` | Python (uv): router training, offline only |
| `demo/rightsize/` | Hackathon demo of the router, with its own server and extension |
| `supabase/` | Backend placeholder |
| `docs/` | Plan, ADRs and research notes |

## Development

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the extension with hot reload |
| `pnpm build` / `pnpm zip` | Production build, and a zip for the Chrome Web Store |
| `pnpm lint` / `pnpm format` | Biome checks (the same as CI) and automatic fixes |
| `pnpm typecheck` | Typechecks every package |
| `pnpm test` | Runs the unit tests in every package (Vitest) |
| `pnpm --filter @shoal/core eval:context --oracle` | Checks the eval scorer, with no API calls |

**Before you open a pull request,** run `pnpm lint && pnpm typecheck && pnpm test`. CI also checks that core runs on Deno, and that the MT-Bench subset rebuilds to the hashes in its manifest.

**Paid API calls never run in CI.** Evals that cost money are run by hand, and their spend is recorded in the related issue.

**The codebase follows a few rules:**
- Core stays free of browser and Node APIs.
- Changes to `packages/core/src/contracts/` need review from both track owners.
- Text read from a chat page never acts as instructions to Shoal's own model calls.
- Branch from `main`, and link the issue in the pull request with `Closes #N`.

The full list, the review rules and the setup details are in [CONTRIBUTING.md](CONTRIBUTING.md).

**Keep the repo out of iCloud, Dropbox and other synced folders.** Sync tools offload and duplicate files inside `.git` and `node_modules`, which breaks git and builds. If the repo has to live in `~/Documents`, give the folder a name ending in `.nosync`.

## License

No license has been chosen yet. Until one is added, all rights are reserved by the authors.
