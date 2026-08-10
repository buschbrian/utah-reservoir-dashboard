# Utah Reservoir Drought Dashboard

**Live: <https://buschbrian.github.io/utah-reservoir-dashboard/>**

Current storage levels across 54 reservoirs in and serving Utah, combining
Reclamation RISE with the wider NRCS AWDB inventory in three views:

| | |
|---|---|
| [`index.html`](index.html) | The map, built with the [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/). Each reservoir colored by how full it is and sized by its capacity. |
| [`maplibre/`](maplibre/) | The same map rebuilt on [MapLibre GL JS](https://maplibre.org/) + CARTO, as an open-source parity comparison. |
| [`explore.html`](explore.html) | **Statewide overview** — totals excluding Lake Powell, a size-first ranking, a sortable table of every metric with CSV export, and 54 twelve-month sparklines. No map SDK. |

Storage comes from the [Bureau of Reclamation RISE
API](https://data.usbr.gov/) and [USDA NRCS
AWDB](https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui.html).

The two map pages still load their SDK from a CDN with plain `<script>`
tags. The overview is now a [Vite](https://vite.dev/) entry point, because
its statewide chart uses [Observable Plot](https://observablehq.com/plot/).
The site is built and published to GitHub Pages by
[`deploy-pages.yml`](.github/workflows/deploy-pages.yml). See
[Build and deploy](#build-and-deploy) — the rule that matters is that the
daily data is *copied* into the published output, never bundled into it.

A larger rebuild is under way: one unified dashboard on ArcGIS Maps SDK 5.1
and Calcite 5, with the three current pages staying live until it lands.
[`MODERNIZATION_PLAN.md`](MODERNIZATION_PLAN.md) is the working plan and the
record of what has been measured; [What is done and what is
next](#what-is-done-and-what-is-next) summarizes where it stands.

## Quick start

```bash
npm ci
npm run dev
```

Then open the page you want: `/explore.html` for the overview, `/index.html`
for the ArcGIS map, `/maplibre/` for the MapLibre one.

The two map pages need network access, since they load their SDK from a CDN
and their basemap tiles from a tile service. To work on the Python pipeline
instead, see [Working on the data script](#working-on-the-data-script).

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, unit tests, SDK bundle budget, then the production build |
| `npm test` | Vitest only |
| `npm run typecheck` | `tsc --noEmit` |
| `python -m pytest tests/ -q` | Data-pipeline and watershed tests (no network) |
| `node tests/smoke.mjs` | Browser smoke test, against the built `dist/` |
| `python refresh_reservoirs.py --dry-run` | Recompute every metric without writing |
| `node scripts/fetch-huc6.mjs --dry-run` | Re-derive the watershed boundaries |

## Why the project is built this way

[`docs/decisions/`](docs/decisions/) holds the architecture decision records —
the build step, the runtime-data rule, where capacity comes from, why there is
no API key, how the watershed boundaries were chosen, the wording standard, why
there are two map engines, and the one class-break table everything derives
from. [`CLAUDE.md`](CLAUDE.md) is the short version: the conventions a
contributor will be failed by a test for breaking.

## Using the maps

Both map pages carry the same controls, built from the same shared module so
they cannot drift:

- **Hover** a reservoir for its name, percent full and reading date, with no
  click. **Select** one — by clicking, or from the keyboard list — for the full
  record and its 12-month chart.
- **Filter** by percent-full class, or to reservoirs with late data only.
  Matching reservoirs stay bright and the rest recede rather than disappearing:
  where the low reservoirs are is most of the answer.
- **The month slider** redraws every reservoir at any of the last 12 months,
  with play and pause. The capacity ring does not change with the month — only
  the storage fill does, so the gap between them stays a true read of
  depletion. A reservoir with no reading for that month is a small grey circle.
- **Every reservoir is reachable by keyboard**, from a focusable list beside
  the map in size order. Selections are announced, focus moves into the popup
  and returns to where it came from.
- **Links are shareable.** `?reservoir=Deer+Creek` works on all three pages and
  means the same thing on each.

`reservoirs.json` is regenerated daily by [`refresh_reservoirs.py`](refresh_reservoirs.py),
run on a schedule via [GitHub Actions](.github/workflows/refresh-data.yml) (6am
Mountain Time). The script re-pulls each reservoir's full 2015–present
series and recomputes every metric from scratch. RISE and two current AWDB
stations are daily; the other 23 AWDB additions are month-end series and are
explicitly labeled monthly in the data and UI.

## Metrics

- **% of capacity** — the headline number, and what the map colors and
  sizes by: current storage against the reservoir's real capacity from the
  USACE [National Inventory of Dams](https://nid.sec.usace.army.mil/),
  stored in [`capacities.json`](capacities.json). RISE publishes no
  capacity at all, so this comes from a second source.
- **% of period-of-record max** — current storage vs. the highest storage
  seen since 2015. Kept alongside, because it is what the dashboard used to
  show and it drifts as the record grows: a reservoir that sets a new high
  retroactively shrinks every earlier percentage.
- **Seasonal percentile** — where today's storage ranks against *prior
  years'* values within a 7-day day-of-year window. Prior years only, so a
  reservoir at its lowest level ever for this week reads as 0 rather than
  being partly ranked against itself.
- **Normal for this week** — the median storage for this same day-of-year
  window across prior years, and today's storage as a percentage of it. This
  is the "is this normal for August?" read, which % of record max can't
  give you: a reservoir at 60% of its all-time high in late summer might be
  perfectly ordinary or historically bad, and only this number says which.
- **7-, 30- and 365-day change**, and this year's peak with its date. Monthly
  sources omit the unsupported 7-day claim.
- **12 months of monthly history** — mean/min/max/end storage per month,
  plus a *normal* for each calendar month (the median of that month in
  earlier years). This drives the trend chart and table in every popup.
- **Sample depth** — `seasonal_sample_years`, how many prior years the
  percentile and the normal are drawn from. A percentile from three years is
  not the same claim as one from eleven.
- **Freshness** — `as_of`, `days_stale`, `is_stale`, `fetch_ok`. See below.
  Dates are compared in Mountain Time, so an evening run and a morning run
  agree about how stale a reservoir is.

Source data is provisional and subject to revision. Every record carries its
provider, station/item identifier and daily or monthly cadence, and every
popup links back to the relevant source.

## Stale reservoirs

Reclamation's feed can go quiet for one reservoir while every other one
keeps updating. Deer Creek, Red Fleet and Steinaker sat frozen at their
2026-07-29 values for eleven days, and nothing in the pipeline or the map
said so — the dashboard presented week-old numbers exactly like fresh ones,
and the workflow stayed green the whole time.

Staleness is now first-class data rather than something you'd have to
notice:

- The script computes `days_stale` per reservoir. Daily sources are flagged
  after two days; month-end AWDB sources use a 45-day threshold.
- Stale reservoirs are annotated as warnings in the Actions log and listed
  in the run's job summary, so a quiet feed is visible on the run page.
- A reservoir that can't be fetched at all keeps its previous record,
  clearly marked `fetch_ok: false`, instead of silently vanishing from the
  map the way it used to.
- Both dashboards draw a dashed amber ring around a stale reservoir, list
  the offenders under the title, and open the popup with a banner saying
  which date the numbers actually describe.

The script refuses to overwrite `reservoirs.json` if fewer than half the
reservoirs refreshed successfully, so a bad RISE day can't quietly replace
good data with a stub.

## What the pipeline fixes by itself

The original failure wasn't that something broke — it was that nothing
noticed. Three additions close that loop without a human in it:

- **Transient failures retry.** The data pull runs up to three times with
  1/3/9-minute backoff, on top of the per-request retries inside the script.
  A RISE hiccup costs minutes, not a day of data. The push rebases and
  retries too, rather than throwing away a good pull because another commit
  landed first.
- **The staleness alert manages its own issue.** When any feed goes quiet,
  the run opens (or updates) an issue labeled `stale-feed` listing which
  reservoirs and for how long. When they all report again, the run closes
  it. An open issue means the state is true right now; nobody has to
  remember to file or tidy it.
- **The dashboards are checked in a real browser on every push.**
  [`ci.yml`](.github/workflows/ci.yml) runs the data-script tests and a
  Playwright smoke test that loads all three pages, asserts all 53
  reservoirs actually rendered (as map circles, and as table rows, ranking
  bars and sparkline cards on the overview), opens a popup and the overview's
  detail dialog, fails on any console error, and uploads screenshots.

That last one exists because of a specific bug. `esri/Map` was bound as
`Map` in the ArcGIS page's `require` callback, shadowing the global `Map`
constructor, so a later `new Map(...)` built an ArcGIS map instead of a
lookup table. The page threw, caught its own error, and displayed a line of
small print blaming `reservoirs.json` — while MapLibre, with nothing
shadowing `Map`, rendered the same file perfectly. Syntax checks and unit
tests cannot see a map that loads and draws nothing. A browser can.

## Capacity

RISE publishes storage but no capacity — proven by walking the catalog for
Lake Powell (item 509 → record 2362 → location 393) with
[`tools/probe_rise.py`](tools/probe_rise.py): the location has no capacity
attribute, none of the 17 catalog items on the record is a capacity,
`hasProfile` is false so there is no elevation–area–capacity table, and the
free-text fields are empty.

Capacity for RISE records comes from the USACE National Inventory of Dams, built into
[`capacities.json`](capacities.json) by
[`tools/build_capacity_table.py`](tools/build_capacity_table.py) and
committed rather than fetched at refresh time: it changes on the order of
never, and a denominator that shifts silently underneath you is worse than
a stale one. Each entry records the NID id and dam name, so any figure can
be traced back.

`normal_storage` — the conservation pool — is the denominator where NID has
it (25 of 28 reservoirs). It is strikingly close to what we have actually
observed: Strawberry 1,105,910 af against 1,106,560 af seen since 2015,
Rockport 62,120 against 62,372. The other three fall back to `max_storage`.
The AWDB additions use AWDB's traceable reservoir-capacity metadata. For the
RISE records, `nid_storage` is deliberately last: it is the maximum pool *including flood
surcharge*, and taking it for Lake Powell gave 29,875,000 af against a real
full pool nearer 25,000,000, quietly understating how empty it is.

Matching reservoirs to dams is where this could go silently wrong, so every
row is checked against the storage observed since 2015 and rejected if the
capacity comes in below it — a capacity smaller than what we have already
watched sit in the reservoir means the wrong dam got attached. Four
reservoirs needed help: Strawberry and Rockport are impounded by Soldier
Creek and Wanship dams, and Glen Canyon (Lake Powell) and Meeks Cabin are
in Arizona and Wyoming, so a `state='UT'` filter dropped them.

## Symbology

Each reservoir renders as two circles: a gray outline ring sized by that
reservoir's full capacity, and a colored filled circle on top sized by
current storage. Both sizes come from Arcade `valueExpression`s
on the same sqrt-scaled domain, so the visible gap between ring and fill is
always a real read of depletion, not a scaling artifact.

The ramp colors by percent full (percent of period-of-record max for any
reservoir without a capacity). It has five classes (under 25 / 25–50 /
50–75 / 75–90 / over 90%) rather than the original three. In a drought year most of the state
falls under 50%, and the old ramp painted Lake Powell at 34% and Meeks
Cabin at 13% the identical red — flattening the map exactly where the story
is. Class breaks live in one table in
[`shared/reservoir-viz.js`](shared/reservoir-viz.js) and are used to
generate the ArcGIS renderer stops, the MapLibre `step` expression, the
legend and the chart bar colors, so they can't drift apart.

Clicking any reservoir opens a 12-month trend chart (inline SVG, bars
colored on the same ramp, with a dashed line for that month's normal in
prior years) and a collapsible table of the same 12 months in numbers.

Everything outside the state line is dimmed under a translucent mask, so
Nevada and Wyoming stop rendering at the same weight as the subject of the
dashboard. It is a scrim, not a clip, on purpose: neighboring terrain is
real context, and several monitored reservoirs cross or sit just beyond the
state line. The state is six corners of surveyed latitude and longitude
rather than a shapefile, which is why the mask is a dozen lines in
[`shared/reservoir-viz.js`](shared/reservoir-viz.js) and not a data file.
The drainage-area outlines draw on top of it: the mask says what the subject
is, the outlines say how the water is organized.

This paragraph was wrong for several commits, which is worth recording.
Adding the drainage-area layer replaced the mask rather than joining it, and
nothing caught it: both map pages reported `masked` and `huc6` in their
readiness signal from the *same expression*, so the browser test made two
assertions about one fact. A test that cannot fail is worse than no test,
because it is counted as coverage. They are two signals now.

The two engines disagreed about it, which is the sort of thing the parity
page exists to surface: a mask ring spanning the full -180…180 renders
correctly in MapLibre but *inverts* in the ArcGIS SDK — a polygon touching
both sides of the antimeridian is ambiguous about which side it encloses,
so the outer ring is dropped and the Utah hole becomes the only ring,
dimming the state instead of its surroundings. Both pages now use a
continent-sized box.

## Statewide overview

[`explore.html`](explore.html) is the half the maps can't do. A map answers
"where"; everything past the headline number was locked behind clicking one
dot at a time, dozens of clicks to compare reservoirs, and no
way at all to see the state as a single quantity. The overview adds:

- **Statewide totals** — combined storage against combined capacity, versus
  the prior-years normal for this week, and 30-day and 1-year change. Beside
  them, a count of reservoirs per color class, because the volume-weighted
  percentage can otherwise become effectively a report on Lake Powell. A
  separate, prominent total excludes Lake Powell as the useful Utah read.
- **Twelve months of statewide storage**, drawn by the same chart function
  the popups use, with the state standing in for a reservoir.
- **A size-first comparison** of all 53. Circle size shows relative capacity.
  The adjacent bar shows current percent full. Normal storage stays in the
  time-series chart and details, where it has enough context.
- **A sortable table** of every metric, with a name filter, a late-data-only
  toggle, and CSV export of exactly the rows on screen (raw numbers, not the
  formatted strings).
- **Twelve-month sparklines for all 53 at once**, scaled against each
  reservoir's own capacity so a short bar means low, not just small.
- **Drainage areas.** One capacity-weighted bar per six-digit hydrologic
  unit: total storage over total full level, *not* the average of the
  percentages — one area holds Lake Powell and another holds four ponds, and
  the two answers differ sharply. Every row carries its reservoir count and
  combined full level, because this is the storage of the reservoirs the
  dashboard tracks, not the water in the watershed. Selecting an area filters
  the ranking, the table and the cards together.
- **Deep links.** `explore.html?reservoir=Deer+Creek` opens that reservoir's
  full record directly, and opening one updates the URL so it can be shared.
  `?area=160201` selects a drainage area, and the two combine.

It shares the color classes, the popup markup, the trend chart and the
formatting with both maps, so a reservoir reads identically whether you got
to it by clicking a dot or a table row. It is also the only page that loads
no SDK at all: it would still render during a CDN outage.

## Open-source parity comparison

[`maplibre/`](maplibre/) rebuilds this exact dashboard with
[MapLibre GL JS](https://maplibre.org/) and CARTO's free vector basemap
instead of the ArcGIS Maps SDK for JS — both WebGL vector renderers, so it's
a true baseline comparison (replacing an earlier Leaflet pass, which wasn't:
Leaflet is a raster/DOM renderer, not a fair comparison to Esri's WebGL SDK).
Same data, same dual-circle symbology, same popup content. See
[`maplibre/README.md`](maplibre/README.md) for the findings.

Everything that isn't engine-specific — class breaks, popup markup, the
trend chart, the legend, the status wording, the Utah mask geometry and the
statewide rollup — now lives in
[`shared/reservoir-viz.js`](shared/reservoir-viz.js), loaded by all three
pages. It had been duplicated by hand and was already drifting, which made
the comparison partly a measurement of copy drift rather than of the
engines.

## Wording

Visible text follows [ASD-STE100 Simplified Technical
English](https://asd-ste100.org/): short sentences, one term for one thing,
and no unexplained specialist word. `af` is written *acre-feet*,
*period-of-record max* is *highest recorded storage*, *stale* is *late data*,
and *cadence* is *update schedule*. The overview defines capacity, acre-foot,
normal, history rank, update schedule and CSV file in a *Meaning of terms*
block. Two tests enforce it: `src/content-language.test.ts` on the source, and
the browser smoke test, which fails if any retired term reappears in text a
reader can see.

## Build and deploy

This is the one place the build step changes the operating model, and it has
a trap in it. `reservoirs.json` is rewritten every morning, and that commit
*is* the deploy — the pages fetch the file at runtime. If the app baked the
data in at build time, every refresh would need a rebuild, and a failing
build would silently freeze the dashboard's numbers.

**Rule: data is copied into the published output, never bundled into it.**
`vite.config.ts` copies `reservoirs.json` and `capacities.json` into `dist/`
and `dist/data/` after the bundle is written, and nothing imports them. The
deploy workflow asserts both halves: that every current URL still resolves in
`dist/`, and that the payload's `generated_at` does not appear anywhere in
`dist/assets`.

The corollary is that a red build now freezes the numbers, which is why the
unit tests are written against `shared/reservoir-viz.js` rather than against
literals from one day's payload. A data refresh cannot turn the build red on
its own.

```bash
npm ci
npm run dev        # Vite dev server
npm run build      # typecheck, unit tests, SDK bundle budget, then vite build
npm test           # vitest only
```

`npm run build` runs `scripts/check-sdk-bundle.mjs`, which builds the planned
ArcGIS 5.1 import surface and fails if it exceeds 18 MiB raw / 6 MiB gzip
emitted or a 2.5 MiB gzip static entry path. It is a budget for the rebuild,
checked before the rebuild depends on it.

## Watersheds

Every reservoir carries the six-digit hydrologic unit its water drains
through, and separately whether the reservoir is in Utah. The two are not the
same question and are deliberately not merged: a drainage area does not stop
at a state line, so "reservoirs in Utah" and "reservoirs in drainage areas
that touch Utah" have different answers, and Lake Powell's water arrives from
Wyoming and Colorado.

- Assignment is by the **dam or outlet point** — where the stored water
  leaves — not the middle of the reservoir, because a large reservoir can
  span a boundary. `huc_assignment_source` records which kind of point
  produced each row.
- Boundaries live in [`huc6.geojson`](huc6.geojson), written by
  [`scripts/fetch-huc6.mjs`](scripts/fetch-huc6.mjs) from the USGS Watershed
  Boundary Dataset and **committed**, for the same reason as
  `capacities.json`: an assignment that can change underneath you is not
  reproducible, and a reservoir that silently moves basin between two runs is
  not something anyone would catch by looking.
- The file is generalized to roughly 500 m, which is a measured choice rather
  than a default. No tracked reservoir sits closer than 2.72 km to a unit
  boundary, and all 53 assignments are identical to the ungeneralized
  geometry — at 1/5 the size.
- `in_utah` comes from the **reservoir's** point, not the assignment point.
  Glen Canyon Dam is in Arizona while Lake Powell reaches well into Utah, so
  the two must not be collapsed.

Utah's outline is six corners of surveyed latitude and longitude rather than
a shapefile — 42°N to 37°N, 114°03′W to 109°03′W, with the northeast notch
belonging to Wyoming. It exists twice, in [`huc.py`](huc.py) and in the map
mask in [`shared/reservoir-viz.js`](shared/reservoir-viz.js); a test reads the
numbers out of the JavaScript and fails if they drift apart.

## Working on the data script

```bash
pip install "pandas==3.0.*" "numpy==2.*" "requests==2.*"

python refresh_reservoirs.py                      # full refresh, writes reservoirs.json
python refresh_reservoirs.py --dry-run            # compute + print the freshness report only
python refresh_reservoirs.py --only "Deer Creek"  # one reservoir, prints JSON, never writes

python tools/build_capacity_table.py --dry-run   # re-derive capacities from NID
python tools/probe_rise.py --name "Lake Powell"  # dump RISE's catalog for a reservoir
python tools/probe_huc_points.py                 # compare our points against the dams
node scripts/fetch-huc6.mjs --dry-run            # re-derive the watershed boundaries
```

Tests (no network — RISE is slow, rate-limited and occasionally wrong, and
none of that should decide whether CI is green):

```bash
pip install pytest
python -m pytest tests/ -v
```

The browser smoke test runs against the **built** site in `dist/`, not the
source files, because the overview's chart now comes from the bundle. It
needs network access, since both map pages load their SDK from a CDN:

```bash
npm ci && npx playwright install chromium
npm run build
mkdir -p screenshots && node tests/smoke.mjs
```

It loads all three pages at three viewport widths — 1280, 390 and 360 — and
asserts every reservoir rendered, that no retired term is visible, that the
page does not scroll sideways, and that nothing overlaps the map controls.
The narrowest width is there deliberately: the overflow bugs it catches come
from font metrics, so a check with no margin passes on Windows and fails on
CI's Linux.

## What is done and what is next

### Resolved in the modernization pass so far

| | |
|---|---|
| **A build step** | Vite 8 + TypeScript 7 (strict, `exactOptionalPropertyTypes`) + Vitest. The zero-build constraint is retired deliberately, not by accident. |
| **Published from a build** | GitHub Pages now deploys `dist/` from Actions. All seven public URLs — `/`, `explore.html`, `maplibre/`, `modern.html`, `reservoirs.json`, `data/reservoirs.json`, `shared/reservoir-viz.js` — are asserted in the workflow and return 200. |
| **A real module** | The flagged `IMPROVEMENT` in `shared/reservoir-viz.js`. Class breaks, `percentFull`, the statewide rollup and the formatters are now typed modules in `src/`, unit-tested against the legacy script loaded in a `node:vm` sandbox rather than against one day's numbers. Two divergences were found this way and are asserted, not hidden. |
| **A runtime validator** | A malformed refresh fails loudly at the fetch boundary instead of rendering an empty map. |
| **Charts** | Observable Plot drives the statewide 12-month chart, with pointer tips and with/without-Powell and acre-feet/percent controls. Colors still come from the one class-break table. |
| **Basemap authentication** | Measured, not assumed: the well-known ids (`topo-vector`, `gray-vector`, …) still serve keyless on 5.1; only the `arcgis/*` styles service is key-gated. **No API key is needed.** |
| **No credential prompt can reach a public page** | The real failure mode was a 401 raising a username/password modal and then hanging the load for 20 seconds. `src/arcgis/auth.ts` refuses credential challenges at `IdentityManager.getCredential`, and `src/arcgis/basemaps.ts` falls through a chain of candidates. Measured after: fails in 54 ms, no modal, map renders. |
| **A bundle budget** | Every build measures the planned SDK import surface (15.49 MiB raw / 5.43 MiB gzip today) against a ceiling, so Phase 2 cannot quietly become enormous. |
| **Plain wording** | Simplified Technical English across all visible text, enforced by two tests. See [Wording](#wording). |
| **Mobile layout on the maps** | Partly. All three pages are tested at 1280, 390 and 360 pixels: the title panel stays inside the viewport, nothing overlaps the ArcGIS zoom control, and no page scrolls sideways. The card's height is measured against the legend rather than capped at a constant. The structural fix is still Phase 2. |
| **Interaction, pulled forward from Phases 3 and 5** | Hover reading, class and late-data filtering with dimming, a twelve-month time slider, deep links, and a keyboard path to every reservoir — on both maps, built from the shared module. See [Using the maps](#using-the-maps). Done on the current pages rather than held for the shell, because the shell is several phases away and these are the pages people use. |
| **Decisions written down** | Eight architecture decision records in [`docs/decisions/`](docs/decisions/), plus [`CLAUDE.md`](CLAUDE.md) for the conventions a test will fail you for breaking. |

### Next, in order

1. **Phase 1.5 — watershed data.** *Mostly done.* Every published reservoir
   now carries its drainage area (see [Watersheds](#watersheds)); the
   boundaries are committed; the rollups are written and tested on both
   sides — [`huc.py`](huc.py) for the pipeline and
   [`src/data/huc.ts`](src/data/huc.ts) for the dashboards, with
   capacity-weighted `rollupByHuc` and a monthly rollup that shows a gap
   rather than a partial total. What remains: **upgrade the 28 RISE
   reservoirs to real dam points** from the National Inventory of Dams (a
   correctness improvement — measured, it moves no assignment), and **audit
   the connected out-of-state reservoirs**. Three drainage areas —
   Colorado Headwaters, White-Yampa and Lower San Juan — currently have zero
   tracked reservoirs, which is exactly where Blue Mesa, Morrow Point and
   Navajo would land.
2. **Phase 2 — the unified dashboard shell.** One Calcite 5 shell holding the
   map, filters, the selected reservoir and the ranking/table/sparkline tabs.
   This is what replaces the three pages, and it closes mobile layout
   structurally rather than with more media queries.
3. **Phase 3–5 — the parts not yet pulled forward.** `CIMSymbol` dual circles
   with a real drop shadow, and layer-bound charts bound to the same filter.
   Filter dimming, the shared selection object, deep links and the time slider
   already landed on the current pages.
4. **Phase 6–7 — MapLibre 6 parity, then verification.** Rewrite the smoke
   test against the new DOM, add axe-core, and assert end-to-end that no
   password prompt can appear.

[`MODERNIZATION_PLAN.md`](MODERNIZATION_PLAN.md) has the detail, the
measurements behind each decision, and the traps found on the way.

### Still open, and not part of that plan

Roughly in order of how much they'd pay back. Items marked *(flagged in
code)* have a matching `IMPROVEMENT:` comment at the relevant line.

#### Correctness of the metrics

- **Revisit the capacity denominator.** Capacity now comes from NID (see
  below), using `normal_storage` where it exists and `max_storage` for the
  three reservoirs that lack it. Utah DWR's own published capacities would
  be the more local authority if a machine-readable version turns up —
  [`tools/find_utah_capacities.py`](tools/find_utah_capacities.py) records
  where I looked and what each candidate field actually contained.
- **Flag implausible readings.** A gage that reports a 40% overnight jump
  is far more likely broken than real, and nothing currently distinguishes
  the two. A per-reservoir plausibility check would catch a different
  failure mode than staleness does.

#### Making failures impossible to sit on

- **Verify the catalog IDs.** *(flagged in code)* The `RESERVOIRS` table is
  hand-maintained with no verification. A weekly job that re-walks RISE's
  location → catalogRecord → catalogItem chain for `stateId=UT` and diffs
  the result against the table would catch a retired item ID — one of the
  two candidate explanations for the 2026-07-29 freeze, ruled out this time
  only by reading row counts by hand.
- **Notify a human, not just a page.** The stale-feed issue opens itself,
  but nobody is subscribed to it by default. Watching the repo or wiring a
  notification would close the last gap between "the system knows" and
  "someone knows".
- **Self-heal a dead catalog ID.** The catalog check above can only report a
  changed ID. Having it rewrite the `RESERVOIRS` table and open a PR would
  make the most likely permanent failure fix itself.

#### Data breadth

- **Cache the daily series.** Every run re-pulls ~4,200 rows for each daily
  reservoirs to recompute values that almost all didn't change. Persisting
  the series (artifact or committed Parquet) and fetching only the delta
  would cut the run time, be considerably kinder to RISE, and make a longer
  history than 2015–present affordable.
- **More parameters per reservoir.** RISE also carries inflow, outflow and
  elevation. Storage alone can't distinguish "this reservoir is being drawn
  down on purpose" from "nothing is coming in."
- **Snowpack context.** Utah's reservoir year is decided by snowpack, and
  NRCS SNOTEL basin values would give each reservoir's trend a cause rather
  than just a shape.
- **More current local feeds.** Twenty-three expanded-inventory reservoirs
  have reliable AWDB month-end storage but no current daily AWDB series.
  Direct local-agency feeds could improve their cadence where stable APIs
  and traceable capacity definitions are available.

#### The dashboards

- **A time slider.** The data now holds 12 months per reservoir but the maps
  only ever draw today. Animating the map through those months would show
  the drawdown spreading across the state — the overview shows the same 12
  months as small multiples, which is the static answer to the same
  question, not a replacement for the moving one.
- **Deep links on the maps.** `explore.html?reservoir=Deer+Creek` works;
  the two map pages still ignore the parameter, so a link into a specific
  reservoir's popup isn't shareable.
- **Mobile layout on the maps.** The overview is responsive down to a phone;
  the map pages' title panel, legend and popup are all still sized for a
  desktop viewport and overlap badly.
- **Accessibility.** Rows, ranking bars and cards on the overview are real
  focusable buttons, and every chart carries an `aria-label` plus a table of
  the same numbers — but the chart bars themselves still aren't focusable
  with per-month tooltips, and none of the three pages has had a proper
  keyboard and contrast pass.
- **Harden the CDN dependency.** *(flagged in code)* Both map pages pin
  their SDK version in two places with no integrity hash and no fallback,
  so a version bump means editing both and a CDN outage means a blank page.
  (The overview loads no SDK, so it is the page that survives that.)
- **Size legend.** The legend explains the color ramp but not the circle
  sizing, which is doing just as much work.
- **A real module.** *(flagged in code)* `shared/reservoir-viz.js` is a
  plain script hanging one global off `window`, to hold the no-build-step
  constraint. Its own comment said to revisit that "the moment a third page
  shows up". A third page has shown up.

Also still open from before: bring over the remaining matplotlib charts
from the original notebook — the overview covers the storage-history ones,
not the rest.
