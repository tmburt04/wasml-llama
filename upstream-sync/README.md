# upstream-sync

`upstream-sync` owns alignment with upstream **llama.cpp**: vendored sources, **overlays** (for example `overlays/wasml-llama/` and `overlays/llama-wasm.exports.json`), and the ABI contract under **`abi/contract.json`**.

## Invariants

- `vendor/llama.cpp` is a pristine upstream mirror managed by sync automation (`ci/scripts/sync-upstream.mjs` and related).
- Every downstream change is represented as an ordered patch or overlay, not inline edits inside the vendor tree.
- ABI and symbol drift is detected before runtime packages consume new artifacts.
- Sync automation must fail loudly when patch replay or contract verification breaks.

## When upstream `llama.cpp` changes

CI already treats upstream as the source of truth:

- `ci/scripts/sync-upstream.mjs` invokes `upstream-sync/scripts/cli.mjs sync`.
- `upstream-sync/scripts/sync.mjs` fetches the latest upstream commit into `vendor/llama.cpp`, checks it out, and reapplies `patches/series.json`.
- The main workflow then builds fresh WASM artifacts and verifies the bridge ABI against `abi/contract.json` before the remaining validation gates run.

That means **no intervention is required** when all of these continue to pass.

Intervention is only needed when upstream drift breaks one of the explicit gates:

- A downstream patch no longer applies cleanly.
- The overlay bridge under `overlays/wasml-llama/` needs code changes to match upstream API or build changes.
- Exported symbols no longer match `abi/contract.json`, which means the bridge contract must be updated intentionally.
