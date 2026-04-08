# ci

`ci` contains provider-neutral helper scripts invoked by GitHub Actions (`.github/workflows/ci.yml`).

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/sync-upstream.mjs` | Invoke `upstream-sync/scripts/cli.mjs sync` to replay patches onto the vendor tree |
| `scripts/check-abi.mjs` | Validate a built `wasm-build/dist/<version>/core.wasm` against `upstream-sync/abi/contract.json` |
| `scripts/build-release.mjs` | Local replication of CI quality + build + bench sequence (uses `RELEASE_VERSION` env var) |
| `scripts/check-release.mjs` | Validate `wasm-build/dist/<version>/manifest.json` — requires `core` target; `extended` and `debug` are optional |

## Invariants

- Stage scripts must exit non-zero on any gate failure.
- Schedule-driven sync runs never suppress drift failures.
