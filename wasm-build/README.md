# wasm-build

Turns upstream-aligned sources into **deterministic** WebAssembly artifacts and accompanying manifests.

## Outputs

After `npm run wasm:build` (or `wasm:build:cpu` / `wasm:build:webgpu`), each versioned directory under **`dist/<version>/`** contains:

- **`manifest.json`** — schema version, ABI version, per-target paths, hashes, feature toggles
- **`build-metadata.json`** — toolchain notes (for example `browserGpuPolicy` for WebGPU policy)
- Per-target **`core.js`** / **`core.wasm`** (or extended/debug tiers when built)

Downstream packages resolve artifacts only through these files; do not assume fixed filenames across backends.

## Invariants

- Every target is defined by explicit, versioned CMake flags recorded in the manifest.
- Reproducibility settings are pinned where the toolchain allows; hashes are stored for drift detection.
- Output shape is stable across invocations: manifest + metadata + one or more WASM tiers per build profile.
