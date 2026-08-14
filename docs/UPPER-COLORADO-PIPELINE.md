# Upper Colorado watershed pipeline

## Status

Configured for research and candidate audits. It does not change the
dashboard's accepted 14-unit Utah-connected geography or its published totals.

## Named scope

`upper-colorado` selects all six-digit hydrologic units in region 14:

| HUC6 | Name |
|---|---|
| 140100 | Colorado Headwaters |
| 140200 | Gunnison |
| 140300 | Upper Colorado-Dolores |
| 140401 | Upper Green |
| 140402 | Great Divide Closed Basin |
| 140500 | White-Yampa |
| 140600 | Lower Green |
| 140700 | Upper Colorado-Dirty Devil |
| 140801 | Upper San Juan |
| 140802 | Lower San Juan |

The boundaries are generated from the public USGS Watershed Boundary Dataset
ArcGIS layer and committed separately at
`data/watersheds/upper-colorado-huc6.geojson`. The production dashboard keeps
using `huc6.geojson`.

```bash
python tools/fetch_watershed_scope.py --scope upper-colorado --dry-run
python tools/audit_awdb_stations.py --scope upper-colorado
python tools/audit_snotel.py --scope upper-colorado
```

The fetcher first requests every matching object ID, then downloads bounded
GeoJSON batches using the layer's advertised record limit. It refuses partial,
duplicate, missing, or out-of-region results. ArcGIS layer metadata varies by
service generation, so the object-ID field is resolved from `objectIdField`,
`objectIdFieldName`, or the field whose type is `esriFieldTypeOID`.

## Measured storage-station baseline

The live AWDB audit on 2026-08-11 returned 347 active national storage
stations. Point-in-polygon selection against the 10 committed units found 20
already tracked sites and 39 additional candidates:

| HUC6 | Tracked | Candidates |
|---|---:|---:|
| 140100 Colorado Headwaters | 0 | 10 |
| 140200 Gunnison | 0 | 11 |
| 140300 Upper Colorado-Dolores | 1 | 3 |
| 140401 Upper Green | 4 | 3 |
| 140402 Great Divide Closed Basin | 0 | 0 |
| 140500 White-Yampa | 0 | 4 |
| 140600 Lower Green | 14 | 3 |
| 140700 Upper Colorado-Dirty Devil | 1 | 0 |
| 140801 Upper San Juan | 0 | 4 |
| 140802 Lower San Juan | 0 | 1 |

This is discovery evidence, not admission. AWDB does not provide the capacity
denominator required for percent-full totals. Each candidate must still pass
the existing National Inventory of Dams identity/capacity rules before it can
enter a refresh configuration.

## Source roles

- RISE and AWDB remain the observed-storage sources used by the Python refresh
  in GitHub Actions.
- The [USBR Addressing Drought Across the West Experience](https://experience.arcgis.com/experience/512cef7647fe42698dc05dd4e75d4343/page/Current-Conditions)
  and its Major Reclamation River Basins layer are design and geographic-scope
  references only. They are not measurement dependencies.
- The watershed query follows Esri's [ArcGIS REST layer query
  contract](https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/).
- The optional Python backend follows the documented
  [`FeatureLayer.query`](https://developers.arcgis.com/python/latest/guide/working-with-feature-layers-and-features/)
  pattern. ArcGIS API for Python 2.4.3 requires Python 3.10-3.13, so it is kept
  out of the normal daily refresh environment.
- pandas normalizes ArcGIS attributes and NumPy calculates deterministic
  geometry statistics. HUC identifiers remain strings, never numeric values.
