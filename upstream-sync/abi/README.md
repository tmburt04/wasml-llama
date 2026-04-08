# abi

`abi` stores the downstream contract this repository expects from upstream-derived artifacts.

## Invariants
- ABI baselines are generated, reviewed, and versioned intentionally.
- Symbol or layout drift must fail the sync pipeline before releases are built.
- Runtime packages consume ABI versions, not ad hoc symbol guesses.
