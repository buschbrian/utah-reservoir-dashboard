# Utah Reservoir Drought Dashboard

**Live site:** <https://buschbrian.github.io/utah-reservoir-dashboard/>

A public dashboard for current reservoir storage in Utah and connected Colorado
River and Great Basin drainage areas. It combines official storage observations,
traceable capacity figures, twelve months of history, and drainage-area context.

The same validated data is presented in one ArcGIS application and retained
legacy comparisons:

| View | Purpose |
|---|---|
| [ArcGIS dashboard](./) | Primary responsive map built with ArcGIS Maps SDK for JavaScript 5.1 and Calcite 5. |
| [ArcGIS data workspace](overview.html) | Cross-filtered KPIs, ArcGIS charts, and an accessible exact-value table. |
| [Public data API](data.html) | Stable JSON downloads, field definitions, and code examples. |
| [Legacy ArcGIS map](legacy/) | Retained ArcGIS 4.34 comparison. |
| [Legacy MapLibre map](maplibre/) | Retained MapLibre GL JS and CARTO comparison. |
| [Legacy overview](explore.html) | Retained no-SDK analysis page for experiments and historical comparison. |

The root page and its stable `modern.html` alias are the ArcGIS Maps SDK for
JavaScript application. The legacy pages stay available so renderer behavior,
accessibility, and performance can be compared without holding the primary
dashboard back.

## Use the dashboard

The ArcGIS dashboard provides these map controls:

- Point at a reservoir for its name, percent full, and data date.
- Select a reservoir for its complete record and 12-month chart.
- Filter by percent-full class or show only reservoirs with late data. Other
  reservoirs remain visible in gray to preserve geographic context.
- Move or play the month slider to compare the last 12 months.
- Open the reservoir list to reach every site with a keyboard.
- Share a selection with `?reservoir=Deer+Creek`.

The ArcGIS data workspace answers comparison questions that a map cannot. Its
search, drainage-area, and reporting filters update the KPI strip, both ArcGIS
charts, and semantic table as one view. Lake Powell is excluded by stable RISE
item identifier 509 from the default map and data workspace; it remains in the
source data for traceability and explicit legacy comparisons.

## Quick start

Requirements:

- Node.js 22
- Python 3.11 or newer for the data pipeline
- A Playwright Chromium installation for browser smoke tests

```bash
npm ci
npm run dev
```

Vite opens the ArcGIS dashboard. Open `/overview.html` for the data workspace,
or `/legacy/`, `/maplibre/`, and `/explore.html` for the legacy comparisons.
The ArcGIS pages need network access for SDK assets and basemap services.

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite development server. |
| `npm run typecheck` | Check the strict TypeScript project. |
| `npm test` | Run the Vitest unit suite. |
| `npm run budget:sdk` | Check the planned ArcGIS 5.1 bundle against its size budget. |
| `npm run build` | Typecheck, test, check the SDK budget, and build `dist/`. |
| `python -m pytest tests/ -q` | Run pipeline and drainage-area tests without network access. |
| `node tests/smoke.mjs` | Test the built production pages in Chromium. |
| `python refresh_reservoirs.py --dry-run` | Refresh and validate storage data without writing. |
| `node scripts/fetch-huc6.mjs --dry-run` | Rebuild drainage-area boundaries without writing. |
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

Broader watershed research uses named scopes so it cannot silently replace
the accepted Utah-connected production geography. `utah-connected` retains
the 14 published units; `upper-colorado` selects the 10 HUC6 codes beginning
with region 14 and writes `data/watersheds/upper-colorado-huc6.geojson`.

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
  Boundary Dataset and are committed in [`huc6.geojson`](huc6.geojson).
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

The primary application is typed and component based. The original pages are
kept as comparison fixtures, not parallel product targets.

| Path | Role |
|---|---|
| `index.html`, `modern.html` + `src/` | Primary ArcGIS 5.1 and Calcite 5 application; `modern.html` is a stable alias. |
| `overview.html` + `src/overview*` | ArcGIS Charts data workspace and shared filter model. |
| `legacy/index.html` | CDN-loaded ArcGIS 4.34 comparison; copied into `dist/`. |
| `maplibre/index.html` | CDN-loaded MapLibre legacy comparison; copied into `dist/`. |
| `explore.html` | Legacy no-SDK overview. |
| `shared/reservoir-viz.js` | Shared behavior retained by the legacy views. |
| `refresh_reservoirs.py` | Daily storage pipeline and metric calculation. |
| `huc.py` | Drainage-area geometry, assignment, and pipeline rollups. |
| `tests/smoke.mjs` | Browser contract for all production views at desktop and phone widths. |

The load-bearing rules are:

1. **Runtime data is copied, never bundled.** Daily refreshes must not require
   application data to be compiled into JavaScript.
2. **Shared production behavior has one owner.** Anything both maps need lives
   in `shared/reservoir-viz.js`; the typed port is tested for parity.
3. **Color classes have one source of truth.** Renderers, legends, filters, and
   charts derive from the same table.
4. **Legacy engines remain comparable, but do not constrain the ArcGIS app.**
   Their differences are useful evidence, not a second product roadmap.
5. **A public page never asks for ArcGIS credentials.** Secured resources fail
   promptly and fall back rather than opening a sign-in dialog.
6. **Visible text uses Simplified Technical English.** Tests reject retired or
   unexplained specialist terms in rendered content.

The rationale and rejected alternatives are in the
[architecture decision records](docs/decisions/).

## Refresh, build, and deploy

The scheduled [refresh workflow](.github/workflows/refresh-data.yml) runs the
Python pipeline, retains good previous records when individual feeds fail,
refuses to publish a broadly failed reservoir refresh, and maintains the
late-data issue. Snow measurements refresh independently, so a provider
failure keeps the last complete `snowpack.json` without blocking reservoir
updates. Changed runtime data is committed to `main`.

The [Pages workflow](.github/workflows/deploy-pages.yml) builds and publishes
`dist/` after direct pushes to `main` and after successful scheduled refreshes.
Vite copies the reservoir, snow, reference, and boundary files, the shared
module, and the legacy pages into the artifact. The workflow checks
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
polygons are downloaded as verified GeoJSON. The independent snow pipeline
publishes all 217 full-resolution-verified monitoring sites and their
1991–2020 comparisons; displaying drought and snow remains separate interface
work.

Phase 2 is complete: the unified ArcGIS 5.1 and Calcite 5 application runs at
the root and at its stable `modern.html` alias, with its ArcGIS Charts
workspace at `overview.html`.
Phase 3 has begun with pointer hover and corrected map-click selection. Its
ordered increments and gates are in [`docs/PHASE-3-PLAN.md`](docs/PHASE-3-PLAN.md);
the completed shell contract remains in
[`docs/PHASE-2-PLAN.md`](docs/PHASE-2-PLAN.md). The full sequence, measurements,
and implementation history live in [`MODERNIZATION_PLAN.md`](MODERNIZATION_PLAN.md).

## Documentation map

- [`CLAUDE.md`](CLAUDE.md) — concise rules and verification steps for
  contributors and coding agents.
- [`MODERNIZATION_PLAN.md`](MODERNIZATION_PLAN.md) — working roadmap,
  measurements, spikes, and implementation history.
- [`docs/PHASE-2-PLAN.md`](docs/PHASE-2-PLAN.md) — the completed shell scope,
  milestones, and acceptance gates.
- [`docs/PHASE-3-PLAN.md`](docs/PHASE-3-PLAN.md) — ordered symbology and
  interaction increments.
- [`docs/decisions/`](docs/decisions/) — immutable architecture decisions and
  their status.
- [`CHANGELOG.md`](CHANGELOG.md) — notable user-facing changes; daily data
  refreshes are intentionally omitted.
- [`maplibre/README.md`](maplibre/README.md) — historical ArcGIS/MapLibre
  comparison findings.

## Known limitations

- Monthly sources cannot support a meaningful 7-day change.
- The ArcGIS application depends on third-party SDK assets and basemap services;
  the legacy overview remains the no-SDK comparison.
- Automated accessibility auditing, displaying snow measurements, and drought
  context are not complete.
- ArcGIS map pixels render blank in headless Chromium even when the map and
  reservoir layers are ready, so smoke tests assert runtime state as well as
  capturing screenshots.
