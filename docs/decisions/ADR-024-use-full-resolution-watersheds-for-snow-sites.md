# ADR-024: Use full-resolution watersheds for snow sites

## Status

Accepted

## Date

2026-08-14

## Context

The committed drainage-area file is generalized to about 500 metres. ADR-005
measured that as safe for reservoirs because the closest reservoir assignment
was more than two kilometres from a divide.

Snow sites are different. Hoosier Pass, McClure Pass, and Parleys Summit are
4–65 metres from a divide in the generalized file. Comparing every active
automated snow site against the full-resolution U.S. Geological Survey
Watershed Boundary Dataset found four membership or assignment changes:

- Arapaho Ridge and Divide Peak are inside the accepted geography but fall
  just outside the generalized polygons.
- McClure Pass is in the Gunnison drainage area and is outside the accepted
  geography, although the generalized file places it in Colorado Headwaters.
- Parleys Summit belongs in Weber, although the generalized file places it in
  Jordan.

The earlier generalized audit found 216 sites. Correcting those four cases
produces 217 sites. The same check confirms Hoosier Pass in Colorado
Headwaters even though the station catalog carries a different drainage code.

The Natural Resources Conservation Service also confirms that the current
comparison period is the 1991–2020 median. It is updated once per decade.

## Decision

Use the full-resolution federal watershed geometry to build the snow-site
inventory. Commit the small, deterministic result as `snow_sites.json`; do
not add the much larger source geometry to the runtime payload.

Keep `huc6.geojson` generalized for display and for reservoir assignment. Its
measured reservoir margin remains valid. Snow sites do not inherit that
margin merely because they share the same drainage areas.

Refresh daily snow measurements into a separate `snowpack.json`. The refresh
reads the reviewed station inventory, requires a response for every station,
and retries a missing batch member on its own before it can publish. A snow
service failure keeps the last complete snow file and does not stop reservoir
updates.

## Alternatives Considered

### Use the generalized map boundary for every dataset

- Pros: one geometry and the existing audit already works.
- Rejected: it includes one site from the wrong drainage area, excludes two
  valid sites, and files one valid site under the wrong area.

### Trust the drainage code in station metadata

- Pros: no geometry download during an inventory review.
- Rejected: Hoosier Pass carries a provider code outside the accepted
  geography while the full-resolution point is inside Colorado Headwaters.
  Metadata remains disagreement evidence, not the membership rule.

### Commit a second full-resolution boundary file

- Pros: every assignment can be repeated without a network request.
- Rejected: the published interface does not need that geometry. The reviewed
  station inventory preserves the result, and its builder makes the source
  query reproducible when membership is audited again.

## Consequences

- All fourteen drainage areas have at least four verified snow sites.
- The inventory is changed deliberately after review, not silently during a
  morning data update.
- The seasonal area value is the mean of station percentages, with a minimum
  of two reporting sites. It never averages raw snow depth across elevations.
- Lower San Juan has four verified sites, but only Beaver Spring and Camp
  Jackson have enough 1991–2020 observations for a published normal median.
  Every area value therefore carries its reporting-site count.
- A zero normal median produces no percentage instead of a division by zero.
- Late readings remain present and are marked as late data.
