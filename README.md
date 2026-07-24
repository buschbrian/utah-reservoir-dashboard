# Utah Reservoir Drought Dashboard

A static web map of current storage levels across 28 Bureau of
Reclamation-monitored reservoirs in Utah, colored by percent of
period-of-record maximum storage and sized by current storage volume.

Built with the [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/)
(loaded directly from Esri's CDN — no build step, no framework). Data comes
from the [Bureau of Reclamation RISE API](https://data.usbr.gov/).

`reservoirs.json` is a static snapshot generated from a Python/pandas
pipeline — it is not live-refreshing.

This next step for this project is to clean up the popups and include the charts from matplotlib and also explain the dataset and peroid of record max as well as start to begin to have more advanced symbology.
