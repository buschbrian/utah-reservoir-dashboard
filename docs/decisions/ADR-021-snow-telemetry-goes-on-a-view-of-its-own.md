# ADR-021: Snow telemetry goes on a view of its own

## Status

Accepted

## Date

2026-08-13

## Context

The other question Phase 3.5 raised and refused to answer: the snow telemetry
sites are a different kind of thing from a reservoir. A reservoir is a volume
that is already there. A snow site is a point measurement of what is going to
arrive — a depth of water held as snow over an area, read at one instrument,
standing for a basin.

Snowpack is also the single addition that would give every reservoir trend a
cause rather than a shape, which is why it has stayed on the plan as deferred
work rather than being dropped.

The pull is to put the sites on the reservoir map, where the cause would sit
beside the effect. The cost lands on the parts of this project that were
hardest to get right: one class-break table drives colour everywhere
(ADR-008), and it is a table of percent-of-capacity. Snow water equivalent has
no capacity and no percent full. It would need its own breaks, its own legend
and its own size domain, and the map would then carry two quantities that look
alike and mean different things.

## Decision

**Snow telemetry does not go on the reservoir map.** When the snowpack work
lands it lands as a view of its own, reading the same published payload and
the same drainage areas.

The reservoir map stays about stored volume. One legend, one class table, one
unit.

The connection between the two — the reason to want snowpack at all — is made
through the drainage area, which both views already share, and through
whatever linking the shared state object provides. It is not made by drawing
the two on one canvas.

This does not change the data track. Snowpack ingestion remains Phase 1.6
work, and this record only fixes where the result is displayed. It also does
not decide the new view's URL or its place in the shell; those are open until
the data exists.

## Alternatives Considered

### A toggleable snow layer on the reservoir map

- Pros: cause and effect on one canvas; no new page.
- Rejected: two quantities with two legends and two size meanings on one map,
  and a second class table beside the one the whole project keeps in one
  place. The map answers "how much is stored"; a layer that answers a
  different question makes the reader work out which symbol answers which.

### Not at all in this pass

- Pros: nothing to build; Phase 4 starts immediately.
- Rejected as an answer to *where*, though not as an answer to *when*. This
  record costs nothing now and stops the question being re-opened as a
  symbology question later, which is how it arrived.

## Consequences

- The snowpack item in the plan's deferred list becomes a view, not a layer,
  and inherits the same obligations every surface here has: Simplified
  Technical English, a deadline on every wait, a readiness signal, and the
  three tested widths.
- The reservoir map's symbology work is finished without a second quantity
  arriving to reopen it, which is what Phase 3 needed to be able to close.
