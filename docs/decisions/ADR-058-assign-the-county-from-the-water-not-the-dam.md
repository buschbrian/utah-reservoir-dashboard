# ADR-058: Assign the county from the water, not the dam

- Status: Accepted; amended by [ADR-076](ADR-076-nest-the-place-menus-and-let-the-heading-carry-the-state.md)
  (the state now travels as a group heading rather than a per-row label suffix)
- Date: 2026-08-18

## Context

The county and conservancy district aggregation axes were the oldest genuinely
open item on the backlog. Scoping them (`docs/OPEN-BACKLOG-SCOPING.md`) split
them apart and answered them differently. This record is the county half.

Two things had to be decided before anything was built: whether counties are
an aggregation axis, and which point a county is assigned from.

### Counties are not an aggregation axis

Measured against the published roster: **68 reservoirs fall in 34 counties**,
and **19 of those counties hold exactly one reservoir**. The drainage axis
groups the same 68 into 14 areas, about five per group.

A bar chart of county storage is therefore a bar chart of individual
reservoirs with a county's name on it, and a box plot of within-group spread
has nothing to show for more than half its groups. County count grows about as
fast as roster count, so this gets thinner as the roster grows rather than
richer — which contradicts the western-expansion scoping, where these axes were
called the strongest argument for keeping a ~193-row list browsable.

What counties are genuinely good for is the question people actually ask:
*how is Washington County doing*. That is a filter and a search term. The snow
view already searches by county name for exactly this reason.

### The assignment point is the waterbody, not the dam

ADR-013 assigns a drainage area from the **dam or outlet point**, because a
drainage area is where the stored water leaves — and ADR-057 has just decided
*which* dam structure that is. The obvious move is to reuse that point.

It is the wrong one. Measured across the 29 reservoirs holding both points,
two disagree:

| reservoir | from the waterbody | from the dam |
|---|---|---|
| Lake Powell | San Juan County, **UT** | Coconino County, **AZ** |
| Lost Lake | Wasatch County, UT | Summit County, UT |

Lake Powell settles it. Glen Canyon Dam is genuinely in Arizona, and a county
filter that answers "Lake Powell is in Coconino County, Arizona" is telling a
Utah reader something true about a structure when they asked about a lake.

The two axes are asking different questions and should use different points. A
drainage area is a hydrologic fact about where water goes; a county is an
administrative fact about where a thing is. Both records say which point they
used, in the payload envelope, so the difference is visible rather than
implied.

## Decision

**A reservoir's county is the county containing its published waterbody
point.** The payload states the rule beside the drainage rule it differs from.

**The key is the five-digit FIPS code and never the name.** The published
roster alone holds two Summit Counties, two Carbon Counties and two Garfield
Counties, each pair in different states. Reader-facing labels carry the state
("Summit County, UT"), and search matches the label a reader can see —
including its comma, which is why both the search text and the query are
normalised.

**The assignment is committed, not computed each morning.** `counties.json` is
built deliberately by `tools/build_county_assignments.py`, the same
arrangement as `capacities.json`, for the reason rule 4 of the source
inventory gives: an assignment that can change underneath you is not
reproducible.

**Geometry is queried, never committed.** The service resolves each point
against its own full-resolution polygons and answers with a code. This is
ADR-048's rule — publish the roster, not the polygons — reaching a second
geography, and here it is stronger: the polygons are not even *stored*.

**The source is Esri Living Atlas, "USA Census Counties", layer `dtl_cnty`**,
marked authoritative and carrying the Census Bureau's 2020 boundaries. The
*detailed* layer, deliberately: the generalized county boundaries beside it —
the ones the drought map already draws as optional context — place Lost Lake
outside Wasatch County entirely, and a 100-metre file requested under rule 5
does the same. This is ADR-037's lesson from a different direction. Drawing
tolerates a shifted line; assigning a point does not. The source inventory
already anticipated it: those generalized boundaries are optional context, and
"if either is ever used for an analytical result, it stops being optional
context and has to be re-sourced from the owner at a stated tolerance."

## Consequences

The axis is a filter and a search term. **Nothing groups by county**, and the
measurement above is the reason. If that is ever revisited it should be
revisited with a fresh count of reservoirs per county, not with an argument.

The county fields are optional on `Reservoir`, like the drainage fields, so
the pages keep reading the payload published before they existed. The control
is hidden when the payload carries no counties at all — a filter whose every
choice narrows to nothing is worse than no filter, and that is exactly the
state of the published payload until the next refresh.

A reservoir with no county assignment is left out of a chosen county rather
than shown in it. It is reachable with the filter set to all, and the refresh
names it rather than guessing.

`counties.json` has to be rebuilt when the roster changes, like
`capacities.json` and for the same reason. The refresh says so when a
reservoir arrives without one.

The western expansion does not change any of this, but it does change the
numbers the first section rests on: at roughly 193 reservoirs across eleven
states the county count grows with the roster. The measurement has not been
redone at that scale, and the ratio argument predicts it gets worse rather
than better.
