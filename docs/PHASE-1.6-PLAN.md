# Phase 1.6 execution plan — connected sites and snowpack

**Status (2026-08-20): complete and expanded by later western work.** The first
connected-reservoir and snow pipeline shipped, the drought interface shipped,
and the later western expansion grew the snow inventory to 637 sites and the
reservoir roster across eleven states. Measurements below retain their
original 2026-08-10 scope.

Scoped 2026-08-10, after a measurement pass run the same day. This plan
covers the two data additions left in Phase 1.6: the reservoir sites inside
our drainage areas that we do not yet track, and snowpack. Drought context
(1.6b) stays where MODERNIZATION_PLAN.md leaves it — the service's contract is
still unverified, and nothing here depends on it.

Everything below marked *measured* came from a live probe against the real
services on 2026-08-10, not from documentation.

## Why these two together

They are the same fetch, against the same API, keyed the same way. The AWDB
REST service carries both reservoir storage (`RESC`) and snow water equivalent
(`WTEQ`) on identical station triplets, with no key, and both are assigned to a
drainage area by point-in-polygon against the boundaries already committed in
`huc6.geojson`. Snowpack does not need a new provider, a new geography or a new
identifier scheme — it needs a second element code and a rollup.

They also answer each other. The four drainage areas that hold no tracked
reservoir are the ones a reader currently sees as empty; between them the
inventory pass finds 18 reservoir stations and the snowpack pass finds 60
SNOTEL sites. The empty areas were never empty. We had only ever looked at
Utah's own inventory.

## Part A — the connected sites

### What the audit returns today

`python tools/audit_awdb_stations.py` (measured, 2026-08-10):

> 347 active storage stations returned. 53 already tracked, 261 outside our
> drainage areas, **33 candidates**.

**The count and the composition have both moved since MODERNIZATION_PLAN.md
recorded 34.** Read that section as history, not as the current list. Today:

| State | Candidates |
|---|---|
| Colorado | 17 |
| Utah | 10 |
| Wyoming | 4 |
| Idaho | 1 |
| Arizona | 1 |

So this is **not** "add 34 Colorado and Wyoming sites": 21 of the 33 are in
those two states, ten are Utah sites our own inventory list never carried, and
three areas that the earlier table did not mention (Upper Bear, Lower Bear,
Great Salt Lake) now return one candidate each. Re-run the audit before
acting on any list, including this one.

### What each candidate actually has — measured

A probe pulled `RESC` for all 33 triplets, daily and monthly, from 2015, and
matched each name against the hosted National Inventory of Dams layer that
`tools/build_capacity_table.py` already uses.

| | Count |
|---|---|
| Returned a storage series | **32 of 33** |
| Daily series | 18 |
| Monthly only | 14 |
| Found a name-matched capacity in the inventory | 21 |
| **Would be admitted today, unchanged rules** | **10** |
| Capacity-admissible with position-first matching (measured, below) | **31** |
| Rejected by the "capacity below observed storage" check | 11 |
| No inventory name match at all | 12 |

The ten that pass cleanly by name: Dillon, Green Mountain, Lake Granby, Ruedi,
Shadow Mountain, Willow Creek, Groundhog, Browns Draw, Whitney, Gunnison Bend —
and one of those ten, Willow Creek, passes onto the *wrong dam*. See below.

**One candidate has no storage series at all.** `Great Salt Lake Rise`
(`09UTGSLR:UT:BOR`) returns nothing for `RESC` in either duration. It is a
lake-elevation station, not a storage station, and the audit also flags it as
the single case where the station's own `huc` disagrees with our
point-in-polygon assignment. Drop it from the candidate list and record why;
32 candidates, not 33.

### The real bottleneck is the capacity rule, not the capacity data

Eleven candidates are rejected because the inventory's normal (conservation)
pool sits below the storage we have actually observed. Those eleven are not
one kind of problem — they are two, and the current rule cannot tell them
apart:

| Candidate | Inventory | Observed max | Gap |
|---|---|---|---|
| Mcphee | 381,000 | 382,522 | 0.4% |
| DMAD | 7,735 | 7,822 | 1.1% |
| Huntington | 5,616 | 5,703 | 1.5% |
| Yamcolo | 9,621 | 9,825 | 2.1% |
| Vega | 32,980 | 33,807 | 2.5% |
| Viva Naughton | 42,200 | 45,139 | 7.0% |
| High Savery | 22,433 | 23,685 | 5.6% |
| Big Sandy | 39,700 | 51,963 | 31% |
| Trout Lake | 198 | 4,180 | 21× |
| Rocky Ford | 211 | 1,854 | 8.8× |
| Lake Mead | 132 | 11,610,000 | 88,000× |

The bottom three are the failure the check was written for: a name collision
attaching some other dam's numbers to ours — "Mead" is a small dam somewhere,
not Hoover. The top group is a different thing entirely: reservoirs operated a
few percent above conservation pool, which is exactly the case
[Fontenelle](../MODERNIZATION_PLAN.md) was admitted under by hand after a human
confirmed the dam by NID id, name and coordinates.

**Proposed rule change, to be recorded as an ADR before any site lands:**

1. Match on **coordinates first, name second**. Accept an inventory row whose
   dam point is close to the station's published point.
2. Once identity is confirmed by position, compare observed storage against
   the inventory's **maximum** pool, not the normal pool, and reject only when
   observed storage exceeds even that.
3. Keep dividing by the normal pool where there is one. ADR-003's reason for
   preferring it over the flood-surcharge figure is unchanged, and
   `capacity_basis` already records `max_storage` for the rows that have no
   normal figure — this widens the *identity* check, not the denominator.
4. Record the confirmation evidence per row: dam name, NID id, distance.

### The wider probe — measured 2026-08-10

Both halves of the proposal were run against the live inventory: 5,145 dams
with coordinates across Colorado, Wyoming, Utah, Arizona and Idaho, matched to
the 33 candidates by position.

| | Name matching (today) | Position first (proposed) |
|---|---|---|
| Found a capacity at all | 21 | **32 of 32 with a series** |
| Admitted under the existing storage check | 10 | **16** |
| Additionally admitted by the maximum-pool check | — | **13** |
| **Total admissible** | **10** | **31** |
| Rejected | 11 | 2 |

**Position matching is the larger half of the fix, and not for the reason the
plan assumed.** Twelve candidates that no name matched are matched instantly
by position — the inventory calls them `Homestake Project`, `Williams Fork
Main`, `Ritschard` (for Wolford Mountain), `Elkhead Creek`, `Pacificorp -
Electric Lake`, `Ivins Bench`, `Montpelier Creek`, `Rocky Ford (Sevier)`.
Every one is 0.02–1.4 km from its station.

**And name matching was not merely missing rows — it was picking wrong ones.**
Four candidates get a different dam from each method, and in every case the
name is the wrong one:

| Candidate | By name | By position | Observed max |
|---|---|---|---|
| Willow Creek | 28,668 | 10,553 (`Willow Creek Bor CO Dam`) | 8,612 |
| Trout Lake | 198 | 2,500 | 4,180 |
| Rocky Ford | 211 | 1,700 (`Rocky Ford (Sevier)`) | 1,854 |
| Lake Mead | 132 | — (nearest dam 88 km away) | 11,610,000 |

Three of those four are absurd enough that the observed-storage check catches
them. **Willow Creek is the one that matters:** 28,668 acre-feet is a
plausible number, it passes every check we have, and it is the wrong
reservoir. The site would have published as 30% full when it is 82% full. That
is the failure mode the current check cannot see, and it is an argument for
position-first matching independent of how many extra sites it admits.

**The distance threshold has to know which provider published the point.**
Calibrated against the 29 reservoirs whose dam match is already confirmed by
NID id: the distance from the published point to its own dam runs 0.01 km
(Trial Lake) to **20.87 km** (Lake Powell), median 1.08 km. The long tail is
entirely large reservoirs whose RISE coordinate sits mid-lake — Flaming Gorge
14.5 km, Huntington North 13.5 km, Strawberry 9.6 km. A flat 5 km rule would
reject five matches known to be right.

AWDB station points do not behave that way: they are gauge locations at the
dam or outlet, and **31 of the 32 candidates match within 1.4 km**. So the
rule is per-provider — a tight radius for AWDB stations, and the existing
name-plus-review path for RISE, whose points describe the lake rather than the
dam. Write that down; it is the kind of convention that gets "simplified" into
one constant later.

**The rule is now written and tested** — `admission.py`, with
[ADR-015](decisions/ADR-015-confirm-a-dam-by-position-before-name.md) recording
why, and `tools/audit_candidate_capacity.py` applying it to the live services.
Running it finds **31 of the 33 candidates capacity-admissible**. Publication
still depends on the scope and cadence decisions below. Two fail the capacity
gate, and each is a different question:

- **Trout Lake** — 4,180 acre-feet observed against a 3,200 maximum pool, 30%
  over. Either the series includes water the dam does not hold, or it is still
  the wrong Trout Lake. Do not admit it on a tolerance; look at it.
- **Great Salt Lake Rise** — no storage series in either duration. It measures
  water level, not stored volume. Drop it from the candidate list.

Two things the run corrected on the way:

- **Lake Mead is matchable after all.** The first probe searched five states
  and refused it, because Hoover Dam is in Nevada. With Nevada in the search
  it matches at 0.37 km and 28,255,000 acre-feet. The refusal was right for
  the wrong reason. Whether to publish it is the scope question below.
- **`Sevier Bridge Reservoir` is Yuba, which we already publish.** The station
  identifier says so; the name does not. Candidate discovery now excludes by
  station identifier first, and the two audit tools share one definition of
  "candidate" so they cannot disagree.

### Scope questions that are decisions, not data

These need answering before the numbers move, because each changes what a
published total means:

- **Lake Mead.** 7.05 million acre-feet today, 11.6 million observed maximum.
  It is inside 150100 Lower Colorado-Lake Mead, which touches Utah, so
  ADR-009/ADR-010 admit it — and adding it would do to the connected total
  exactly what Lake Powell does to the Utah total. The honest answer is
  probably the same one: a separate dimension, the way
  [ADR-011](decisions/ADR-011-separate-location-scope-from-lake-powell.md)
  separates Lake Powell, rather than a silent inclusion or a quiet exclusion.
  It also needs a `Hoover` alias in the capacity table, like
  `Lake Powell → Glen Canyon`.
- **Monthly-only sites.** Fourteen of the candidates publish monthly values
  only. The pipeline already handles this (`AWDB_MONTHLY_STALE_AFTER_DAYS`,
  and the "Monthly data: 23" line the freshness text already carries), but
  going from 23 to 37 monthly sites out of ~85 changes how much of the map is
  a month old. The map already marks late data; the summary should say what
  share of the total is monthly.
- **Series that stopped.** Groundhog's daily series ends in 2018; Elkhead,
  Stagecoach and Narraguinnep end 2025-10-31 with monthly continuing. Decide
  once whether "daily station that went quiet, monthly still current" is
  admitted as a monthly site or excluded, and apply it mechanically.
- **The out-of-state framing.** Ten of these are Utah sites, but 22 are not,
  and the page currently says "Utah waterbodies". Once the connected sites
  land, the scope control from P2.1 (`geography: "utah" | "connected"`) stops
  being a code path with one interesting value.

### How to land it

- One reviewable change, with before-and-after totals stated, not one site at
  a time. Every addition moves the published statewide numbers.
- The candidate list is generated by the tool, never hand-typed into
  `refresh_reservoirs.py`'s dictionaries. If the audit and the tracked list
  disagree, that is a test failure.
- `tests/test_refresh.py` and `tests/test_huc.py` cover the arithmetic; add
  the admission rule itself as a tested function rather than as tool prose.

## Part B — snowpack

### What is actually available — measured

| Question | Answer (2026-08-10) |
|---|---|
| Stations carrying `WTEQ`, active | 2,175 nationally |
| Of those, automated SNOTEL (`SNTL`) | 883 on 2026-08-14 |
| **SNOTEL inside our fourteen drainage areas** | **217, using full-resolution boundaries** |
| Areas with at least four | all fourteen |
| Elements available daily per station | `WTEQ`, `SNWD`, `PREC` |
| Cost of one call for all 217 stations, one day | ~9 s, one URL of 4 KB |
| Cost of one station, full water year, three elements | ~0.6 s |

Per area: Escalante Desert-Sevier Lake 33, Colorado Headwaters 31, Lower Green
24, Upper Green 21, Jordan 19, Lower Bear 16, White-Yampa 16, Weber 16, Upper
Colorado-Dolores 10, Lower Colorado-Lake Mead 10, Upper Colorado-Dirty Devil 7,
Great Salt Lake 6, Lower San Juan 4, Upper Bear 4.

**Use `SNTL` only, and say so.** The 2,175 figure in MODERNIZATION_PLAN.md
counts snow courses (`SNOW`, 1,128 of them) that are read manually a few times
a winter. Mixing them into a daily series would produce a line that jumps
whenever somebody walked a course.

### The API contract, measured rather than assumed

`GET https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data`

| Parameter | Note |
|---|---|
| `stationTriplets` | Comma-separated. **`stationTriples` is rejected with 400** — unlike `stateCds` on `/stations`, this endpoint validates its parameter names. |
| `elements` | `WTEQ`, `SNWD`, `PREC` |
| `duration` | `DAILY`, `HOURLY`, `SEMIMONTHLY`, `MONTHLY`, `CALENDAR_YEAR`, `WATER_YEAR` |
| `centralTendencyType` | `NONE` (default), `ALL`, `MEDIAN`, `AVERAGE`. `NORMAL` is rejected with 400. |
| `returnFlags`, `returnOriginalValues`, `returnSuspectData` | Booleans, default false |

**The median comes from the API.** With `centralTendencyType=MEDIAN`, each
value carries both `value` and `median` for that day of year, and the series
additionally carries `timingCentralTendencies`: median peak date and value,
median onset, median meltout. Measured for Agua Canyon (`907:UT:SNTL`),
2026-03-01: value 2.0 in against a median of 7.3 in, median peak 9.0 in on
March 12.

That is worth having for its own sake: "the snow peaked at 9 inches around
March 12 in a normal year" is a sentence a reader understands, and it is
published rather than derived.

**The comparison period is resolved.** The Natural Resources Conservation
Service identifies the current official normals as 1991–2020 medians, updated
once per decade. The response does not repeat the years, so `snow_sites.json`
records them beside the source URL and `snowpack.json` carries them forward.
The page must say what the comparison is against, per ADR-006.

`tools/build_snotel_inventory.py` makes the full-resolution station query and
point-in-polygon counts reproducible. `refresh_snowpack.py` asserts complete
station coverage, retries a missing site on its own, writes the area rollups,
and has network-free fixtures for the short-response case.

**One inconsistency to handle, not ignore:** a batch request for 216 triplets
returned 215 series. Requesting *n* stations and receiving *n−1* has to be an
assertion, not a silent shortfall — the same class of failure as the ignored
`stateCds` filter.

### Design

- **Roll up by drainage area, not by state.** The page already groups by
  six-digit unit; snowpack joins the structure that exists. Assign each
  station by point-in-polygon, exactly as reservoirs are assigned.
- **A unit's value is the mean of its stations' percent-of-median**, not the
  mean of their inches. Stations sit at very different elevations, and
  averaging inches across them produces a number that means nothing and moves
  when a high station drops out. Require a minimum station count and publish
  the count beside the value.
- **Show the seasonal series, never a bare current number.** Snow water
  equivalent in August is zero everywhere and says nothing. The default view
  is the water year to date against the median for the same days, and the
  wording says which part of the year it describes.
- **The same staleness treatment the reservoirs get.** Daily element, daily
  expectation, and a station that stops reporting is marked late rather than
  dropped.
- **A separate published file, `snowpack.json`,** written by the same morning
  workflow and fetched at runtime like the others (ADR-002). Not merged into
  `reservoirs.json`: the two have different shapes, different failure modes,
  and a snowpack fetch failure must not be able to stop the storage refresh.

### Vocabulary

The dashboard is written in Simplified Technical English (ADR-006), and this
addition brings a fresh crop of terms a reader has not agreed to learn:

- "snow water equivalent" → **"water held in the snow"**, with the acre-feet
  and inches both explained in the terms section.
- "SNOTEL", "SNTL", "WTEQ", "median peak SWE" → never visible.
- "percent of median" → **"share of the usual amount for this date"**, and the
  period that "usual" covers has to be named once the open question above is
  answered.
- The existing rule stands: no `af`, no `RISE`, no `AWDB` anywhere a reader
  can see, including labels and live region messages.

## APIs needed

| Service | Used for | Key | Status |
|---|---|---|---|
| AWDB REST `/stations` | Station inventory, coordinates, HUC, network code | none | In use. `stateCds` is ignored — filter in the client and assert counts. |
| AWDB REST `/data` | `RESC` storage, `WTEQ`/`SNWD`/`PREC` snowpack, and the published median | none | In use for storage. Parameter contract measured above. |
| AWDB REST `/reference-data` | Element definitions and units, for the terms section | none | Not yet used. Worth one call to source the wording rather than inventing it. |
| RISE (`data.usbr.gov`) | Reclamation daily storage | none | In use. Publishes no capacity. |
| National Inventory of Dams, via the hosted AGOL layer | Capacity, and the dam identity check | none | In use. The name-matching weakness described in Part A is the main work here. |
| U.S. Drought Monitor | 1.6b context | none | **Unverified.** Its HUC endpoint answered 200 with zero rows for every level tried. Do not plan on it until a spike returns rows. |
| Colorado CDSS, Wyoming SEO | Alternative storage for the CO/WY sites | varies | **Not needed.** AWDB already covers 105 storage stations in those two states on identifiers this project handles. Only worth taking on if Part A leaves a gap that matters. |

No new provider, no key, and no new geography is required for either part.

## Sequence

1. **Fix the admission rule** (coordinate-first matching, maximum-pool
   identity check), with the rule as a tested function and an ADR recording
   why the check widened. Nothing is published in this step. The probe that
   measured it belongs in `tools/` alongside the other audits, so the
   appendix below can be regenerated rather than trusted.
2. **Resolve the three rejects and the two boundary cases by hand** — Trout
   Lake's 30% overshoot, Stagecoach's 35 acre-feet, Big Sandy's 31%, and the
   two sites whose daily series stopped — and record each decision the way
   Fontenelle's was recorded.
3. **Decide Lake Mead** (and, with it, whether "connected" needs the same
   two-dimension treatment Lake Powell has).
4. **Land the sites in one change**, before-and-after totals stated.
5. **Snowpack fetch and `snowpack.json`** — complete. The 1991–2020 period is
   recorded and a station-count shortfall stops publication.
6. **Snowpack in the page**, seasonal series by drainage area, in the shell
   that Phase 2 built.

Steps 1–4 change published numbers and belong together. Steps 5–6 add a file
and a panel and change no existing number, so they can land independently — and
should, because a snowpack bug must never be able to freeze the storage
refresh.


## Appendix — the measured candidate list, 2026-08-10

Produced by `python tools/audit_candidate_capacity.py`, which applies the
rules in `admission.py` (ADR-015). Capacity is the conservation pool where the
inventory publishes one. `km` is the distance from the station to its matched
dam. Regenerate rather than trust: the station list and the inventory both
move, and the observed maxima grow.

| Candidate | State | Area | Dam matched | km | Confirmed by | Capacity | Observed max |
|---|---|---|---|---|---|---|---|
| Lake Mead | AZ | 150100 | Hoover Dam | 0.37 | position | 28,255,000 | 11,610,000 |
| Lake Granby | CO | 140100 | Granby Dam | 3.85 | name and position | 539,760 | 462,672 |
| Mcphee Reservoir | CO | 140300 | Mcphee Dam | 0.11 | name and position | 381,000 | 382,522 |
| Dillon Reservoir | CO | 140100 | Dillon | 0.37 | name and position | 254,000 | 253,000 |
| Green Mountain Reservoir | CO | 140100 | Green Mountain Dam | 0.13 | name and position | 153,640 | 146,377 |
| Ruedi Reservoir | CO | 140100 | Ruedi Dam | 0.15 | name and position | 102,373 | 102,061 |
| Williams Fork Reservoir | CO | 140100 | Williams Fork Main | 0.04 | position | 96,800 | 96,700 |
| Wolford Mountain Reservoir | CO | 140100 | Ritschard | 0.04 | position | 65,985 | 67,560 |
| Homestake Reservoir | CO | 140100 | Homestake Project | 0.07 | position | 42,900 | 42,884 |
| Viva Naughton Res | WY | 140401 | Viva Naughton | 0.72 | name and position | 42,200 | 45,139 |
| Big Sandy | WY | 140401 | Big Sandy Dam | 0.12 | name and position | 39,700 | 51,963 |
| Stagecoach Reservoir nr Oak Creek | CO | 140500 | Stagecoach | 0.18 | position | 36,439 | 36,474 |
| Vega Reservoir | CO | 140100 | Vega Dam | 0.11 | name and position | 32,980 | 33,807 |
| Electric Lake | UT | 140600 | Pacificorp - Electric Lake | 0.60 | position | 31,500 | 30,651 |
| Groundhog Reservoir | CO | 140300 | Groundhog | 0.08 | name and position | 26,640 | 25,925 |
| Elkhead Reservoir | CO | 140500 | Elkhead Creek | 0.32 | position | 24,778 | 25,363 |
| High Savery Reservoir | WY | 140500 | High Savery | 0.13 | name and position | 22,433 | 23,685 |
| Narraguinnep Reservoir | CO | 140802 | Narraguinnep - Dam 2 | 0.33 | position | 18,960 | 19,018 |
| Shadow Mountain Reservoir | CO | 140100 | Shadow Mountain Dam | 0.34 | name and position | 18,369 | 17,666 |
| Eden | WY | 140401 | Eden Dike 1 | 0.04 | position | 14,421 | 1,500 |
| Willow Creek Reservoir | CO | 140100 | Willow Creek Bor CO Dam | 0.05 | position | 10,553 | 8,612 |
| Yamcolo Reservoir | CO | 140500 | Yamcolo | 0.06 | name and position | 9,621 | 9,825 |
| DMAD | UT | 160300 | Dmad | 0.15 | name and position | 7,735 | 7,822 |
| Browns Draw | UT | 140600 | Browns Draw | 0.17 | name and position | 5,901 | 5,737 |
| Huntington | UT | 140600 | Huntington | 0.18 | name and position | 5,616 | 5,703 |
| Kolob Reservoir | UT | 150100 | Kolob Creek | 1.05 | position | 5,586 | 5,728 |
| Gunnison Bend | UT | 160300 | Gunnison Bend | 1.38 | name and position | 5,000 | 4,024 |
| Whitney | UT | 160101 | Whitney | 0.25 | name and position | 4,700 | 3,419 |
| Montpelier Reservoir | ID | 160102 | Montpelier Creek | 0.08 | position | 4,050 | 4,050 |
| Rocky Ford | UT | 160300 | Rocky Ford (Sevier) | 0.21 | position | 1,700 | 1,854 |
| Ivins | UT | 150100 | Ivins Bench | 0.02 | position | 778 | 732 |
| Trout Lake Reservoir | CO | 140300 | Trout Lake | 0.39 | — | — | **refused: holds more water than the dam can contain (4,180 acre-feet seen)** |
| Great Salt Lake Rise | UT | 160203 | — | — | — | — | **refused: no storage series** |

## What this plan does not do

- It does not add a state-agency provider.
- It does not touch the storage, capacity, normal-value or late-data formulas
  for reservoirs already published.
- It does not decide the drought-context question, which stays blocked on a
  spike.
