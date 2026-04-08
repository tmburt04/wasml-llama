# runtime-worker

Isolates WASM execution in a dedicated worker and owns **protocol**, lifecycle, and recovery policy.

## Responsibilities

- Versioned commands and events (`protocol/v1.ts`), including batched model chunk delivery (`load-model-chunk-batch`) and inference `mode` (`stream` vs `bulk`).
- Validates chunk sequencing and commit preconditions before touching the core runtime.

## Invariants

- Worker state transitions are explicit and validated.
- Protocol messages are typed, versioned, and backward-aware.
- Recovery behavior is observable and never silent.
