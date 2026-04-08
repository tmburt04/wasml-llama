# Compatibility Matrix

High-level expectations for **this repository’s** WASM builds. Exact caps are always defined by **`wasm-build/dist/<version>/manifest.json`** (`featureToggles`, memory bounds).

| Feature | Chrome | Firefox | Node (this project) |
| --- | --- | --- | --- |
| Core WASM | supported | supported | supported (`local-cpu` benchmark path) |
| SIMD | supported on modern stable releases | supported on modern stable releases | supported when artifact enables it |
| Threads | cross-origin isolated contexts only | cross-origin isolated contexts only | worker threads used for isolation; WASM threads follow manifest |
| Memory64 | experimental; gate by manifest | experimental; gate by manifest | `local-cpu` is typically wasm32; WebGPU builds may use wasm64 per manifest |
| WebGPU + ggml-webgpu | **primary** target for `local-webgpu` | WebGPU availability varies; not the bench default | not applicable — Node bench uses CPU WASM only |
| JSPI (`WebAssembly.promising`) | **required** for canonical WebGPU artifact | must match engine capabilities | not used — WebGPU WASM is browser-only here |
