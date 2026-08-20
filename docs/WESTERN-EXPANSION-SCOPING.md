# Scoping the west, and reader-selectable hydrologic levels

**Status (2026-08-20): delivered for geography, levels, snow, drought, and the
federal roster.** The maps offer 75 basins or 44 subregions, the snow inventory
has 637 sites, and the reservoir roster now covers eleven states through the
two federal providers. Non-federal source work is separate and remains under
review.

Scoped 2026-08-18. Every figure below came from a live query or a real run on
this machine, not from documentation and not from scaling the Utah figure by a
ratio of basin counts — telemetry density is not uniform, and the Pacific
Northwest carries far more snow sites per basin than the Great Basin does.

## The two axes are independent, and one of them is already free

The question arrived as one thing and is two.

**Coverage** is which basins exist in the scope. **Level** is how finely that
same geography is divided. The registry in `watershed_scopes.py` already
models them separately, and three western scopes are registered with
`published=False` and their boundaries fetched: `west-huc4`, `west-huc6`,
`west-huc8`.

One clarification worth making first, because it changes what the work is.
The 14 basins published today are **complete basins that happen to touch
Utah** — ADR-053 scopes by where the water goes, not by longitude, and
nothing is cut at a state line. So "see the entire watershed, not just the
ones intersecting Utah" is a request for *more basins*, not for *unclipped*
ones. The basins already published are whole.

## Measured: what is actually out there

A live AWDB query across every state regions 14–18 reach (CO, UT, WY, NM, AZ,
NV, CA, OR, WA, ID, MT) returned **825 SNOTEL stations** and **342 reservoir
stations**. Assigned to each scope by the pipeline's own point-in-polygon
rule:

| scope | areas | snow sites | reservoir stations |
|---|---:|---:|---:|
| `utah-connected` (today) | 14 | 217 | 86 |
| `west-huc4` | 44 | **639** | **225** |
| `west-huc6` | 75 | **639** | **225** |
| `west-huc8` | 571 | **639** | **225** |

**The station counts are identical across all three western scopes.** They
describe the same ground at three resolutions, so the level changes how many
*areas* the stations are grouped into and not how many stations there are.

That is the central result. **Choosing a hydrologic level is free in the
expensive payloads.** It costs only in the roster and the drought coverage
rows, both of which are small. The reader-selectable level the request asks
for is the cheap half of this work.

One caveat on 225: that is the AWDB BOR network alone, and this dashboard
draws on RISE as well. Measured separately, below.

## Measured: what RISE adds

RISE publishes **280** Lake/Reservoir locations with a position, of which
**180** fall inside `west-huc6`. Matched against the AWDB stations by
position — 3 km, far tighter than the 20 km `admission.py` allows between a
dam and its reservoir, because both of these are the water itself:

| | RISE | AWDB | both | **distinct** |
|---|---:|---:|---:|---:|
| `utah-connected` (today) | 54 | 86 | 32 | **108** |
| `west-huc6` | 180 | 225 | 99 | **306** |

**RISE adds 81 reservoirs on top of AWDB's 225.** The overlap is large — 99
of them report through both networks — which is why adding the two catalogues
together would have overstated the west by nearly a third.

The union is a **candidate pool, not a roster**. Today's 108 candidates yield
68 published reservoirs, an admission rate of 63% after capacity tracing and
review. At the same rate the west yields roughly **193 published reservoirs**,
with 306 as the ceiling if everything were admitted. The western multiple is
**2.83×** on candidates.

That refines the transfer projection below: `reservoirs.json` lands near
**95 KB gzipped** at the historical admission rate, and **142 KB** at the
ceiling. Both are comfortable; the conclusion does not turn on which.

## Measured: what expansion costs over the wire

Per-record costs measured from the committed payloads, and gzip ratios
measured on the real files rather than assumed (ADR-051, ADR-052):

| payload | today | gzip ratio | per record |
|---|---|---:|---:|
| `reservoirs.json` | 340 KB raw / **41 KB gzip** | 8.2× | 3,442 B |
| `snowpack.json` | 1,170 KB raw / **99 KB gzip** | 11.9× | 5,261 B |
| `reference.json` | 21 KB raw / **5.5 KB gzip** | 3.8× | — |
| `usdm-huc6.json` | 3.4 KB raw / **0.9 KB gzip** | 3.7× | 249 B |

Projected at western coverage:

| payload | today | west | change |
|---|---:|---:|---:|
| `reservoirs.json` | 41 KB | **~95 KB** (142 KB at the ceiling) | 2.3× |
| `snowpack.json` | 99 KB | **~287 KB** | 2.9× |
| drought coverage, HUC4 | — | ~3 KB | — |
| drought coverage, HUC6 | 0.9 KB | **4.8 KB** | measured |
| drought coverage, HUC8 | — | **36 KB** | measured |

The storage map's first load goes from about 47 KB to about 113 KB gzipped.
That is still a small page. **The snow page is the real cost**, roughly
tripling to 287 KB, and it is already the heaviest thing here.

Geometry stays free. ADR-048 and ADR-049 publish the roster and not the
polygons, and outlines come from the hosted Watershed Boundary Dataset
quantized to the view. The fetched western files are large — 771 KB, 914 KB
and 2,057 KB gzipped for HUC4, HUC6 and HUC8 — and none of it reaches a
browser. `WBD_LAYER_BY_LEVEL` already maps every level to its service layer.

## Measured: what expansion costs to compute

The drought engine, run for real against the committed weekly polygons:

| scope | areas | runtime | output |
|---|---:|---:|---:|
| today | 14 | ~2 s | 3.4 KB raw |
| `west-huc6` | 75 | **8.8 s** | 18 KB raw |
| `west-huc8` | 571 | **23.8 s** | 133 KB raw |

All three are comfortable inside a daily job. Compute is not the constraint,
which is worth saying because it looked like it would be.

## The one thing that does not scale

`usdm-huc6-history.json` is capped at 520 weeks — ten years — and grows with
the number of areas. At roughly 100 bytes per area-week:

| level | areas | archive at the 520-week cap |
|---|---:|---:|
| today | 14 | ~0.7 MB raw |
| `west-huc6` | 75 | ~3.9 MB raw |
| `west-huc8` | 571 | **~30 MB raw** |

Thirty megabytes is not a file this project should publish, and the cap is
what bounds it rather than anything about the data. Note that nothing fetches
this to draw a week-over-week change — the current coverage file carries its
own previous week for exactly that reason — so the archive serves series work
only.

**Recommendation: publish coverage at every offered level, and the archive at
one.** HUC6 is the natural home for it. A reader choosing HUC8 still gets
this week and last week, because those travel in the coverage file.

## Step 1 delivered, 2026-08-18

`west-huc6` is published and drawn: 75 basins, ADR-063. What the measurements
above got right and wrong, against the run:

| | projected | measured |
|---|---:|---:|
| drought coverage file | 4.8 KB gzip | **2.9 KB** |
| drought engine runtime | 8.8 s | **10.3 s** |
| `reference.json` | -- | 5.5 KB to **6.7 KB** gzip |
| hosted outlines, storage map | -- | 42.5 KB to **210.6 KB** |
| hosted outlines, drought map | -- | 60.4 KB to **241.2 KB** |

**The payload projections held; the one that was never made is the one that
moved.** Both committed files grew about as expected and by trivial amounts.
The cost of the expansion is not in this project's own files at all -- it is
the hosted outlines, where five times the areas cost the storage map 168 KB
more and the drought map 181 KB more on first load. That is the arrangement
working as designed (quantized to the view, never committed), but it is the
figure to watch, and `docs/data-transfer.md` now carries it.

**Two things the scoping did not predict.** The western file had been fetched
at 100 metres and publishing it made it the measurement geometry, which moved
two published drought figures by a rounding step until it was refetched at 56.
And 21 of the 75 basins cross a border, so the `measured` block ADR-059 added
was published for the first time -- no area published before this was partly
unmeasured.

**The roster did not move**, so 61 areas hold nothing and the storage map's
extent was decoupled from the drawn scope to keep the opening view on the
reservoirs. Step 4 -- watch the snow page -- was answered by expanding it on 2026-08-19;
see below.

## Step 4 measured, 2026-08-19: the snow network moved west

217 sites became **637**, in 51 basins of the 75 rather than 14. Twenty-four
basins hold no automated snow site at all and say so rather than being
refused: Sonoran and Mojave desert, Pacific coastal lowland, Central Valley
floor, and three basins that are in Mexico.

| | projected | measured |
|---|---:|---:|
| `snowpack.json` | 287 KB gzip | **322 KB** |
| snow sites | 639 | **639** inventoried, 637 reporting |

The site count was exact. The payload was 12% heavier than projected, and no
cheap encoding is left to take -- two obvious reductions were measured at 3.6%
together, because gzip had already removed the zeros and the repeated calendar
indices. `docs/data-transfer.md` carries that measurement.

**Two things the scoping did not predict.** A station listed as active can
answer with a whole water year of nulls -- 549:NV:SNTL returned 317 rows, every
one flagged missing -- and the refresh treated that as fatal. It never happened
at 217 Utah sites. It is now counted with the stations that did not answer at
all, against the same tolerance, because one dead station must not cost every
other station's reading. And the provider disagrees with this project's
full-resolution assignment for two sites, both on a divide; they are listed
rather than resolved silently, which is what that report is for.

## What this suggests doing, in order

1. **Publish `west-huc6`.** *(Done 2026-08-18, ADR-063.)* It is the coverage change the request is really
   asking for: 75 whole basins instead of 14, the same level everything is
   already keyed at, and no new level machinery. The registry, the boundary
   file, and the level plumbing (ADR-050) all exist.

2. **Then add the level selector**, HUC4 and HUC6 first. *(Done 2026-08-18,
   ADR-064. The measurement held: the station payloads did not move at all,
   and the whole cost was 2.0 KB of coverage, 0.9 KB of roster and 0.1 KB of
   subregion names, gzipped. The decision ADR-050 needed is recorded there --
   a reader-chosen level is a scope change, and what that record protects is
   that every drawn area has a figure behind it, which publishing the figures
   at both levels is how this keeps.)* Free in the
   expensive payloads, per the measurement above. This needs a decision
   recorded against ADR-050: that record says the drawn level is the *scope's*
   and deliberately not the *view's*, and a reader-chosen level is a scope
   change rather than a view-scale change — so it is permitted by ADR-050 and
   should say so explicitly rather than appearing to contradict it.

3. **HUC8 last, and only with the archive pinned to HUC6.** It is the finest
   level the drought engine holds its published precision at (0.21 points of
   error at HUC-10 against a published 0.1), so it is the floor, and the
   archive is the reason to treat it as a separate decision.

4. **Watch the snow page.** 287 KB gzipped is the number to re-measure after
   step 1, not to predict. ADR-052's write-the-calendar-once encoding already
   absorbs part of this, since sites index into a shared date array.

## What the roster step also changes: the site's name

Decided 2026-08-19, to be done **with** the roster and not before.

When the reservoirs cover the west, the header stops being true. `SITE_NAME`
in `src/ui/page-header.ts` becomes **"Western Water Dashboard"**
(`SITE_NAME_SHORT`, "Western Water"), and the page headings drop the state
they carry today -- `PAGE_SUBJECTS` is one table and this is one edit to it.

**The heading then follows the reader's state filter**: "Wyoming Drought"
where Wyoming is chosen, and the unfiltered form otherwise. That is ADR-045
unchanged in principle -- the site is named for the water and each page for
its subject -- with the subject's geography following the reader rather than
being written down.

Two things it needs, neither of them hard:

- **A word for "no state chosen".** The plain reading is that the heading is
  simply "Drought" or "Snowpack" with nothing in front of it, which is what
  the page is about when it is about all of them. "Western Drought" is the
  alternative and it repeats the brand line directly above it.
- **A state filter on the pages that lack one.** Only the storage charts have
  one today (ADR-060). The snow and drought pages would need theirs before
  their headings can follow it, and the storage map before its own.

Not done now, on purpose: the roster is still the fourteen Utah-connected
areas' worth of reservoirs, and a header saying "Western" over 69 Utah
reservoirs claims a coverage the payload does not have.

## Open questions this did not answer

- **Answered 2026-08-19: `normals.json` grows with the roster and the job no
  longer does.** The ~20-minute figure was a sequential job that spent
  fifteen sixteenths of itself waiting: 12.2 seconds of wall clock per
  reservoir for 0.8 seconds of processor. Fetching six at a time takes the
  same 69 reservoirs in **1.6 minutes**, verified byte-for-byte identical to
  the committed file, which projects to about four and a half minutes at ~193.
  `--missing` makes a roster addition cost only the reservoirs added, and is
  how an interrupted run resumes. The hour is not a reason to sequence
  anything.
- **Answered 2026-08-18: the aggregation axes are not the answer.** This
  document called the county and district axes "the strongest argument" for
  keeping a 193-row list browsable. Measured (ADR-058), counties group 69
  reservoirs into 35, with 19 holding exactly one, and the count grows with
  the roster — so the axis gets thinner rather than richer. Counties are a
  search and filter axis. State and HUC-4 are the grouping axes worth having:
  about 11 and 44 groups at western coverage, against 75 basins.

- **What happens to the reservoir list at ~193 rows?** It already scrolls in
  its own box, so nothing breaks; whether it stays *browsable* is a design
  question rather than a data one, and it is the strongest argument for the
  county and district aggregation axes already on the backlog.
- **Which of the 306 actually have traceable capacity?** The admission rate
  of 63% is this project's own history against the Utah-connected pool, and
  capacity tracing is most of what it measures. Nothing says the west behaves
  the same way, and a reservoir without a full level cannot be drawn with a
  percent (`sizeBasis` falls back to the record maximum).
