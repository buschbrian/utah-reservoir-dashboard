# Utah Reservoir Drought Dashboard

Current storage levels across 28 Bureau of Reclamation-monitored reservoirs
in Utah, in three views over one dataset:

| | |
|---|---|
| [`index.html`](index.html) | The map, built with the [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/). Each reservoir colored by how full it is and sized by its capacity. |
| [`maplibre/`](maplibre/) | The same map rebuilt on [MapLibre GL JS](https://maplibre.org/) + CARTO, as an open-source parity comparison. |
| [`explore.html`](explore.html) | **Statewide overview** — totals, a worst-first ranking, a sortable table of every metric with CSV export, and 28 twelve-month sparklines. No map, and no SDK. |

No build step and no framework anywhere: the two maps load their SDK
directly from a CDN with plain `<script>` tags, and the overview loads
nothing at all. Data comes from the
[Bureau of Reclamation RISE API](https://data.usbr.gov/).

`reservoirs.json` is regenerated daily by [`refresh_reservoirs.py`](refresh_reservoirs.py),
run on a schedule via [GitHub Actions](.github/workflows/refresh-data.yml) (6am
Mountain Time). The script re-pulls each reservoir's full 2015–present daily
storage series from RISE and recomputes every metric from scratch.

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
- **7-, 30- and 365-day change**, and this year's peak with its date.
- **12 months of monthly history** — mean/min/max/end storage per month,
  plus a *normal* for each calendar month (the median of that month in
  earlier years). This drives the trend chart and table in every popup.
- **Sample depth** — `seasonal_sample_years`, how many prior years the
  percentile and the normal are drawn from. A percentile from three years is
  not the same claim as one from eleven.
- **Freshness** — `as_of`, `days_stale`, `is_stale`, `fetch_ok`. See below.
  Dates are compared in Mountain Time, so an evening run and a morning run
  agree about how stale a reservoir is.

RISE data is provisional per Reclamation's own disclaimer; treat the last
few days of any series as subject to revision -- the app itself surfaces
this disclaimer and links back to RISE, both in the title panel and in
every popup.

## Stale reservoirs

Reclamation's feed can go quiet for one reservoir while every other one
keeps updating. Deer Creek, Red Fleet and Steinaker sat frozen at their
2026-07-29 values for eleven days, and nothing in the pipeline or the map
said so — the dashboard presented week-old numbers exactly like fresh ones,
and the workflow stayed green the whole time.

Staleness is now first-class data rather than something you'd have to
notice:

- The script computes `days_stale` per reservoir and flags anything older
  than two days as `is_stale`.
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
  Playwright smoke test that loads all three pages, asserts all 28
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

So capacity comes from the USACE National Inventory of Dams, built into
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
`nid_storage` is deliberately last: it is the maximum pool *including flood
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
real context, and two of the 28 reservoirs are not in Utah at all — Lake
Powell sits behind Glen Canyon Dam in Arizona, and Meeks Cabin is in the
Wyoming notch. The state is six corners of surveyed latitude and longitude
rather than a shapefile, which is why the mask is a dozen lines in
[`shared/reservoir-viz.js`](shared/reservoir-viz.js) and not a data file.

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
dot at a time, 28 clicks to find out which reservoirs are worst off, and no
way at all to see the state as a single quantity. The overview adds:

- **Statewide totals** — combined storage against combined capacity, versus
  the prior-years normal for this week, and 30-day and 1-year change. Beside
  them, a count of reservoirs per color class, because the volume-weighted
  percentage is effectively a report on Lake Powell: it holds more than the
  other 27 combined. "31% full statewide" and "16 of 28 are below half" are
  both true and answer different questions.
- **Twelve months of statewide storage**, drawn by the same chart function
  the popups use, with the state standing in for a reservoir.
- **A worst-first ranking** of all 28, each bar carrying a tick for that
  reservoir's normal on the same axis — so the distance between bar and tick
  is the "is this bad or just August?" read, at a glance, for every
  reservoir at once.
- **A sortable table** of every metric, with a name filter, a stale-feeds-only
  toggle, and CSV export of exactly the rows on screen (raw numbers, not the
  formatted strings).
- **Twelve-month sparklines for all 28 at once**, scaled against each
  reservoir's own capacity so a short bar means low, not just small.
- **Deep links.** `explore.html?reservoir=Deer+Creek` opens that reservoir's
  full record directly, and opening one updates the URL so it can be shared.

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

## Working on the data script

```bash
pip install "pandas==3.0.*" "numpy==2.*" "requests==2.*"

python refresh_reservoirs.py                      # full refresh, writes reservoirs.json
python refresh_reservoirs.py --dry-run            # compute + print the freshness report only
python refresh_reservoirs.py --only "Deer Creek"  # one reservoir, prints JSON, never writes

python tools/build_capacity_table.py --dry-run   # re-derive capacities from NID
python tools/probe_rise.py --name "Lake Powell"  # dump RISE's catalog for a reservoir
```

Tests (no network — RISE is slow, rate-limited and occasionally wrong, and
none of that should decide whether CI is green):

```bash
pip install pytest
python -m pytest tests/ -v
```

The browser smoke test needs network access, since both pages load their
SDK from a CDN:

```bash
npm install --no-save playwright && npx playwright install chromium
mkdir -p screenshots && node tests/smoke.mjs
```

## Future improvements

Roughly in order of how much they'd pay back. Items marked *(flagged in
code)* have a matching `IMPROVEMENT:` comment at the relevant line.

### Correctness of the metrics

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

### Making failures impossible to sit on

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

### Data breadth

- **Cache the daily series.** Every run re-pulls ~4,200 rows × 28
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
- **Non-Reclamation reservoirs.** These 28 are the Reclamation-monitored
  ones; the Utah Division of Water Resources tracks others that a
  statewide drought map arguably ought to include.

### The dashboards

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
