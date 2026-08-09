# Utah Reservoir Drought Dashboard

A static web map of current storage levels across 28 Bureau of
Reclamation-monitored reservoirs in Utah, colored by percent of
period-of-record maximum storage and sized by current storage volume.

Built with the [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/)
(loaded directly from Esri's CDN — no build step, no framework). Data comes
from the [Bureau of Reclamation RISE API](https://data.usbr.gov/).

`reservoirs.json` is regenerated daily by [`refresh_reservoirs.py`](refresh_reservoirs.py),
run on a schedule via [GitHub Actions](.github/workflows/refresh-data.yml) (6am
Mountain Time). The script re-pulls each reservoir's full 2015–present daily
storage series from RISE and recomputes every metric from scratch.

## Metrics

- **% of period-of-record max** — current storage vs. the highest storage
  seen in that range. A proxy for physical capacity, not the real thing.
- **Seasonal percentile** — where today's storage ranks against every other
  year's value within a 7-day day-of-year window.
- **Normal for this week** — the median storage for this same day-of-year
  window across the record, and today's storage as a percentage of it. This
  is the "is this normal for August?" read, which % of record max can't
  give you: a reservoir at 60% of its all-time high in late summer might be
  perfectly ordinary or historically bad, and only this number says which.
- **7-, 30- and 365-day change**, and this year's peak with its date.
- **12 months of monthly history** — mean/min/max/end storage per month,
  plus a *normal* for each calendar month (the median of that month in
  earlier years). This drives the trend chart and table in every popup.
- **Freshness** — `as_of`, `days_stale`, `is_stale`, `fetch_ok`. See below.

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

## Symbology

Each reservoir renders as two circles: a gray outline ring sized by that
reservoir's period-of-record max storage, and a colored filled circle on
top sized by current storage. Both sizes come from Arcade `valueExpression`s
on the same sqrt-scaled domain, so the visible gap between ring and fill is
always a real read of depletion, not a scaling artifact.

The color ramp has five classes (under 25 / 25–50 / 50–75 / 75–90 / over
90%) rather than the original three. In a drought year most of the state
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
```

## Future improvements

Roughly in order of how much they'd pay back. Items marked *(flagged in
code)* have a matching `IMPROVEMENT:` comment at the relevant line.

### Correctness of the metrics

- **Use real capacity instead of record max.** Every headline number is
  currently a share of the highest storage seen since 2015, which is a
  proxy and drifts as the record grows — a reservoir that sets a new high
  makes every earlier percentage retroactively smaller. RISE publishes
  active/total capacity per reservoir; pulling it would turn
  `pct_of_record_max` into a real "percent full" and let the two be shown
  side by side.
- **Exclude the current year from `seasonal_percentile`.** *(flagged in
  code)* The comparison population includes today's own value, so the
  metric can never return a true 0 and skews toward the present in a short
  record. Worth fixing before this number is ever presented as official.
- **Leap-year-correct the day-of-year window.** *(flagged in code)* The
  wrap-around is hardcoded to 365, so the ±7-day window is off by a day
  near the New Year in leap years.
- **Normalize freshness to Mountain Time.** *(flagged in code)* The
  pipeline computes `days_stale` in UTC, so an evening run reports every
  reservoir a day staler than a morning run does.
- **Flag implausible readings.** A gage that reports a 40% overnight jump
  is far more likely broken than real, and nothing currently distinguishes
  the two. A per-reservoir plausibility check would catch a different
  failure mode than staleness does.

### Making failures impossible to sit on

- **Alert, don't just annotate.** A stale reservoir now produces a warning
  on the run page — which still requires someone to look at the run page.
  Opening (and auto-closing) a GitHub issue when a reservoir passes some
  threshold would push the signal instead of waiting for a pull.
- **Verify the catalog IDs.** *(flagged in code)* The `RESERVOIRS` table is
  hand-maintained with no verification. A weekly job that re-walks RISE's
  location → catalogRecord → catalogItem chain for `stateId=UT` and diffs
  the result against the table would catch a retired item ID — one of the
  two candidate explanations for the 2026-07-29 freeze, ruled out this time
  only by reading row counts by hand.
- **Commit the test suite and run it in CI.** The refresh script's cleaning,
  metrics, carry-forward, degenerate-series and pagination behavior were
  all exercised against synthetic fixtures during this change, but that
  harness lives outside the repo, so none of it protects the next edit.
- **Smoke-test the maps in CI.** Both dashboards are verified by eye and by
  syntax check, never automatically. A Playwright job that loads each page,
  asserts 28 rendered circles and zero console errors, and uploads a
  screenshot would catch a broken renderer before it ships — and would have
  caught the earlier legend that silently never painted.

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
