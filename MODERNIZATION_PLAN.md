# Modernization Plan — Utah Reservoir Drought Dashboard

**Status (2026-08-15):** Phases 0, 1, 1.5, 2, 3, and 5 are complete. The
inventory portion of Phase 1.6 added Fontenelle; drought context remains data
only. Phase 4 is underway: the chart workspace is live, its class colours,
storage bands and reservoir summaries have completed their first accessibility
pass, and the layer-driven ranking chart now runs on the primary application's
bottom row. The ArcGIS 5.1 application is the root production view. The first
snowpack view shipped late on 2026-08-15: a fourth navigation surface with the
seasonal percent-of-normal curve, drainage-area narrowing over `?area=`, and
the full site table, validated at the fetch boundary and gated by its own
browser smoke sections. Its map rendering (the basin choropleth) is still to
build under slice 5.

**Goal:** turn a set of three hand-written, zero-build HTML pages into one slick,
unified dashboard on the current generation of tooling — ArcGIS Maps SDK for
JavaScript 5.1, MapLibre GL JS 6, Calcite Design System 5, and a real build
pipeline — while preserving the daily refresh contract. Controlled data
enrichment is allowed; the storage formulas and refresh reliability contract
are not part of the frontend rewrite.

**Decisions already made** (see [Open decisions](#open-decisions) for what is not):

| | |
|---|---|
| Build step | **Yes.** Vite + npm + TypeScript. The zero-build constraint is retired. |
| Visual scope | Polished 2D + micro-interactions, plus a real charting upgrade. 3D scenes and deck.gl are **out of scope** for this pass (parked in [Deferred](#deferred)). |
| First target | **A new unified dashboard** — map, charts, metrics and table in one Calcite shell. It now runs at the root; the existing views remain as explicit comparisons. |
| User text | **Use ASD-STE100 Simplified Technical English.** Use short sentences. Use one term for one item. Replace specialist terms when possible. Define each required water or file term. |

### Current snapshot

| Area | State |
|---|---|
| Production views | The ArcGIS 5.1 application runs at the root. ArcGIS 4.34, MapLibre, and the earlier overview remain at comparison URLs. |
| Build and deploy | Vite, strict TypeScript, Vitest, runtime-data copying, GitHub Pages deployment after direct pushes and successful refreshes, and the SDK bundle budget are live. |
| Typed foundation | Runtime validation, class breaks, formatting, statewide rollups, drainage-area assignment, and drainage-area rollups are tested. |
| Data expansion | Fourteen drainage areas are in scope. Fontenelle is included; the remaining inventory candidates still need capacity validation. |
| Symbology and interaction | One feature layer, composed symbols, hover, selection, filter effects and shareable state are live and measured affordable on integrated graphics. |
| Bottom row | The sortable table, its CSV export, and Phase 4's ranking chart share the row under the map. The chart is loaded when the row opens. |
| Next application work | Phase 4's remaining question: whether the distribution histogram joins the primary application or stays an overview-only view. |

This file is both a roadmap and an implementation journal. Dated review and
measurement sections are historical evidence; the snapshot above and the phase
headings below are the current status. Accepted architectural decisions live
in [`docs/decisions/`](docs/decisions/) and are not rewritten here.

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
unit parity tests against the then-current payload, a Vite production
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

1. **Utah waterbodies** contains reservoirs whose stored-water surface
   intersects Utah. This remains the default and includes cross-border lakes.
2. **Sites in drainage areas that touch Utah** also contains sites outside the
   state when their six-digit hydrologic unit intersects Utah. This includes the
   Colorado Headwaters and the connected Green, Gunnison, Dolores, and San Juan
   areas.

The U.S. Geological Survey Watershed Boundary Dataset is the boundary source.
It defines hydrologic units without regard to state borders. Keep the current
six-digit level because its 14 qualifying units are large enough for a
readable comparison chart. Add these fields to each published reservoir:

```text
in_utah                  whether the provider point is in Utah
intersects_utah           whether the waterbody intersects Utah
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
  without notice. Verified against the live service. (Fourteen since ADR-010; fifteen when
  this was written.)
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

**Waterbody correction — 2026-08-10.** ADR-013 supersedes the use of
`in_utah` for the default rollup. Official USGS NHDPlus HR waterbody polygons
show that Bear Lake and Meeks Cabin Reservoir cross into Utah even though
their provider points are outside it. Every record now also carries
`intersects_utah`; the Utah rollup uses that field. The current Utah count is
52, or 51 when Lake Powell is excluded. HUC assignment still uses the dam or
outlet, and Upper Snake remains excluded from both committed boundaries and
the legacy pages' live WBD query.

**The overview reads it — 2026-08-10.** `explore.html` now imports
`rollupByHuc` from `src/data/huc.ts` (its first consumer, so the tested module
and the shipped page are the same code) and renders one capacity-weighted bar
per drainage area. Selecting an area filters the ranking, table and cards
through the existing `visibleRows()`, so it is a filter beside `q` and
`staleOnly` rather than a second mode. Eleven of the fourteen units in scope have tracked
reservoirs; the three empty ones are where the connected out-of-state
reservoirs would land. The browser test asserts the filter actually filters --
a section that renders but filters nothing looks correct in a screenshot.

### Dam points, and the connected-reservoir audit — 2026-08-10

**Dam points are in.** `tools/add_dam_points.py` queries the National
Inventory of Dams *by the NID id the capacity already came from*, so there is
no name matching and none of its risk, and writes `dam_lon`/`dam_lat` into
`capacities.json`. The refresh uses the dam point where it has one and the
published lake point where it does not, recording which in
`huc_assignment_source`. 28 of 53 are now assigned by their dam and — as
measured beforehand — **no reservoir changed drainage area**. Lake Powell now
assigns from Glen Canyon Dam in Arizona while still reading `in_utah: true`,
which is exactly the case the two-points rule was written for.

**The audit found a scoping conflict, not a shopping list.**
`tools/audit_connected_reservoirs.py` checks each candidate against the four
admission criteria:

| Candidate | Storage series | Capacity | Drainage area | Admissible |
|---|---|---|---|---|
| Blue Mesa | RISE item | 748,430 af | 140200 Gunnison (CO) | **no** |
| Morrow Point | RISE 592 | 117,190 af | 140200 Gunnison (CO) | **no** |
| Crystal | RISE 274 | 25,236 af | 140200 Gunnison (CO) | **no** |
| Navajo | RISE 613 | 1,708,600 af | 140801 Upper San Juan (AZ,CO,NM) | **no** |
| **Fontenelle** | RISE 347 | 334,411 af | **140401 Upper Green (CO,UT,WY)** | **yes** |

Every one of them has an observed storage series and a traceable capacity.
Four are rejected on **geography alone**: their drainage areas do not touch
Utah. The candidate list comes from Reclamation's *Upper Colorado operating
region*, while this dashboard's rule is *drainage areas that intersect Utah*,
and those are different sets. Blue Mesa's water reaches Lake Powell, but the
Gunnison basin never enters the state.

So there is a decision here, and it is not "add these five":

- **Keep the intersect-Utah rule.** Only Fontenelle is admissible, and it
  joins Upper Green, which already has three reservoirs.
- **Widen the rule to "upstream of Utah".** That admits all five and a good
  deal more, changes every statewide total, and needs a different sentence in
  the methods text than the one there now.

**None of the five fills an empty area.** Colorado Headwaters, White-Yampa,
Lower San Juan and Upper Snake stay empty either way, for a different reason
in each case — which is the next thing to look at rather than assuming the
Reclamation list covers it.

**Two API traps found on the way, both the same shape.** RISE answered 200 and
*ignored the filter* for `?itemTitle=`, returning California reservoirs, so
the first pass of the audit reported "no storage series" for all five;
`tools/probe_rise.py` already records the identical trap for `locationId`. And
NID's `STATE` column holds `Colorado`, not `CO`, which
`build_capacity_table.py` already guards against and this tool did not.
**Treat any filter on these services as unsupported until its output proves
otherwise.**

**Geography rule decided — 2026-08-10: keep intersect-Utah.** Recorded as
[ADR-009](docs/decisions/ADR-009-geography-is-drainage-areas-that-touch-utah.md).
Fontenelle is therefore admissible and is **not yet added**: it moves the
statewide totals, so it is its own deliberate step. The four empty drainage
areas stay empty, and why each is empty is still open.

---

## Phase 1.6 — Snowpack, drought context, and the Colorado/Wyoming inventory (in progress)

Scoped 2026-08-10. The inventory pass and first addition are complete;
snowpack and drought context remain unimplemented. Three related additions,
in the order they pay back.

### What was measured before scoping this

The important finding is that **the biggest piece needs no new data
provider.** The AWDB REST API the pipeline already calls carries both the
snowpack and the out-of-state reservoirs, on the same station triplets, with
no key:

| | Colorado | Wyoming | Utah |
|---|---|---|---|
| Reservoir storage stations (`RESC`, all BOR network) | **85** | **20** | 58 |
| Snow water equivalent stations (`WTEQ`) | **199** | **150** | 159 |

**A third silently-ignored filter, same shape as the other two.** `stateCds`
does nothing: `?stateCds=CO`, `?stateCds=WY` and `?stateCds=UT` all return the
identical national set (347 storage stations, 2,175 snow stations). The
numbers above come from filtering the returned station triplets in the client.
This is now three services — RISE `itemTitle`, NID `STATE`, AWDB `stateCds` —
where an unsupported filter is answered with 200 and ignored rather than
rejected. **Filter client-side, and assert the counts.**

### 1.6a Snowpack (SNOTEL, via AWDB)

Utah's reservoir year is decided by snowpack, and every reservoir trend on the
dashboard is currently a shape with no cause.

- `WTEQ` (snow water equivalent) and `SNWD` (snow depth), daily, from the same
  AWDB endpoint and the same retry and staleness handling the reservoirs use.
- Roll up **by drainage area**, not by state: the page already groups by
  six-digit unit, so snowpack joins the existing structure with no new
  geography. Assign each station by point-in-polygon, exactly as reservoirs are.
- Compare against the **median for the same day-of-year in prior years** — the
  same "normal" definition already used for storage, so the two read alike.
- The honest caveat has to be visible: snow water equivalent in August is not
  a meaningful number. Show the seasonal series, not a single current value,
  and say what part of the year it describes.

### 1.6b Drought context (U.S. Drought Monitor)

An independent weekly read to set against storage. Where the two disagree is
the interesting part: a full reservoir in a D3 basin is a story.

- **Needs a spike first.** `usdmdataservices.unl.edu`'s HUC statistics
  endpoint answered **200 with zero rows for every HUC level tried** (2, 4, 6,
  8, in both region 14 and 16), and the comprehensive-statistics endpoint
  answered 400 for the parameter shape tried. So the service is reachable and
  its contract is **unverified**. Do not plan a phase on it until a spike
  returns real rows; try the county and state endpoints too, and check whether
  it wants a different date format or an `aoi` that is not a bare HUC code.
- If it works, store the weekly D0–D4 area percentages per drainage area and
  show them beside the storage bar. Percentages of *area*, not of severity —
  the wording has to make that clear.
- If it does not, the fallback is the published weekly shapefile or GeoJSON,
  processed the same way the watershed boundaries are: fetched by a tool,
  committed, and versioned.

### 1.6c results — the AWDB pass, run 2026-08-10

**Fontenelle is in.** RISE item 347, 4,239 daily observations back to 2015,
currently 291,378 acre-feet — 87% of a 334,411 acre-foot capacity from NID
WY01389. Assigned to 140401 Upper Green by its dam, and `in_utah: false`,
which is the honest reading for a Wyoming reservoir on a Utah dashboard. 54
reservoirs now, 29 by RISE.

**One anomaly, recorded rather than smoothed.** Fontenelle's observed maximum
since 2015 is 344,308 acre-feet against a NID capacity of 334,411 — the
reservoir has been held about 3% above its listed maximum pool.
`build_capacity_table.py` treats capacity below observed storage as evidence
that the *wrong dam* was matched, and would reject this row. Here the dam is
confirmed by NID id, name and coordinates, so the check's purpose is
satisfied and the figure is kept. The consequence is that Fontenelle can read
slightly over 100% full, which the class ramp already handles because its top
class is open-ended (ADR-008). NID's `nid_storage` of 405,160 would remove the
anomaly and is deliberately not used: it is the flood-surcharge figure ADR-003
rejects.

**The pass itself, over 347 active storage stations:** 52 already tracked, 248
outside our drainage areas, **47 candidates** — Colorado 17, Idaho 13, Utah 10,
Wyoming 6, Arizona 1.

| Drainage area | Tracked | Candidates |
|---|---|---|
| 140100 Colorado Headwaters | 0 | **10** |
| 140300 Upper Colorado-Dolores | 1 | 3 |
| 140401 Upper Green | 4 | 4 |
| 140500 White-Yampa | 0 | **4** |
| 140600 Lower Green | 14 | 3 |
| 140802 Lower San Juan | 0 | **1** |
| 150100 Lower Colorado-Lake Mead | 4 | 3 |
| 160300 Escalante Desert-Sevier Lake | 8 | 3 |
| 170402 Upper Snake | 0 | **13** |
| Weber, Jordan, Upper Colorado-Dirty Devil | 8 / 6 / 1 | 0 |

**This answers why the four areas are empty: they are not.** Colorado
Headwaters has ten storage stations, White-Yampa four, Lower San Juan one and
Upper Snake thirteen. We had never looked outside Utah's own inventory. Weber
and Jordan return zero candidates, which is the reassuring half — those are
fully covered, and it is what tells us the matching is working rather than
just permissive.

**One decision taken, one still open:**

1. **Upper Snake is excluded — decided 2026-08-10.**
   [ADR-010](docs/decisions/ADR-010-colorado-and-great-basin-systems-only.md)
   supersedes ADR-009: a drainage area must touch Utah *and* belong to the
   Colorado River or Great Basin systems (regions 14, 15, 16). Upper Snake
   clips Utah's northern edge and drains to the Columbia, so its thirteen
   Idaho reservoirs are out of scope. **Fourteen units, and no published
   number changed** — it never held a tracked reservoir. 34 candidates remain,
   all Colorado and Great Basin. Bear River is region 16 and unaffected.
2. **Capacity is still the bottleneck.** AWDB publishes none, so each of the
   34 needs an NID match that survives the observed-storage check — the same
   check Fontenelle only just passed. Expect attrition, and expect it to be
   worst for the small Colorado sites.

### 1.6c The Colorado and Wyoming inventory

ADR-009 keeps the intersect-Utah rule, so this is not "add Colorado". It is:
**which sites inside the fourteen units are we missing?**

- Start from the 85 Colorado and 20 Wyoming AWDB storage stations, assign each
  by point-in-polygon against the committed units, and keep the ones that land
  inside. That is a mechanical, reproducible list rather than a hand-picked one.
- Then apply the same four admission criteria as the Reclamation audit:
  observed series, traceable capacity, stable identifier, usable outlet point.
  Capacity is the likely bottleneck — NID covers the dams, but the match has to
  survive the same "capacity below observed storage means the wrong dam" check.
- **Fontenelle is already known-admissible** and is the natural first addition.
- Expect the four empty areas to stay empty: Colorado Headwaters and
  White-Yampa are in the units that touch Utah only at their edges, so a
  station inside them is possible but not guaranteed. Report the count found
  per area rather than assuming.
- Every addition changes the statewide totals, so land them as one reviewable
  change with the before-and-after numbers stated, not one at a time.

**Not in scope:** state-agency APIs. Colorado's CDSS and Wyoming's SEO both
publish reservoir data, but AWDB already covers 105 sites in those two states
through an integration this project has, with identifiers it already handles.
A second provider is only worth taking on if the AWDB pass leaves a gap that
matters, and the pass has to come first.

### 1.6c publication — 2026-08-14

[ADR-023](docs/decisions/ADR-023-fill-the-empty-drainage-areas.md) closes the
empty-area inventory question. The position-first capacity audit admitted all
15 stations in the three empty published drainage areas: ten in Colorado
Headwaters, four in White-Yampa, and one in Lower San Juan. They are committed
as reviewed configuration in `connected_reservoirs.json`, with their station
identifiers and National Inventory of Dams evidence kept together.

The refresh now publishes 69 reservoirs across all fourteen drainage areas.
Nine of the additions use current daily values and six use monthly values.
Elkhead Reservoir's newest monthly value is May 31, 2026, so it is published
as late data instead of being made to look current.

The earlier drought-service block is also resolved at the geometry level.
`tools/fetch_drought_monitor.py` downloads the official current nationwide
polygons as GeoJSON, verifies completeness and common dates, and writes
`data/drought/usdm-current.geojson`. Adding those polygons to the interface and
calculating drainage-area coverage remain later product work.

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

**2. Does it matter?** At the time of this measurement, no. **All 53 reservoirs
then published were assigned, none was
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
directly rather than argued: all 53 then-current assignments are identical to the
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
network: the units by code and name, every reservoir landing in exactly
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

### Noticed while testing — subsequently fixed

The live 4.34 page logged `Found 10 Visual Variable stops, but MapView only
supports 8. Displayed stops will be simplified` — three times, once per
layer. This was fixed on the production page by replacing the color visual
variable with a `UniqueValueRenderer` generated from the shared class table
(ADR-008); it was not deferred to the new shell.

### Symbol and filter cost measured — 2026-08-13

Phase 3.5's last open item. The rule was written down in
[`docs/PHASE-3-PLAN.md`](docs/PHASE-3-PLAN.md) before the tool existed, so
this is a result being read against a threshold rather than a threshold being
chosen to fit a result.

Measured with `node tools/profile-symbols.mjs` against `dist/modern.html` on a
MacBook Air, Apple M4 (10 CPU cores, 8 GPU cores, 16 GB), macOS 27, Google
Chrome 151.0.7922.138 — integrated graphics, which is the class of machine the
rule was written for. Four runs per arm, the first of each discarded to shader
compilation.

| Measurement | Value |
|---|---|
| Frame budget (median idle interval) | 16.7 ms |
| Pan p50, reservoirs drawn | 16.7 ms |
| Pan p95, reservoirs drawn | 17.7 ms |
| Pan p50, reservoirs hidden | 16.7 ms |
| Layer's share of the median frame | 0 ms |
| Run-to-run spread (noise floor) | 0 ms |
| Tasks over 50 ms | 0 |
| Filter apply, per change | 12.6–18 ms |

All three pre-registered thresholds pass: pan p95 of 17.7 ms against a limit of
33.4 ms, a layer share of 0 ms against 4.17 ms, and no task anywhere near the
50 ms long-task threshold.

**The composed symbol is free at this inventory size, to the limit of what the
display can resolve.** Panning with all 51 reservoirs drawn and panning with the
layer removed produce the same median frame interval, and the display refreshes
at 16.7 ms, so a difference below that cannot be seen even if one exists. The
p95 sits one millisecond over the median — the tail is a single frame's jitter,
not a dropped frame. Applying `featureEffect` costs about one frame, once, per
filter change.

So nothing is reduced: the drop-shadow layer stays, and `CIRCLE_POINTS` stays at
64. The pre-registered response to a failure was to cut cost, and there is no
cost to cut. **Bloom stays rejected** on the encoding grounds recorded with the
rule — the layer view's `temporary` highlight already does the emphasis job, and
this measurement was never able to change that.

The honest limit of the result: it is one machine in one session, at 51
reservoirs. It says the current symbology is affordable, not that any symbology
would be. The inventory work in Phase 1.6 is the thing that would make it worth
re-running, and the tool is kept for that.

---

## 1. Baseline when this plan started

This section records the starting point on 2026-08-09. It is historical; use
the [current snapshot](#current-snapshot) for present status. Five source files
did the application work, with no local frontend dependency graph or build:

| File | Role |
|---|---|
| `index.html` | ArcGIS Maps SDK **4.34**, loaded from CDN with a `<link>` + `<script>` pair and AMD `require()`. Two `FeatureLayer`s, `SimpleRenderer` + Arcade `valueExpression` visual variables. |
| `maplibre/index.html` | MapLibre GL JS from unpkg. One GeoJSON source, two `circle` layers, native expressions. Open-source parity comparison. |
| `explore.html` | Statewide overview. It later became a Vite entry using bundled Observable Plot, but no map SDK. |
| `shared/reservoir-viz.js` | An IIFE hanging one global off `window`. Class breaks, popup markup, the 12-month trend chart, the legend, the Utah mask, the statewide rollup. |
| `refresh_reservoirs.py` | Regenerates `reservoirs.json` daily via GitHub Actions. **Out of scope — do not touch.** |

The codebase was in unusually good shape for a rewrite: the data contract was
documented, the shared logic is already factored out of the pages, class breaks
live in exactly one table, and a Playwright smoke test asserted every
then-published reservoir actually rendered. The rewrite is mostly a re-hosting of logic that is
already correct, not a redesign of it.

The former README's "Future improvements" section named most of what this plan
does — a real module, a time slider, deep links on the maps, mobile layout, an
accessibility pass, CDN hardening, and a size legend. Those items were folded
into the phases below; the README now stays focused on use and contribution.

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
├── index.html                     # primary ArcGIS 5.1 production URL
├── legacy/index.html              # retained ArcGIS 4.34 comparison
├── explore.html                   # current overview and Vite entry
├── maplibre/index.html            # current parity URL; rebuilt in Phase 6
├── modern.html                    # stable alias for the primary application
├── shared/reservoir-viz.js        # shared current-page behavior until consolidation
├── refresh_reservoirs.py          # daily storage artifact and enrichment pipeline
├── huc.py                         # drainage-area assignment and rollups
├── reservoirs.json                # daily runtime artifact
├── capacities.json                # committed capacity table
├── huc6.geojson                   # committed generalized boundaries
├── reference.json                 # versioned capacity and geography export
├── package.json                   # Vite + TypeScript + SDK dependencies
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.ts                    # app bootstrap
│   ├── types.ts                   # typed runtime data contract
│   ├── data/
│   │   ├── load.ts                # fetch + runtime-validate reservoirs.json
│   │   ├── rollup.ts              # statewide rollup
│   │   └── huc.ts                 # drainage-area assignment and rollups
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
└── tests/
    ├── test_refresh.py            # Python pipeline behavior
    ├── test_huc.py                # committed geometry and assignments
    └── smoke.mjs                  # current production browser contract
```

The production URLs stay at the repository root until consolidation. Vite
copies those pages and all runtime data into `dist/`; it does not require a
second `src/legacy/` tree or a checked-in `public/data/` duplicate.

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

- The typed app fetches `./data/reservoirs.json` with `cache: "no-store"`.
- The Pages build copies `reservoirs.json`, `capacities.json`, and
  `huc6.geojson` into both `dist/` and `dist/data/`; it never imports them.
- The deploy workflow runs on direct pushes to `main` and after a successful
  refresh workflow, and verifies that the payload did not enter `dist/assets`.
- Root file paths remain available for the production pages while the typed
  application uses the `data/` copies.

---

## 3. Phases

Each phase is independently shippable and independently revertable. Nothing in
Phases 0–1 changes a pixel.

### Phase 0 — Groundwork (complete; no visual change)

1. `npx @arcgis/create -n _scaffold -t vite` into a throwaway directory. Read its `vite.config.ts`, asset handling and CSS imports; copy what's needed; delete it.
2. Add `package.json`, `vite.config.ts`, `tsconfig.json` (strict). Configure `base` for the Pages path.
3. Keep the three production pages at their public paths and copy them into
   `dist/`. Moving them under `src/legacy/` was rejected because their URLs are
   the production contract. **They remain the working dashboard until Phase 2
   lands.**
4. Add the Pages deploy workflow with the runtime-data rule above. Verify a data-only commit republishes.
5. Extend `ci.yml`: `tsc --noEmit`, `vitest run`, then the existing Python tests and Playwright job.

**Done when:** `npm run build` produces a `dist/` that serves the three legacy pages identically, and CI is green.

### Phase 1 — Port the shared logic to typed, tested modules (complete)

This is the README's flagged `IMPROVEMENT` in `shared/reservoir-viz.js`, and it
is the highest-value step in the whole plan: the statewide rollup is arithmetic
with no DOM in it that is currently only ever exercised by a browser smoke test.

1. Write `src/types.ts` from the actual shape of `reservoirs.json` — every field the README documents (`as_of`, `days_stale`, `is_stale`, `fetch_ok`, `seasonal_sample_years`, cadence, provider, monthly history, …).
2. Add a runtime validator at the fetch boundary (Zod, or a hand-written guard — the schema is small and stable). A malformed refresh should fail loudly at load, not render as a blank map.
3. Split `reservoir-viz.js` into the modules listed above. Behavior-preserving port; resist redesigning while porting.
4. **Vitest unit tests** for the parts that are pure: the class-break lookup, `percentFull` and its capacity-vs-record-max fallback, the statewide rollup (including the exclude-Lake-Powell variant), staleness thresholds (2-day daily / 45-day monthly), and the formatters.
5. Load `shared/reservoir-viz.js` in a `node:vm` sandbox as the reference. The
   ported rollup and class table are tested against it without importing the
   daily payload into the application bundle.

**Done when:** the ported modules reproduce the legacy numbers exactly, under test.

### Phase 1.5 — Watershed and connected-reservoir data (complete)

This phase must finish before the new shell depends on HUC filters.

1. Publish the 14 six-digit hydrologic units that intersect Utah and belong to
   the Colorado River or Great Basin systems as versioned GeoJSON from the
   official U.S. Geological Survey service (ADR-010).
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

### Phase 2 — The unified dashboard shell (complete)

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

**Correction:** there is no `calcite-shell-center-row` in Calcite 5. The bottom
region is an ordinary `calcite-shell-panel` with `layout="horizontal"` in the
shell's `panel-bottom` slot; the sortable table and its CSV landed there in
Phase 5. The sketch is left as written because it is what the phase was planned
against.

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

The executable scope, responsive contract, and verification gates are in
[`docs/PHASE-2-PLAN.md`](docs/PHASE-2-PLAN.md). ADR-012 narrows this phase to
the shell and current map parity; charts, complete filters, and production
cutover stay in their later phases.

**Done when:** `modern.html` shows every published reservoir with the current
symbology in one responsive shell, passes the Phase 2 integration gates, and
leaves the three production views unchanged.

### Phase 3 — Symbology and micro-interactions (complete)

The "slick" phase. Everything here is a real SDK capability, not CSS trickery.
The executable order and release gates are in
[`docs/PHASE-3-PLAN.md`](docs/PHASE-3-PLAN.md). All five increments landed and
the acceptance gates pass; the cost of the result is measured in
[Symbol and filter cost measured](#symbol-and-filter-cost-measured--2026-08-13).
Bloom was rejected on encoding grounds rather than on cost — the layer view's
`temporary` highlight already emphasises the hovered and selected reservoir,
and an effect that is free but redundant still loses.

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

**The ranking chart landed on the primary application 2026-08-15**, in the
bottom row beside the table. Three things were found by building it:

- **The chart is drawn from the table's own rows.** `src/state/ranking.ts`
  ranks the same `TableRow[]` the table renders and the CSV writer exports,
  so the row's three surfaces are one filter answered three ways -- the same
  by-construction agreement ADR-029's row was built on, extended rather than
  re-proved. Colours come from the class table through `storageClass`
  (ADR-008), computed from the same rounded value as the bar's length so the
  two claims a bar makes cannot disagree at a class boundary.
- **The charts package is loaded when the row opens, not with the page.**
  `renderArcgisBarChart` is reused from the overview through a dynamic
  import, which kept the static entry path at 2.13 MiB gzip (was 2.07). The
  build's *totals* still grew to 23.58 MiB raw / 8.22 MiB gzip, because the
  charts package's lazy chunk graph -- including a PDF exporter nothing here
  calls -- now ships with the primary build. The SDK budget was re-baselined
  deliberately from that measurement; the initial-path limit did not move.
- **A chart redraw needs a debounce and an identity check.** The month
  slider fires once per animation frame while dragged, and an SDK chart
  takes whole seconds to rebuild -- so redraws are debounced, guarded by a
  revision counter, and skipped when the records serialize to what is
  already on screen (a table sort reorders the rows but not the ranking).
  `rankingBars` joined the readiness signal; the row's `aria-busy` is
  cleared on every exit from the draw, the failed one included.

### Phase 5 — State, filters and deep links (complete)

- One filter/selection state object; everything else derives from it — map `featureEffect`, layer `definitionExpression`, table rows, chart data, CSV export.
- **Deep links on the map**, the README's open item: `?reservoir=Deer+Creek` selects and zooms; selecting updates the URL. Extend to filters and the active bottom tab so a filtered view is shareable.
- **Time slider** (`<arcgis-slider>` over the 12 months), the README's top dashboard ask. The data is already there. Animating the drawdown across the state is the single most compelling thing this dataset can do and it currently cannot be seen at all.
- CSV export continues to export exactly the rows on screen, raw numbers.

Three of these have landed early, on the primary application: the filter and
selection state is one object the map effect, the list, the summary and the
address bar all derive from; `?reservoir=`, `?storage=`, `?reporting=`,
`?area=`, `?powell=`, `?reservoirs=` and `?month=` restore the whole view; and
the twelve months are a Calcite slider. The drainage-area filter joined them on
2026-08-13 — a filter rather than a scope, so one basin is read against the
state rather than instead of it, and the totals do not move when it changes.

**The bottom row landed 2026-08-14, and this phase is closed.** A sortable
table under the map lists the reservoirs the filter matches, its values follow
the month slider, and its download writes exactly those rows in exactly that
order — one `TableRow[]` feeds the renderer and the CSV writer, so the promise
is a property of the construction rather than two code paths agreeing. `?table=`
and `?sort=` carry the row's open state and its order as separate parameters.

Three things were found by building it, all worth carrying forward:

- **`calcite-shell-center-row` does not exist in Calcite 5.** The Phase 2
  layout sketch above names it, written before the packages were installed —
  the same class of error as the `arcgis-placement` correction recorded in the
  SDK structural decisions. The shell publishes a `panel-bottom` slot that
  takes an ordinary `calcite-shell-panel` with `layout="horizontal"`, which is
  better anyway: it opens and closes through the same `collapsed` property the
  two side panels use rather than through a mechanism of its own.
- **A Calcite panel needs its height and its max-height moved together.** The
  `height="m"` preset carries both, so setting `--calcite-shell-panel-height`
  alone leaves the panel clamped exactly where it was. This is the mirror of
  the sheet trap already in CLAUDE.md, where `--calcite-sheet-max-height`
  alone does nothing because the height preset wins. Neither property moves a
  Calcite surface by itself.
- **A fourth header action put the theme control 8px outside a 360px
  viewport.** Not scrolled off — amputated, which is what that bar does. The
  brand's cap was a flat `13rem` that happened to fit three actions; it is now
  measured against the viewport, so the title gives up characters to an
  ellipsis instead. The smoke test measures every control in the bar and this
  is what it is for.

[ADR-029](docs/decisions/ADR-029-the-table-narrows-where-the-map-dims.md)
records the one real design decision: the table narrows where the map dims.
The map greys excluded reservoirs because removing a circle removes the
geography around it; a table has no geography to lose, and a sorted table with
excluded rows interleaved through it defeats the sorting. The reservoir list
keeps every reservoir in scope operable, which is where the keyboard path
lives.

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

## Noted follow-up items — 2026-08-15

Recorded from a repo review. The first two were concrete UI defects. The rest
are directional notes about where the product goes after Phase 7; the small
slices below record which parts are now decided or implemented.

**UI fixes — implemented 2026-08-15**

1. **Drainage-area label treatment.** The halo is now 50% opaque. The names
   are one interior text symbol per HUC6 on a dedicated background layer,
   under the reservoir layer on the first draw and after every scope redraw.
   The readiness signal and browser gate assert that order. ADR-030 records
   why ordinary FeatureLayer labels could not enforce it.
2. **Overview control scope.** The workspace has six ArcGIS charts plus one
   interactive storage-level strip, not seven chart components. The analysis
   filters above the KPI strip already change every chart and the table. The
   confusing part was the first chart's display controls: its measure also
   changed the 12-month chart, while its count and order changed only the
   largest-reservoir chart. All three now sit in one **Chart display** row
   above the chart grid, and each label names the charts it changes.

**Directional notes**

3. **Declutter the modern page toward being primarily the ArcGIS 5.1 SDK
   application — implemented under ADR-031.** The primary page now reads as
   the ArcGIS 5.1 application, and the former implementation paths are
   compatibility redirects rather than equal product options.
4. **The public API and reference data already cover more geographic scope
   than the dashboard displays** (see
   [`docs/UPPER-COLORADO-PIPELINE.md`](docs/UPPER-COLORADO-PIPELINE.md)).
   Not needed now, but worth keeping deliberately — it is the natural seed
   for a future multi-state or multi-region explorer.
5. **Prefer authoritative ArcGIS REST services over static exports where
   practical — geometry default implemented; inventory begun.** For committed
   JSON/GeoJSON that must ship as files, do not generalize geometry beyond
   100m simplification unless doing so produces a genuinely large file-size
   saving.
6. **Retire MapLibre and restructure this dashboard into multiple views —
   retirement implemented under ADR-031; new views remain to build.** Candidate
   views: current storage and reservoir levels (have), drought and
   advanced watershed statistics (pandas/NumPy), snowpack, and a dashboard
   for each — roughly four, possibly more or fewer once it is actually
   scoped.

### Small implementation slices for the directional work

These are ordered so each slice can ship and be verified on its own. Work not
marked as implemented remains proposed until its named decision is accepted.

1. **Make the primary surface unambiguous — implemented 2026-08-15.** The
   ArcGIS shell and overview now call the two product surfaces **Storage map**
   and **Storage charts**. The overview no longer promotes the three comparison
   pages. Their direct URLs remain compatibility redirects, and unit and
   browser tests assert both sides of that boundary.
2. **Retire comparison implementations — implemented 2026-08-15.** ADR-031
   supersedes ADR-019, keeps its root, alias and refresh-deployment decisions,
   and retires its complete comparison pages. `/legacy/` and `/maplibre/`
   redirect to the storage map; `/explore.html` redirects to storage charts.
   Recognized state crosses through an allowlist, while old basemap choices
   and unknown fields are dropped. Observable Plot and the legacy runtimes are
   absent from the published artifact. `shared/reservoir-viz.js` remains a
   source-only ADR-008 color-table owner and test oracle until a separate
   decision moves that contract.
3. **Establish the multi-view shell.** Keep one shared ArcGIS 5.1 navigation,
   theme, data loader, filter vocabulary, and URL-state contract. Add view
   routes without adding data layers to the storage map. The initial working
   set is:

   - current storage and reservoir levels, already live;
   - the current storage table and chart workspace, already live;
   - drought and advanced drainage-area statistics;
   - snowpack, as required by ADR-021.

   The storage map and its chart workspace can remain one topic with two
   surfaces. Drought and drainage-area statistics can also begin together and
   split only if their controls or explanations become crowded. The final
   count therefore does not need to be fixed at four before prototypes exist.
4. **Build drought and drainage-area statistics as a data slice first — the
   data slice is implemented 2026-08-15.**
   `tools/compute_drought_coverage.py` reads the committed drought polygons
   and the committed boundaries and writes
   `data/drought/usdm-huc6.json`: the percent of each drainage area's land
   in each intensity class, both exclusive and "at least" figures, with the
   map and release dates carried through. Two facts were established before
   writing it: the downloaded features are *exclusive* (a probe point deep
   inside D4 is in none of D0–D3, so cumulative figures are sums of disjoint
   areas), and no geometry library is installed, so coverage is an even-odd
   scanline sample at 0.01 degrees with cosine-latitude weighting — NumPy
   only, deterministic, no timestamps, about two seconds for all fourteen
   units. Each sampled point takes exactly one class, worst wins, so the
   shares sum to 100 by construction even where the simplified class edges
   overlap by a sliver. Twelve unit tests hold the engine to known shapes
   (holes, multiple parts, ring-and-island exclusivity, the latitude
   weighting) and the committed output to its own arithmetic,
   data-independently. Run the tool after each `fetch_drought_monitor.py`
   download; wiring both into a weekly scheduled job remains open. The
   first read of the current week: all fourteen drainage areas are entirely
   in drought or unusually dry, with Colorado Headwaters at 59.7% D4.
   **The view shipped 2026-08-15, the same evening:** `drought.html` is the
   fifth navigation surface, rendering the committed coverage as one bar
   per drainage area in the monitor's own palette (a second colour table,
   owned by `src/viz/drought-classes.ts`, never shown on the reservoir
   map), ordered most severe first, with the exact values in a table
   behind the bars. The join this category lacks is on the page: combined
   reservoir storage beside each area's land conditions, degrading to a
   visible note when the reservoir payload cannot be read. Freshness
   follows the weekly cadence — the map's week, release date and age are
   stated, and nine days without a release marks the data late. Cross
   links carry `?area=` to the storage map and the snow view. **The USDM
   polygon map landed 2026-08-16:** the weekly national polygons in the
   monitor's palette under the fourteen outlines, on the drought view only
   (one colour language per map), refusing to draw a week that does not
   match the coverage figures, with the shared theme-following basemap and
   view-map helpers (`src/ui/theme-basemap.ts`, `src/ui/view-map.ts`) that
   the snow map now also uses. Remaining: the weekly automation.
5. **Build snowpack as its own vertical slice — first version implemented
   2026-08-15.** `snow.html` is a fourth navigation surface on the shared
   shell: the seasonal curve for the whole region or one drainage area, the
   first-of-month table behind it, headline values held to a half-the-sites
   floor, the complete site table with late handling, and `?area=` deep
   links. `snowpack.json` is validated at the fetch boundary
   (`src/data/snow-validate.ts`), a unit test holds the client's percent
   arithmetic to the pipeline's rollups, and the browser suite gates the
   page at all three widths. **The map half landed later the same
   evening:** an ArcGIS map card with the basin-fill choropleth and site
   markers on one red-to-blue percent-of-normal scale
   (`src/viz/snow-classes.ts`, its own table), a day control across the
   water year carried by `?day=`, the same keyless basemap chain as the
   storage map, an exact fit to the fourteen units (a written zoom cannot
   do this — the component snaps fractional zoom, and one step out spans
   Oregon to Minnesota), and graceful degradation to a visible note.
   **Per-site accumulation curves landed 2026-08-16:** a one-site card with
   the water-year curve in inches against the normal median, the published
   onset/peak/meltout timing drawn and stated as text, a grouped site
   picker plus selectable names in the site table, and `?site=` carrying
   the station identifier in shared links. The data reference turned out to
   already document every snowpack field; what it gained on 2026-08-16 was
   the drought coverage file's documentation, display cross-links on every
   file card, and a note on the season timing. This slice is complete. Do not
   put snow symbols or a second colour table on the reservoir map. Design
   decisions adopted from the external product review above: HUC6 basin-fill choropleth by percent of
   the 1991–2020 normal median with sites reading on the same scale, the
   seasonal accumulation curve as the subject rather than a current-value
   headline, percent-of-normal before inches everywhere, and the full URL
   state contract from day one. `snowpack.json` is 1.9 MB — roughly seven
   times the reservoir payload — so the snow route fetches it on entry, not
   with the shell.
6. **Audit service and geometry sources — inventory begun and default enforced
   2026-08-15.** The source owner, exact endpoint, copy policy, update behavior,
   runtime failure behavior, and geometry treatment are now recorded in
   [`docs/AUTHORITATIVE-SOURCE-INVENTORY.md`](docs/AUTHORITATIVE-SOURCE-INVENTORY.md).
   It identifies one concrete migration slice: compare the older hosted dam
   layer still named by capacity and point tools with the current U.S. Army
   Corps public feature service before changing any committed values. The
   named-scope watershed and official drought
   downloaders now request roughly 100-metre geometry by default and publish
   that tolerance in their output. The measured committed-file changes were
   86,460 to 352,255 bytes for Upper Colorado HUC6 boundaries and 916,611 to
   2,042,452 bytes for the national drought polygons. The drought file is not
   loaded by the current dashboard. The broader watershed scope is embedded
   in the public `reference.json` contract, so its extra precision increased
   that uncompressed payload from 239,656 to 505,451 bytes even though the
   current map selects only the Utah scope. This preserves the broader API
   seed deliberately; extract a smaller runtime geography payload before it
   becomes a measured loading problem. Keep the source inventory current as
   endpoints or copy policies change. Prefer an
   authoritative public REST layer for optional map context when it has a
   bounded failure path; keep reviewed assignments and daily normalized data
   reproducible in committed files. Use 100 metres or finer as the default
   simplification for new GeoJSON. Any coarser export needs measured file-size
   savings, unchanged analytical results, and an ADR. The current 500-metre
   `huc6.geojson` is an existing measured exception under ADR-005: it saved
   455 KiB against the 100-metre candidate and moved no reservoir assignment.
7. **Preserve broader API scope without exposing it yet.** Keep geographic
   identifiers and wider-region records in the public contract where they are
   already validated. Do not add present-day filters or generalized UI for a
   multi-state explorer. When that product is scoped, begin with a separate
   route and explicit region definitions rather than widening the Utah view
   silently.

### External product review — 2026-08-15

Two inputs were reviewed against this plan: the competitive landscape survey
and its gap-action list (kept in the project owner's notes, assessed at commit
`9a1f898`), and a direct read of the NRCS NWCC iMap — the interactive map the
agency itself builds on the same AWDB API this pipeline calls. The four Tier 1
gap actions (baseline disclosure, CSV export on the primary surfaces, the
documented public API page, extended URL state) shipped 2026-08-14 and are not
repeated here. What follows is what the review adds to the plan.

**Adopted as plan rules:**

1. **External products are sources, never surfaces.** No embed, iframe, or
   link-out-as-feature for USDM, iMap, RISE, or any other product on the
   landscape list. Each enters only as data through the existing pipeline
   conventions: fetched by a tool, verified, committed or refreshed, rendered
   in this project's symbology, vocabulary, and freshness handling. The
   survey's sharpest finding is that fragmentation — five products, three
   different reservoir counts, no canonical answer — is the incumbent's
   defining failure. One product, one answer.
2. **Credit the upstream products where the reader can find them.** The
   methods and data pages name and link the authoritative sources. That is
   cheap trust, and it is the honest version of what the agency products
   themselves rarely do.
3. **Mobile is a stated differentiator, not a test artifact.** Nearly every
   product on the landscape list fails on a phone; the USGS National Water
   Dashboard is the only exception and it is the best federal product partly
   for that reason. The existing 1280/390/360 test widths are the enforcement
   mechanism. Every new view is built and tested at those widths from its
   first commit, not adapted later.
4. **The showcase constraint cuts both ways.** This project deliberately
   shows off the current SDK generation — components, charts, composed
   symbols, and whatever 5.x adds next. iMap is the proof that capability
   without restraint produces an analyst console: its URL carries roughly
   forty parameters of element, depth, duration, day-part and four opacity
   sliders. New features earn a place by serving a reading a normal end user
   actually has, and the Simplified Technical English tests hold on every
   view.

**Adopted into the snow view design (slice 5 below):** the one idiom iMap
gets right is the basin-fill choropleth — each hydrologic unit filled by
percent of normal, stations on top as points reading on the same scale. That
is the snow view's core rendering at HUC6. Percent of the 1991–2020 normal
median is the default framing everywhere, never raw inches first. Out-of-season
honesty stays as Phase 1.6a wrote it: the seasonal accumulation curve is the
subject, and the page says what part of the year the number describes rather
than coloring a headline on August snow. Total URL state carries over from the
storage view. What is deliberately not copied: the control sprawl, and the
`WTEQ % of Median (POR)` vocabulary the content-language tests already reject.

**Remaining gap actions, in the order they pay back** (Tier 1 shipped):
the snow view (slice 5), the drought layer with per-unit coverage statistics
(slice 4), county and conservancy-district aggregation axes, per-reservoir
permanent pages, the auto-generated weekly "what moved" summary, and the
selectable normal baseline. The last two are the category-level
differentiators; the survey found no product in the West that has either.

### Map parity across the three views — 2026-08-16

The snow and drought maps shipped as pictures: a basemap, some graphics, and
one zoom control. The storage map had a year of interaction work in it that
neither could reach. This slice closed that, and the reviews it went through
changed three of the decisions along the way.

**One hover, three maps.** The storage map's pointer machinery -- one hit test
per animation frame, stale answers discarded, the SDK's own named highlight
for emphasis, a card kept inside its stage at every edge -- is now
`src/ui/map-hover.ts`, and all three maps wire it. Only what the card *says*
differs per map, so that is the parameter; the sentences themselves live in
`src/ui/hover-content.ts`, which is pure, unit-tested, and read by the
Simplified Technical English test like any other visible text. Two changes were
made for fluidity while extracting it: the card is repositioned on every frame
the pointer moves rather than only on frames a hit test resolves on (an async
answer lands one to three frames behind the pointer, and a card that waits for
it visibly lurches), and its nodes are rewritten only when the words change,
so tracking across one reservoir is two style writes rather than a subtree
replacement.

What the cards now answer: on the storage map, a reservoir gives its
percentage *and the basis it is of* -- capacity and highest recorded storage
are different claims drawn with the same circle -- plus volume, 30-day
direction and reading date. On the snow map, a basin gives its mean and how
many sites reported it (eleven sites and two draw the same colour), a site
gives percent of normal beside the actual depth, and a reservoir names its
drainage area. On the drought map, an area gives its worst class *with the
share in it or worse* and the storage banked in it, which is the join no other
product in this category makes.

**The drainage areas answer too.** The fourteen outlines were decoration on
every map -- a boundary and a name and nothing about what was inside it. The
storage map's hit test now includes them behind the reservoirs, so pointing at
an area gives its combined percent full over the reservoirs in view, the same
ADR-011 arithmetic the drought view joins by. A true click-to-open panel for a
drainage area is the obvious next step and is *not* done: it needs a decision
about what clicking empty space means, since clicking the basemap currently
clears the reservoir selection. Recorded here rather than built.

**Reservoir names on every map, and a label ladder to hold them.** The first
attempt put 9-pixel bold names on at every scale and was wrong twice over: too
loud beside the drainage names they sit inside, and a wall of text on the
opening view. `src/viz/label-scales.ts` now owns the whole ladder as one
table, on the same one-table rule as the colour tables (ADR-008), and it
encodes two relationships rather than four numbers. Scale follows containment,
so the tiers hand off instead of piling up -- states carry the widest views
and step aside, drainage areas hold the middle, reservoirs arrive one zoom
step in from where the maps open, counties last of all, and at no reachable
scale are three tiers on at once. Size follows containment inverted, so a name
is never larger than the shape it sits in: 12, 11, 9, 8.5 pixels, with only
the drainage names -- the subject of these maps -- drawn bold. The thresholds
are placed against measured opening scales (1:10,700,000 on the storage map,
about 1:7,900,000 on the two cards), not guessed, and a unit test holds the
order while leaving the numbers free to move.

**State and county context, from the services rather than from files.** The
drought map draws the national sweep whole, which needs something that says
which land it crosses. `src/arcgis/reference-layers.ts` takes both from Esri's
generalized hosted layers -- the plan's own preference for optional map
context, and the first runtime service dependency a view has taken. The
condition is enforced rather than assumed: each layer loads against an
8-second deadline and is added only if it answered, so a refusal costs
outlines and nothing else. The counties are scale-limited as a *layer*, not
only in their labels, so they do not fetch three thousand features nobody will
see.

**Oceans as the background on every map.** The theme-matching gray canvases
are deliberately featureless, which is right for a map whose data is the only
thing worth seeing and wrong for these, where the land is half the story.
`oceans` now leads both theme chains: bathymetry and shaded relief under a
restrained label set, keyless, with the theme canvases kept one step down so a
dark reader whose oceans style is blocked still falls to a dark background
rather than a bright rectangle.

**Framing, controls and bounds.** All three maps now carry zoom, home,
fullscreen and a scale bar, refuse to navigate outside the region, and stop at
the same minimum zoom. The opening box is deliberately *not* copied verbatim:
the storage map has a whole viewport and opens at `regionExtent`, while the
two cards are wide and short, and an extent is a minimum -- asking a short box
to contain that much latitude pushed the view out to 1:18,000,000, a third of
the way out from the storage map. The cards open on `drainageExtent` instead
and land within half a zoom level of it. The card height moved from
`clamp(20rem, 52vh, 28rem)` to `clamp(24rem, 62vh, 34rem)` for the same
reason. Same subject, same bounds, framed for the box each one is in.

**What the browser suite gained.** Two shared helpers, run against both view
maps at all three widths: one measures the control set, layer order,
navigation bounds, opening scale band and hover-card placement; the other
drives one hover per layer with `hitTest` stubbed, since the render loop that
settles a real one does not run headless. Plus the ladder itself -- at the
opening view the states must be named and the reservoirs must not, and the
state type must be larger than the reservoir type. Five failures on the first
full run were all one cause, worth recording: the suite serves `dist/`, so it
was testing a build from before the fix.

### Advanced symbology, and one colour table moved — 2026-08-16

Three things from the 2026 SDK releases, all available on the 5.1 the project
already runs.

**`alternateSymbols` (5.1), on the same threshold as the labels.** Each
`UniqueValueInfo` now carries a simplified alternate, and both symbols declare
their own scale window on the `CIMSymbolReference`. Above 1:4,500,000 the map
draws two layers and two overrides; below it, three and three. What the
alternate drops is what cannot be resolved at the opening view -- a half-point
drop shadow and a three-quarter-point inner stroke, both well under a pixel at
1:10,700,000 -- and what it keeps is the map's actual claim, because the ring
is still sized by capacity and the fill still by how full. The dashed late
ring goes too, since a four-on three-off dash around an eight-pixel circle is a
smudge; lateness survives as the amber ring colour, which is a renderer key
rather than something the symbol builder decides.

The threshold is deliberately `RESERVOIR_DETAIL_SCALE`, the same constant the
reservoir labels use. Crossing one line makes the map more detailed in every
respect at once, which is the same principle the label ladder encodes.
Verified through the renderer itself rather than by eye: `getSymbolAsync` at
1:10,700,000 returns the two-layer symbol and at 1:2,000,000 the three-layer
one, both with their primitive overrides intact. That last part was the open
question -- the documentation does not say whether an alternate keeps its
Arcade overrides, and it does.

**Atkinson Hyperlegible Next (5.1) on every label tier.** Drawn for the
Braille Institute to be legible to low-vision readers, and 5.1 added it to the
2D label fonts. Weight comes from the family name rather than a `weight`
property, because these are four separate files and the regular family asked
for bold gets a synthesized one. Only the drainage names take the bold family.
*Not verified end to end in this environment:* the glyph fetch happens when
the label engine paints, which needs a compositing browser, and the font host
refuses a direct probe even for fonts that certainly exist. The family strings
come from the SDK's own documented list, and a family the host does not know
falls back to the default sans -- so the failure mode costs the typeface and
never the label. Worth confirming on the live site.

**One colour table moved, and it was a real defect.** Storage and snow were
both drawing five-class RdYlBu, and `#fdae61` and `#abd9e9` were byte-identical
in the two tables -- two maps of two unrelated quantities speaking the same
colour language, which is exactly what "one colour language per map" exists to
prevent. It went unnoticed because each table was internally consistent and
each had its own test. Snow moved to Esri's **Green and Brown 6**, reversed:
brown for deficit through to teal for surplus, which is the conventional
moisture ramp, so it reads without the legend. Every class was checked for
luminance as well as hue, because these are translucent fills over a
shaded-relief basemap and a near-white middle would be indistinguishable from
the grey that means "no value for this day".

Storage stayed put, and the check is worth recording: its palette turns out to
be Esri's **Blue and Red 9**, byte for byte. It is already a published,
colour-blind-tested ramp, it is pinned to the frozen oracle by ADR-008, and it
is read by the map, the legend, six charts and the table -- so there was
nothing to gain and an ADR to write. The drought palette is the monitor's own
and is not ours to change at all. A unit test now asserts that no snow colour
appears in either of the other two tables.

**The reservoirs came off the snow map.** They had been added the same day for
parity. Fourteen filled basins plus 217 site markers plus sixty-nine named
points is too much on one card, and the points that were meant as context
buried the readings. They stay on the drought map, which has five broad
national classes and room for them. The argument is density, not principle --
the same layer is right on one map and wrong on the other.

---

## 4. Risks and traps

| Risk | Notes / mitigation |
|---|---|
| ~~**ArcGIS basemaps and API keys**~~ | **Checked and cleared, 2026-08-09.** The current keyless basemap strings still work on 5.1; only the `arcgis/*` styles service is key-gated, and we are not obliged to use it. The keyless `VectorTileLayer` fallback was verified to work too, so the contingency exists if Esri changes this later. Residual risk is that Esri meters or retires the public AGOL basemap items — worth re-running the spike at each SDK upgrade. 2026-08-16: `dark-gray-vector` joined the chain as the dark theme's first choice and was observed serving keyless; its chain falls through to the verified light canvas if that changes. |
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
3. ~~**Validation library**~~ — **resolved 2026-08-10: keep the hand-written
   guard.** The payload is small and stable, the complete runtime contract is
   covered by focused tests, and no additional dependency is required.
4. **Fate of `explore.html`** — recommend keeping it as the deliberate no-SDK fallback rather than retiring it.
5. ~~**Phase 2 framework and entry**~~ — **resolved 2026-08-10: vanilla
   TypeScript with ArcGIS and Calcite web components at `modern.html`.** Keep
   the production entry unchanged until a later cutover review (ADR-012).
6. ~~**Statewide scope semantics**~~ — **resolved 2026-08-10: location and
   Lake Powell inclusion are independent dimensions.** The default is Utah
   reservoirs without Lake Powell; the connected comparison includes all
   published reservoirs (ADR-011).
7. ~~**The reservoirs outside the current scope**~~ — **resolved 2026-08-13:
   the reader reaches them through the existing controls, and no third
   dimension is added (ADR-020).** Raised by Phase 3.5 on the morning of
   2026-08-11 and answered by code that afternoon, when both of ADR-011's
   dimensions became the reader's: `connected` plus `include` puts all 54
   published reservoirs on screen. What the record adds is the obligation —
   publishing a reservoir commits the interface to a way of reaching it, and a
   test now asserts it against the committed payload.
8. ~~**The snow telemetry sites**~~ — **resolved 2026-08-13: a view of their
   own, not a layer on the reservoir map (ADR-021).** Snow water equivalent
   has no capacity and no percent full, so a layer would put a second class
   table and a second unit on a map that keeps one of each. Snowpack
   ingestion stays Phase 1.6 data work; only its destination is settled.

## 6. Deferred

Not in this pass, but the architecture should not preclude them:

- **3D / SceneView** — extruded reservoir volumes, and 5.0's **emissive materials + glow effect** for genuinely striking nighttime symbology.
- **MapLibre 6 globe projection + Terrain3D.**
- **deck.gl 9.3 interleaved overlay** — works with both engines and with MapLibre's globe; the route to arcs, hexbins and GPU-driven transitions neither SDK does natively.
- **ArcGIS AI components (beta)** — `<arcgis-assistant>` with the navigation
  and data-exploration agents. Natural-language querying of the reservoir
  inventory is a genuinely good demo of the new SDK, and it is a handful of
  lines. Beta, so not on the critical path.
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
