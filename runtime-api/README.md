# runtime-api

`runtime-api` exposes the public inference surface over **`WorkerRuntimeClient`** (and pool helpers where configured).

## Invariants

- Promise-based entry points only.
- **Streaming** (`runInference`) is the default path for token-by-token results.
- **Bulk** (`runInferenceBulk`) uses the same worker command with `mode: 'bulk'` for single-shot generation when the backend supports it.
- Cancellation and destruction are explicit operations owned by the caller.
