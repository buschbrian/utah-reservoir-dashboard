# Modernization Plan — Utah Reservoir Drought Dashboard

**Status (2026-08-14):** Phases 0, 1, 1.5, 2, 3, and 5 are complete. The
inventory portion of Phase 1.6 added Fontenelle; snowpack and drought context
are not implemented. Phase 4 is underway: the chart workspace is live, and its
class colours, storage bands and reservoir summaries have completed their first
accessibility pass. The ArcGIS 5.1 application is the root production view,
and the earlier pages remain available as comparisons.

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
| Bottom row | The sortable table and its CSV export are live under the map on the primary application, closing Phase 5's remainder. |
| Next application work | Phase 4's layer-driven ranking chart, which now has a row to land in. |

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

Recorded from a repo review; not yet triaged into a phase or an ADR. The
first two are concrete UI defects. The rest are directional notes about
where the product goes after Phase 7, kept here so they are not lost before
they are scoped.

**UI fixes**

1. **The HUC6 drainage-area label halo is too strong, and the labels sit
   above the reservoir points instead of behind them.** The halo needs to
   drop to 50% opacity, and the labels need to render as background
   elements — under the reservoir symbols, not over them. Touches the label
   work from ADR-025/ADR-027 and the layer ordering from Phase 3.3.
2. **Only the first of the overview's seven charts carries filter controls,
   even though the filters affect all seven.** Either wire the filtering UI
   into the other six charts, or add one filter row that visibly governs
   the whole chart set instead of reading as though it belongs to the first
   chart alone. `overview.html` / Phase 4.

**Directional notes**

3. **Declutter the modern page toward being primarily the ArcGIS 5.1 SDK
   application.** Move or retire the older comparison-engine material
   currently reachable from the modern shell, so the primary page reads as
   the ArcGIS 5.1 application first rather than one of several equal
   options.
4. **The public API and reference data already cover more geographic scope
   than the dashboard displays** (see
   [`docs/UPPER-COLORADO-PIPELINE.md`](docs/UPPER-COLORADO-PIPELINE.md)).
   Not needed now, but worth keeping deliberately — it is the natural seed
   for a future multi-state or multi-region explorer.
5. **Prefer authoritative ArcGIS REST services over static exports where
   practical.** For committed JSON/GeoJSON that must ship as files, do not
   generalize geometry beyond 100m simplification unless doing so produces
   a genuinely large file-size saving.
6. **Retire MapLibre and restructure this dashboard into multiple views**,
   rather than maintaining it as a separate comparison page. Candidate
   views: current storage and reservoir levels (have), drought and
   advanced watershed statistics (pandas/NumPy), snowpack, and a dashboard
   for each — roughly four, possibly more or fewer once it is actually
   scoped. This would supersede ADR-007 and ADR-016's two-engine framing
   and wants its own ADR when it is decided, not before.

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
