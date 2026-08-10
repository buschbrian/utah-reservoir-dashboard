# Utah Reservoir Drought Dashboard

**Live site:** <https://buschbrian.github.io/utah-reservoir-dashboard/>

A public dashboard for current reservoir storage in Utah and connected Colorado
River and Great Basin drainage areas. It combines official storage observations,
traceable capacity figures, twelve months of history, and drainage-area context.

The same data is presented in three production views:

| View | Purpose |
|---|---|
| [ArcGIS map](index.html) | Geographic view built with ArcGIS Maps SDK for JavaScript 4.34. |
| [MapLibre map](maplibre/) | Open-source parity view built with MapLibre GL JS and CARTO. |
| [Statewide overview](explore.html) | Totals, a 12-month chart, drainage areas, ranking, table, CSV export, and sparklines without a map SDK. |

The repository also publishes [modern.html](modern.html), the responsive
ArcGIS 5.1 and Calcite 5 modernization preview. Its shell, explicit failure
states, and persistent theme are in place; reservoir map layers and selection
arrive in P2.3. It is not yet a replacement for the three production views.

## Use the dashboard

Both maps provide the same controls and behavior:

- Point at a reservoir for its name, percent full, and data date.
- Select a reservoir for its complete record and 12-month chart.
- Filter by percent-full class or show only reservoirs with late data. Other
  reservoirs remain visible in gray to preserve geographic context.
- Move or play the month slider to compare the last 12 months.
- Open the reservoir list to reach every site with a keyboard.
- Share a selection with `?reservoir=Deer+Creek`.

The overview answers comparison questions that a map cannot. It shows combined
storage with and without Lake Powell, the distribution across percent-full
classes, drainage-area totals, a size-first ranking, every published metric,
and one 12-month sparkline per reservoir. Drainage-area selections are
shareable with `?area=160201` and can be combined with a reservoir link.

## Quick start

Requirements:

- Node.js 22
- Python 3.11 or newer for the data pipeline
- A Playwright Chromium installation for browser smoke tests

```bash
npm ci
npm run dev
```

Vite opens the modernization workbench. Open `/index.html`, `/maplibre/`, or
`/explore.html` to work on a production view. The two maps need network access
for their SDKs and basemap tiles; the overview does not load a map SDK.

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
| `npm run boundary:utah -- --dry-run` | Check the authoritative Utah boundary without writing. |

The browser smoke test expects a current `dist/` directory and an existing
`screenshots/` directory:

```bash
npm run build
mkdir -p screenshots
node tests/smoke.mjs
```

## Data and methods

[`reservoirs.json`](reservoirs.json) is the published data contract. The daily
pipeline rebuilds it from observations dating to 2015 and preserves the last
known record when an individual source cannot be reached.

To work on the pipeline in an isolated environment:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install "pandas==3.0.*" "numpy==2.*" "requests==2.*" pytest
python -m pytest tests/ -q
python refresh_reservoirs.py --dry-run
```

The version ranges match CI and the scheduled refresh workflow.

### Sources

- Storage observations come from the [Bureau of Reclamation RISE
  API](https://data.usbr.gov/) and the [USDA Natural Resources Conservation
  Service AWDB API](https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui.html).
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

The project is deliberately transitional: the current pages remain stable
while a typed, component-based replacement is built alongside them.

| Path | Role |
|---|---|
| `index.html` | CDN-loaded ArcGIS 4.34 production map; copied into `dist/`. |
| `maplibre/index.html` | CDN-loaded MapLibre production map; copied into `dist/`. |
| `explore.html` | Vite entry using Observable Plot. |
| `modern.html` + `src/` | Responsive Calcite modernization shell and typed application modules. |
| `shared/reservoir-viz.js` | Shared behavior and markup for the three production views. |
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
4. **The two map engines remain comparable.** Their differences are useful
   evidence, not accidental duplication.
5. **A public page never asks for ArcGIS credentials.** Secured resources fail
   promptly and fall back rather than opening a sign-in dialog.
6. **Visible text uses Simplified Technical English.** Tests reject retired or
   unexplained specialist terms in rendered content.

The rationale and rejected alternatives are in the
[architecture decision records](docs/decisions/).

## Refresh, build, and deploy

The scheduled [refresh workflow](.github/workflows/refresh-data.yml) runs the
Python pipeline, retains good previous records when individual feeds fail,
refuses to publish a broadly failed refresh, and maintains the `stale-feed`
issue. A changed `reservoirs.json` is committed to `main`.

The [Pages workflow](.github/workflows/deploy-pages.yml) builds and publishes
`dist/`. Vite copies `reservoirs.json`, `capacities.json`, `huc6.geojson`,
`utah-boundary.geojson`, the shared module, and the legacy pages into the artifact. The workflow checks
that every public URL exists and that the data payload did not leak into a
JavaScript bundle.

The [CI workflow](.github/workflows/ci.yml) runs TypeScript checks, Python
tests, the SDK bundle budget, and browser smoke tests on pushes and pull
requests. Browser assertions read the expected reservoir count from the
current payload; tests do not hard-code values that change in the daily feed.

## Modernization status

Phases 0, 1, and 1.5 are complete: the build and deploy pipeline, strict data
types and runtime validation, tested rollups, drainage-area enrichment, and
the modernization workbench are in place. The connected-reservoir audit added
Fontenelle; snowpack and drought context remain research tracks.

Phase 2 is complete: the unified ArcGIS 5.1 and Calcite 5 shell now runs at
`modern.html` without replacing the current production URLs prematurely.
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
- [`maplibre/README.md`](maplibre/README.md) — focused ArcGIS/MapLibre parity
  findings.

## Known limitations

- Monthly sources cannot support a meaningful 7-day change.
- The maps depend on third-party SDK and basemap CDNs; the overview is the
  no-map-SDK fallback.
- The unified Calcite shell, automated accessibility audit, snowpack context,
  and drought context are not complete.
- ArcGIS map pixels render blank in headless Chromium even when the map and
  reservoir layers are ready, so smoke tests assert runtime state as well as
  capturing screenshots.
