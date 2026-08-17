# ADR-047: Let the label engine place the drainage-area names

## Status

Accepted

## Date

2026-08-17

## Context

ADR-030 took the drainage-area names out of the label engine and drew them as
fourteen fixed `TextSymbol` graphics in their own layer, ordered below the
reservoirs. Its reasoning was sound and its own Consequences section named the
condition under which it would stop being sound:

> Background TextSymbols do not use FeatureLayer label deconfliction. The
> current inventory has fourteen names; viewport smoke checks guard layout, and
> a later denser geography would need a measured decluttering rule.

That geography has arrived. The western scope is 181 drainage areas at HUC-6
and 1,247 at HUC-8, against the fourteen the record was written for. At those
counts a fixed position is not a simplification, it is a defect: a name with
nowhere to go is drawn anyway, on top of its neighbour, and the map has no
mechanism to decide which of two overlapping names should survive.

So the harm ADR-030 set out to prevent inverts. It moved the names down so a
name could not cover a reservoir point. At 181 areas the names stop covering
reservoirs and start covering each other, and a name buried under another name
is worse than a name over a dot: the dot is still there, still the right
colour, and still answers a hover, whereas two names on one another are
illegible and neither is recoverable.

### Why this was not simply done in the first place

ADR-030's third reason was a budget, not a cartographic judgement: computing
label points ourselves meant importing the geometry engine's label-point
operator, measured then at **+0.32 MiB** on the static entry path. That is
still true and still unaffordable. Measured on this branch:

```
SDK shell baseline: 23.61 MiB raw / 8.24 MiB gzip across 1547 files;
                    2.14 MiB gzip on the static entry path
```

against a 2.3 MiB budget — 0.16 MiB of headroom, so the operator would still
fail the build.

The premise of this record is that the budget objection never applied to the
label *engine*, only to computing label points ourselves. The engine is already
on the rendering path for every other labelled layer on the site. That was a
hypothesis rather than an assumption, so it was measured rather than argued.
After moving the storage map's drainage names onto hosted labelling:

```
SDK shell baseline: 23.61 MiB raw / 8.23 MiB gzip across 1547 files;
                    2.14 MiB gzip on the static entry path
```

Unchanged on the entry path, and marginally smaller overall. The engine costs
nothing because it was already being paid for.

## Decision

The drainage areas are one hosted `FeatureLayer` and their names are its
`labelingInfo`, placed by the SDK's label engine with
`deconflictionStrategy: "dynamic"`.

The type of guarantee changes, and this is the substance of the decision:

| | ADR-030 | this record |
|---|---|---|
| Guarantee | **Position** — a name is never above a reservoir | **Placement** — a name is never above another name |
| Failure at scale | Names pile up, silently | A name that cannot fit is dropped |
| Who decides | The map, once | The engine, per frame, per viewport |

A name that cannot be placed is not drawn. That is the decluttering rule
ADR-030 asked a later record to measure, and it is the engine's rather than
ours.

Appearance does not change. The same 11-pixel bold `#263f52` at the same
`DRAINAGE_LABEL_MIN_SCALE`, over the same 2-pixel halo at ADR-030's 50%
opacity — that half of ADR-030 was right about a real problem and stands. What
changes is who places the words, not what they look like.

The drainage layer stays below the reservoir layer in the operational stack.
The fills and outlines still draw as background, and the SDK's label pass
resolves conflicts between layers in that order, so where a drainage name and a
reservoir name compete the reservoir's identity wins. ADR-030's intent survives
its mechanism.

## Consequences

A drainage name can now be drawn over a reservoir symbol. This is the price and
it is worth stating plainly rather than burying: at fourteen areas it is a
regression against ADR-030, and only at a denser geography does it become the
better trade. It is accepted because the reservoir symbol is still drawn, still
hit-tested and still hovered — the name sits above it in one pass, it does not
replace it.

`window.__dashboardReady.drainageLabelsUnderReservoirs` now reports **false**,
which is honest: there is no text-symbol layer to be under anything. The field
is kept rather than deleted, per the readiness-signal rule, and the smoke suite
now asserts it is false — a text-symbol layer returning alongside engine
placement would draw every name twice.

The fact that replaced it is `drainageLabelsDeconflicted`, true while the
drainage layer exists, carries no text-symbol layer, and has its labels
switched on. It is not derivable from the other field: a map with no names at
all reports false to both, which is the failure this needs to catch.

`createDrainageLayer` and its `GraphicsLayer` output are no longer used by the
storage map. They are left in place for now because the snow map still fills
each area by a value the hosted service has never heard of, and that surface is
migrated separately.

The drought map has moved too, and its cased outline is two feature layers
over one service: a wide bright pass under a narrow dark one, because a casing
only works if every casing is down before any core is drawn and one layer
cannot order that across features. The doubling that buys was measured rather
than assumed -- **exactly 2.00x, 30.2 KB to 60.4 KB** at its opening view, with
nothing shared between the two instances, against the 982 KB of committed
geometry it replaces. `docs/data-transfer.md` carries the table and the reason
the single-layer CIM alternative was not taken.

That map keeps its own heavier halo. It writes over the Drought Monitor's
palette rather than over terrain, and ADR-032 forbids its outlines from
carrying colour, so contrast is all the separation they have.

## Alternatives considered

**Keep the text symbols and add our own decluttering rule.** This is what
ADR-030 asked for, read literally. Rejected: the rule would need label extents,
which means measuring text, which is the label engine's job — and writing a
second, worse one beside a good one already on the rendering path.

**Import the label-point operator and keep fixed placement.** Rejected on the
measurement above. It fails the SDK budget by 0.16 MiB, and it would buy fixed
placement, which is the thing that stops working at scale.

**Thin the names by drainage-area size, drawing only the largest.** Rejected:
it decides at build time what only the viewport knows. A reader zoomed into one
basin would lose its name because it is small nationally.

## Related

- Supersedes [ADR-030](ADR-030-draw-drainage-area-names-below-reservoirs.md),
  on its own stated expiry condition.
- Builds on [ADR-035](ADR-035-a-label-ladder-tied-to-containment.md)
  for the scale at which names appear.
- The hosted source is `src/arcgis/watershed-layers.ts`; see
  [ADR-034](ADR-034-hosted-boundary-layers-with-a-deadline.md)
  for why that organisation needs no widening of the content policy.
