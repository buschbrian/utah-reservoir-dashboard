# The Colorado review: what the state's own network could add

> **Historical implementation journal.** It records a slice of work as it
> was, and is not a description of current architecture — that is
> [`docs/architecture/`](architecture/README.md). See
> [`docs/history/README.md`](history/README.md).

Measured and delivered 2026-08-21. This is R3's second non-federal source,
following the California admission recorded in
[`CDSS-CDEC-API-REVIEW.md`](CDSS-CDEC-API-REVIEW.md). Every figure came from a
live query against `dwr.state.co.us` or from the audit run of that morning.

## The headline: 119 candidates were never candidates

The API review projected **119 new reservoirs** for about 2% more stored
water, and recommended Colorado as "a coverage-of-places gain". That count
was matched by position against published points and never scoped to the
drawn drainages.

The drawn scope is regions 14–18 (ADR-053): everything draining to the
Pacific plus the Great Basin. Colorado's telemetry network covers the whole
state, and most of the state drains east — the South Platte and Arkansas to
the Missouri, the Rio Grande to the Gulf. Measured against the 75 drawn
areas:

| | |
|---|---:|
| station records carrying STORAGE | 146 |
| distinct storage stations | 142 |
| recharge ponds (not reservoirs) | 13 |
| reservoir systems (no one denominator) | 1 |
| quiet past a year (Gross, Brush Hollow, Steamboat Lake) | 3 |
| already tracked by position, reviewed dam point or name | 21 |
| **outside the drawn drainages** | **91** |
| **candidates** | **13** |

So Colorado's addition is **ten published reservoirs** — real ones, in five
drainage areas from the Headwaters to the Upper San Juan — not a hundred and
nineteen. The eastern-slope network is genuine coverage this site does not
carry, and it stays exactly where it was: reachable only if the *drawn scope*
ever expands to the Missouri basin, which is a geography decision and not an
admission one. The coverage table's Colorado row now says so with a number.

One candidate was refused before review: Garnet Mesa Reservoir has no usable
daily history since 2015 at all — its station began reporting days ago, and
a reservoir with no observed maximum cannot be screened against a dam.
Recorded in the withheld block, to be re-audited when it has a season.

## What the screens caught

Twelve candidates carried a history; ten passed every screen untouched and
two were held:

- **Ivanhoe Lake** — matched to Ivanhoe Dam (CO00682) at 0.146 km by name and
  position, so the match itself is certain. Held because the water has stood
  at 1,271 acre-feet against the largest figure the same inventory record
  holds (1,155), a tenth above the ceiling that exists to catch wrong dams.
  At this distance it is surcharge above every published pool — the Lake
  Mohave case, which stayed out too.
- **Trout Lake** — the same refusal AWDB's station on the same reservoir drew
  in the western pool (+31% over its record's largest pool). Two providers
  agreeing about a refusal is the refusal getting stronger, not weaker.

No waiver was granted: nothing on the roster arrived over a screen.

## One denominator correction the run forced

`admit()` records the plain preference (conservation pool first). ADR-072
later added a condition: **the denominator must be a figure the water has not
been seen above**, and `denominator_for` implements it. Alsbury Reservoir is
where the gap between those two mattered: its record offers 181 acre-feet
(conservation) and 429 (maximum), and has stood at 226. Dividing by the plain
preference publishes "125% full" as an ordinary state while the same record
holds a figure that contains the water.

So the Colorado audit chooses denominators with `denominator_for`, and the
disagreement screens measure against the figure actually chosen — which is
why Alsbury is publishable rather than held. No existing roster entry moved:
the other three providers either publish their own full level or had already
been through `build_capacity_table.py`, which has applied the rule since
ADR-072.

## What this provider costs to read

Two measured operating facts, both now written down beside the code:

- **A station or window with no rows answers HTTP 404** carrying a text body
  ("returns zero records"). `_get_cdss_json` treats that shape as an empty
  series and any other 404 as a failure.
- **The service publishes its own quota**: 1,000 requests and 600,000 rows a
  day, resetting at midnight Mountain, on `x-rate-*` headers. A full-history
  daily refresh of the Colorado roster is about 400,000 rows — two thirds of
  the anonymous quota, spent every morning. Nothing else (audit, normals
  build) may share that day's quota once Colorado is on the refresh. There is
  no monthly endpoint to thin it with; if the quota ever tightens, the answer
  is a bounded fetch window, and that is a deliberate change because it would
  move `record_max_af` for these records.

## Delivered in the change

The fourth provider (`SourceKey` `cdss`, agency name "Colorado Division of
Water Resources"), the adapter, the roster file with its withheld block, the
refresh wiring, normals for six of the ten (their periods of record are young;
the site says how many years each comparison holds), county assignments, the
coverage-table correction for both Colorado and California — whose row still
claimed the site does not read what it has published since 2026-08-20 — and
one payload defect the runtime validator caught before a reader could: a
reservoir too young to hold either comparison published `default: "recent"`
naming an empty period, and `summarize` now omits the baselines block
entirely instead.
