# Utah Reservoir Drought Dashboard

A static web map of current storage levels across 28 Bureau of
Reclamation-monitored reservoirs in Utah, colored by how full each one is
and sized by its capacity.

Built with the [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/)
(loaded directly from Esri's CDN — no build step, no framework). Data comes
from the [Bureau of Reclamation RISE API](https://data.usbr.gov/).

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
  Playwright smoke test that loads both maps, asserts all 28 reservoirs
  actually rendered, fails on any console error, and uploads screenshots.

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

## Open-source parity comparison

[`maplibre/`](maplibre/) rebuilds this exact dashboard with
[MapLibre GL JS](https://maplibre.org/) and CARTO's free vector basemap
instead of the ArcGIS Maps SDK for JS — both WebGL vector renderers, so it's
a true baseline comparison (replacing an earlier Leaflet pass, which wasn't:
Leaflet is a raster/DOM renderer, not a fair comparison to Esri's WebGL SDK).
Same data, same dual-circle symbology, same popup content. See
[`maplibre/README.md`](maplibre/README.md) for the findings.

Everything that isn't engine-specific — class breaks, popup markup, the
trend chart, the legend, the status wording — now lives in
[`shared/reservoir-viz.js`](shared/reservoir-viz.js), loaded by both pages.
It had been duplicated by hand and was already drifting, which made the
comparison partly a measurement of copy drift rather than of the engines.

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

- **A statewide table view.** Everything beyond the map is currently locked
  behind clicking one reservoir at a time. A sortable all-28 table —
  worst-first, sortable by any metric, CSV export — would answer "which
  reservoirs are in the worst shape" without 28 clicks.
- **A time slider.** The data now holds 12 months per reservoir but the map
  only ever draws today. Animating the map through those months would show
  the drawdown spreading across the state.
- **Deep links.** `?reservoir=Deer+Creek` opening that popup directly would
  make a specific reservoir's condition shareable.
- **Accessibility.** The trend chart is an `aria-label` and a table; it
  should have focusable bars with per-month tooltips, and the whole page
  needs a keyboard and contrast pass.
- **Mobile layout.** The title panel, legend and popup are all sized for a
  desktop viewport and overlap badly on a phone.
- **Harden the CDN dependency.** *(flagged in code)* Both pages pin their
  SDK version in two places with no integrity hash and no fallback, so a
  version bump means editing both and a CDN outage means a blank page.
- **Size legend.** The legend explains the color ramp but not the circle
  sizing, which is doing just as much work.

Also still open from before: bring over the remaining matplotlib charts
from the original notebook.
