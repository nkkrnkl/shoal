# Shoal

Shoal is a Chrome extension that helps you get better answers from chat assistants. While you work on claude.ai, chatgpt.com or gemini.google.com, it reads the conversation in a side panel. It tells you:

- what your next message is missing
- which parts of a long chat have gone stale
- whether a smaller model would do

It runs on your own API keys, and nothing is stored outside your browser.

> **Status: early development.** Shoal is not on the Chrome Web Store yet. You load it unpacked, and features are still landing. See [What works today](#what-works-today).

## What works today

| Feature | Status | Notes |
|---|---|---|
| **Context health**: flags turns that are useless, redundant or out of date, and the share of tokens they waste | Works | Re-runs after every reply. Labels 91–95% of turns correctly on the [MT-Bench eval](evals/README.md), but can still drop needed context when a follow-up is vague ([#29](https://github.com/nkkrnkl/shoal/issues/29)). |
| **Draft tips**: up to three tips on what your message needs, such as missing context or an outdated reference | Works | Runs about 2 seconds after you stop typing. |
| **Model choice**: says whether a small model is enough for the prompt, given how much of your plan is left | Works with a local router | Needs the [Right-size router](demo/rightsize/README.md), on `localhost:8000` by default (change it in Settings). On claude.ai it reads your plan usage; elsewhere you set it with a slider. |
| **Reading the chat page** on claude.ai, chatgpt.com and gemini.google.com | **Needs live testing** | The selectors are tested only against saved HTML. If a site isn't read, paste the conversation instead. |
| **Voice**: a spoken conversation through Gemini Live. Ask which model fits, how your usage looks or whether the chat is stale, or have it read the latest answer or your draft aloud | Works | The fish orb moves with your voice and Shoal's. You can also type a question. Reading answers depends on the same untested site selectors. |

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
| Shoal settings page | Gemini API key | Context health, draft tips and voice | Yes |
| Shoal settings page | Router address | Model choice | No; defaults to `http://localhost:8000` |
| Your shell, for the router | `JEV_API_KEY` | Running the [Right-size router](demo/rightsize/README.md) | Only for model choice |
| Root `.env` | `GEMINI_API_KEY` | Running the paid eval script (`pnpm --filter @shoal/core eval:context`) | Only for evals |
| `apps/extension/.env.development`, `.env.production` | `SHOAL_EXTENSION_KEY` | Pinning the extension ID | No; leave it empty |

Copy each `*.example` file to create its real counterpart. Every `.env` file is gitignored. **Never commit a key**, and never put one in source code.

## Privacy

Shoal has no server, accounts or analytics. Here is everything that leaves your browser:

| What | Where it goes | When |
|---|---|---|
| The open conversation and the message you are typing | Google's Gemini API, with your key | While the side panel is open on a supported site |
| Your voice, and the page text the voice reads aloud | Google's Gemini Live API, with your key | Only during a voice session you start |
| The message you are typing | The router you run on your own computer, which scores it with Jev | When model choice is in use |

- **Your Gemini key** is stored in `chrome.storage.local` on your device and sent only to Google.
- **Plan usage on claude.ai** is read from the site with your own session, and stays in the browser.
- **Nothing is recorded or stored** outside the browser.
- **Text on the chat page** is treated as data to analyze or read aloud. Shoal never treats it as instructions.
- **Turning it off**: you can turn off automatic analysis in Settings.

## How it works

```
chat page ──content script──▶ side panel ──your key──▶ Gemini API (analysis, tips)
 (claude.ai,   reads turns      analyzer, tips,  ──your key──▶ Gemini Live (voice)
  chatgpt.com, and the draft    model choice,    ──draft────▶ local router (model choice)
  gemini…)     when the page    voice
               settles
```

- **The content script** watches the page and sends the conversation to the panel once a reply finishes or the draft changes.
- **The analyzer** labels every turn in one structured-output call. It keeps any turn it is unsure about, because dropping needed context is worse than keeping waste.
- **Voice** is a Gemini Live session. The voice model calls Shoal's own tools (model choice, usage, context health, and reading the answer or the draft) instead of seeing the page directly.
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
