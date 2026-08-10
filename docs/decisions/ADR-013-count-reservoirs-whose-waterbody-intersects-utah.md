# ADR-013: Count reservoirs whose waterbody intersects Utah

## Status

Accepted. Supersedes
[ADR-011](ADR-011-separate-location-scope-from-lake-powell.md).

## Date

2026-08-10

## Context

ADR-011 made geography and Lake Powell inclusion independent, but defined the
Utah scope from `in_utah`, a point-in-state test on each provider's published
reservoir coordinate. A point is sufficient to assign one drainage area, but
it is not sufficient to classify a waterbody that crosses a state boundary.

The error is visible in the current payload. Bear Lake's point is in Idaho and
Meeks Cabin Reservoir's point is in Wyoming, so both are excluded from the
Utah rollup. Their water surfaces extend into Utah.

The four published records whose points are outside Utah were checked against
the U.S. Geological Survey NHDPlus High Resolution `NHDWaterbody` layer:

| Reservoir | USGS permanent identifier | Latitude extent | Intersects Utah |
|---|---:|---:|---|
| Bear Lake | `120026431` | 41.846–42.123° N | Yes; crosses the 42° Idaho border |
| Meeks Cabin Reservoir | `120025290` | 40.987–41.028° N | Yes; crosses the 41° Wyoming border |
| Woodruff Narrows Reservoir | `46882399` | 41.446–41.505° N | No |
| Fontenelle Reservoir | `120028307` | 42.026–42.177° N | No |

USGS also describes Bear Lake as straddling the Utah–Idaho border. The source
layer is the official national waterbody dataset:

- <https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/9>
- <https://www.usgs.gov/centers/utah-water-science-center/science/bear-lake-water-quality>

Upper Snake HUC6 (`170402`) remains excluded under ADR-010. It is not present
in `huc6.geojson`, and this reservoir-location correction does not change the
drainage-area rule.

## Decision

Add `intersects_utah` to every published reservoir record. It answers one
question only: does the reservoir's waterbody intersect Utah?

- A published reservoir point inside Utah proves the waterbody intersects the
  state.
- A point outside Utah requires a reviewed waterbody polygon. Bear Lake and
  Meeks Cabin Reservoir are the current reviewed cross-border exceptions.
- `in_utah` remains the point-location fact for compatibility and provenance.
- `huc6` continues to be assigned by the dam or outlet point.
- The Phase 2 `utah` rollup uses `intersects_utah`, not `in_utah`.
- Lake Powell inclusion remains an independent choice.

The daily refresh does not query NHDPlus. Cross-border classifications change
far less often than storage readings, so the reviewed names and permanent
waterbody identifiers are versioned with the pipeline and guarded by tests.

## Alternatives Considered

### Redefine `in_utah`

- Pros: no additional payload field.
- Rejected: it would silently change an existing field from a point-location
  fact to a polygon-intersection fact. Keeping both makes the two scientific
  claims inspectable.

### Use the dam or outlet point for the Utah count

- Pros: one point owns both location and drainage assignment.
- Rejected: Glen Canyon Dam is in Arizona, and Bear Lake's outlet is in Idaho.
  An outlet is the correct hydrologic assignment point but the wrong model for
  the footprint of stored water.

### Query the national waterbody service during every daily refresh

- Pros: classifications could update without a code change.
- Rejected: reservoir footprints do not need daily updates, and a remote
  geometry outage must not block publication of current storage readings.

## Consequences

- The current Utah scope increases from 50 to 52 reservoirs by adding Bear
  Lake and Meeks Cabin Reservoir.
- The default Phase 2 headline, which excludes Lake Powell, increases from 49
  to 51 reservoirs.
- Connected totals and all HUC assignments are unchanged.
- New cross-border reservoirs require a polygon review and a versioned
  classification before publication.
