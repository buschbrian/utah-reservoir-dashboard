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
storage series from RISE, then recomputes the same two drought metrics from
the original notebook:

- **% of period-of-record max** — current storage vs. the highest storage
  seen in that range. A proxy for physical capacity, not the real thing.
- **Seasonal percentile** — where today's storage ranks against every other
  year's value within a 7-day day-of-year window.

RISE data is provisional per Reclamation's own disclaimer; treat the last
few days of any series as subject to revision -- the app itself surfaces
this disclaimer and links back to RISE, both in the title panel and in
every popup.

Each reservoir renders as two circles: a gray outline ring sized by that
reservoir's period-of-record max storage, and a colored filled circle on
top sized by current storage. Both sizes come from Arcade `valueExpression`s
on the same sqrt-scaled domain, so the visible gap between ring and fill is
always a real read of depletion, not a scaling artifact.

## Open-source parity comparison

[`maplibre/`](maplibre/) rebuilds this exact dashboard with
[MapLibre GL JS](https://maplibre.org/) and CARTO's free vector basemap
instead of the ArcGIS Maps SDK for JS — both WebGL vector renderers, so it's
a true baseline comparison (replacing an earlier Leaflet pass, which wasn't:
Leaflet is a raster/DOM renderer, not a fair comparison to Esri's WebGL SDK).
Same data, same dual-circle symbology, same popup content. See
[`maplibre/README.md`](maplibre/README.md) for the findings.

Next steps: include the matplotlib charts from the original notebook in the
UI, and keep pushing the symbology further (e.g. a small inline sparkline
per reservoir).
