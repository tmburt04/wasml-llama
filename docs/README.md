# docs

Reference material for architecture, compatibility, and failure handling. Tutorials and step-by-step guides belong at the repo root or in workspace READMEs when they describe how to run this repository.

## Contents

| Document | Purpose |
| --- | --- |
| [`architecture.md`](architecture.md) | Package dependency graph and ownership boundaries |
| [`compatibility-matrix.md`](compatibility-matrix.md) | Browser vs Node capability expectations |
| [`failure-cases.md`](failure-cases.md) | Fault categories and default handling strategies |
| [`state-machine.md`](state-machine.md) | Worker lifecycle states |

## Invariants

- Diagrams and tables describe contracts that exist in code (manifests, protocols, errors).
- Avoid duplicating long command lists; the root [`README.md`](../README.md) is the primary “how to run” entry.
