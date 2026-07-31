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
few days of any series as subject to revision.

Next steps: clean up the popups and include the matplotlib charts, explain
the dataset and period-of-record max in the UI itself, and start building
out more advanced symbology.
