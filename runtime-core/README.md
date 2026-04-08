# runtime-core

`runtime-core` is the only layer allowed to bind directly to WASM exports (`EmscriptenLlamaAdapter` and related types).

Implementation helpers (module loading, virtual FS, JSPI string marshalling) live under **`src/emscripten/`** and must not leak worker or transport concepts.

## Invariants

- No worker awareness.
- No retry policy.
- No hidden state outside explicit allocation, model loading, and token execution lifecycles.
