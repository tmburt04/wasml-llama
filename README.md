# wasml-llama

Pipeline-managed port of **llama.cpp** to WebAssembly: deterministic builds, manifest-driven artifacts, and a **worker-first** TypeScript runtime with structured errors and observable recovery.

## Layout

| Path | Role |
| --- | --- |
| `upstream-sync/` | Upstream alignment, overlays, ABI contract (`abi/contract.json`) |
| `wasm-build/` | Emscripten build driver, manifests, `dist/<version>/` outputs |
| `runtime-core/` | Sole layer that binds WASM exports (`EmscriptenLlamaAdapter`) |
| `runtime-worker/` | Worker protocol, model load (including batched chunks), inference routing |
| `runtime-api/` | Public client: `loadModel`, `runInference` (stream), `runInferenceBulk` |
| `bench/` | End-to-end benchmarks (Node CPU WASM + Chrome WebGPU) |
| `tooling/` | Inspect manifests, compatibility checks, memory estimates |
| `tests/` | Vitest unit/integration tests against fakes and contracts |
| `docs/` | Architecture and failure-reference material |

CI lives under `.github/workflows/`; helper scripts under `ci/scripts/`.

## Prerequisites

- **Node.js** 20+ (CI uses 22)
- **Emscripten** when building WASM locally (or rely on CI artifacts)
- **Google Chrome** for browser benchmarks (auto-detected on common install paths; override with `CHROME_BIN` or `--chrome`)

## Common commands

```bash
npm ci
npm run build          # all workspaces
npm run typecheck
npm run lint
npm run test
```

**Interactive browser UI** (requires a built artifact in `wasm-build/dist/`):

```bash
npm run serve          # starts the bench server at http://127.0.0.1:41741
```

Open `http://127.0.0.1:41741/` in Chrome with the flags listed in `bench/src/chrome-profile.ts`
(`--enable-unsafe-webgpu --enable-features=WebGPU,WebAssemblyExperimentalJSPI`).
The server sets the required `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers.

**WASM** (requires emsdk / `em++` on `PATH`):

```bash
npm run wasm:build:cpu
npm run wasm:build:webgpu
npm run wasm:manifest
```

**Benchmarks** (download a GGUF from the configured URL; default model is Qwen3.5-0.8B Q4_K_M):

```bash
npm run bench:node              # CPU WASM, uses wasm-build/dist/local-cpu by default
npm run bench:browser           # WebGPU in Chrome; path resolved automatically when possible
```

Pass flags via the CLI entry (`bench/src/cli.ts`): `--version`, `--backend`, `--max-tokens`, `--model-url`, `--commit`, `--baseline`, `--chrome` (optional if Chrome is found on a standard path or `CHROME_BIN` is set).

**Tooling** (defaults to `wasm-build/dist/local-cpu/manifest.json`):

```bash
npm run inspect
npm run check-compat
npm run estimate-memory -- --model-bytes <bytes> --context-tokens 4096
```

## Artifacts

Built outputs land under `wasm-build/dist/<version>/`: `manifest.json`, `build-metadata.json`, and per-target `core.js` / `core.wasm` (or bundled variants). Feature flags (WebGPU, JSPI, memory64, SIMD) are recorded in the manifest; consumers must not assume a single global ABI.

## Inference modes

- **Stream** — token iterator via `runInference` (default worker path).
- **Bulk** — full decode in one WASM call (`wasml_generate_all`) via `runInferenceBulk` / `mode: 'bulk'` for lower JSPI overhead in WebGPU builds.

## Documentation

- [`docs/README.md`](docs/README.md) — index of reference docs
- [`docs/architecture.md`](docs/architecture.md) — package graph
- [`docs/failure-cases.md`](docs/failure-cases.md), [`docs/state-machine.md`](docs/state-machine.md), [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md) — contracts and matrices

Package-level invariants live in each workspace `README.md` (`bench/`, `tooling/`, `runtime-*`, `wasm-build/`, `upstream-sync/`).
