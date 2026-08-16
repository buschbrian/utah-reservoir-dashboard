# ADR-039: Draw percent full with a sequential ramp, and free the ring from it

## Status

Accepted — supersedes ADR-028

## Date

2026-08-16

## Context

ADR-028 replaced an uneven 25/25/25/15/10 split with five equal 20-point
bands and a colour-blind-safe ramp. The bands were right and are unchanged.
The ramp was ColorBrewer's five-class RdYlBu — a **diverging** scheme.

Percent full is not diverging data. It runs one direction from empty to full,
and nothing happens at 50%: it is not a threshold, an average, or a zero. A
diverging ramp asserts a pivot the quantity does not have, and the hydrology
literature is explicit that a diverging scheme requires a meaningful midpoint
while sequential data wants monotonic luminance (Stoelzle & Stein, 2021).

The same ramp had already caused one measured failure. ADR-032 found storage
and snow sharing byte-identical colours, because both tables had independently
reached for the same red-to-blue.

## Decision

**Take the colours from Crameri's `davos`, reversed.** A scientific colour
map: perceptually uniform, colour-vision-deficiency safe, readable in
greyscale, citable. Reversed it runs pale and dry at empty to deep water at
full, which is the depth convention every water map borrows. Luminance
decreases monotonically across the five classes, so the order survives
greyscale and survives a reader who cannot separate the hues.

The sampling was measured rather than eyeballed. Pulled in from both ends: the
first attempt put the lightest class at luminance 0.90, which is effectively
white and invisible on a white legend card. The chosen sampling holds it at
0.73, keeps every adjacent pair at least 50 apart in RGB distance, and keeps
every class clear of the snow and drought tables (ADR-032).

**And the capacity ring stops taking the storage colour.** This is the half
that made the change possible rather than merely correct.

The symbol has always meant two things: the ring is sized by the reservoir's
own capacity, and the fill is sized by how full it is. Colouring both by the
storage class conflated them — and with a sequential ramp it broke outright.
A near-empty reservoir is a ring with almost no fill inside it, so a pale low
end made the entire symbol disappear against a light basemap, and empty is the
reading this map exists to show. The ring now carries one constant slate
outline (`CAPACITY_RING_COLOR`), so every reservoir has a visible edge whatever
its value, and the fill carries the value alone.

Late readings keep the amber dashed ring. Lateness is a state, not a value, so
it is the one thing still allowed to recolour the ring.

## Consequences

Each half of the symbol now says exactly one thing: size means capacity,
colour means storage.

An empty reservoir is more visible than before, not less, despite the low end
being pale — the outline does the work the colour used to.

Every surface that reads `STORAGE_CLASSES` follows automatically: the map, the
legend, the six charts and the table. The frozen oracle in
`shared/reservoir-viz.js` was updated in lockstep, as ADR-008 requires, and the
value-for-value test holds them together.

A test now asserts the luminance is strictly decreasing, which is the property
that makes a sequential ramp a sequential ramp. Swapping in a prettier set of
hues that happens not to darken monotonically will fail the build.

ADR-028's equal 20-point bands are untouched. Only the ramp and the ring
changed.
