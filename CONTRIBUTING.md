# Contributing to Shoal

## Prerequisites

- Node 22 or later (`.nvmrc` pins 22).
- pnpm 10. The version is pinned in `package.json`. Run `corepack enable` once, or call `corepack pnpm` instead of `pnpm`.
- uv, for the Python projects in `ml/` and `evals/`.
- Optional: Deno 2, to run the core runtime check locally.

## Setup

```sh
pnpm install
```

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Starts the extension in dev mode with hot reload and opens a Chrome window with it loaded. |
| `pnpm build` | Builds the production extension into `apps/extension/.output/chrome-mv3`. |
| `pnpm zip` | Builds and zips the extension for the Chrome Web Store. |
| `pnpm typecheck` | Typechecks every package. |
| `pnpm test` | Runs unit tests in every package. |
| `pnpm lint` | Runs Biome lint and format checks, the same as CI. |
| `pnpm format` | Fixes formatting and safe lint issues. |
| `deno check packages/core/src/index.ts` | Confirms core runs on Deno, as Supabase Edge Functions need. |

## Load the extension in Chrome

1. Run `pnpm build`.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click "Load unpacked" and choose `apps/extension/.output/chrome-mv3`.
4. Click the Shoal toolbar icon to open the side panel.

## Repository layout

See [ADR-001](docs/adr/001-architecture.md). In short: `apps/extension` is the Chrome extension, `packages/core` holds shared logic and contracts, `packages/providers` holds LLM clients, `supabase/` is the backend, and `ml/` and `evals/` are Python.

## Rules

- **Core stays runtime-agnostic.** `packages/core` cannot use `window`, `document`, `chrome`, `process` or Node modules. The typecheck enforces this. Use `.ts` extensions in relative imports so Deno resolves them.
- **Contracts need two approvals.** Changes under `packages/core/src/contracts/` need review from both track owners.
- **Page text is untrusted.** Never let text read from a chat page act as instructions to Shoal's own LLM calls.
- **No secrets in code.** API keys stay in `chrome.storage.local` on the user's device. Copy `apps/extension/.env.example` to `.env` for local settings.
- **Paid API calls never run in pull request CI.**

## Pull requests

- Branch from `main` and name the branch after the work, for example `feat/site-adapters`.
- Link the issue with `Closes #N`.
- CI must pass: lint, typecheck, tests, build, and the Deno check.
