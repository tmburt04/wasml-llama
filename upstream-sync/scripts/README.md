# scripts

Sync automation is intentionally small and inspectable.

## Invariants
- Scripts report the exact upstream commit, patch, and ABI contract involved in a failure.
- No script suppresses patch replay, ABI drift, or snapshot drift failures.
- Commands are composable so CI can run each stage independently.
