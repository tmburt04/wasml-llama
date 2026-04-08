# tooling

Small CLI utilities for inspecting produced artifacts and sanity-checking runtime assumptions. Tools read **`wasm-build/dist/<version>/manifest.json`** (and related metadata) instead of guessing from ad hoc paths.

## Commands (from repo root)

| Script | Purpose |
| --- | --- |
| `npm run inspect` | Dump manifest + build metadata for an artifact (default version: **`local-cpu`**) |
| `npm run check-compat` | Summarize declared support for Chrome, Firefox, Node |
| `npm run estimate-memory -- --model-bytes N --context-tokens N` | Rough memory budget for a model + context |

Pass **`--version <name>`** after the subcommand to point at another directory under `wasm-build/dist/` (for example a CI build id).

## Invariants

- Output is concise; `inspect` / `check-compat` default to JSON for machine use.
- No tool mutates upstream-aligned source trees or vendor snapshots.
