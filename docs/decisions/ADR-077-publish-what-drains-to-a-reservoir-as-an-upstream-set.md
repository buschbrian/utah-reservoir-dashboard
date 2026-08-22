# ADR-077: Publish what drains to a reservoir, as an unordered upstream set

- Status: Accepted
- Date: 2026-08-22

## Context

The site says, in words on the drought page, that a reservoir collects its
water from land far upstream. It could not show it. Drainage-area codes nest —
140100 sits inside 14 — and nesting is containment, not flow: nothing in a
HUC code says which of two adjacent basins drains into the other, so every
regrouping this project does is silent about where the water goes.

The USGS Network-Linked Data Index (NLDI) models the river network itself,
needs no key, and answers anonymous requests. Measured against real roster
dam points, the contributing basin above Lake Powell — most of the Upper
Colorado, about 108,000 square miles — is a 94 KB gzipped polygon fetched in
half a second. The full trace of all 375 published reservoirs runs in about
twenty minutes and was validated before this record was written: Flaming Gorge
inside Powell's set, Fontenelle inside Flaming Gorge's, Blue Mesa on the
Gunnison above Powell, and Lake Mead and Lake Mohave containing all of them.
375 traced, none screened, none flagged.

## Decision

**The trace is precomputed and committed; the browser never asks NLDI.** This
is ADR-048's rule reaching a third geography: geometry is the tool's input and
stops there, an assignment that can change underneath you is not reproducible,
and 375 calls once beats 375 readers each paying for one. The committed file is
`upstream_index.json`, keyed by `source_station_id` (ADR-066), carrying per
reservoir the upstream reservoir stations, the upstream snow stations, and the
NLDI COMID the trace was taken from. It is `derived-on-demand`, rebuilt when
the roster or snow network changes — after an admission, not on a date — and
published verbatim in `dist/`: at 13.7 KB gzipped, trimming it would cost a
second generator to save less than the evidence fields are worth.

**An upstream set is containment, not flow order.** Every published reservoir
and snow site whose point falls inside the contributing area is in the set;
nothing in a polygon says Fontenelle is directly above Big Sandy. "Which
reservoirs are directly above" needs NLDI's flowline navigation and is
deliberately not attempted here. Surfaces say "upstream of" and never "feeds"
or "supplies": several reservoirs in these sets sit on transbasin diversions,
and the water they hold does not always go where the river points.

**A dam lies inside its own basin by construction, so self-inclusion is
excluded deliberately** — one line in the tool, recorded here so it can never
read as an accident of geometry.

**A trace that fails is screened, never emptied.** A point answering no
flowline (`no_flowline`), or a COMID answering no basin (`no_basin`), is
recorded with its reason rather than published as an empty set, which would
read as "nothing drains here" when the truth is "we could not trace". A basin
several times larger than any western headwater — past 300,000 square miles —
is flagged for review rather than trusted. A quota refusal ends the run with
nothing written rather than filling the index with screens that look like
findings.

## Consequences

The storage map's details panel and each reservoir page name what sits above
the reservoir they describe; the snow-page filter over an upstream set ("the
snow above this reservoir") is the natural next surface and is not built yet.
The index moves when admissions move, so `check_reference_freshness.py`
watches its date. The contributing polygon is NHDPlus's, disagrees slightly
with the WBD outlines the maps draw because they are two products at two
resolutions, and is therefore never published beside them.
