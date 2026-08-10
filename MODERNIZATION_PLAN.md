# Modernization Plan — Utah Reservoir Drought Dashboard

**Status:** Phase 0–1 groundwork started in parallel; current dashboards remain live. **Date:** 2026-08-09.

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
| User text | **Use ASD-STE100 Simplified Technical English.** Use short sentences. Use one term for one item. Replace specialist terms when possible. Define each required water or file term. |

### Implementation review — 2026-08-09

The volatile assumptions were checked against primary package and SDK sources
before installing anything:

- The installed, locked line is ArcGIS packages **5.1.15**, Calcite **5.1.2**,
  TypeScript **7.0.2**, Vite **8.2.1**, and Vitest **4.1.10**. ArcGIS 5.1's
  component-first direction and MapLibre 6.1's ESM/WebGL2 requirements are
  confirmed.
- Do **not** physically move the current pages during Phase 0. Their URLs are
  the production contract. The Vite build instead copies them verbatim to
  `dist/` while `modern.html` is developed alongside them.
- Runtime data uses `fetch(..., { cache: "no-store" })`. A cache key based on
  `as_of` is circular because the client only knows `as_of` after fetching the
  payload. The build copies data to `dist/data/` and never imports it into the
  application bundle.
- **SDK assets stay on Esri's CDN for this deployment.** A local copy of the
  installed core, map, common, chart and Calcite asset trees is 57.9 MiB across
  22,906 files. The dashboard already requires ArcGIS Online for basemaps, so
  copying those trees would not make it offline-capable; it would only enlarge
  the Pages artifact and create another version-sync obligation.
- The basemap/authentication question remains a Phase 2 spike, but it does not
  block typed data and build groundwork. Official 5.1 guidance allows public
  apps to omit authentication for public resources, while specific location
  services may still require a token.
- MapLibre 6 now supports nested GeoJSON properties. Phase 6 must re-test the
  old “nested arrays become strings” workaround rather than porting it as an
  assumption.

Implemented so far: strict TypeScript data types, a hand-written runtime
validator, class-break and statewide-rollup modules, cadence-aware staleness,
unit parity tests against the real 53-reservoir payload, a Vite production
build, and a small modernization workbench. The Python refresh pipeline is not
part of this modernization track.

The current pages also have a user-text baseline for the new shell. Map controls,
chart labels, popups, legends, status messages, errors, and download headings now
use Simplified Technical English. The overview defines capacity, acre-foot,
normal, history rank, update schedule, and CSV file. Browser tests reject the old
unexplained terms if they return to visible text.

### Follow-up review — 2026-08-09 (second pass)

Two problems in the first frontend commit, both found by replacing the unit
tests' hardcoded expectations with a real comparison against the legacy module:

- **The tests were snapshots of one day's payload.** `reservoirs.json` is
  rewritten every morning, so assertions like `percentFull` to ten decimal
  places would have failed on the next refresh — and because `build` runs the
  tests, a data refresh would have broken the build too. They now load
  `shared/reservoir-viz.js` in a `node:vm` sandbox and compare against
  `statewideSummary` directly, which is what Phase 1 asked for and is
  data-independent. Verified by mutating every storage value, the class
  distribution and the stale count, and re-running green.
- **The class-break table had already drifted.** `src/viz/classes.ts` shipped a
  different RdYlGn palette (every class one stop lighter) and reworded labels,
  which the snapshot test could not see. This is the exact risk in §4. Now a
  verbatim port, with `STALE_COLOR`/`STALE_ACCENT`, guarded by an assertion
  that the table equals the legacy one value for value.

One divergence is **deliberate** and asserted rather than silently carried:

| | Legacy | Port |
|---|---|---|
| Headline % | reads the pipeline's rounded `pct_of_capacity` | recomputed from `current_storage_af` |
| Stale count | the pipeline's `is_stale` flag | late for its own cadence (2d daily / 45d monthly) |

Recomputing is the more precise number and keeps the client off a derived
field, at the cost of disagreeing with the legacy pages by up to the
pipeline's rounding (0.05 pp today). Percentage comparisons therefore carry a
0.1 pp tolerance and class-boundary comparisons skip reservoirs sitting inside
it, so a reservoir drifting past 50.00% cannot fail the suite on a morning
when no code changed.

Phase 0 is now closed: `deploy-pages.yml` builds and publishes `dist/`,
asserting that every current URL still resolves and that the payload is not
in the bundle. The Pages source has been switched to "GitHub Actions"; the
first run succeeded, the classic `pages-build-deployment` stopped firing, and
all seven published URLs (`/`, `explore.html`, `maplibre/`, `modern.html`,
`reservoirs.json`, `data/reservoirs.json`, `shared/reservoir-viz.js`) return
200 from the new deploy.

### Basemap authentication spike — 2026-08-09

**Resolved, and the plan survives it.** Measured against `@arcgis/core`
5.1.15 in a browser with no API key and no ArcGIS session, loading each
basemap and then fetching the service URLs it resolved to. Two identical
runs.

| Construction | Result |
|---|---|
| `Basemap.fromId("topo-vector")` | **Keyless.** 2 layers loaded, both service URLs 200 |
| `Basemap.fromId("gray-vector")` | **Keyless.** 2 layers loaded, both service URLs 200 |
| `new VectorTileLayer({ portalItem })` | **Keyless.** public AGOL item, 200 |
| `new Basemap({ style: { id: "arcgis/topographic" } })` | **401** from `basemapstyles-api.arcgis.com`, then an interactive ArcGIS Online sign-in prompt |
| `new Basemap({ style: { id: "arcgis/outdoor" } })` | **401**, same |

So the split is by *service*, not by SDK version: the well-known 4.x ids the
current picker uses still resolve to public ArcGIS Online vector tile items
and serve without credentials on 5.1. It is the **basemap styles service**
that is key-gated, and nothing forces us onto it.

Consequences:

- **Phase 2 is unblocked and needs no API key.** Keep `topo-vector`,
  `gray-vector`, `streets` and `imagery` — the ids already in the picker.
- A key remains optional, and buys exactly one thing: the modern
  `arcgis/*` styles and the basemap gallery built on them. Worth taking
  only if we decide those styles are visibly better than the current ones.
- Do not call `Basemap.fromId()` with a style id. It returns `null` rather
  than throwing, which reads like an auth failure and is not one.
- **Never let an unauthenticated style id reach production.** The failure
  mode is not a blank basemap, it is a modal username/password prompt on a
  public dashboard. If a key is ever added, `IdentityManager` should be
  configured not to challenge interactively.

### SDK hardening — anonymous auth policy, 2026-08-09

The spike's real lesson was not "no key needed", it was the *failure mode*: a
401 raised a username/password modal on a public page and then left the load
promise pending. Basemaps are only the example. Any secured resource does
this — a hosted feature service whose sharing changed, a portal item that
moved, an ArcGIS Server layer behind token auth — and Phase 2 onward adds
exactly those. Hardened before building the shell rather than after.

- **`src/arcgis/auth.ts`** — refuses credential challenges outright.
  `IdentityManager.getCredential` is the single choke point every secured
  resource funnels through, so overriding it to reject covers layers and
  basemaps alike rather than patching one call site. It must *reject*, not
  merely hide the dialog: hiding leaves the promise pending, which was the
  measured 20-second hang. A `dialog-create` listener tears down a modal if
  some other path still builds one.
- **`src/arcgis/fallback.ts`** — `resolveFirstLoadable` tries candidates in
  order, times out a hung one, and resolves with `null` rather than
  rejecting, because a caller out of options needs to render and explain
  itself, not handle another exception.
- **`src/arcgis/basemaps.ts`** — the only SDK-coupled seam; the other two
  take their dependencies as arguments and are unit-tested without a
  browser. Chain: `topo-vector` → `gray-vector` → the same tiles as a direct
  portal item → nothing, with a notice.

Verified in a browser against the real 401, not just against fakes:

| | Before | After |
|---|---|---|
| Key-gated style | modal, then pending forever | fails in **54 ms**, no modal |
| Fallback | none | falls through to `topo-vector`, renders |

Two findings worth carrying into Phase 2:

1. **The SDK rewraps the error.** The caller receives `[request:server]:
   <our message>` — an esri request error, not ours, so `instanceof
   SecuredResourceError` is `false` downstream. Detection has to match on
   content; use `isSecuredResourceRefusal()`, never `instanceof`.
2. **`Basemap.fromId()` returns `Basemap | null | undefined`** and really
   does return null for an unknown id. `basemaps.ts` converts that to a
   thrown candidate failure so a null never reaches a `MapView`.

**Decision — keep `exactOptionalPropertyTypes`.** The SDK's typings are not
authored for it: property getters include `undefined` where the matching
`*Properties` constructor shapes do not, so documented constructor usage can
fail to typecheck. The flag has earned its keep — it surfaced the real
`Basemap.fromId()` null path. Confine SDK construction and component assignment
to adapter seams; where Esri's instance and property types disagree, use a
narrow, commented assertion at that seam instead of weakening the application.
`src/architecture.test.ts` locks the compiler flag on.

**Regression guard is missing.** The verification above was a temporary page,
now deleted; the unit tests cover the policy against a fake IdentityManager
but nothing asserts end-to-end that no modal can reach production. Add it to
the Phase 7 Playwright run: load the shell with a deliberately key-gated
basemap first in the chain and assert no password input exists in the DOM.

### SDK structural decisions — 2026-08-09

The remaining pre-shell choices are now explicit and enforced:

- **Use CDN-hosted SDK assets.** This matches the SDK default and Esri's
  recommendation for connected apps. Do not add asset-copy steps or call a
  package `setAssetPath()` unless the requirement changes to a disconnected
  deployment; that would be a measured change for all five asset trees, not a
  one-package tweak.
- **Import individual custom elements.** Do not use package barrels or loader
  builds. `src/architecture.test.ts` fails on any package-wide component import
  and on any `@arcgis/core/widgets/*` import. Widgets are excluded by the build
  rather than by convention.
- **One Calcite installation.** The app keeps the direct Calcite dependency
  required by Esri's npm setup, while npm dedupes all ArcGIS peer dependencies
  to the same 5.1.x installation. The architecture test reads the lockfile and
  fails if a second physical Calcite copy appears.
- **A real Phase 2 bundle baseline runs in `npm run build`.** The planned
  shell/map/layer import surface emits 15.49 MiB raw / 5.43 MiB gzip across
  1,352 code-split files on 5.1.15; its static entry path is 2.19 MiB gzip.
  Ceilings are 18 MiB raw / 6 MiB gzip emitted and 2.5 MiB gzip static. Replace
  the fixture with the real shell entry and re-baseline deliberately when
  Phase 2 lands; chart and common-component costs enter in their own phases.

One plan correction fell out of checking the installed 5.1 component catalog:
there is no `arcgis-placement` component. Arbitrary KPI content belongs directly
in an `arcgis-map` named slot. Also start with a configured keyless
`arcgis-basemap-toggle`, not a gallery whose default source can expose the
key-gated `arcgis/*` styles this hardening deliberately excludes.

### Watershed expansion and Reclamation open data — scoped 2026-08-09

The dashboard needs two separate geographic groups. Do not merge them into one
number:

1. **Utah sites** contains measurement sites in Utah. This remains the default.
2. **Sites in drainage areas that touch Utah** also contains sites outside the
   state when their six-digit hydrologic unit intersects Utah. This includes the
   Colorado Headwaters and the connected Green, Gunnison, Dolores, and San Juan
   areas.

The U.S. Geological Survey Watershed Boundary Dataset is the boundary source.
It defines hydrologic units without regard to state borders. Keep the current
six-digit level because its 15 Utah-intersecting units are large enough for a
readable comparison chart. Add these fields to each published reservoir:

```text
in_utah                  true or false
huc6                     six-digit code
huc6_name                display name
huc_assignment_point     dam or outlet coordinates
huc_assignment_source    source for those coordinates
```

Assign a reservoir by its dam or outlet point, not by the center of its water
polygon. Large reservoirs can cross more than one boundary. The assignment says
where the stored water leaves the reservoir. Show this rule in the methods text.

**Reservoir discovery and measurements use different sources:**

- Use Reclamation's public `Reclamation_Reservoirs` ArcGIS FeatureServer for
  facility discovery and geometry. It is a native ArcGIS source and can load as
  a `FeatureLayer` in the SDK.
- Use observed storage time series from Reclamation RISE or another official
  operating source. The geometry service does not replace measured storage.
- Start the outside-Utah audit with the reservoirs on Reclamation's official
  Upper Colorado status page: Blue Mesa, Crystal, Morrow Point, Navajo, and
  Fontenelle. Lake Powell and Flaming Gorge are already present.
- Include a candidate only when it has an observed storage series, a traceable
  capacity, a stable site identifier, and a usable dam or outlet coordinate.
  Do not mix modeled values into current conditions.
- The refresh job writes normalized reservoir points and watershed boundaries
  to local JSON/GeoJSON. ArcGIS can use the live native layer when it is
  available. MapLibre uses the published local copy and does not depend on an
  Esri service at runtime.

**HUC totals are capacity-weighted reservoir totals:**

```text
percent full = sum(current storage) / sum(capacity) × 100
```

Label the result **tracked reservoir storage in this drainage area**. It is not
the percentage of all water in the watershed. Show the reservoir count and the
combined capacity beside every value. A 12-month HUC value is valid only when
every tracked reservoir in that HUC has a value for that month. Otherwise, show
a gap and the coverage count.

The HUC chart uses the same shared selection state as the map and table:

- `Utah sites`, `all connected sites`, or one HUC is the active group.
- The comparison view shows one capacity-weighted bar for each HUC.
- Selecting a HUC highlights its boundary and filters the reservoirs.
- The 12-month chart then shows the total for the selected HUC.
- The URL stores the selected HUC so that the view is shareable.

This is a data-enrichment step. It does not change the existing storage,
capacity, normal-value, or late-data formulas.

### Phase 1.5 scaffolding — 2026-08-09

The pure half of the watershed work is written and tested; nothing published
changes yet.

- **`src/data/huc.ts`** — point-in-polygon assignment (rings with holes and
  multipolygons), `rollupByHuc`, `monthlyRollupByHuc` and `coverageReport`.
  16 tests cover capacity weighting against naive averaging, the missing-
  capacity fallback, a site with no denominator at all, duplicate sites,
  cross-border assignment by outlet, and partial monthly coverage.
- **The coverage gate is a deliberate divergence** from `statewideMonthly` in
  `shared/reservoir-viz.js`, which sums whatever months are present. Across 53
  reservoirs a missing month barely moves the total; in a unit with three
  reservoirs it is a cliff that reads as a drought. HUC months are therefore
  all-or-nothing, and carry their `covered`/`count`.
- **`scripts/fetch-huc6.mjs`** publishes the units as versioned GeoJSON, and
  fails rather than writing if the service stops returning exactly 15 — the
  `states` filter and the layer numbering are both things that can change
  without notice. Verified against the live service: the 15 units are correct.
- **Not committed yet: the boundary file.** 1.7 MiB at metre precision. The
  likely answer is two files, full precision for the assignment and a
  generalized copy for the map, decided with both sizes measured. Until then
  the pages keep their live query.
- The typed record now carries optional `in_utah`, `huc6`, `huc6_name`,
  `huc_assignment_point` and `huc_assignment_source`. Optional because the
  Python refresh does not emit them and the pages must keep working without
  them.

### The pipeline publishes watersheds — 2026-08-09

`huc.py` (standard library, no pandas) holds the geometry, the Utah outline
and `describe()`; `refresh_reservoirs.attach_watersheds()` calls it once per
run and writes `in_utah`, `huc6`, `huc6_name`, `huc_assignment_point` and
`huc_assignment_source` onto every record, plus a `watersheds` block in the
envelope. All 53 assigned, 50 in Utah. `huc6.geojson` is copied into `dist/`
and `dist/data/` alongside the other runtime data and asserted in the deploy
workflow, so the pages can stop querying the USGS service on every load.

Three decisions worth keeping:

- **Carried-forward records are enriched too.** A reservoir whose feed went
  quiet has not moved. Leaving it without a basin would drop it out of every
  drainage-area total on the day it most needs to be visible as late data.
- **A missing boundary file is not fatal.** The fields are optional in the
  schema and the dashboards work without them; losing a day of data over a
  geometry lookup would be the worse failure. It warns and publishes.
- **`in_utah` is computed from the reservoir's point, not the assignment
  point.** Found by running it: Glen Canyon Dam is in Arizona and Lake Powell
  reaches well into Utah, so once the dam points land, deriving `in_utah`
  from the assignment would drop the largest reservoir on the dashboard out
  of its own default view. The two points are now separate arguments and a
  test pins the Lake Powell case.

**Still to do in this phase:** upgrade the 28 RISE reservoirs to real dam
points (measured as moving no assignment, so it is a provenance improvement),
and audit the connected out-of-state reservoirs. Colorado Headwaters,
White-Yampa and Lower San Juan currently have zero tracked reservoirs — which
is where Blue Mesa, Morrow Point and Navajo would land.

### Watershed assignment measured — 2026-08-09

`tools/probe_huc_points.py` answers the two questions the plan could only
assume. Standard library only, so it runs without the pandas/numpy stack.

**1. What do our published coordinates actually describe?** Not dams. The
28 reservoirs with a NID id in `capacities.json` can be queried against the
inventory *by id* — no name matching, so none of the risk that made
`build_capacity_table.py` careful. The published point sits a median of
**1.08 km** from its dam, worst **20.87 km** (Lake Powell, whose point is out
on the lake rather than at Glen Canyon Dam; Flaming Gorge is 14.50 km).
These are lake points.

**2. Does it matter?** Today, no. **All 53 reservoirs are assigned, none is
unassigned, and not one changes unit** when the dam point is used instead.
So the dam/outlet rule stands — it is the correct rule and it is what the
methods text will say — but it is a **correctness improvement, not a
blocker**. The refresh job can publish assignments now with
`huc_assignment_source` recording which kind of point was used, and upgrade
the 28 to dam points afterwards without a single assignment moving.

**3. How much boundary precision does this need?** Far less than assumed.
No tracked reservoir sits closer than **2.72 km** to a unit boundary (median
14.04 km, closest is Lost Lake). Generalizing the boundaries to roughly 500 m
is five times finer than the closest call anyone has to make, and was checked
directly rather than argued: all 53 assignments are identical to the
ungeneralized geometry.

| Boundaries | Size | Vertices | Assignments that move |
|---|---|---|---|
| `geometryPrecision=5`, ungeneralized | 718 KiB | 33,646 | — |
| `maxAllowableOffset=0.001` (~100 m) | 601 KiB | 28,155 | 0 |
| **`maxAllowableOffset=0.005` (~500 m)** | **146 KiB** | **6,764** | **0** |
| `maxAllowableOffset=0.01` (~1 km) | 75 KiB | 3,414 | 0 |

This **retires the "two files" plan** from the scaffolding note above: one
generalized file serves both the assignment and the map. `huc6.geojson` is
committed at 0.005. 0.01 also loses nothing today and was not taken — at
~1 km it is the same order as the 2.72 km closest approach, so one reservoir
added near a divide could quietly flip; 146 KiB buys a real margin.

`tests/test_huc.py` locks all of this in against the committed files, with no
network: the 15 units by code and name, every reservoir landing in exactly
one unit, ten hand-checkable assignments (Strawberry in Lower Green rather
than Jordan, Bear Lake in Lower Bear, Meeks Cabin in Upper Green from
Wyoming), the 2 km boundary margin the generalization was chosen against, and
the ray-casting fixtures shared with `src/data/huc.test.ts` so the Python and
TypeScript implementations cannot drift.

### Starting extent — 2026-08-09

The starting box was a tight fit around Utah and cropped hard against the
state line. It is now one zoom level wider. This is provisional and marked as
such in `shared/reservoir-viz.js`: a hand-set box around one state stops
making sense as soon as the connected sites land, because the drainage areas
that touch Utah reach into Colorado, Wyoming and New Mexico. Once those are
published the extent should be computed from the sites and boundaries on the
map, not written down.

### Full review — 2026-08-09

Findings from a pass over the live site and the whole tree, after the
watershed work landed.

- **The Utah mask had been deleted and everything still claimed it existed.**
  The drainage-area layer replaced the scrim instead of joining it;
  `utahMaskRings`, `utahMaskGeoJSON`, `MASK_FILL` and `MASK_LINE` stayed
  exported and unused, and the README kept describing the mask at length.
  The cause of it going unnoticed is the interesting part: `index.html`
  reported `masked` and `huc6` from the *same expression*, so the browser
  test made two assertions about one fact. **A test that cannot fail counts
  as coverage without being coverage.** Restored, under the outlines, with
  the two signals now genuinely separate. It matters more than it did — the
  starting extent is a zoom level wider, so there is far more out-of-state
  area on screen.
- **`MAP_CENTER` is also dead**, left over from the pre-extent construction.
- **The published watershed data has no reader yet.** Every record carries
  `huc6`, `huc6_name` and `in_utah`, the envelope carries the summary, and
  `rollupByHuc`/`monthlyRollupByHuc` are written and tested — and no page
  displays or filters by any of it. Next on the overview.
- **The map pages are barely interactive**: click-to-popup and a basemap
  selector. No hover, no filtering, no deep links, no keyboard path. All of
  the project's interaction lives in `explore.html`. Phases 3 and 5 are being
  pulled forward onto the current pages rather than waiting for the shell,
  because the shell is several phases away and these are the pages people
  are using now.
- **The CI screenshot artifact shows a blank map canvas** on both map pages,
  at every width, while the live site renders correctly. Headless rendering,
  not a defect — but it means the uploaded screenshots prove much less than
  they appear to, and the smoke test's "every reservoir rendered" is a count
  of graphics in a layer, not of anything painted. Worth closing with a pixel
  or WebGL check rather than leaving the artifact looking authoritative.

### Noticed while testing, not fixed

The live 4.34 page logs `Found 10 Visual Variable stops, but MapView only
supports 8. Displayed stops will be simplified` — three times, once per
layer. The size ramp is being silently truncated today, so the current map's
circle sizing is not quite what the code asks for. Phase 3 rebuilds this
symbology on `CIMSymbol` anyway; fold the fix in there rather than patching
the page being replaced.

---

## 1. Where the project is today

Five source files do all the work, with no dependencies and no build:

| File | Role |
|---|---|
| `index.html` | ArcGIS Maps SDK **4.34**, loaded from CDN with a `<link>` + `<script>` pair and AMD `require()`. Two `FeatureLayer`s, `SimpleRenderer` + Arcade `valueExpression` visual variables. |
| `maplibre/index.html` | MapLibre GL JS from unpkg. One GeoJSON source, two `circle` layers, native expressions. Open-source parity comparison. |
| `explore.html` | Statewide overview. Vite entry using bundled Observable Plot, but no map SDK. Totals, interactive statewide trend, ranking, sortable table + CSV, 53 sparklines. |
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
| Charting | hand-rolled inline SVG | Observable Plot 0.6 for time series; `@arcgis/charts-components` for layer-driven charts | Plot is now proven on the production statewide trend; ArcGIS Charts remains for Phase 4's layer-bound ranking and distribution views. |

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

### Phase 1.5 — Watershed and connected-reservoir data

This phase must finish before the new shell depends on HUC filters.

1. Publish the 15 six-digit hydrologic units that intersect Utah as versioned
   GeoJSON from the official U.S. Geological Survey service.
2. Add the HUC and Utah-membership fields defined above to the typed reservoir
   record and runtime validator.
3. Add a tested point-in-polygon join that uses each dam or outlet point.
4. Audit Reclamation facility candidates inside those HUC polygons. Join each
   accepted site to an observed storage series and a capacity source.
5. Add pure `rollupByHuc` and `monthlyRollupByHuc` functions. Test capacity
   weighting, missing capacity, duplicate sites, cross-border sites, and partial
   monthly coverage.
6. Publish a coverage report. It lists accepted, rejected, and unmatched sites
   with the reason for each result.

**Done when:** every published reservoir has one verified HUC assignment; the
Utah-only totals do not change; and each HUC total states its reservoir count and
coverage.

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
│       ├── arcgis-basemap-toggle (topo-vector ↔ gray-vector) in an arcgis-expand
│       ├── arcgis-home, arcgis-scale-bar, arcgis-fullscreen
│       └── custom KPI container in the top-left named slot (glass panel)
├── calcite-shell-panel (end)    — selected reservoir
│     KPI tiles · 12-month trend chart · monthly table (calcite-block, collapsed)
│     · sample-depth and staleness notices · source links
└── calcite-shell-center-row (bottom, collapsible)
      tabbed: Ranking (all loaded reservoirs) | Table (sortable + CSV) | Sparklines
```

- Calcite handles responsive collapse; on mobile the side panels become sheets. This closes the README's "mobile layout on the maps" item structurally rather than with media-query patches.
- **Known ArcGIS phone-layout failure, confirmed in CI runs 27 and 28:** at a
  390-pixel screen width, the legacy title panel spans from 8 pixels inside the
  left edge to 8 pixels inside the right edge. The longer Simplified Technical
  English status text makes the panel tall enough to overlap the ArcGIS zoom
  control at the upper right by about 17 pixels. Keep the existing Playwright
  no-overlap check. In the unified shell, responsive Calcite panels and named map
  component positions must prevent this by design. If the legacy page is changed
  before Phase 2 replaces it, move the zoom control to the lower right below 640
  pixels and keep it at the upper right on larger screens.
- Light/dark via `calcite-mode-light` / `calcite-mode-dark` on the root. **Caveat from Esri's docs: `calcite-mode-dark` is not applied to charts components** — chart theming must be handled explicitly.
- Theme tokens in `src/styles/theme.css`. Style with Calcite CSS variables; use plain CSS only for structure. Do not override Calcite internals.

**Done when:** the new `index.html` shows every published reservoir with the current symbology, in one responsive shell, at parity with the 4.34 page.

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
- the all-reservoir ranking chart (colored on the same class breaks),
- a distribution histogram of % capacity,
- and legitimately showcase the new charts package on data that actually fits it.

**(b) Time series → Observable Plot.** The 12-month history is a **nested array per
reservoir**. The README already records that neither engine will carry a nested
array on a feature — it has to live in a side lookup keyed by name. That makes it
a poor fit for a layer-bound chart component. Use
[Observable Plot](https://observablehq.com/plot/): small, declarative, plain SVG
output, easy to theme from Calcite tokens, and it replaces the hand-rolled chart
with materially less code while adding per-month tooltips and focusable marks.
Use it for the 12-month trend (with the dashed normal line), the reservoir sparklines,
and the statewide 12-month chart.

The statewide chart is the first production proof: `explore.html` is now a
Vite entry and ships Plot as a 102.4 kB gzip bundle alongside the existing
runtime-loaded data. It adds pointer tooltips, with/without-Powell scope and
acre-feet/percent controls without taking a dependency on either map SDK. Keep
the tiny multiples as lightweight SVG until the unified shell can measure
whether replacing all of them is worth the DOM and interaction cost.

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
- Read the same normalized reservoir and HUC GeoJSON that the refresh job
  publishes. Keep monthly arrays in the keyed data lookup instead of feature
  properties. This avoids engine-specific parsing and keeps the map source small.
- Make CARTO Positron the calm default background. Keep Voyager and Dark Matter
  as explicit choices. Save the choice in the URL.
- Add HUC hover and selection. A selected HUC gets a stronger outline. Its
  tracked-reservoir total appears in a small summary card. Selection filters the
  points, chart, table, and URL through the shared state object.
- Add reservoir hover, keyboard-accessible results beside the canvas, selected
  feature state, and the same deep links as the ArcGIS page. Canvas markers alone
  are not a complete accessible interface.
- Treat the HUC layer, facility layer, and background style as independent
  failures. Reservoir points must still render when one optional layer fails.
- Add expression-parity tests for class color, relative circle size, late-data
  rings, selected state, and HUC filters. Compare pixel screenshots at desktop
  and phone widths after the data assertions pass.
- Re-run the comparison and update `maplibre/README.md`. The v5-era findings need re-checking: the dashed-stroke gap, the nested-array behavior, and the antimeridian mask inversion are all worth re-testing against 6.x and 5.1 respectively.
- **The MapLibre page is also the Esri-outage fallback** the current
  `explore.html` provides. Do not make its runtime depend on the Reclamation
  FeatureServer. Use the local normalized copy created during the refresh.

### Phase 7 — Consolidation, verification, docs

- Rewrite the Playwright smoke test against the new DOM. **Gotcha: Calcite and ArcGIS components are shadow-DOM.** Playwright's CSS locators pierce open shadow roots, but map readiness cannot be asserted from the DOM — wait on the `arcgis-map` component's ready event / `view.when()` via `page.waitForFunction`, not on a selector. Keep the existing assertions: every published reservoir renders, a popup opens, zero console errors, screenshots uploaded.
- **Assert no credential prompt can reach production.** Load the shell with a key-gated basemap forced to the front of the chain and assert there is no password input anywhere in the DOM (piercing shadow roots), and that the fallback basemap rendered. The policy in `src/arcgis/auth.ts` is unit-tested against a fake IdentityManager; this is the end-to-end half.
- Add axe-core to the Playwright run. Keyboard and contrast pass across the shell — the README's open accessibility item.
- Lighthouse and runtime-transfer audit. The emitted SDK budget already runs in every build; replace its fixture with the real shell entry, verify lazy chunks are requested only when used, and verify CDN-hosted assets resolve under the production CSP.
- Decide the fate of `explore.html`: the unified dashboard supersedes most of it. Either retire it with a redirect, or keep it deliberately as the no-SDK fallback (recommended — it is the page that survives a CDN outage, and that is a real property worth keeping).
- Rewrite the main README. It is excellent and should stay that way; the architecture section is what changes.

---

## 4. Risks and traps

| Risk | Notes / mitigation |
|---|---|
| ~~**ArcGIS basemaps and API keys**~~ | **Checked and cleared, 2026-08-09.** The current keyless basemap strings still work on 5.1; only the `arcgis/*` styles service is key-gated, and we are not obliged to use it. The keyless `VectorTileLayer` fallback was verified to work too, so the contingency exists if Esri changes this later. Residual risk is that Esri meters or retires the public AGOL basemap items — worth re-running the spike at each SDK upgrade. |
| **Widget deprecation** | All widgets are deprecated in 5.0 and slated for removal in 6.0 (Q1 2027). Write **zero** widget code. `src/architecture.test.ts` fails on `@arcgis/core/widgets/*`; anything ported from the 4.34 page must be re-expressed as components. |
| **Daily data must not need a rebuild** | Covered by the runtime-fetch rule in §2. Verify explicitly with a data-only commit before Phase 2. |
| **Bundle size** | The Phase 2 SDK surface baseline is 15.49 MiB raw / 5.43 MiB gzip emitted, with a 2.19 MiB gzip static entry path, and is checked by every build. Re-baseline deliberately from the real entry as each component phase expands it. |
| **MapLibre 6 browser floor** | WebGL2 mandatory, ESM only. Detect and message. |
| **Shadow DOM in tests** | Existing smoke test will not survive the port unchanged. Rewrite in Phase 7, don't patch. |
| **Losing single-source-of-truth for class breaks** | The current code is careful that breaks, legend, chart colors and both engines' expressions derive from one table. A rewrite across four packages is exactly where that drifts. Assert it in a unit test. |
| **Scope creep into the data pipeline** | The HUC work adds a controlled enrichment stage and additional observed sites. It does not change the existing storage, capacity, normal-value, or late-data formulas. Keep candidate discovery, HUC assignment, and rollups in new tested modules. Catalog ID verification, plausibility checks, snowpack context, and series caching remain a separate track. |

---

## 5. Open decisions

1. ~~**API key / basemap**~~ — **resolved 2026-08-09, no key needed.** The
   well-known ids (`topo-vector`, `gray-vector`, …) still serve keyless on
   5.1; only the `arcgis/*` basemap styles service returns 401. See the
   [basemap authentication spike](#basemap-authentication-spike--2026-08-09).
   A key is now an optional upgrade, not a dependency.
2. ~~**Observable Plot vs. ECharts vs. keeping hand-rolled SVG**~~ — **resolved 2026-08-09: Observable Plot.** It is live in the statewide Vite entry with pointer tips, responsive axes, scope switching and unit switching. ECharts remains unnecessary unless a later phase needs linked brushing or zoom-heavy analysis.
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
- [USGS Hydrologic Units and the Watershed Boundary Dataset](https://water.usgs.gov/themes/hydrologic-units/)
- [Reclamation Reservoirs ArcGIS FeatureServer](https://services5.arcgis.com/HDRa0B57OVrv2E1q/ArcGIS/rest/services/Reclamation_Reservoirs/FeatureServer)
- [Reclamation RISE reservoir conditions data and methods](https://data.usbr.gov/visualizations/reservoir-conditions/)
- [Reclamation Upper Colorado Basin status](https://www.usbr.gov/uc/water/hydrodata/status_maps/uc_status.html)
