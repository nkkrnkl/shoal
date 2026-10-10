# @shoal/core

Runtime-agnostic logic shared by the extension and Supabase Edge Functions: router, context analyzer, staleness detector, prompt coach, model catalog and schemas.

**Rule:** no Node-only or browser-only APIs. The `tsconfig.json` loads only the `ES2022` library with no ambient types, so using `window`, `document`, `chrome`, `process` or `fs` fails the typecheck. CI also runs `deno check` on this package.

Relative imports use explicit `.ts` extensions so Deno can resolve them.

## Contracts

`src/contracts/` holds the shared interfaces agreed in [ADR-001](../../docs/adr/001-architecture.md). Changing a contract needs a pull request approved by both track owners.
