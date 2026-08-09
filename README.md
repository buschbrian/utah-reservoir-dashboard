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

Next steps: bring over the remaining matplotlib charts from the original
notebook, and add a weekly job that re-walks RISE's catalog for stateId=UT
and diffs the discovered item IDs against the hand-maintained `RESERVOIRS`
table — a retired catalog item is one plausible cause of a reservoir going
permanently quiet, and nothing currently checks for it.
