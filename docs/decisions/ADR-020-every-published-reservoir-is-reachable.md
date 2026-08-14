# ADR-020: Every published reservoir is reachable from the map

## Status

Accepted

## Date

2026-08-13

## Context

Phase 3.5 left a question open in
[`docs/PHASE-3-PLAN.md`](../PHASE-3-PLAN.md): "the payload publishes more than
the map draws", and what the out-of-scope records are for — context,
comparison, or nothing.

The question was written on the morning of 2026-08-11 and answered by code the
same afternoon, and the note was never revised. `overviewScope` had geography
pinned to `utah` at every call site, so Fontenelle and Woodruff Narrows —
connected to Utah by drainage but never touching it — were refreshed every
morning and drawn nowhere. Making both of ADR-011's dimensions the reader's
choice, on the primary application and on the overview, closed the gap: with
`geography: connected` and `lakePowell: include`, all 54 published reservoirs
are on screen.

So the decision is not "should we add a third control". It is whether the
property that state now has is the one the project intends to keep.

## Decision

**Every reservoir in `reservoirs.json` must be reachable by some combination
of the published scope controls.** A record that the refresh pays for every
morning and that no reader can reach is a bug in the controls, not a category
of data.

The two dimensions stay exactly as ADR-011 defined them — `geography`
(`utah` / `connected`) and `lakePowell` (`include` / `exclude`) — and no third
dimension is added. Adding one for the two out-of-state reservoirs would give
the reader a control whose only job is to reveal what `connected` already
reveals.

The default stays Utah reservoirs without Lake Powell. Reachable is not the
same as shown by default; the claim is that a reader can always ask.

`src/overview-model.test.ts` asserts the property against the committed
payload. It tests reachability rather than a count, so a morning that adds a
reservoir cannot fail it — only a morning that adds an unreachable one, which
is exactly when the controls need revisiting.

The two comparison maps draw every published reservoir and carry no scope
control at all. That is consistent with this record and with ADR-016: they
exist to compare rendering engines, and a scope control is not rendering.

## Alternatives Considered

### A third scope control for the out-of-state reservoirs

- Pros: names the distinction explicitly in the interface.
- Rejected: it is the same distinction `geography` already draws. Two controls
  that answer one question is the trap ADR-011 was written to avoid, and it
  would have to be built, labelled and kept in step on every surface.

### Leave them out of the map entirely

- Pros: the map would mean exactly what the default totals mean.
- Rejected: the refresh fetches and validates them every morning, and the
  drainage-area totals count them. Publishing a number and refusing to draw it
  is a harder thing to explain than a control.

### Draw them always, as unweighted context

- Pros: no control needed.
- Rejected: a reservoir on the map that is in no total is a third kind of
  thing on a map that currently has one, and the reader has no way to turn it
  off.

## Consequences

- The obligation runs from the pipeline to the interface: publishing a record
  commits the interface to a way of reaching it. A future inventory that does
  not fit `utah` / `connected` — the Upper Colorado candidates, for instance —
  forces a controls decision at the same time, rather than quietly landing as
  records nobody can see.
- The test is the enforcement. The property is invisible in ordinary use,
  which is how it went unnoticed for a day the first time.
