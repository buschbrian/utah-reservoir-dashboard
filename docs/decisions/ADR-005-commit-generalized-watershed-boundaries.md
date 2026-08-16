# ADR-005: Commit one generalized watershed boundary file

## Status

Superseded by ADR-037

## Date

2026-08-09

## Context

Every reservoir now carries the six-digit hydrologic unit its water drains
through. That needs boundary polygons, and there were three open questions:
fetch them live or commit them; at what precision; and one file or two.

The map pages already queried the USGS Watershed Boundary Dataset live on every
page load, which is fine for a background outline and wrong for an assignment
source: which basin a reservoir belongs to must be reproducible, and it cannot
be if the polygons can change between two runs.

The initial guess was **two files** — full precision for the point-in-polygon
assignment, generalized for the map. That guess was recorded and then tested
rather than acted on.

`tools/probe_huc_points.py` measured the thing the guess was missing: **no
tracked reservoir sits closer than 2.72 km to a unit boundary** (median 14.04
km; closest is Lost Lake). So the assignment does not need metre-accurate
boundaries — it needs boundaries accurate to well under a kilometre, which is a
completely different requirement.

Verified directly rather than argued, by re-running all 53 assignments against
each candidate:

| Boundaries | Size | Vertices | Assignments that move |
|---|---|---|---|
| `geometryPrecision=5`, ungeneralized | 718 KiB | 33,646 | — |
| `maxAllowableOffset=0.001` (~100 m) | 601 KiB | 28,155 | 0 |
| **`maxAllowableOffset=0.005` (~500 m)** | **146 KiB** | **6,764** | **0** |
| `maxAllowableOffset=0.01` (~1 km) | 75 KiB | 3,414 | 0 |

## Decision

Commit **one** file, `huc6.geojson`, generalized to roughly 500 m, written by
`scripts/fetch-huc6.mjs`. It serves both the assignment and the map.

## Alternatives Considered

### Two files, full precision and generalized

- Rejected on measurement. It solves a problem that does not exist: 500 m is
  five times finer than the closest call anyone has to make, and it produces
  identical assignments for all 53 reservoirs.

### One file at ~1 km (75 KiB)

- Pros: half the size again, and it also moves no assignment today.
- Rejected on margin. At ~1 km the generalization error is the same order as
  the 2.72 km closest approach, so one reservoir added near a divide could
  quietly flip basins. 146 KiB buys a real margin for 71 KiB.

### Keep querying the USGS service at runtime

- Pros: nothing to commit, always current.
- Cons: not reproducible, and it makes a page's correctness depend on a third
  party being up.
- Rejected for the assignment. Same argument as ADR-003's committed capacities.

## Consequences

- `scripts/fetch-huc6.mjs` **fails rather than writing** if the service stops
  returning exactly 15 units that touch Utah. The `states` filter and the
  layer numbering are both things that can change without notice.
- `tests/test_huc.py` pins the result against the committed files with no
  network: the 15 units by code and name, every reservoir in *exactly* one unit
  (units tile without overlapping, so two matches means the data is wrong), ten
  hand-checkable assignments, and **the 2 km margin the generalization was
  chosen against** — if a future reservoir lands inside it, the test fails and
  says the decision needs re-measuring.
- The file is copied into the published output like the other runtime data
  (ADR-002), so the pages can stop querying the service on every load.
- Assignment is by the **dam or outlet point** — where the stored water leaves
  — not the middle of the reservoir, because a large reservoir can span a
  boundary. The published coordinates are lake points, a median of 1.08 km from
  their dam (worst: Lake Powell at 20.87 km), and switching to dam points moves
  **no** assignment. So dam points are a provenance improvement, tracked in
  `huc_assignment_source`, not a correction.
- `in_utah` is computed from the **reservoir's** point, never the assignment
  point. Glen Canyon Dam is in Arizona while Lake Powell reaches well into
  Utah; conflating the two would drop the largest reservoir on the dashboard
  out of its own default view.
