# Authoritative source inventory

Status: Working inventory, checked 2026-08-16

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
| Dam capacity and outlet points | U.S. Army Corps of Engineers National Inventory of Dams public ArcGIS service: `https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer/0` | Capacity evidence, dam identifiers, and outlet points used for drainage-area assignment | Capacity and point decisions are committed so an upstream edit cannot change a past assignment during a daily refresh | No runtime dependency; a deliberate rebuild stops before writing if a dam is absent or implausibly far from its reservoir | Adopted 2026-08-18, replacing the hosted copy at `https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/NID_v1/FeatureServer/0`. The parity report is below: both services return identical rows for every committed identifier, and no published number moved. The layer is pinned rather than searched for. |
| Drainage areas | U.S. Geological Survey Watershed Boundary Dataset ArcGIS service: `https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer`. Each hydrologic level is a layer on it — HUC2 is 1, HUC4 is 2, HUC6 is 3, HUC8 is 4 — and the scope's level decides which is queried. The published dashboard reads layer 3, for the 75-basin `west-huc6` scope (ADR-063). | Boundaries, labels, reservoir assignment, and drainage-area summaries | Scope fetches obtain the complete object-ID set, validate it, and commit GeoJSON. Scope changes are deliberate, not part of the daily refresh | No runtime service dependency; a failed rebuild leaves the last verified file in place | A scope file a figure is measured against requests `0.0005` degrees, about 56 metres, under ADR-037: measurement showed the source stops adding vertices past that point. `huc6.geojson` was refetched at it when the outlines became a drawn subject, and `data/watersheds/west-huc6.geojson` when it became the drawn scope (ADR-063) -- at the 100-metre default two of the fourteen published drought figures moved by a tenth of a point, which is a rounding step at the precision this project publishes. Unpublished research scopes still request `0.001`. Adopted. |
| Utah state boundary | Utah Geospatial Resource Center Utah State Boundary ArcGIS service: `https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahStateBoundary/FeatureServer/0` | Python's `in_utah` and `intersects_utah` point-in-state checks. No map draws a mask from it any more (ADR-067); the outside-state mask this row used to serve is retired | `scripts/fetch-utah-boundary.mjs` validates one Utah polygon and commits the normalized copy when run | No runtime service dependency; a failed rebuild writes nothing | Requests `0.0001` degrees, about 10 metres. Adopted under ADR-014. |
| Current drought polygons | U.S. Drought Monitor ArcGIS service, produced by the National Drought Mitigation Center, U.S. Department of Agriculture, and National Oceanic and Atmospheric Administration: `https://services5.arcgis.com/0OTVzJS4K09zlixn/arcgis/rest/services/USDM_current/FeatureServer/0` | Source geometry for the planned drought and drainage-area statistics slice | The daily workflow validates the complete current layer and commits `data/drought/usdm-current.geojson`; the producer normally publishes a new map each week | A failed independent download keeps the last verified drought file and does not block current reservoir data | Requests `0.001` degrees, about 100 metres. Adopted for analysis; not yet loaded by a dashboard view. |
| Snow monitoring-site inventory | Natural Resources Conservation Service station API: `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations`, joined to the full-resolution U.S. Geological Survey drainage-area layer | Reviewed station list and drainage-area assignment | `snow_sites.json` is a committed inventory rebuilt deliberately | No runtime service dependency; an incomplete inventory build writes nothing | Full-resolution drainage-area geometry is used for point assignment. Adopted. |
| Snow measurements | Natural Resources Conservation Service water and climate API: `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data` | Daily snow-water values and 1991–2020 comparisons | `refresh_snowpack.py` validates every reviewed station and writes `snowpack.json` atomically | A short response is retried per station; any unresolved site keeps the previous complete payload | No geometry is taken from this service. Adopted; interface view remains to be built. |
| Reservoir discovery and basin references | Bureau of Reclamation public ArcGIS feature services, including `https://services5.arcgis.com/HDRa0B57OVrv2E1q/ArcGIS/rest/services/Reclamation_Reservoirs/FeatureServer` | Discovery, scope review, and design comparison only | No ArcGIS feature-service response is copied into daily observed storage | An outage cannot change or stop the measurement refresh | Reference only. Promote a specific layer only after its fields, update schedule, and failure path are documented here. |
| Map background | Esri public basemaps `oceans` (leading), `dark-gray-vector`, `gray-vector`, `topo-vector`, and direct portal item `7dc6cea0b1764a1f9af2e679f642f0f5` | Optional geographic background on every map | Loaded at runtime; no local copy | Each candidate has a 10-second deadline. The application tries the next candidate and ultimately keeps reservoirs and drainage areas visible without a background map | Optional runtime context. Adopted under the existing anonymous-access and fallback contract. `oceans` leads both theme chains from 2026-08-16: its bathymetry and shaded relief are the terrain the water sits in, which the deliberately featureless gray canvases could not show. Its base is a public tile service and its labels a public vector style; both were verified anonymous before adoption. |
| State boundaries | Esri generalized boundaries, published by Esri Demographics: `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_States_Generalized_Boundaries/FeatureServer/0` | Outlines and state names on the drought map, where the national drought sweep needs something that says which land it crosses | Loaded at runtime; no local copy. Nothing on any page is computed from these boundaries | An 8-second deadline; a layer that does not answer is not added, and the drought classes, drainage outlines, reservoirs and every published figure are already drawn from local data | Publisher's own generalization. Optional runtime context, adopted 2026-08-16. Verified anonymous. |
| County boundaries | Esri generalized boundaries, published by Esri Demographics: `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Counties_Generalized_Boundaries/FeatureServer/0` | Outlines and county names on the drought map, hidden until the reader has zoomed past 1:2,500,000 | Loaded at runtime; no local copy. Nothing is computed from *these* boundaries: the county assignment is an analytical result and comes from the detailed layer in the row below, per the re-sourcing condition this table already stated | The same 8-second deadline and the same non-addition on failure | Publisher's own generalization. Optional runtime context, adopted 2026-08-16. The scale limit is on the layer, not only its labels, so it does not fetch features nobody will see. Verified anonymous. |
| County assignment | Esri Living Atlas, USA Census Counties, layer `dtl_cnty`: `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Counties/FeatureServer/0`. Marked authoritative; carries the U.S. Census Bureau 2020 boundaries | Which county each reservoir sits in, for the search and filter axis (ADR-058). Not an aggregation axis, and not drawn | `tools/build_county_assignments.py` resolves one point per reservoir against the service and commits `counties.json`. Rebuilt deliberately, never during the daily refresh | No runtime dependency. A point that resolves to no county stops the rebuild before writing, because a partial file publishes a filter that silently omits reservoirs | **No geometry is copied at all.** The service answers with a code, so there is nothing to commit and nothing to keep in step -- ADR-048's rule reaching a second geography. The *detailed* layer is required rather than preferred: the generalized boundaries in the row above, and a 100-metre file requested under rule 5, both place Lost Lake outside Wasatch County. Adopted 2026-08-18. |
| Drought-monitor land mask | U.S. Census Bureau TIGERweb, layer 0 of the States and Counties service: `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0`. The same owner-operated service the county assignment reads, one layer up | The extent the drought engine measures against, so land the monitor does not cover is reported as unmeasured rather than as land with no drought on it (ADR-059) | `tools/fetch_us_land_mask.py` validates that every western state is present and commits `data/us-land.geojson`. Rebuilt deliberately, never during the daily run | No runtime dependency. A missing mask **stops** the coverage run rather than defaulting: running without one does not fail, it silently reports every border basin's far half as drought-free, which looks like a clean run | Requests `0.001` degrees, the 100-metre default under rule 5; no exception is claimed, because the sampling grid is an order of magnitude coarser and a finer mask could not move a published figure. Committed, never published -- the engine reads it offline like `huc6.geojson`. Adopted 2026-08-18. |
| Drainage-area boundaries, drawn | Esri Living Atlas copies of the USGS Watershed Boundary Dataset, one service per level: `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Watershed_Boundary_Dataset_HUC_6s/FeatureServer/0` (and the HUC 4s and HUC 8s beside it) | The drainage outlines and shapes the maps draw | Loaded at runtime, scoped by an explicit list of the units in scope. The committed `huc6.geojson` remains the assignment source, so which unit a reservoir belongs to is still reproducible from a file and never depends on a service | The same deadline and non-addition on failure as the boundaries above | Measured before adopting: the fourteen published basins cost about 12 KB at 1:18,000,000 and 24 KB at 1:9,000,000 once the SDK quantizes them to the view, against 982 KB for the same outlines inside `reference.json`. The saving is the quantization, not the hosting -- the same features fetched in bulk are 935 KB. This service ignores `maxAllowableOffset`. Verified anonymous. |

## Next source slices

### 1. Migrate the dam inventory reference -- done 2026-08-18

Scoped as a five-step parity exercise. Two of the five steps turned out not to
exist, and the measurement found something the plan had not looked for.

**Step 2 was retired by measurement.** Both services publish **81 fields under
the same names** -- `NIDID`, `NAME`, `NID_STORAGE`, `MAX_STORAGE`,
`NORMAL_STORAGE`, `LATITUDE`, `LONGITUDE`. There was nothing to normalize.

**The parity report passed with nothing to review.** All 29 committed dam
identifiers resolve in both services, returning **33 rows each** -- the counts,
the names, all three storage figures and both coordinates agree row for row.
Zero unexplained losses, zero differing values. Rebuilding the dam points
against the owner service reproduces all 29 committed positions exactly.

**What the parity plan did not ask about: a dam identifier is not unique.** It
names a *project*, and three of the committed ones return several structures --
Lost Lake and Hyrum have a dike beside the dam, Stateline has two. Every row of
a project carries the same storage, so capacity was never exposed; the
coordinates differ by up to 600 metres, and that point is the drainage-area
assignment point. `tools/add_dam_points.py` kept whichever row arrived last,
so the two services' different row orders produced different committed points
from identical data. It now chooses the principal structure by rule. No
published assignment changes either way at HUC-6, where every structure of a
project falls in one drainage area -- see ADR-057 for why that is a property of
the level rather than of the data.

**Step 5 is done.** `tools/build_capacity_table.py` no longer locates its layer
by searching ArcGIS Online for the most-viewed copy -- a search that could never
reach this service, since USACE runs its own ArcGIS Server and publishes nothing
to ArcGIS Online, and that wrote its result into `capacities.json` as the
provenance. All five active tools name the owner service, and
`src/source-inventory.test.ts` rejects the retired URL in every one of them and
in the three committed files that republish it.

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

### 4. Keep the hosted boundary layers inside their contract

The state and county layers are the first runtime service dependency any
dashboard view has taken on for map context, so the condition rule 3 states is
enforced in code rather than assumed: `src/arcgis/reference-layers.ts` loads
each layer against a deadline and adds it to the map only if it answered. The
browser suite therefore checks the layer list against what actually loaded
rather than against a fixed list -- a refused service is a supported outcome,
and a test that failed on it would be testing the publisher's uptime instead of
this project's behavior.

Two things to watch if they change upstream. The name fields are read once each
(`STATE_NAME`, `NAME`); a rename would silently produce blank labels rather than
an error. And these are Esri's own generalizations rather than a tolerance this
project requested, so rule 5 does not apply to them -- if either is ever used
for an analytical result, it stops being optional context and has to be
re-sourced from the owner at a stated tolerance.

## Review boundary

This inventory records ownership and current behavior; it does not claim that
every upstream value is final. Provider values can be revised. Source changes
that can alter a measurement, capacity, point assignment, or geographic scope
require a parity report and a separate reviewed change.
