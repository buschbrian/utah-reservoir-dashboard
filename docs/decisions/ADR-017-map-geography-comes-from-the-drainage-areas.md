# ADR-017: Map geography comes from the drainage areas

## Status

Accepted. Narrowed by
[ADR-063](ADR-063-draw-the-west-and-open-on-the-roster.md): the geography is
the box of the drainage areas that *hold published reservoirs*, which was
every drawn area until the coverage moved west and the roster stayed.

## Date

2026-08-11

## Context

Three maps needed two numbers: where to open, and how far out a reader may
zoom. Both were written down as `MAP_BOUNDS`, a hand-chosen box
`[[-117.55, 33.90], [-105.55, 45.10]]` that predated the connected
out-of-state reservoirs. The shared module's own comment had marked it
provisional and said the extent "should be computed from the sites and
boundaries actually on the map".

Opening at that box put the drainage areas in the middle third of the canvas
with Nevada, Wyoming and Arizona around them. A first attempt computed the
opening view from the reservoir points instead, which framed the data but
left two different answers to "where does this map open" — one for the
opening view and one for the navigation limit — and made the reservoirs,
rather than the watersheds, the thing the map is about.

The drainage areas are the primary source. Reservoirs are what the dashboard
reports on; the HUC6 polygons are the geography it reports on them within,
and they are already committed to the repository (ADR-005) and drawn on all
three maps.

## Decision

The map's geography is derived from the drainage-area polygons.

- `HUC6_BOUNDS` is the bounding box of the polygons in `huc6.geojson`.
- `MAP_BOUNDS` is that box scaled by two about its centre — one zoom level
  out — and is **both** where every map opens and the furthest out any of
  them goes. The polygons get the middle of the canvas with their
  surrounding geography for context, and there is nothing useful beyond
  that for a dashboard about these watersheds.
- `MAP_MAX_ZOOM` is 23, deep enough to read an individual dam. Nothing
  caps the way in.

`HUC6_BOUNDS` is a written-down constant rather than a computation over the
file. Both engines need their navigation constraint when the view is
constructed, before any boundary file has been fetched, and a constraint
that arrives late is a map that can be panned away in the meantime.
`extent.test.ts` recomputes the box from the committed `huc6.geojson` and
fails if the constant no longer describes it, so the constant cannot drift
from its source.

## Alternatives Considered

### Compute the bounds at load from the fetched polygons

- Pros: no constant to regenerate.
- Rejected: the constraint would be absent for the first frames, and on the
  MapLibre page the whole data pipeline already waits on the basemap style,
  so "at load" is later than it sounds.

### Open on the reservoirs, constrain to the region

- Pros: frames the data the dashboard reports.
- Rejected: two sources for one question. It also reframes the map every
  time the published inventory changes, which makes the opening view a
  moving target between mornings.

### Keep the hand-written box

- Pros: no change.
- Rejected: it is not derived from anything, and it was already annotated as
  provisional.

## Consequences

- The opening view is the maximum extent. A reader cannot zoom out past the
  view they arrived at, which is the intended floor rather than a bug.
- All three maps open on the same box, which is what makes them comparable
  (ADR-007).
- Changing `huc6.geojson` changes the map's geography, and the unit tests
  will require `HUC6_BOUNDS` to be regenerated in the same commit.
- `MAP_MIN_ZOOM` is retained and unchanged. The extent constraint is what
  actually holds the view now; the zoom floor is a second, looser guard.
