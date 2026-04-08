# bench

Single source of truth for **end-to-end, model-backed** performance runs using real WASM artifacts and the same runtime stack as production (no fake adapters in benchmark paths).

## Invariants

- Bench runs use real build artifacts and the shared worker/runtime pipeline where applicable.
- **Chrome + WebGPU** is the primary browser target (`local-webgpu` artifact, JSPI-enabled).
- Node benchmarks use **CPU WASM** (`local-cpu`); useful for CI and regression without a GPU.
- Result JSON under `bench/results/` is keyed by commit, artifact version, model id, backend, and environment compatibility metadata.

## Commands (from repo root)

```bash
npm run bench:node -- --commit my-run --version local-cpu --backend cpu --max-tokens 48
npm run bench:browser -- --commit my-run --version local-webgpu --backend webgpu
```

Omit flags to use defaults (`bench/src/cli.ts`).

Chrome is resolved automatically from standard install paths (macOS: `/Applications/Google Chrome.app`; Linux: `google-chrome-stable`; Windows: Program Files). If auto-detection fails, set **`CHROME_BIN`** or **`GOOGLE_CHROME`**, or pass **`--chrome /path/to/chrome`**.

Optional **`CHROME_EXTRA_ARGS`** is appended to the launch profile (see `src/chrome-profile.ts`).

## Interactive dev server

```bash
npm run serve          # repo root script — starts bench HTTP server at port 41741
```

Open in Chrome with the WebGPU and JSPI feature flags (see `src/chrome-profile.ts`). The server sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers required by the WASM runtime. Use `PORT=<n>` env var to change port.

Default model and thresholds are defined in `src/config.ts`; override with **`--model-url`**, **`--model-file`**, **`--prompt`**, **`--max-tokens`**.

## Browser model cache

The interactive browser UI stores downloaded GGUF files in the browser **Cache API** under a versioned cache namespace. Cache keys are derived from the configured **model URL** plus **model ID**, so:

- Running the same model again can skip the network download and reuse cached bytes.
- Changing either the model URL or the model ID forces a cache miss.
- The config panel exposes **Clear model cache** to drop cached entries without clearing generated output.

If Cache Storage is unavailable, or a cache write fails because of browser quota limits, the run still continues by using the downloaded bytes in memory only. COOP/COEP requirements are unchanged.

## Outputs

Each run writes a JSON report path to stdout and stores the file under `bench/results/<commit>.json`. Use **`--baseline`** to compare against a previous report for regression thresholds.
