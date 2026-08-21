# Western Water Dashboard

**Live site:** <https://buschbrian.github.io/western-water-dashboard/>

A public dashboard for reservoir storage, mountain snow, and drought across
the western United States. It combines official observations, reviewed full
levels, climate comparisons, weekly drought measurements, and drainage-area
context in one typed ArcGIS 5.1 and Calcite 5 application.

The project began as a Utah reservoir map. Its current scope follows five
western hydrologic regions across eleven states. The application draws 75
basins or 44 larger subregions, reads a reviewed western reservoir roster, and
uses 637 mountain snow sites. Counts that can change with provider reporting
are read from the runtime payloads rather than written into application code.

## Dashboard pages

| Page | What it answers |
|---|---|
| [Western Reservoir Storage](./) | Where water is stored now, how full each reservoir is, and how levels compare with earlier years. |
| [Western Storage Charts](overview.html) | What moved this week and how the current reservoir set compares across charts and an exact-value table. |
| [Western Snowpack](snow.html) | How much water is held in mountain snow, by site and drainage area, against the 1991–2020 comparison period. |
| [Western Drought](drought.html) | How much land is in each U.S. Drought Monitor class and how that relates to stored water. |
| [Methods and Sources](methods.html) | Where each number comes from, how it is worked out, and what it does not claim. |
| [Public Data API](data.html) | Stable JSON paths, field definitions, update behavior, and code examples. |
| [Terms and License](terms.html) | Project terms, source-data terms, and the noncommercial code license. |

`modern.html` is a stable alias for the storage map. The former ArcGIS 4.34,
MapLibre, and overview paths are accessible compatibility redirects. They
preserve saved links without restoring retired runtimes.

## Use the dashboard

The storage map lets a reader:

- point at or select a reservoir for its storage, full level, reading date,
  comparison period, history rank, and change over time;
- narrow the view by state, subregion, drainage area, county, storage class,
  reporting status, reservoir geography, Lake Powell, or Lake Mead;
- move or play the month slider through the last twelve published months;
- open a keyboard-reachable reservoir list;
- sort the matching reservoirs in a table and download the exact rows and
  order on screen as CSV; and
- share the complete view through the address bar.

The storage map opens on the complete western roster, with Lake Powell and
Lake Mead both in the totals. Each is large enough to dominate a regional
figure, so each keeps its own switch and every page states which of the two
the figure beside it holds. The narrower Utah-waterbody view remains
available as a deliberate choice.

A first visit with no link and no remembered place opens a short chooser: a
state or a river basin, and one of the three subjects. It is skippable in one
action, it is never shown over a shared link, and the choice it produces is
the same `?state=` and `?area=` a reader can set from the controls. The place
is remembered between visits; a link always outranks it.

The storage charts use the same geographic and reservoir scope. Their search,
filters, summary strip, six ArcGIS charts, and semantic table update together.
The snow and drought pages share the reader's chosen state or drainage area
where that choice has the same meaning, and every page writes its own view to a
shareable URL.

## Quick start

Requirements:

- Node.js 22
- Python 3.11 or newer for pipeline work
- Playwright Chromium, or a local Google Chrome executable, for browser tests

```bash
npm ci
npm run dev
```

Vite opens the storage map. The maps need network access for Esri basemaps and
hosted reference layers. Stored measurements still load when an optional map
service does not answer.

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite development server. |
| `npm run typecheck` | Check the strict TypeScript project. |
| `npm test` | Run the Vitest unit suite. |
| `npm run budget:sdk` | Check the ArcGIS 5.1 bundle against its measured budget. |
| `npm run build` | Typecheck, run unit tests, check the SDK budget, and build `dist/`. |
| `python -m pytest tests/ -q` | Run pipeline, source, geography, and measurement tests. |
| `node tests/smoke.mjs` | Check the three compatibility redirects in Chromium. |
| `node tests/smoke-modern.mjs` | Check every current page at desktop and phone widths, including axe-core. |
| `python refresh_reservoirs.py --dry-run` | Fetch and validate reservoir data without writing. |
| `python tools/build_normal_baselines.py --missing` | Build only missing 1991–2020 reservoir comparisons. |
| `node tools/audit-transfer.mjs` | Measure page requests and hosts against a built `dist/`. |

Playwright is intentionally not a package dependency. Restore it after an
ordinary `npm install` with:

```bash
npm install --no-save --no-package-lock playwright
```

To use an installed Chrome instead of downloading Chromium:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tests/smoke-modern.mjs
```

## Data and methods

The browser fetches runtime JSON. It never imports a daily payload into an
application bundle. This keeps a data-only morning commit deployable without
turning measurements into compiled source.

Stable public paths are documented on the [data page](data.html):

| Path | Contents |
|---|---|
| `/api/reservoirs.json` | Current storage, comparisons, changes, twelve-month history, reporting status, source identity, and geography. |
| `/api/snowpack.json` | Water-year site series and drainage-area summaries against 1991–2020. |
| `/data/drought/usdm-huc6.json` | Weekly drought shares for 75 basins. |
| `/data/drought/usdm-huc4.json` | The same week measured over 44 larger subregions. |
| `/data/drought/usdm-current.geojson` | The verified current U.S. Drought Monitor polygons. |
| `/api/reference.json` | Reviewed capacity evidence and the drainage-area roster, without polygon geometry. |

The daily pipeline reads observations from the Bureau of Reclamation, the
Natural Resources Conservation Service and the California Department of Water
Resources. Dam evidence comes from the U.S. Army
Corps of Engineers National Inventory of Dams. Drainage areas come from the
U.S. Geological Survey Watershed Boundary Dataset. Drought data comes from the
U.S. Drought Monitor. The complete ownership and failure contract is in
[`docs/AUTHORITATIVE-SOURCE-INVENTORY.md`](docs/AUTHORITATIVE-SOURCE-INVENTORY.md).

California is a production provider as of 2026-08-20: 142 reservoirs, read
from the state's own service, with the full level taken from the operator's
published figure wherever it publishes one (ADR-070). Twenty-one candidates
are held rather than published and
[`admitted_cdec_reservoirs.json`](admitted_cdec_reservoirs.json) names each
with the finding behind it. Colorado remains measured design work and is the
next coverage-of-places source; the review of both is in
[`docs/CDSS-CDEC-API-REVIEW.md`](docs/CDSS-CDEC-API-REVIEW.md).

### Storage metrics

- **Percent full** is current storage divided by the reviewed full level. The
  full-level source is published per reservoir.
- **Standard comparison** is the median of one representative value per year
  near the same calendar date from 1991 through 2020.
- **Recent-years comparison** uses the years this project collects through the
  prior year.
- **History rank** compares the current value with one representative value
  per earlier year near the same calendar date.
- **Change** reports the measured interval and reference date for 7-, 30-, and
  365-day targets when the source supports them.
- **Monthly history** carries the mean, minimum, maximum, ending storage, and
  comparison value for each of the last twelve months.
- **Reporting status** is evaluated per source update schedule. A reading that
  is late remains visible and named. A reading from another season is removed
  from current totals until the provider resumes.

Regional storage is full-level weighted:

```text
percent full = sum(current storage) / sum(full level) × 100
```

The result describes the reservoirs tracked by this dashboard, not every
reservoir or every form of water in a drainage area.

### Geographic scope

The western scope follows where water drains, not a longitude box. It includes
hydrologic regions 14 through 18: the Colorado River, Great Basin, Pacific
Northwest, and California systems. The maps offer two complete measurement
levels:

- 75 six-digit basins, the default; and
- 44 four-digit subregions.

A reservoir is assigned to a drainage area from its reviewed dam or outlet
point. State and county filters describe where the waterbody is. Those are
separate facts: a dam, a lake, and the land feeding it can cross different
lines.

## Architecture

The reader-facing application is strict TypeScript built with Vite, ArcGIS
Maps SDK for JavaScript 5.1, ArcGIS Charts 5.1, and Calcite Components 5.1.

| Path | Role |
|---|---|
| `index.html`, `modern.html`, `src/main.ts` | Primary reservoir map and stable alias. |
| `overview.html`, `src/overview*` | Storage charts workspace and shared filter model. |
| `snow.html`, `src/snow*` | Snow curves, drainage-area map, site map, and detail views. |
| `drought.html`, `src/drought*` | Weekly drought map, comparisons, rankings, and distribution. |
| `methods.html`, `data.html`, `terms.html` | Methods, public API, and legal documentation. |
| `legacy/`, `maplibre/`, `explore.html` | Compatibility redirects only. |
| `public/retired-route.js` | Allowlisted translation for retired URL state. |
| `shared/reservoir-viz.js` | Frozen source-only storage color-table oracle; never published. |
| `refresh_reservoirs.py`, `refresh_snowpack.py` | Reservoir and snow refresh pipelines. |
| `huc.py`, `watershed_scopes.py` | Drainage assignment, grouping, and named-scope contracts. |
| `tools/` | Source audits, boundary work, drought processing, symbol profiling, and transfer measurement. |

The load-bearing rules are:

1. Runtime data is fetched and copied, never bundled.
2. Each map quantity has one color table; storage retains the frozen oracle
   until a later ADR moves ownership.
3. Retired routes preserve bookmarks, not runtimes.
4. Public pages never ask for ArcGIS credentials.
5. Anything that can wait forever has a deadline and an explicit failure
   state.
6. Visible application text uses Simplified Technical English.
7. Accessibility is a release gate at 1280, 390, and 360 pixels.
8. One readiness field reports one fact, so deleting a rendered layer cannot
   hide behind another successful signal.
9. Comparisons name their period, method, and sample size.
10. Shares with different denominators are never subtracted into a stated
    quantity.

The rationale and supersession history are in the
[architecture decision records](docs/decisions/).

## Refresh, build, and deploy

The scheduled [refresh workflow](.github/workflows/refresh-data.yml) updates
reservoir and snow data independently, retains verified previous data when a
provider fails, refuses broad or inconsistent results, computes drought
coverage from the polygons downloaded in the same run, and maintains issues
for late and withdrawn reservoir feeds.

The [Pages workflow](.github/workflows/deploy-pages.yml) builds and publishes
`dist/` after changes to `main` and after successful scheduled refreshes. It
checks public paths and fails if runtime data appears in `dist/assets`.

The [CI workflow](.github/workflows/ci.yml) runs TypeScript, Vitest, pytest,
the SDK bundle budget, Playwright smoke tests, axe-core, URL compatibility,
and font-host checks. Tests derive changing counts from the payload rather
than asserting today's numbers.

## Project status and documentation

The original modernization phases are complete. ArcGIS 5.1 is the production
runtime; the MapLibre rebuild was superseded by the decision to keep retired
paths as redirects. The western geography, reader-chosen opening scope, the
first-visit place chooser and the remembered place behind it, the 637-site
snow network, the western federal reservoir roster, drought measurements,
accessibility gates, and transfer policy have all shipped. The Utah state
mask is retired and the state boundary is no longer published (ADR-067);
state outlines a reader can see come from Esri's Living Atlas, built from
U.S. Census Bureau boundaries, and are drawn only where a continuous surface
means a line cannot hide the subject (ADR-061).

Current product work is narrower:

- resolve the held California source and capacity decisions before adding a
  third reservoir provider;
- keep automatically reported late and withdrawn feeds under review;
- re-check vendor accessibility exceptions and the content policy on SDK
  upgrades;
- give the first-visit chooser its counts. The design that ordered it wanted
  "eleven reservoirs, eighty-five snow sites" on each tile, which is what
  makes offering a state with no reservoirs obviously right rather than
  apparently broken. It needs all three payloads, and a chooser that waits on
  three fetches arrives late, which is the one thing that shape must not be;
  and
- complete a human visual review of every page and viewport. Automated tests
  cannot judge color balance, terrain, density, or visual hierarchy because
  the ArcGIS canvas is blank in headless Chromium.

Start with [`docs/README.md`](docs/README.md) for the maintained documentation
index. Key records include:

- [`CHANGELOG.md`](CHANGELOG.md) — user-facing changes, excluding daily data refreshes;
- [`MODERNIZATION_PLAN.md`](MODERNIZATION_PLAN.md) — historical roadmap and implementation journal;
- [`docs/AUTHORITATIVE-SOURCE-INVENTORY.md`](docs/AUTHORITATIVE-SOURCE-INVENTORY.md) — current data ownership and failure behavior;
- [`docs/data-transfer.md`](docs/data-transfer.md) — measured page and payload cost;
- [`docs/decisions/`](docs/decisions/) — immutable architecture decisions and their current status;
- [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md) — repository rules and verification guidance; and
- [`maplibre/README.md`](maplibre/README.md) — archived findings from the retired comparison runtime.

## Known limitations

- Monthly sources cannot support a meaningful seven-day change.
- Maps depend on third-party basemap and reference services. Local
  measurements and non-map views remain available when those services fail.
- The content policy must currently allow the ArcGIS CDN and `unsafe-eval`
  because of SDK workers and chart schema compilation. Re-measure it on every
  SDK upgrade.
- One accessibility exception remains in a vendor component and is documented
  in `AXE_EXCEPTIONS` in `tests/smoke-modern.mjs`.
- ArcGIS map pixels render blank in headless Chromium. Runtime readiness and a
  human review are therefore both required evidence.
- A link carries only what a reader changed, so the meaning of an absent
  parameter is part of the contract. Two defaults have moved: `reservoirs=`
  when the roster went west, and `powell=` and `mead=` when the two largest
  reservoirs joined the opening view. A link written before either change and
  carrying neither parameter now reads as the current default. Both spellings
  of every parameter are still accepted.

## License and commercial use

Copyright © 2026 Brian Busch. The source code is licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md). Noncommercial use,
inspection, and modification are allowed under that license. Commercial use
requires a separate license; contact <brian.busch@me.com>.

The license covers the code, not source measurements. The federal and state
publishers credited on the [methods page](methods.html) retain their own terms.
Esri mapping services are provided under Esri's terms. See
[terms.html](terms.html) for the site terms.
