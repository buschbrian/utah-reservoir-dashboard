# Authoritative source inventory

Status: Working inventory, checked 2026-08-15

This inventory turns the source preference in the modernization plan into a
review checklist. It separates measurement services from map services because
an ArcGIS service is not automatically the best source for a measurement. The
data owner's public API remains the source for storage and snow measurements;
the data owner's ArcGIS REST layer is preferred for boundaries and facility
geometry.

## Rules for choosing a source

1. Use a public service operated or named by the data owner.
2. Use the owner's measurement API for observed values. Do not replace it with
   an ArcGIS display layer that may round, delay, or omit records.
3. Prefer the owner's ArcGIS REST layer for spatial context when the dashboard
   can set a deadline and keep useful local data on screen after a service
   failure.
4. Commit normalized measurements, reviewed assignments, and analytical
   geometry when a changing live response would make a published result hard
   to reproduce.
5. Use geometry accurate to about 100 metres or finer for new GeoJSON. A
   coarser file needs measured size savings, unchanged analytical results, and
   an architecture decision.
6. Record one current owner, endpoint, update schedule, failure behavior, and
   copy policy for every source before it becomes a dashboard layer.

## Current inventory

| Data | Authoritative owner and service | Dashboard use | Copy and update behavior | Failure behavior | Geometry and status |
|---|---|---|---|---|---|
| Reservoir storage observations | Bureau of Reclamation data API: `https://data.usbr.gov/rise/api/result` | Daily and month-end storage records | `refresh_reservoirs.py` validates and commits a normalized `reservoirs.json` each day | An individual failure keeps the last known record; a broad failure does not replace the complete payload | No geometry is taken from this service. Adopted. |
| Reservoir storage observations | Natural Resources Conservation Service water and climate API: `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data` | Daily and month-end storage records for provider stations | The same normalized daily payload as above | The same per-site and broad-failure checks as above | No geometry is taken from this service. Adopted. |
| Dam capacity and outlet points | U.S. Army Corps of Engineers National Inventory of Dams public ArcGIS service: `https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer/0` | Capacity evidence, dam identifiers, and outlet points used for drainage-area assignment | Capacity and point decisions are committed so an upstream edit cannot change a past assignment during a daily refresh | No runtime dependency; a deliberate rebuild stops before writing if a dam is absent or implausibly far from its reservoir | Migration candidate. New candidate audits use this owner-operated service, but `capacities.json`, `tools/add_dam_points.py`, and two older audits still identify `https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/NID_v1/FeatureServer/0`. Compare identifiers, fields, capacities, and coordinates before switching them. |
| Six-digit drainage areas | U.S. Geological Survey Watershed Boundary Dataset ArcGIS service: `https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/3` | Boundaries, labels, reservoir assignment, and drainage-area summaries | Scope fetches obtain the complete object-ID set, validate it, and commit GeoJSON. Scope changes are deliberate, not part of the daily refresh | No runtime service dependency; a failed rebuild leaves the last verified file in place | New scope files request `0.001` degrees, about 100 metres. `huc6.geojson` remains the measured 500-metre ADR-005 exception. Adopted. |
| Utah state boundary | Utah Geospatial Resource Center Utah State Boundary ArcGIS service: `https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahStateBoundary/FeatureServer/0` | Utah outline, outside-state mask, and point-in-state checks | `scripts/fetch-utah-boundary.mjs` validates one Utah polygon and commits the normalized copy when run | No runtime service dependency; a failed rebuild writes nothing | Requests `0.0001` degrees, about 10 metres. Adopted under ADR-014. |
| Current drought polygons | U.S. Drought Monitor ArcGIS service, produced by the National Drought Mitigation Center, U.S. Department of Agriculture, and National Oceanic and Atmospheric Administration: `https://services5.arcgis.com/0OTVzJS4K09zlixn/arcgis/rest/services/USDM_current/FeatureServer/0` | Source geometry for the planned drought and drainage-area statistics slice | The daily workflow validates the complete current layer and commits `data/drought/usdm-current.geojson`; the producer normally publishes a new map each week | A failed independent download keeps the last verified drought file and does not block current reservoir data | Requests `0.001` degrees, about 100 metres. Adopted for analysis; not yet loaded by a dashboard view. |
| Snow monitoring-site inventory | Natural Resources Conservation Service station API: `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations`, joined to the full-resolution U.S. Geological Survey drainage-area layer | Reviewed station list and drainage-area assignment | `snow_sites.json` is a committed inventory rebuilt deliberately | No runtime service dependency; an incomplete inventory build writes nothing | Full-resolution drainage-area geometry is used for point assignment. Adopted. |
| Snow measurements | Natural Resources Conservation Service water and climate API: `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data` | Daily snow-water values and 1991–2020 comparisons | `refresh_snowpack.py` validates every reviewed station and writes `snowpack.json` atomically | A short response is retried per station; any unresolved site keeps the previous complete payload | No geometry is taken from this service. Adopted; interface view remains to be built. |
| Reservoir discovery and basin references | Bureau of Reclamation public ArcGIS feature services, including `https://services5.arcgis.com/HDRa0B57OVrv2E1q/ArcGIS/rest/services/Reclamation_Reservoirs/FeatureServer` | Discovery, scope review, and design comparison only | No ArcGIS feature-service response is copied into daily observed storage | An outage cannot change or stop the measurement refresh | Reference only. Promote a specific layer only after its fields, update schedule, and failure path are documented here. |
| Map background | Esri public basemaps `topo-vector`, `gray-vector`, and direct portal item `7dc6cea0b1764a1f9af2e679f642f0f5` | Optional geographic background | Loaded at runtime; no local copy | Each candidate has a 10-second deadline. The application tries the next candidate and ultimately keeps reservoirs and drainage areas visible without a background map | Optional runtime context. Adopted under the existing anonymous-access and fallback contract. |

## Next source slices

### 1. Migrate the dam inventory reference

This is the next source implementation, but it is not a search-and-replace.

1. Query the old hosted layer and the owner-operated U.S. Army Corps layer for
   every committed dam identifier.
2. Normalize field names from both schemas.
3. Compare dam identifier, capacity fields, longitude, latitude, and reservoir
   distance. Report missing or changed records without writing.
4. Require zero unexplained identifier losses and review every capacity or
   coordinate change.
5. Change the rebuild tools and `capacities.json` source metadata only after
   the parity report passes. Add a regression test that rejects the old
   service URL in active tools.

### 2. Publish drought statistics before a drought view

1. Intersect the committed drought polygons with the committed six-digit
   drainage areas.
2. Publish a small, dated result per drainage area: total area and area in
   each reported drought class.
3. Verify that class areas do not overlap incorrectly and that reported areas
   close to the drainage-area total within a stated tolerance.
4. Add the dashboard view only after this analytical contract is tested.

### 3. Split research geography from the first page load when measured

The broader Upper Colorado geometry is intentionally retained as a future
regional-explorer seed. It should remain in the public reference data for now.
Before adding more regions, measure transfer and parse cost, then create a
smaller map-start payload if the current broader copy becomes material.

## Review boundary

This inventory records ownership and current behavior; it does not claim that
every upstream value is final. Provider values can be revised. Source changes
that can alter a measurement, capacity, point assignment, or geographic scope
require a parity report and a separate reviewed change.
