# ADR-063: Draw the whole west, and open on the areas that hold reservoirs

- Status: Accepted; narrowed by [ADR-068](ADR-068-move-the-roster-scope-west-and-decouple-the-opening-box.md)
  (`ROSTER_SCOPE` moved to `DEFAULT_SCOPE` and `MAP_BOUNDS` no longer derives
  from `HUC6_BOUNDS`) -- everything else here still holds
- Date: 2026-08-18

## Context

ADR-053 scoped the west by where the water goes and registered three western
scopes with `published=False`, so the geography could be fetched, measured and
reviewed before anything drew it. `docs/WESTERN-EXPANSION-SCOPING.md` then
measured what publishing one would cost, from live queries rather than from
scaling the Utah figure by a ratio of basin counts, and recommended
`west-huc6` first: 75 whole basins instead of 14, at the level every figure on
this site is already keyed to, with no new level machinery.

The scoping left one thing open that this record has to answer. Coverage and
roster are separate: admitting a reservoir means tracing a capacity through
the National Inventory of Dams and reviewing it, and the western candidate
pool — 306 distinct reservoirs across RISE and AWDB — has not been through
that. Whether the west's admission rate resembles Utah's 63% is named in the
scoping as an unanswered question. So the areas drawn move now and the roster
does not, which makes "which drainage areas exist" and "which drainage areas
hold reservoirs" two different questions for the first time.

That matters because the map's opening extent was derived from the first one.
ADR-017 made the map's geography the bounding box of the committed drainage
polygons, and for as long as the two questions had one answer, that was also
the box of the areas a reader could find something in. At 75 basins it stops
being: the box would grow from about 10 degrees of longitude to 19, and every
one of the 69 reservoirs would sit in one corner of it. The map would open
further out and show less.

## Decision

**The maps draw `west-huc6`.** `DEFAULT_SCOPE` in `watershed_scopes.py` names
it, the scope is `published=True`, and everything downstream follows that one
name: `huc.BOUNDARY_PATH` assigns reservoirs against the file it names,
`tools/compute_drought_coverage.py` measures against the same file, and
`reference.json` publishes its roster of 75 codes and names for the maps to
draw outlines for from the hosted Watershed Boundary Dataset. No file name is
written down in a second place.

**The extent follows the roster, not the coverage.** A second name,
`ROSTER_SCOPE`, is the geography the published reservoirs were admitted from —
still `utah-connected`, the fourteen areas that touch Utah. `HUC6_BOUNDS` is
the box of *that* scope's polygons, so it is unchanged by this record and
moves when the roster does rather than when the coverage does. This narrows
ADR-017's "the map's geography is derived from the drainage-area polygons" to
the polygons of the areas that hold reservoirs. Both names are published in
`reference.json` as `default_scope` and `roster_scope`, and `extent.test.ts`
recomputes the box from whichever file `roster_scope` points at — so naming a
file in the test, which would have quietly stopped tracking the reservoirs the
morning the roster expanded, is not possible.

**Each map draws what it can say something about.** The drought engine now
publishes coverage for all 75 areas, so the drought map draws 75. The snow
network reports in 14 of them, so the snow map draws 14: `measuredScope` in
`src/snow-model.ts` narrows the drawn scope to the areas the snow payload has
rollups for. An outline with no percent of normal behind it and a hover card
that comes back empty is what ADR-050 already judges to be less information
rather than more, and the one map whose subject *is* the drainage areas is the
worst place to put 61 of them. The storage map draws all 75, where the areas
beyond the roster are context around a subject rather than the subject.

**61 drawn areas hold no reservoir, and that is a state the payload already
allows for.** ADR-056 made an empty drainage area possible on any morning a
feed goes quiet, and `storageAgainstDrought` already omits an area with no
storage rather than plotting it at zero.

## What it cost, measured

Gzipped, which is what a reader pays (ADR-051):

| payload | before | after |
|---|---:|---:|
| `reference.json` | 21.7 KB raw / **5.5 KB** | 26.9 KB raw / **6.7 KB** |
| `data/drought/usdm-huc6.json` | 3.4 KB raw / **0.9 KB** | 17.5 KB raw / **2.9 KB** |
| `reservoirs.json` | 360 KB raw / **43 KB** | unchanged; the roster did not move |

The drought engine takes **10.3 seconds** for 75 areas against about 2 for 14,
comfortably inside a daily job. The scoping predicted 8.8 seconds and 4.8 KB
for the coverage file; the runtime is close and the transfer figure was
pessimistic by a third.

## The western file was refetched at 56 metres first

`west-huc6.geojson` was fetched at `maxAllowableOffset=0.001`, the 100-metre
default of rule 5 in the source inventory. `huc6.geojson` was refetched at
`0.0005` under ADR-037, where measurement showed the source stops adding
vertices.

Publishing the western file made it the measurement geometry as well as the
drawn scope's roster, and the difference was not cosmetic: recomputing drought
coverage against the coarser file moved **two of the fourteen published areas
by 0.1 point** — Lower Bear's D3 share and Escalante Desert-Sevier Lake's D2 —
which is one rounding step at the precision this site publishes, with no
weather behind it. Over the same fourteen areas the coarse file carried 25,057
vertices against 29,856.

Refetched at `0.0005`, the western file's fourteen shared areas are
**byte-for-byte identical** to `huc6.geojson`, every previously published
drought figure is unchanged, and `HUC6_BOUNDS` needs no edit. The file grew
from 3.0 MB to 3.7 MB; it is committed and never published, so no reader pays
for it. `tests/test_watershed_scopes.py` now holds the two files to that
identity, because a disagreement between them is two geographies wearing one
set of codes.

## Consequences

- **The reservoir roster is unchanged at 69, and the site now draws areas that
  hold nothing.** That is visible: 61 outlines with no reservoir in them. It is
  the honest intermediate state of an expansion whose two halves have
  different costs, and the alternative — waiting for the roster — would have
  held back a drought map that has a real measurement for all 75.
- **`ROSTER_SCOPE` is a thing to move, and a test moves it.** Admitting a
  reservoir outside `utah-connected` fails
  `test_every_roster_reservoir_sits_inside_the_roster_scope` with the
  instruction to move the name, rather than opening a map the new reservoir
  sits outside of.
- **The archive stays at HUC-6.** `usdm-huc6-history.json` grows with the
  number of areas, and the scoping measured it at about 3.9 MB raw at the
  520-week cap for 75 areas against 30 MB at HUC-8. Publishing coverage at a
  finer level later does not move the archive with it.
- **Weeks in the archive before this one hold 14 areas.** Nothing recomputes
  them: every figure in that file is one this pipeline computed from polygons
  it verified, and the monitor's own back catalogue is deliberately not mixed
  in. A week-over-week change for a new area is skipped rather than compared
  against nothing, which `weekly-model.ts` already did for unmeasured areas.
- **Partly measured areas are published for the first time.** Twenty-one of
  the 75 cross the Canadian or Mexican border; the `measured` block ADR-059
  added has never appeared in a published file until now, and it is documented
  in the data API accordingly.

## Alternatives Considered

### Let the extent expand to the whole west

- Pros: the box describes exactly what is drawn, and ADR-017 needs no
  narrowing.
- Rejected: it makes the opening view worse for every reader today in exchange
  for describing 61 areas with nothing in them. The map would open at 19
  degrees of longitude to show reservoirs occupying 10 of them.

### Pin the extent to the current box as a written constant

- Pros: the smallest change.
- Rejected: it is derived from nothing then, which is what ADR-017 exists to
  prevent. The constant has to stay recomputable from a file, and the question
  is only which file.

### Expand the roster in the same change

- Pros: one coherent expansion rather than an intermediate state.
- Rejected: capacity traceability across the 306 western candidates is
  unmeasured, `normals.json` needs a rebuild measured in hours at that roster
  size, and admission is a review rather than a run. Coverage is ready now and
  waiting for the roster would hold it back for neither a measurement nor a
  decision.

### Draw only the 14 areas that hold reservoirs, and publish the rest as data

- Pros: no empty outlines anywhere.
- Rejected: the drought map has a real measurement for all 75, and refusing to
  draw an area this project measured because a *different* subject has no
  reading for it is the coverage question answered by the wrong payload. The
  snow map narrows for exactly the opposite reason, and each map answering for
  its own subject is the rule this record adopts.
