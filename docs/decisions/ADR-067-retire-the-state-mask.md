# ADR-067: Retire the state mask, and stop publishing the state boundary

## Status

Accepted

## Date

2026-08-19

## Context

Every map on this site used to grey out everything outside Utah with a
translucent mask, drawn from the maintained UGRC Utah State Boundary
(ADR-014). That was the right boundary for the right shape of dashboard: a
Utah reservoir map with a handful of connected basins peeking over the state
line.

It is not the right shape of thing any more. ADR-063 moved the drawn
coverage to `west-huc6` -- 75 drainage areas across regions 14 to 18, which
reach 11 states -- and the storage map now draws all 75 as context around its
69 reservoirs. A mask that grades everything outside one state contradicts a
map whose whole subject is a region eleven states wide: it would draw ten of
those states, and every basin in them, under the same grey wash the mask was
built to mean "not the subject."

The state outline was doing two jobs, and only one of them was ever the
mask's. `in_utah` and `intersects_utah` -- Python's point-in-state
classification, used for the state filter and the roster's own admission
rule (ADR-009, ADR-010, ADR-013) -- read the same committed
`utah-boundary.geojson` the mask drew from, and that classification has
nothing to do with what a map greys out. It is a fact about a reservoir, not
a fact about the screen.

Separately, the site already draws state outlines where a map benefits from
them: the drought map has carried Esri Living Atlas state and county
boundaries since ADR-034, sunk below the Drought Monitor's classes per
ADR-061, because a national drought sweep needs something on screen that
says which states it crosses. That service was adopted for a different
reason and on a different map, but it settles what "state outline" means on
this site once the mask is gone -- a hosted, generalized layer, not a
committed polygon.

## Decision

The mask is retired. Not re-targeted at a wider extent, not re-sourced from
Living Atlas, not replaced by anything -- the storage, snow and drought maps
simply stop drawing one. `ui/layers.ts` drops `createMaskLayer`,
`MASK_FILL` and `MASK_LINE`; `data/boundaries.ts` drops
`parseUtahBoundary`, `utahMaskRings`, `loadUtahBoundary`, `UtahBoundary`,
`UTAH_RING` and `SURROUND_RING`; `main.ts` stops fetching the boundary before
the map loads.

This is frontend-only. `huc.py`'s point-in-state logic, `in_utah`,
`intersects_utah`, and `CROSS_BORDER_WATERBODIES` are untouched -- they read
`utah-boundary.geojson` directly, at pipeline run time, and none of that
depends on anything reaching a browser.

`utah-boundary.geojson` itself stays. It is still committed, still reviewed,
still rebuilt deliberately by `scripts/fetch-utah-boundary.mjs`
(`npm run boundary:utah`). What changes is that it stops being *published*:
it is no longer copied into `dist/` as a standalone file, and
`refresh_reservoirs.py`'s `build_export_sections` stops folding it into
`reference.json`'s `geography.state`. It joins `normals.json` and the
drainage-area GeoJSON in the same arrangement ADR-048 and ADR-049 already
established for exactly this shape of file: reviewed and committed, read by
the pipeline, and never shipped to a reader who has nothing left to draw
with it.

Removing a published field is a breaking change for anyone still reading it,
so `REFERENCE_SCHEMA_VERSION` (client) and `EXPORT_SCHEMA_VERSION`
(pipeline) both move from 3 to 4. A client still on 3 is told rather than
handed a `state` field that silently stopped meaning anything -- the same
soft failure an unrecognised version has always been given.

### What ADR-048 and ADR-049's reasoning becomes

Both records kept the state outline in the published payload with the same
sentence: *"no hosted service publishes the reviewed UGRC polygon."* That
was true and load-bearing -- it was the reason the polygon could not simply
be swapped for a hosted layer the way the drainage geometry was. It is still
true. What changed is the premise underneath it: that sentence was an answer
to "how do we keep publishing the polygon this mask is drawn from," and
there is no longer a mask asking that question. A true fact about a
service that does not exist is not a reason to keep publishing a file
nothing reads it for.

Where a map still wants a state outline on screen, it was never the UGRC
polygon's job to answer that -- ADR-034 already answered it, for the drought
map, with the hosted Living Atlas service this ADR's Context section
describes. ADR-048 and ADR-049 are not reversed by this: their decisions
about the drainage geometry stand exactly as written. Only the one borrowed
sentence about the state outline stops applying, because the thing it was
defending is gone.

### Credit, re-attributed rather than deleted

`methods.ts`'s "State outline" entry and credit list named the Utah
Geospatial Resource Center because that was the only source a reader could
see the effect of. It is not credited any more: nothing on the page draws
from it. State outlines a reader can see -- today, only on the drought map --
come from Esri's Living Atlas, built from U.S. Census Bureau boundaries, so
the credit list now names the Census Bureau alongside Esri. `counties.json`
has recorded exactly that same lineage since ADR-058 without a credit line
existing to hold it; this is the first time the page names the source it has
been drawing county context from as well as state context.

## Alternatives considered

**Re-source the mask from the Living Atlas states layer, at western
extent.** Rejected on the Context section's own terms: a mask means "this is
the subject, that is not," and a western dashboard has no single state to
draw that line around. Masking all 11 touched states and greying everything
past them is not a smaller version of the same idea -- it is a map of the
United States with a border drawn near its edge, which tells a reader
nothing the basemap does not already show.

**Keep `utah-boundary.geojson` published even though nothing draws it.**
Rejected. The whole reasoning for publishing it whole was that no hosted
service could stand in for the mask it fed. With the mask gone, publishing
it costs a reader 6.8 KB raw (about 2.3 KB gzipped) of `reference.json` for a
polygon that never reaches a `<canvas>`.

**Drop `utah-boundary.geojson` from the repository entirely.** Rejected.
`huc.py` still reads it every morning; dropping the committed file would
break the pipeline's own `in_utah` and `intersects_utah` classification, not
just the browser payload.

## Consequences

`reference.json` goes from 36.9 KB raw / 8.8 KB gzipped to 30.1 KB / 6.5 KB
-- confirmed by measurement, not projected; see `docs/data-transfer.md`. No
map page's console error count, reservoir count, or axe result changes: the
mask was decoration. The readiness signal's `masked` and `boundaryPoints`
fields stay -- fields are added, never removed -- and now permanently report
the retired value (`false`, `0`) rather than being read from a layer that no
longer exists; the smoke suite asserts that value instead of asserting the
mask is present.

A saved link or bookmark is unaffected. Nothing about `?state=`, the
geographic filters, or `MAP_BOUNDS`/`MAP_CENTER` (ADR-044) changes -- those
are a different "state" than the one this ADR retires, and none of them read
`geography.state`.

## Related

- Supersedes [ADR-014](ADR-014-use-the-ugrc-utah-state-boundary.md), whose
  choice of the UGRC polygon as the maintained source was correct and is
  simply no longer the shape of thing a western map needs drawn.
- Narrows one sentence of [ADR-048](ADR-048-publish-the-roster-not-the-polygons.md)
  and [ADR-049](ADR-049-stop-publishing-the-drainage-polygons.md) without
  reversing either: their drainage-geometry decisions stand, and their
  reasoning about the state outline is explained above rather than edited
  in place, per this project's rule that an accepted record is not rewritten.
- Follows [ADR-063](ADR-063-draw-the-west-and-open-on-the-roster.md), which
  is what made a Utah-shaped mask the wrong tool.
- Depends on nothing from [ADR-034](ADR-034-hosted-boundary-layers-with-a-deadline.md);
  it explains why that record's Living Atlas service is now the only drawn
  state outline on the site.
