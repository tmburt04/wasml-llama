# overlays

Overlays hold non-invasive wrapper assets that complement the patch queue.

## Invariants
- Overlays never mutate upstream source files in place.
- Overlays are small, explicit, and traceable to a single downstream concern.
- Build scripts must copy overlays into isolated build directories instead of editing vendor state.
