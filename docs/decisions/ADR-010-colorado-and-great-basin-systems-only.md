# ADR-010: Narrow the geography to the Colorado and Great Basin systems

## Status

Accepted. Supersedes
[ADR-009](ADR-009-geography-is-drainage-areas-that-touch-utah.md).

## Date

2026-08-10

## Context

ADR-009 set the rule as "drainage areas that intersect Utah". That rule was
right for the question it was asked — it correctly rejected Blue Mesa and
Navajo, whose basins never enter the state — but it was written before anyone
had looked at what it *admitted*.

The AWDB pass (`tools/audit_awdb_stations.py`) looked. Of 47 candidate storage
stations inside the qualifying units, **thirteen are in 170402 Upper Snake**,
and every one is an Idaho reservoir: American Falls, Island Park, Magic,
Mackay, Ririe, Salmon Falls and the rest.

Upper Snake qualifies under ADR-009 because its polygon clips Utah's northern
edge. But it drains north-west to the Snake, then the Columbia, then the
Pacific. Nothing stored in it reaches Utah, and nothing Utah does affects it.
Adding thirteen Idaho reservoirs to a dashboard called *Utah Reservoir Drought
Dashboard* would make its own title a harder claim to defend, and would change
every statewide total with water that has no relationship to the state.

The rule is right in the Colorado basin, where it captures Fontenelle and
Flaming Gorge and correctly excludes the Gunnison. It is wrong at the northern
edge, because "touches Utah" is a fact about a polygon and "matters to Utah"
is a fact about where water goes.

## Decision

A drainage area is in scope when it **touches Utah** *and* is in the
**Colorado River or Great Basin systems** — two-digit hydrologic regions 14,
15 and 16. Region 17, the Pacific Northwest, is excluded.

`scripts/fetch-huc6.mjs` applies it as
`states LIKE '%UT%' AND huc6 NOT LIKE '17%'`, and the unit count drops from 15
to **14**.

## Alternatives Considered

### Keep ADR-009 and add the thirteen Idaho reservoirs

- Pros: the rule stays a single sentence with no exceptions.
- Rejected: a consistent rule that produces an indefensible page is not a
  better rule. The dashboard would be reporting Snake River storage under a
  Utah title.

### Keep ADR-009 and exclude Upper Snake as a one-off

- Pros: smallest change.
- Rejected: a bare exception list is a rule nobody can predict. Region 17 is a
  hydrologic system, not an arbitrary omission, so naming the systems says
  *why* — and answers the next borderline case without another decision.

### Filter by "drains toward Utah" rather than by region

- Pros: the most precise statement of the actual intent.
- Rejected as unimplementable from the data at hand: it needs a flow network,
  not a polygon boundary, and the region test gives the same answer here for a
  fraction of the machinery. Revisit if a case appears that regions get wrong.

## Consequences

- **No published number changes.** Upper Snake had no tracked reservoir, so
  removing it alters no total, no assignment and no percentage. It removes an
  always-empty row from the drainage-area section and thirteen candidates from
  the pipeline of future work.
- The boundary file drops from 146 KiB to **130 KiB**, still one generalized
  file (ADR-005 stands).
- `tests/test_huc.py` pins the fourteen units by code and name, so a service
  change that re-admits Upper Snake fails a test rather than quietly adding
  Idaho to the map.
- **Bear River is unaffected and worth stating explicitly**: Upper Bear and
  Lower Bear are region 16, Great Basin. They stay, as they must — the Bear
  is Utah's water even though it loops through Idaho and Wyoming.
- The remaining 34 candidates are all in the Colorado and Great Basin systems,
  which is the inventory work Phase 1.6c describes.
