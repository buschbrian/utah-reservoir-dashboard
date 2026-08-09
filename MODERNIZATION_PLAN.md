# Modernization Plan — Utah Reservoir Drought Dashboard

**Status:** proposal, not yet started. **Date:** 2026-08-09.

**Goal:** turn a set of three hand-written, zero-build HTML pages into one slick,
unified dashboard on the current generation of tooling — ArcGIS Maps SDK for
JavaScript 5.1, MapLibre GL JS 6, Calcite Design System 5, and a real build
pipeline — without touching the Python data pipeline or the daily refresh
contract that feeds it.

**Decisions already made** (see [Open decisions](#open-decisions) for what is not):

| | |
|---|---|
| Build step | **Yes.** Vite + npm + TypeScript. The zero-build constraint is retired. |
| Visual scope | Polished 2D + micro-interactions, plus a real charting upgrade. 3D scenes and deck.gl are **out of scope** for this pass (parked in [Deferred](#deferred)). |
| First target | **A new unified dashboard** — map, charts, metrics and table in one Calcite shell. The three existing pages stay as-is until it lands. |

---

## 1. Where the project is today

Five source files do all the work, with no dependencies and no build:

| File | Role |
|---|---|
| `index.html` | ArcGIS Maps SDK **4.34**, loaded from CDN with a `<link>` + `<script>` pair and AMD `require()`. Two `FeatureLayer`s, `SimpleRenderer` + Arcade `valueExpression` visual variables. |
| `maplibre/index.html` | MapLibre GL JS from unpkg. One GeoJSON source, two `circle` layers, native expressions. Open-source parity comparison. |
| `explore.html` | Statewide overview. Loads no SDK at all. Totals, ranking, sortable table + CSV, 53 sparklines. |
| `shared/reservoir-viz.js` | An IIFE hanging one global off `window`. Class breaks, popup markup, the 12-month trend chart, the legend, the Utah mask, the statewide rollup. |
| `refresh_reservoirs.py` | Regenerates `reservoirs.json` daily via GitHub Actions. **Out of scope — do not touch.** |

The codebase is in unusually good shape for a rewrite: the data contract is
documented, the shared logic is already factored out of the pages, class breaks
live in exactly one table, and there is a Playwright smoke test asserting all 53
reservoirs actually render. The rewrite is mostly a re-hosting of logic that is
already correct, not a redesign of it.

The README's own "Future improvements" section already names most of what this
plan does — a real module, a time slider, deep links on the maps, mobile layout
on the maps, an accessibility pass, hardening the CDN dependency, a size legend.
Those are folded in below rather than listed separately.

### What has changed underneath it

| | In repo | Current | Gap |
|---|---|---|---|
| ArcGIS Maps SDK for JS | 4.34 | **5.1** (June 2026) | A major version. 5.0 (Feb 2026) moved the SDK to semantic versioning and **deprecated every widget** — components are now the only forward path, with widget removal scheduled for 6.0 in Q1 2027. |
| MapLibre GL JS | v5 line, from unpkg | **6.1.0** (Aug 2026) | 6.0 (July 2026) made **WebGL2 mandatory** and the distribution **ESM-only**. The v5 line ended at 5.24. |
| Calcite Design System | not used | **5.0** (Feb 2026) | Not previously in play. Now the recommended layout foundation for SDK apps. |
| Charting | hand-rolled inline SVG | `@arcgis/charts-components`, `@arcgis/common-components` | Both are new packages; common-components (Slider, Histogram, Ticks) shipped in 5.0. |

Relevant to us specifically from the 5.x line:

- **Single script tag / npm parity.** `<script type="module" src="https://js.arcgis.com/5.1/">` now loads core + map components + common components + charts components + Calcite together. Useful as a fallback, but we are going the npm route.
- **`@arcgis/create` CLI.** `npx @arcgis/create -n app -t vite` scaffolds a working Vite + SDK project — worth generating once as a reference for the exact Vite config, asset handling and CSS imports, even if we don't adopt the output wholesale.
- **Common components package.** `<arcgis-slider>`, `<arcgis-histogram>`, `<arcgis-ticks>` — quantitative UI designed to work with or without a map. Exactly the primitives the time slider and the class-break filter want.
- **Charts components.** `<arcgis-chart>`, driven from a layer + chart config.
- **Layout guidance + samples.** Esri publishes a [dashboard layout sample](https://github.com/Esri/jsapi-resources/tree/main/layouts/dashboard-sample) that is close to what we are building. Start from it.
- **`--arcgis-view-color-focus`** and per-component `visualScale` for styling.
- **Archived docs.** 4.34 documentation lives at `archive.developers.arcgis.com/javascript/v4-34/` — useful while porting.

---

## 2. Target architecture

```
utah-reservoir-dashboard/
├── refresh_reservoirs.py          # unchanged
├── tools/                         # unchanged
├── tests/test_refresh.py          # unchanged
├── reservoirs.json                # unchanged — still the daily artifact
├── capacities.json                # unchanged
│
├── package.json                   # new: Vite + TS + SDK deps
├── vite.config.ts
├── tsconfig.json
├── index.html                     # NEW unified dashboard entry
├── public/
│   └── data/                      # reservoirs.json + capacities.json copied at build
├── src/
│   ├── main.ts                    # app bootstrap
│   ├── types.ts                   # Reservoir, MonthlyRecord, Capacity — the data contract, typed
│   ├── data/
│   │   ├── load.ts                # fetch + runtime-validate reservoirs.json
│   │   └── rollup.ts              # statewide rollup (ported, now unit-testable)
│   ├── viz/
│   │   ├── classes.ts             # the five class breaks — still one table
│   │   ├── symbology.ts           # CIMSymbol builders, visual variables, size domain
│   │   ├── mask.ts                # Utah scrim geometry
│   │   └── format.ts              # number/date formatting, status wording
│   ├── charts/
│   │   ├── trend.ts               # 12-month chart
│   │   └── sparkline.ts
│   ├── ui/
│   │   ├── shell.ts               # Calcite layout wiring
│   │   ├── filters.ts             # filter state → featureEffect + table + charts
│   │   ├── detail-panel.ts        # selected-reservoir panel
│   │   └── url-state.ts           # deep links, both directions
│   └── styles/
│       ├── theme.css              # Calcite token overrides, light + dark
│       └── app.css
├── src/legacy/                    # the three original pages, moved verbatim
│   ├── arcgis-434.html
│   ├── maplibre/
│   ├── explore.html
│   └── reservoir-viz.js
├── maplibre/                      # rebuilt on MapLibre 6 (Phase 6)
└── e2e/
    └── dashboard.spec.ts          # Playwright, rewritten
```

**Dependencies** (verify exact versions at install; these are current as of writing):

```
@arcgis/core                 ^5.1
@arcgis/map-components       ^5.1
@arcgis/common-components    ^5.1
@arcgis/charts-components    ^5.1
@esri/calcite-components     ^5
maplibre-gl                  ^6.1     (Phase 6)
@observablehq/plot           ^0.6     (time-series charts — see §5)
typescript, vite, vitest, @playwright/test
```

### Deployment

This is the one place a build step genuinely changes the operating model, and it
has a trap in it.

`reservoirs.json` is rewritten **daily** by a GitHub Action. Today that commit is
the deploy — the pages fetch the file at runtime and the new numbers are live.
If the app bakes the data in at build time, every data refresh needs a rebuild,
and a build failure silently freezes the dashboard.

**Rule: data is fetched at runtime, never bundled.** Concretely:

- The app fetches `./data/reservoirs.json` at runtime with a cache-busting query on `as_of`.
- The Pages deploy workflow copies `reservoirs.json` and `capacities.json` into `dist/data/` — a copy step, not an import.
- `refresh-data.yml` gains a `workflow_run` trigger on the deploy workflow (or the deploy workflow triggers on changes to `reservoirs.json`), so a data-only change republishes without rebuilding anything semantic.
- Keep the current file paths working. `reservoirs.json` stays at the folder root so the archived legacy pages keep loading.

---

## 3. Phases

Each phase is independently shippable and independently revertable. Nothing in
Phases 0–1 changes a pixel.

### Phase 0 — Groundwork (no visual change)

1. `npx @arcgis/create -n _scaffold -t vite` into a throwaway directory. Read its `vite.config.ts`, asset handling and CSS imports; copy what's needed; delete it.
2. Add `package.json`, `vite.config.ts`, `tsconfig.json` (strict). Configure `base` for the Pages path.
3. Move the three existing pages verbatim into `src/legacy/`, fix their relative paths to `reservoirs.json`, confirm they still load. **They are the working dashboard until Phase 2 lands** — do not break them.
4. Add the Pages deploy workflow with the runtime-data rule above. Verify a data-only commit republishes.
5. Extend `ci.yml`: `tsc --noEmit`, `vitest run`, then the existing Python tests and Playwright job.

**Done when:** `npm run build` produces a `dist/` that serves the three legacy pages identically, and CI is green.

### Phase 1 — Port the shared logic to typed, tested modules

This is the README's flagged `IMPROVEMENT` in `shared/reservoir-viz.js`, and it
is the highest-value step in the whole plan: the statewide rollup is arithmetic
with no DOM in it that is currently only ever exercised by a browser smoke test.

1. Write `src/types.ts` from the actual shape of `reservoirs.json` — every field the README documents (`as_of`, `days_stale`, `is_stale`, `fetch_ok`, `seasonal_sample_years`, cadence, provider, monthly history, …).
2. Add a runtime validator at the fetch boundary (Zod, or a hand-written guard — the schema is small and stable). A malformed refresh should fail loudly at load, not render as a blank map.
3. Split `reservoir-viz.js` into the modules listed above. Behavior-preserving port; resist redesigning while porting.
4. **Vitest unit tests** for the parts that are pure: the class-break lookup, `percentFull` and its capacity-vs-record-max fallback, the statewide rollup (including the exclude-Lake-Powell variant), staleness thresholds (2-day daily / 45-day monthly), and the formatters.
5. Keep `src/legacy/reservoir-viz.js` frozen as the reference. Add a test that the ported rollup matches the legacy one on the real `reservoirs.json`.

**Done when:** the ported modules reproduce the legacy numbers exactly, under test.

### Phase 2 — The unified dashboard shell

Start from Esri's [dashboard layout sample](https://github.com/Esri/jsapi-resources/tree/main/layouts/dashboard-sample). Structure, per Esri's own guidance, keeps layout (Calcite) strictly separate from GIS functionality (map components).

```
calcite-shell
├── calcite-navigation (header)
│     title · as-of date chip · stale-count badge · light/dark toggle · links to legacy pages
├── calcite-shell-panel (start)  — filters & controls
│     calcite-action-bar: Filter / Legend / Layers / About
│     calcite-panel > calcite-block:
│       search input · class-break checkboxes · stale-only switch ·
│       provider & cadence filter · sort selector ·
│       arcgis-histogram + arcgis-slider over % of capacity
├── main
│     arcgis-map
│       ├── arcgis-legend        (with the size legend the README asks for)
│       ├── arcgis-basemap-toggle / arcgis-basemap-gallery in an arcgis-expand
│       ├── arcgis-home, arcgis-scale-bar, arcgis-fullscreen
│       └── arcgis-placement: statewide KPI tiles (glass panel, top-left)
├── calcite-shell-panel (end)    — selected reservoir
│     KPI tiles · 12-month trend chart · monthly table (calcite-block, collapsed)
│     · sample-depth and staleness notices · source links
└── calcite-shell-center-row (bottom, collapsible)
      tabbed: Ranking (all 53, with normal ticks) | Table (sortable + CSV) | Sparklines (53)
```

- Calcite handles responsive collapse; on mobile the side panels become sheets. This closes the README's "mobile layout on the maps" item structurally rather than with media-query patches.
- Light/dark via `calcite-mode-light` / `calcite-mode-dark` on the root. **Caveat from Esri's docs: `calcite-mode-dark` is not applied to charts components** — chart theming must be handled explicitly.
- Theme tokens in `src/styles/theme.css`. Style with Calcite CSS variables; use plain CSS only for structure. Do not override Calcite internals.

**Done when:** the new `index.html` shows the map and all 53 reservoirs with the current symbology, in one responsive shell, at parity with the 4.34 page.

### Phase 3 — Symbology and micro-interactions

The "slick" phase. Everything here is a real SDK capability, not CSS trickery.

- **Dual circles → `CIMSymbol`.** Replace the two-`FeatureLayer` construction with a single layer and a `CIMSymbol` composed of stacked symbol layers: an offset, blurred **drop shadow**, the capacity ring, and the storage fill. CIM gives real per-symbol effects (offset, buffer, dash) that `simple-marker` cannot, and collapses the two layers into one — which also removes the duplicate-popup trap both engines hit.
  - Keep the sqrt-scaled shared size domain. Size still comes from visual variables so the ring-to-fill gap stays a true read of depletion.
  - The stale dashed amber ring becomes another CIM layer rather than a separate renderer.
- **Hover.** `view.hitTest` on `pointer-move` → `view.highlight()` with 5.x highlight options (halo, fill opacity, shadow) plus a lightweight hover card. Throttle the hit test; do not run it per frame.
- **Filter dimming via `featureEffect`.** When a filter is active, matched features get `includedEffect: "bloom(...)"` and everything else `excludedEffect: "grayscale(100%) opacity(30%)"`. This is the single highest-impact interaction in the whole redesign: the map answers the filter directly instead of the map and the table disagreeing.
- **Selection.** `goTo` with eased easing on select; the detail panel animates in; the URL updates.
- **Loading.** `calcite-loader` and skeleton blocks for the panels, replacing the current "Loading data…" text.
- **Motion discipline.** Respect `prefers-reduced-motion`; bloom and transitions off when set.

**Watch:** bloom and heavy CIM effects have real GPU cost. 53 features is trivial, but measure on an integrated GPU before committing to always-on bloom.

### Phase 4 — Charts

Two chart problems that want two different tools. Do not force one.

**(a) Layer-driven charts → `@arcgis/charts-components`.** The scalar per-reservoir
fields — `% capacity`, `% record max`, `seasonal percentile`, `current_storage_af`
— are ordinary `FeatureLayer` fields, so `<arcgis-chart>` binds to them
natively, honors the same filter, and stays in sync with map selection for free.
Use it for:
- the 53-reservoir ranking bar chart (colored on the same class breaks),
- a distribution histogram of % capacity,
- and legitimately showcase the new charts package on data that actually fits it.

**(b) Time series → Observable Plot.** The 12-month history is a **nested array per
reservoir**. The README already records that neither engine will carry a nested
array on a feature — it has to live in a side lookup keyed by name. That makes it
a poor fit for a layer-bound chart component. Use
[Observable Plot](https://observablehq.com/plot/): small, declarative, plain SVG
output, easy to theme from Calcite tokens, and it replaces the hand-rolled chart
with materially less code while adding per-month tooltips and focusable marks.
Use it for the 12-month trend (with the dashed normal line), the 53 sparklines,
and the statewide 12-month chart.

Both must read colors from `src/viz/classes.ts`. The single-source-of-truth
property that the current code protects is the thing most likely to be lost in a
rewrite — assert it in a test.

**Accessibility, closing the README's open item:** every chart keeps its
`aria-label` and its table of the same numbers, and Plot marks become focusable
with per-month tooltips.

### Phase 5 — State, filters and deep links

- One filter/selection state object; everything else derives from it — map `featureEffect`, layer `definitionExpression`, table rows, chart data, CSV export.
- **Deep links on the map**, the README's open item: `?reservoir=Deer+Creek` selects and zooms; selecting updates the URL. Extend to filters and the active bottom tab so a filtered view is shareable.
- **Time slider** (`<arcgis-slider>` over the 12 months), the README's top dashboard ask. The data is already there. Animating the drawdown across the state is the single most compelling thing this dataset can do and it currently cannot be seen at all.
- CSV export continues to export exactly the rows on screen, raw numbers.

### Phase 6 — MapLibre parity page on v6

- `maplibre-gl@^6` as an npm ESM dependency. **v6 requires WebGL2 and ships ESM-only** — note the browser floor (pre-2022 browsers are dropped) and add a capability check with a graceful message rather than a blank canvas.
- Rebuild the parity page inside the same Vite app so it shares `src/viz` and `src/charts` — which is the entire point of the comparison, and what `shared/reservoir-viz.js` was invented to protect.
- Re-run the comparison and update `maplibre/README.md`. The v5-era findings need re-checking: the dashed-stroke gap, the nested-array behavior, and the antimeridian mask inversion are all worth re-testing against 6.x and 5.1 respectively.
- **The MapLibre page is also the CDN-outage insurance** the current `explore.html` provides. Keep at least one page that renders without Esri.

### Phase 7 — Consolidation, verification, docs

- Rewrite the Playwright smoke test against the new DOM. **Gotcha: Calcite and ArcGIS components are shadow-DOM.** Playwright's CSS locators pierce open shadow roots, but map readiness cannot be asserted from the DOM — wait on the `arcgis-map` component's ready event / `view.when()` via `page.waitForFunction`, not on a selector. Keep the existing assertions: all 53 render, a popup opens, zero console errors, screenshots uploaded.
- Add axe-core to the Playwright run. Keyboard and contrast pass across the shell — the README's open accessibility item.
- Lighthouse/bundle budget. `@arcgis/core` is large; verify Vite is code-splitting, that `@arcgis/core/assets` are copied correctly, and that only used modules are imported.
- Decide the fate of `explore.html`: the unified dashboard supersedes most of it. Either retire it with a redirect, or keep it deliberately as the no-SDK fallback (recommended — it is the page that survives a CDN outage, and that is a real property worth keeping).
- Rewrite the main README. It is excellent and should stay that way; the architecture section is what changes.

---

## 4. Risks and traps

| Risk | Notes / mitigation |
|---|---|
| **ArcGIS basemaps and API keys** | 5.x pushes toward ArcGIS Location Platform keys and the new session-based basemap billing. Verify before Phase 2 whether the current keyless basemap strings (`topo-vector`, `gray-vector`, …) still work, and if not, whether a referrer-restricted API key is acceptable for a public repo. **This is the one item that can invalidate the plan — check it first.** Fallback: use a keyless `VectorTileLayer`, or make MapLibre + CARTO the default map. |
| **Widget deprecation** | All widgets are deprecated in 5.0 and slated for removal in 6.0 (Q1 2027). Write **zero** widget code. Components only. Anything ported from the 4.34 page must be re-expressed as components. |
| **Daily data must not need a rebuild** | Covered by the runtime-fetch rule in §2. Verify explicitly with a data-only commit before Phase 2. |
| **Bundle size** | Full `@arcgis/core` plus four component packages is heavy. Set a budget in Phase 0 and check it every phase, not at the end. |
| **MapLibre 6 browser floor** | WebGL2 mandatory, ESM only. Detect and message. |
| **Shadow DOM in tests** | Existing smoke test will not survive the port unchanged. Rewrite in Phase 7, don't patch. |
| **Losing single-source-of-truth for class breaks** | The current code is careful that breaks, legend, chart colors and both engines' expressions derive from one table. A rewrite across four packages is exactly where that drifts. Assert it in a unit test. |
| **Scope creep into the data pipeline** | `refresh_reservoirs.py`, the capacity table and the staleness logic are correct and well-tested. Nothing in this plan touches them. Data-side items in the README's "Future improvements" (catalog ID verification, plausibility checks, snowpack context, series caching) are a **separate** track. |

---

## 5. Open decisions

1. **API key / basemap** — see the risk table. Blocking; resolve before Phase 2.
2. **Observable Plot vs. ECharts vs. keeping hand-rolled SVG** for the time series. Plot is recommended (smallest, cleanest, SVG, themeable). ECharts is the answer only if we want heavy interactivity (brushing, linked zoom) later.
3. **Validation library** — Zod adds a dependency for a small, stable schema. A hand-written guard may be enough.
4. **Fate of `explore.html`** — recommend keeping it as the deliberate no-SDK fallback rather than retiring it.
5. **Framework** — the plan assumes vanilla TS + web components, which is what Calcite and the SDK components are designed for and keeps the dependency surface small. React would be a defensible alternative if the state management in Phase 5 gets unwieldy; decide at Phase 5, not now.

## 6. Deferred

Not in this pass, but the architecture should not preclude them:

- **3D / SceneView** — extruded reservoir volumes, and 5.0's **emissive materials + glow effect** for genuinely striking nighttime symbology.
- **MapLibre 6 globe projection + Terrain3D.**
- **deck.gl 9.3 interleaved overlay** — works with both engines and with MapLibre's globe; the route to arcs, hexbins and GPU-driven transitions neither SDK does natively.
- **ArcGIS AI components (beta)** — `<arcgis-assistant>` with the navigation and data-exploration agents. Natural-language querying of 53 reservoirs is a genuinely good demo of the new SDK, and it is a handful of lines. Beta, so not on the critical path.
- **Snowpack context (NRCS SNOTEL)** — data-track work, but the one addition that would give every reservoir's trend a *cause* rather than just a shape.

---

## Sources

- [ArcGIS Maps SDK for JavaScript: What's New in 5.0](https://www.esri.com/arcgis-blog/products/js-api-arcgis/announcements/arcgis-maps-sdk-for-javascript-whats-new-in-5-0)
- [Release notes for 5.1 | ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/latest/release-notes/)
- [ArcGIS Maps SDK for JavaScript is Moving to Semantic Versioning](https://www.esri.com/arcgis-blog/products/js-api-arcgis/announcements/arcgis-maps-sdk-for-javascript-is-moving-to-semantic-versioning)
- [Mapping application layouts | ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/latest/creating-app-layouts/)
- [Layout samples | Esri/jsapi-resources](https://github.com/Esri/jsapi-resources/tree/main/layouts/)
- [Calcite Design System 5.0 released](https://www.esri.com/arcgis-blog/products/developers/announcements/calcite-design-system-5-0-released)
- [Quick Start New JavaScript Maps SDK Projects with @arcgis/create](https://www.esri.com/arcgis-blog/products/js-api-arcgis/developers/quick-start-new-javascript-maps-sdk-projects-with-arcgis-create)
- [@arcgis/map-components](https://www.npmjs.com/package/@arcgis/map-components) · [@arcgis/charts-components](https://www.npmjs.com/package/@arcgis/charts-components) · [@arcgis/common-components](https://www.npmjs.com/package/@arcgis/common-components)
- [MapLibre GL JS v6.0.0: Mandatory WebGL2 and ESM Only](https://geo.malagis.com/maplibre-gl-js-v6-mandatory-webgl-and-esm-only.html)
- [MapLibre GL JS releases](https://github.com/maplibre/maplibre-gl-js/releases) · [MapLibre Newsletter April 2026](https://maplibre.org/news/2026-05-02-maplibre-newsletter-april-2026/)
- [Using deck.gl with MapLibre](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre) · [deck.gl What's New](https://deck.gl/docs/whats-new)
