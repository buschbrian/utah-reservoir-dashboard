# Utah Water Dashboard

**Live site:** <https://buschbrian.github.io/utah-water-dashboard/>

A public dashboard for water conditions in Utah and the connected Colorado
River and Great Basin drainage areas: what is stored in the reservoirs, how
much snow is in the mountains, and how much of the land is in drought. It
combines official observations, traceable capacity figures, twelve months of
history, and drainage-area context.

The same validated data is presented through one ArcGIS 5.1 application, and
each page is named for its own subject (ADR-045):

| View | Subject | Purpose |
|---|---|---|
| [Storage map](./) | Utah Reservoir Storage | Current reservoir storage on a responsive ArcGIS map. |
| [Storage charts](overview.html) | Utah Storage Charts | A weekly digest, cross-filtered summaries, six ArcGIS charts, and an accessible exact-value table. |
| [Snowpack](snow.html) | Utah Snowpack | The season's snow by drainage area and measurement site, opening on the season's peak. |
| [Drought](drought.html) | Utah Drought | The weekly Drought Monitor by drainage area, against the water banked in it. |
| [Methods and sources](methods.html) | Methods and Sources | Where the numbers come from, how they are collected, and how each value is worked out. |
| [Public data API](data.html) | Public Data API | Stable JSON downloads, field definitions, and code examples. |

The root page and its stable `modern.html` alias are the ArcGIS Maps SDK for
JavaScript application. New interface work targets these primary surfaces.

## How this project is made

The judgment is human; most of the typing is not. All of the UI/UX design,
the geographic decisions (which drainage areas are in scope, how reservoirs
are assigned, what a map draws and at what level), and the visualization
design (colour ramps, class bands, symbol composition, label placement,
chart forms) are human-made. Most of the JavaScript/TypeScript and Python
that implements them is written with agentic AI, and every change lands
through human review, the test suites, and the decision records — the wiki's
[Lessons Learned](../../wiki/Lessons-Learned) page records candidly how that
division of labor has worked in practice.

## Use the dashboard

The ArcGIS dashboard provides these map controls:

- Point at a reservoir for its name, percent full, and data date.
- Select a reservoir for its complete record and 12-month chart.
- Filter by state, subregion, drainage area, county, percent-full class, or
  show only reservoirs with late data. The three geographic filters narrow
  each other, so you can drill down from a state to one drainage area. Search
  by reservoir name, drainage area or county.
  Other reservoirs remain visible in gray to preserve geographic
  context.
- Move or play the month slider to compare the last 12 months.
- Open the reservoir table below the map to sort every matching reservoir by
  storage, full level, drainage area, or reading date, and download exactly
  the rows and order on screen as a CSV file.
- Open the reservoir list to reach every site with a keyboard.
- Copy a link to the complete view. The address can carry `?reservoir=`,
  `?drainage=`, `?class=`, `?late=`, `?month=`, `?table=`, and `?sort=`
  together.

The storage charts answer comparison questions that a map cannot. Their search,
drainage-area, and reporting filters update the summary strip, all six ArcGIS
charts, and the semantic table as one view. Lake Powell starts excluded from
the default map and charts, but remains in the source data and can be included.

## Quick start

Requirements:

- Node.js 22
- Python 3.11 or newer for the data pipeline
- A Playwright Chromium installation for browser smoke tests

```bash
npm ci
npm run dev
```

Vite opens the storage map. Open `/overview.html` for storage charts. The map
needs network access for basemap services; stored reservoir data still loads
when those services do not answer.

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite development server. |
| `npm run typecheck` | Check the strict TypeScript project. |
| `npm test` | Run the Vitest unit suite. |
| `npm run budget:sdk` | Check the planned ArcGIS 5.1 bundle against its size budget. |
| `npm run build` | Typecheck, test, check the SDK budget, and build `dist/`. |
| `python -m pytest tests/ -q` | Run pipeline and drainage-area tests without network access. |
| `node tests/smoke.mjs` | Check retired route redirects in Chromium. |
| `python refresh_reservoirs.py --dry-run` | Refresh and validate storage data without writing. |
| `python tools/fetch_watershed_scope.py --scope utah-connected --dry-run` | Rebuild drainage-area boundaries without writing. |
| `python tools/fetch_watershed_scope.py --scope upper-colorado --dry-run` | Validate all Upper Colorado HUC6 boundaries without replacing the dashboard scope. |
| `python tools/audit_awdb_stations.py --scope upper-colorado` | Audit AWDB storage stations across the configured Upper Colorado HUC6 scope. |
| `npm run boundary:utah -- --dry-run` | Check the authoritative Utah boundary without writing. |

The browser smoke test expects a current `dist/` directory and an existing
`screenshots/` directory:

```bash
npm run build
mkdir -p screenshots
node tests/smoke.mjs
```

## Data and methods

The [public data API documentation](data.html) describes stable paths for the reservoir,
snow and reference payloads, their complete field definitions, and browser and Python
examples.

[`reservoirs.json`](reservoirs.json) is the published data contract. The daily
pipeline rebuilds it from observations dating to 2015 and preserves the last
known record when an individual source cannot be reached.

To work on the pipeline in an isolated environment:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-test.txt
python -m pytest tests/ -q
python refresh_reservoirs.py --dry-run
```

The version ranges match CI and the scheduled refresh workflow.

Watershed geography is chosen by named scope, so it cannot change by accident.
`west-huc6` is what the maps draw and what reservoirs are assigned against;
`utah-connected` retains the 14 units the roster was admitted from and is what
the storage map opens on; `upper-colorado` selects the 10 HUC6 codes beginning
with region 14 and writes `data/watersheds/upper-colorado-huc6.geojson`. The
HUC4 and HUC8 western scopes are registered, fetched and drawn by nothing.

The watershed fetcher uses the public ArcGIS REST query API by default. To
exercise the ArcGIS API for Python `FeatureLayer` query path, use Python
3.10-3.13 (the supported range for ArcGIS API 2.4.3) in a separate environment:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-gis.txt
python tools/fetch_watershed_scope.py --scope upper-colorado --backend arcgis --dry-run
```

Both backends first obtain the complete object-ID set and then fetch bounded
GeoJSON batches. The script refuses missing, duplicate, out-of-region, or
partial results. Its report uses pandas to normalize ArcGIS attributes and
NumPy to summarize geometry size; no broader-scope file is loaded by the
dashboard until a separate product decision changes that contract.
The measured scope and current candidate baseline are recorded in
[`docs/UPPER-COLORADO-PIPELINE.md`](docs/UPPER-COLORADO-PIPELINE.md).

### Sources

- Storage observations come from the [Bureau of Reclamation RISE
  API](https://data.usbr.gov/) and the [USDA Natural Resources Conservation
  Service AWDB API](https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui.html).
- Reclamation's [Addressing Drought Across the West Experience
  Builder](https://experience.arcgis.com/experience/512cef7647fe42698dc05dd4e75d4343/page/Current-Conditions)
  and its Major Reclamation River Basins layer are design and scope references
  only. GitHub Actions continues to fetch observed storage from RISE/AWDB; an
  Experience Builder or feature-service outage cannot change or stop the
  published measurements.
- Capacity for Reclamation sites comes from the U.S. Army Corps of Engineers
  National Inventory of Dams and is committed in
  [`capacities.json`](capacities.json). AWDB sites use the provider's reservoir
  metadata.
- Six-digit drainage areas come from the U.S. Geological Survey Watershed
  Boundary Dataset. The maps draw the 75 basins of the west, committed in
  [`west-huc6.geojson`](data/watersheds/west-huc6.geojson); the fourteen the
  reservoir roster was admitted from stay committed in
  [`huc6.geojson`](huc6.geojson) and are what the storage map opens on
  ([ADR-063](docs/decisions/ADR-063-draw-the-west-and-open-on-the-roster.md)).
- The state outline comes from the Utah Geospatial Resource Center's
  maintained Utah State Boundary and is committed in
  [`utah-boundary.geojson`](utah-boundary.geojson). It drives both the map
  mask and point-in-state classification; see [ADR-014](docs/decisions/ADR-014-use-the-ugrc-utah-state-boundary.md).

Every reservoir record includes the provider, station or item identifier,
data frequency, data date, capacity source, and drainage-area assignment point.
Source values are provisional and can be revised by their publisher.

### Metrics

- **Percent full** is current storage divided by capacity. If capacity is not
  available, the highest observed storage since 2015 is the fallback full
  level.
- **Normal for this week** is the median observation near the same calendar
  date in prior years.
- **History rank** compares the current value with observations near the same
  date in prior years; the current year is not ranked against itself.
- **Change** is reported over 7, 30, and 365 days when the source frequency
  supports it.
- **Monthly history** contains mean, minimum, maximum, ending storage, and the
  prior-years normal for each of the last 12 months.
- **Freshness** is evaluated per reservoir. Daily sources are late after two
  days; month-end sources use a 45-day threshold.

Drainage-area and statewide percentages are capacity-weighted:

```text
percent full = sum(current storage) / sum(full level) × 100
```

They describe only the reservoirs tracked by this dashboard, not all water in
a drainage area. The overview always shows the reservoir count and combined
full level beside a drainage-area percentage.

### Geographic scope

A reservoir is assigned by its dam or outlet point, not by the center of the
water polygon. A drainage area is in scope when it intersects Utah and belongs
to the Colorado River or Great Basin systems: hydrologic regions 14, 15, and
16. Region 17 is excluded because it drains to the Columbia River system.

This rule admits connected sites outside Utah, including Fontenelle, while
excluding reservoirs in basins that never affect the state. Upper Snake is
excluded because it drains to the Columbia River system.

Reservoir location and drainage assignment are separate facts.
`intersects_utah` says whether the stored-water surface reaches Utah, including
cross-border Bear Lake and Meeks Cabin Reservoir. `in_utah` describes the
provider's published point. `huc6` is assigned by the dam or outlet. See
[ADR-010](docs/decisions/ADR-010-colorado-and-great-basin-systems-only.md) and
[ADR-013](docs/decisions/ADR-013-count-reservoirs-whose-waterbody-intersects-utah.md).

## Architecture

The primary application is typed and component based. The former application
paths are permanent compatibility redirects, not parallel product targets.

Five reader-facing surfaces, three compatibility redirects, one frozen source
oracle, and a Python pipeline.

| Path | Role |
|---|---|
| `index.html`, `modern.html` + `src/` | Primary ArcGIS 5.1 and Calcite 5 application; `modern.html` is a stable alias. |
| `overview.html` + `src/overview*` | ArcGIS Charts data workspace and shared filter model. |
| `snow.html` + `src/snow*` | Snowpack view: the seasonal curve, the basin choropleth and site map with its key on the map, and one site's own season. |
| `drought.html` + `src/drought*` | Drought view: weekly Drought Monitor coverage by drainage area, the monitor's polygons over terrain shading, the storage-against-drought scatter, the same comparison ranked, and the severity distribution. |
| `methods.html` + `src/methods.ts` | Methods and sources page: where the numbers come from and how each value is worked out. |
| `data.html` + `src/data-docs.ts` | Public data API documentation: stable paths, field definitions, and code examples. |
| `legacy/index.html`, `maplibre/index.html`, `explore.html` | Compatibility redirects to the storage map and storage charts. |
| `public/retired-route.js` | Allowlisted state translation for the three redirects. |
| `shared/reservoir-viz.js` | Source-only color-table owner and porting test oracle; not published. |
| `refresh_reservoirs.py`, `refresh_snowpack.py` | Daily storage and snow pipelines, and metric calculation. |
| `huc.py` | Drainage-area geometry, assignment, and pipeline rollups. |
| `tools/` | On-demand pipeline and audit tools: drought download and coverage, source audits, the symbol profiler, and the transfer audit. |
| `tests/smoke-modern.mjs` | Browser contract for every surface: rendering, deep links, failure paths, accessibility, and label fonts. |
| `tests/smoke.mjs` | Browser contract for the compatibility redirects. |

Shared front-end modules worth knowing about:

| Module | Role |
|---|---|
| `src/ui/map-hover.ts` | The pointer machinery all three maps use: one hit test per frame, stale answers discarded, an edge-safe card. |
| `src/ui/hover-content.ts` | What every hover card says, kept pure so the sentences are unit-tested. |
| `src/ui/view-map.ts`, `src/ui/theme-basemap.ts` | Framing, controls, navigation bounds and the theme-following background for the snow and drought maps. |
| `src/viz/label-scales.ts` | The label ladder: which names appear at which scale, and how large each is drawn. |
| `src/viz/classes.ts`, `snow-classes.ts`, `drought-classes.ts` | One colour table per map, each the only place its breaks and colours are written. |
| `src/arcgis/reference-layers.ts` | State and county boundaries from hosted services, loaded against a deadline and added only if they answer. |

The load-bearing rules are:

1. **Runtime data is copied, never bundled.** Daily refreshes must not require
   application data to be compiled into JavaScript.
2. **The frozen source oracle is not a runtime.** The typed port is tested
   against `shared/reservoir-viz.js`, but that file is not published.
3. **Color classes have one source of truth, and one language per map.**
   Renderers, legends, filters, and charts derive from the same table. Storage,
   snow, and drought each own a separate table, and a test asserts no colour
   appears in two of them — two maps of unrelated quantities must not speak the
   same colour language, on one page or across pages.
4. **Retired routes preserve bookmarks, not runtimes.** Their allowlisted
   redirects reach the closest ArcGIS surface without loading the old engines.
5. **A public page never asks for ArcGIS credentials.** Secured resources fail
   promptly and fall back rather than opening a sign-in dialog.
6. **Visible text uses Simplified Technical English.** Tests reject retired or
   unexplained specialist terms in rendered content.
7. **Anything that can wait forever needs a deadline.** Runtime fetches, the
   basemap chain, the chart render, and the hosted boundary layers each have
   one, and each degrades to a stated fallback rather than an endless spinner.
8. **Accessibility is a gate, not an aspiration.** axe-core runs over every
   page at every tested width on every browser-suite run, at WCAG 2.1 AA. The
   two accepted exceptions are both in vendor components and each is documented
   where it is allowed.
9. **A borrowed line never draws over the subject.** A basemap's reference
   layers render above every operational layer, so they are moved beneath this
   project's own on every map and every basemap swap.
10. **Every comparison names the years it came from.** Two normals are
    published per reservoir — the 1991–2020 standard and the years this site
    collects — and no figure is shown without the period and the number of
    years behind it.
11. **Numbers are measurements or arithmetic on measurements.** Nothing is
    modelled or forecast, and two shares with different denominators are never
    subtracted into a single figure.

The rationale and rejected alternatives are in the
[architecture decision records](docs/decisions/).

## Refresh, build, and deploy

The scheduled [refresh workflow](.github/workflows/refresh-data.yml) runs the
Python pipeline, retains good previous records when individual feeds fail,
refuses to publish a broadly failed reservoir refresh, and maintains the
late-data issue. Snow measurements refresh independently, so a provider
failure keeps the last complete `snowpack.json` without blocking reservoir
updates. The weekly drought polygons and the coverage figures computed from
them move together or not at all: the coverage is recomputed from the
polygons that were just downloaded, both files are staged in one commit, and
a mismatch restores both rather than publishing two different weeks. A missed
weekly release opens and closes its own issue. Changed runtime data is
committed to `main`.

The [Pages workflow](.github/workflows/deploy-pages.yml) builds and publishes
`dist/` after direct pushes to `main` and after successful scheduled refreshes.
Vite copies the reservoir, snow, reference, and boundary files and the three
compatibility redirects into the artifact. The workflow checks
that every public URL exists and that the data payload did not leak into a
JavaScript bundle.

The [CI workflow](.github/workflows/ci.yml) runs TypeScript checks, Python
tests, the SDK bundle budget, and browser smoke tests on pushes and pull
requests. Browser assertions read the expected reservoir count from the
current payload; tests do not hard-code values that change in the daily feed.

## Modernization status

Phases 0, 1, and 1.5 are complete: the build and deploy pipeline, strict data
types and runtime validation, tested rollups, drainage-area enrichment, and
the typed application foundation are in place. The connected-site inventory
now covers every published drainage area. Current U.S. Drought Monitor
polygons are downloaded as verified GeoJSON, and both interface views
shipped: the snowpack page draws all 217 full-resolution-verified monitoring
sites against their 1991–2020 comparisons, and the drought page reads the
monitor's weekly map by drainage area beside the storage that drains it.

Phase 2 is complete: the unified ArcGIS 5.1 and Calcite 5 application runs at
the root and at its stable `modern.html` alias, with its ArcGIS Charts
workspace at `overview.html`.

Phase 3 is complete: pointer hover, corrected map-click selection, layer-view
highlight, filter dimming, and eased selection all landed, and the measured
symbol and filter cost is recorded in the modernization plan. Phase 5 is also
complete: one filter and selection state object drives the map, the reservoir
list, the sortable table under the map, and the address bar together; the
table's CSV export writes exactly the rows and order on screen; and storage
color uses five equal, colorblind-safe bands. The methods and public data API
pages document where the numbers come from and how to reach them outside the
dashboard.

Phase 7 is complete: axe-core runs over every page at every tested width on
every browser-suite run, every page ships a Content-Security-Policy written
from a measured host list, and `tools/audit-transfer.mjs` reports what each
page actually requests.

Groundwork for covering the whole west is in place and deliberately
invisible: the watershed scopes are a registry that carries its own
hydrologic level, the western geographies (44 subregions, 75 basins, 571
subbasins, scoped by where the water goes — ADR-053) are committed and
reviewed but unpublished, the payloads shrank to make the scale affordable
(ADR-048, ADR-051, ADR-052), and the pipeline's assignment, gates, and dam
matching are measured ready for a roster ten times the size.

Phase 3's ordered increments and gates are in
[`docs/PHASE-3-PLAN.md`](docs/PHASE-3-PLAN.md); the completed shell contract
remains in [`docs/PHASE-2-PLAN.md`](docs/PHASE-2-PLAN.md). The full sequence,
measurements, and implementation history live in
[`MODERNIZATION_PLAN.md`](MODERNIZATION_PLAN.md).

## Documentation map

- [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md) — concise rules and
  verification steps for contributors and coding agents.
- [`MODERNIZATION_PLAN.md`](MODERNIZATION_PLAN.md) — working roadmap,
  measurements, spikes, and implementation history.
- [`docs/PHASE-2-PLAN.md`](docs/PHASE-2-PLAN.md) — the completed shell scope,
  milestones, and acceptance gates.
- [`docs/PHASE-3-PLAN.md`](docs/PHASE-3-PLAN.md) — the completed symbology and
  interaction increments.
- [`docs/PHASE-1.6-PLAN.md`](docs/PHASE-1.6-PLAN.md) — the connected-site and
  snowpack data additions.
- [`docs/MODERN-OVERVIEW-PLAN.md`](docs/MODERN-OVERVIEW-PLAN.md) — the data
  workspace's decision record and visual direction.
- [`docs/UPPER-COLORADO-PIPELINE.md`](docs/UPPER-COLORADO-PIPELINE.md) — the
  broader watershed research scope and its measured baseline.
- [`docs/AUTHORITATIVE-SOURCE-INVENTORY.md`](docs/AUTHORITATIVE-SOURCE-INVENTORY.md)
  — the owner, endpoint, copy policy, failure behavior, geometry precision,
  and next migration step for every current or planned data source.
- [`docs/data-transfer.md`](docs/data-transfer.md) — what each page actually
  fetches, measured; the file to update when a payload or layer changes cost.
- [`docs/decisions/`](docs/decisions/) — immutable architecture decisions and
  their status.
- [`CHANGELOG.md`](CHANGELOG.md) — notable user-facing changes; daily data
  refreshes are intentionally omitted.
- [`maplibre/README.md`](maplibre/README.md) — historical ArcGIS/MapLibre
  comparison findings.

## Known limitations

- Monthly sources cannot support a meaningful 7-day change.
- The map depends on third-party basemap services. If they all fail, local
  reservoir data remains available without a background map.
- The content policy's `script-src` has to allow the ArcGIS CDN and
  `unsafe-eval`, because the SDK's workers import their own code from that CDN
  and the charts package compiles schemas with `new Function`. It therefore
  offers little protection against injected script; what it does enforce is
  that fetches, images and fonts cannot leave this site and the named Esri
  hosts.
- Two accessibility findings are accepted rather than fixed, and both are in
  third-party components. `arcgis-chart` renders an inner element carrying a
  label with no role for it to attach to, so that label is inert — every
  chart is named by the section heading around it instead. Re-check on the
  next SDK upgrade. Calcite's slider leaves its own handle unnamed, which
  this project works around by naming the handle directly; if Calcite starts
  naming it, that workaround stands aside.
- ArcGIS map pixels render blank in headless Chromium even when the map and
  reservoir layers are ready, so smoke tests assert runtime state as well as
  capturing screenshots.

## License and commercial use

Copyright © 2026 Brian Busch. The source code in this repository is licensed
under the [PolyForm Noncommercial License 1.0.0](LICENSE.md): you may read,
run, study, and modify it for any noncommercial purpose, but commercial use
requires a separate license. To license this dashboard commercially — for
example, an embedded or white-label version for a news organization or
agency — contact <brian.busch@me.com>.

The license covers the code, not the measurements. The published JSON data
files are built from public-domain sources produced by the federal agencies
credited on the [methods page](https://buschbrian.github.io/utah-water-dashboard/methods.html),
and those agencies' own terms govern their data. Mapping and geospatial
services are provided by [Esri](https://www.esri.com/) under Esri's own terms.
See [terms.html](https://buschbrian.github.io/utah-water-dashboard/terms.html)
for the site's terms of use.
