# Choosing where to start

Design for a reader-chosen opening scope: pick a state on a splash screen,
and every surface narrows to it. Written before any of it is built, on
`initial-scope-selection`.

Nothing here is implemented. This document settles the decisions that are
expensive to reverse — what a state selection is allowed to claim, where the
opening box comes from, and which states are worth offering — before any of
them are made accidentally by the first commit.

## Decisions taken

1. **The site becomes the Western Water Dashboard.** This is what makes
   everything below coherent, and it is the decision the western expansion has
   been walking toward since ADR-053.
2. **The splash asks one question: which state.** Not a level, not a drainage
   area. One axis, one screen.
3. **A state selection narrows all four surfaces** — the reservoirs, the snow
   sites, the drought areas, and the drainage areas drawn around them.
4. **Region, subregion and basin remain available as controls**, reached after
   the splash rather than on it, for a reader who wants to dial in.

## What the maps actually do today

The premise is right, but not everywhere, and the difference decides how much
of this is worth building.

| Surface | Draws | Opens on |
|---|---|---|
| Storage map | 75 drainage areas as context, 69 reservoirs | `HUC6_BOUNDS`, the roster box — 14 areas |
| Storage charts | no map | every published reservoir |
| Snowpack | the areas the network measures | the same roster box |
| Drought | 75 areas | the same roster box |

The storage map does not open on the full western view. ADR-063 made it open
on the roster box precisely to avoid "19 degrees of longitude with 69
reservoirs in one corner". What makes it feel wide is two separate things:

1. **The box grew when Lake Mead was admitted.** `HUC6_BOUNDS` is
   `[[-115.70611, 35.1088], [-105.62642, 43.45212]]` — southern Nevada to
   Wyoming, the Mojave to the Wind River. Fourteen areas is a small roster
   covering a large piece of ground.
2. **Sixty-one drawn areas hold no reservoir.** ADR-063 allowed this on
   purpose, but context outnumbering the subject four to one reads as the
   subject.

A state chooser fixes the first. The second is a separate question, answered
under "What each surface does" below.

## The state axis is exact where it matters

The first draft of this document worried that a state selection could not be
honest, because a drainage area is not in a state. That worry was aimed at
the wrong data. Three of the four surfaces filter **points**, and a point is
in exactly one place:

- **Reservoirs** carry `waterbody_states`, and ADR-060 already settled that
  this is the array a state filter reads: "it is what `intersects_utah` has
  always meant, so Bear Lake stays in Utah's list where a reader expects it."
  `reservoirInState` in `src/overview-model.ts` already implements it.
- **Snow sites** carry their own `state` — `snowpack.json`'s 637 site records
  each have one. A state filter on the snow map is an exact selection of
  sites, and the basin means are then recomputed **from those sites** with the
  pipeline's rule, never by averaging published basin means (ADR-064).
- **Drainage areas** carry `states` in the committed
  `data/watersheds/west-huc6.geojson` and in `reference.json` —
  `{"huc6": "140100", "name": "Colorado Headwaters", "states": "CO,UT"}`. This
  is the attribute the reader asked about, and **it already exists**, at both
  HUC-6 and HUC-4, published for every unit in every scope. Nothing needs
  adding to the dataset.

So only the **drought** map is inexact, and unavoidably so: it has no points,
only areas, and an area whose water reaches two states is drawn whole in both.
Clipping to the state line would need polygon geometry in the browser, which
ADR-048 and ADR-049 refuse — "Never fetch geometry into the browser to colour
something."

**The rule that follows:** a state selection means *the points in that state,
and the drainage areas whose water reaches it*. The drought map prints that
second half in words. This is the same admission ADR-060 already makes about
Hyrum — "wholly in Utah and fed from Idaho" — carried onto the map.

## What each state actually yields

This is the table the splash has to be designed against. Drawn areas are from
the 75 in `west-huc6`; snow areas are those the network currently measures;
reservoirs count by `waterbody_states`; sites by their own `state`.

| State | Drawn areas | Measured snow areas | Reservoirs | Snow sites |
|---|---|---|---|---|
| Utah | 15 | 15 | 52 | 140 |
| Colorado | 8 | 8 | 13 | 72 |
| Wyoming | 7 | 6 | 4 | 32 |
| Arizona | 18 | 8 | 2 | 23 |
| Nevada | 16 | 13 | 1 | 47 |
| Idaho | 13 | 13 | 1 | 85 |
| Oregon | 16 | 13 | 0 | 82 |
| Washington | 10 | 9 | 0 | 77 |
| California | 24 | 12 | 0 | 36 |
| Montana | 6 | 6 | 0 | 38 |
| New Mexico | 5 | 4 | 0 | 5 |

Three things fall out of it, and each is a design decision the splash cannot
avoid making.

**The snow network is already western.** `snowpack.json` publishes 637 sites
across 51 drainage areas in 11 states. Snow and drought are both western-wide
products today; only the reservoir roster is still Utah-connected. A state
chooser therefore delivers a complete snow-and-drought view for every state in
the table, immediately.

**Five states have no reservoirs.** Oregon, Washington, California, Montana
and New Mexico give a reader a working snow map, a working drought map, and an
empty storage map. Under the old name that was a broken page. Under "Western
Water Dashboard" it is an honest one — and ADR-056 already establishes the
pattern: an empty drainage area is a legal state and is always stated.

**Recommendation: offer all eleven, and say what each holds on the tile
itself.** A splash that shows "Oregon — 82 snow sites, 16 drainage areas, no
reservoirs published yet" tells the truth before the click, and doubles as the
roadmap. Hiding the five would make the dashboard look smaller than it is and
would need un-hiding one state at a time as the roster grows west.

**One thing that must not reach the chooser.** The `states` attribute comes
from the national Watershed Boundary Dataset, and its vocabulary includes
`MX` and `CN` — eight drawn areas extend into Mexico, four into Canada. These
are markers that an area crosses the border, not states a reader can pick, and
they carry no reservoirs and no snow sites. The chooser's list is the eleven
above, built from an explicit set rather than from whatever codes the
attribute happens to contain.

## The parameter vocabulary

The site already has four parameters that answer "where":

| Parameter | Where | Means |
|---|---|---|
| `?drainage=` | storage map | one drainage area, prefix-matched |
| `?area=` | snow, drought, and as a legacy alias on the storage map | one drainage area |
| `?huc4=` | storage charts | one subregion |
| `?state=` | storage charts | one state, `waterbody_states` |

Adding a fifth would make `?scope=UT&state=CO` expressible and meaningless.
**The chooser writes parameters that already exist:**

- **`?state=`** carries the splash's answer, with the storage charts' existing
  spelling and ADR-060's existing meaning, extended to the three maps.
- **`?area=`** carries the drill-down, at whatever width the reader chose.
  `HUC_CODE` in `src/data/huc.ts` is `/^(?:\d{2}){1,6}$/` and already accepts
  2, 4 and 6 digits; `matchesFilter` already prefix-matches, with the comment
  explaining why — "a four-digit choice is the subregion a six-digit code sits
  inside and a six-digit choice still matches only itself". A two-digit region
  is the same arithmetic with no new code, and
  `watershedScopeClause(level, codes)` already narrows the drawn areas from a
  code list.

The two combine and narrow each other, coarsest first, exactly as the storage
charts' three already do. Nothing is added to `SELECTION_PARAMS` in `url.ts`,
which matters: that table is the set the storage map *strips and rewrites*,
and `searchWithState` is held byte-for-byte against
`shared/reservoir-viz.js`.

**A finding to fix first.** `filterBounds` produces `drainage_area = '1402'`
([`filters.ts:131`](../src/state/filters.ts)) while `matchesFilter` compares by
prefix — so at four digits the map would grey everything while the list showed
the subregion. `filters.test.ts` asserts the two agree over the committed
payload, so it fails the moment a four-digit code is passed; nothing passes
one today. The clause needs `LIKE '1402%'`, or the layer needs its own
subregion attribute — `layers.ts` builds the attributes, so this is a choice,
not a constraint. **Nothing can write a four-digit `?area=` until this
agrees.**

## Where the opening box comes from

`regionExtent()` reads `HUC6_BOUNDS`, a committed constant, and
[`src/ui/map.ts:337`](../src/ui/map.ts) sets it on the map element *before* the
view exists. The comment there is explicit: "the target is a fixed box, not
something that has to be measured from the data, so there is nothing to wait
for and no race to lose." A chosen state breaks that — the box is now data.

Three options, and the third is the one:

1. **Compute it from geometry.** Refused by ADR-048.
2. **Commit a table of boxes in TypeScript.** Refused by ADR-002 — a table of
   boxes in a source file is a data payload in a trench coat, and it would go
   stale against `west-huc6.geojson` with nothing to catch it.
3. **Publish a bounding box per unit in `reference.json`.** A box is not
   geometry you draw; it is four numbers, and `HUC6_BOUNDS` is already exactly
   this. `watershed_scopes.py` is already the one place that decides which
   areas exist, and it already has the rings in hand.

**The timing works with no new request.** [`src/ui/map.ts:288`](../src/ui/map.ts)
already awaits the reference fetch before constructing the map element — the
Utah mask needs it. The opening extent waits on the same promise. No extra
round trip, no late `goTo`, no visible jump.

**A state's box is the union of its areas' boxes**, computed in the client.
Publishing per-state boxes as well would be a second answer to one question.

**Cost.** `reference.json` is 30.8 KB raw and 7.4 KB gzipped today. Boxes for
all 143 units across the four scopes add roughly 7 KB raw. Per ADR-051 the raw
figure is not the one that matters — measure the gzipped delta with
`tools/audit-transfer.mjs` and update `docs/data-transfer.md`.

**The navigation constraint does not move.** ADR-044 pins `MAP_BOUNDS` and
`MAP_CENTER` because "where a reader may go is a contract with the links the
retired routes translate." A chosen state changes where the map *opens*, never
where it may go. A reader who picks Utah and pans to Colorado is not doing
anything wrong, and a constraint that followed the chooser would trap them.

`extent.test.ts` recomputes `HUC6_BOUNDS` from whichever file
`reference.json` names as the roster scope's. Adding a `bbox` field must leave
that intact — and gains something: the test becomes the oracle for the
published boxes too.

## The splash

**Build the control first, the splash second.** The control is the part that
carries its weight regardless, and it is already a solved shape:
`createLevelControl` builds from what the export publishes, returns `null`
when there is nothing to choose, takes a Calcite scale because the storage
panel and the snow and drought filter bars differ by a third of a control's
height, and treats a change as a `location.replace` navigation rather than a
re-render. A state control is the same component with a different list, and
every one of those decisions applies unchanged.

Then the splash is a first-visit affordance over a mechanism that already
works and is already testable, rather than the only way to reach a state —
which is what would make an interstitial load-bearing.

**When it appears.** Only when all three are true: no `?state=` and no
`?area=` in the address bar, no stored choice, and the reader has not
dismissed it before. Anything else opens the map. A shared link must never
land on an interstitial instead of the thing it was sent to show.

**What it must do.**

- Be skippable in one action. "Show the whole west" is a real answer and needs
  to be as reachable as any state.
- Say what each state holds, from the table above, computed at runtime rather
  than written down — the reservoir counts move every morning.
- Not block on a fetch it does not need. The state list and its counts come
  from `reference.json`, `reservoirs.json` and `snowpack.json`; the first two
  are already on the critical path, the snow payload is not. Either the counts
  for snow arrive late and the tile fills in, or the splash shows what it has.
- Survive axe-core at 1280, 390 and 360, which the smoke test runs over every
  page. A dialog is exactly the component that fails focus-trap and
  accessible-name checks.

**What it is made of.** Calcite 5.1.2 has `calcite-dialog`,
`calcite-tile-group`, `calcite-tile`, `calcite-segmented-control` and
`calcite-chip`, none of which the site imports today. Two constraints:

- `src/architecture.test.ts` fails the build on a package-wide Calcite import.
  Each component is imported by path, as `shell-template.ts` already does.
- **A new Calcite icon is a 404, not a missing glyph.** Icons are committed
  under `public/assets/icon/` (108 files today) and pinned by
  `architecture.test.ts`. Turning on a tile or dialog feature can pull in an
  icon that is not there, the page looks fine, and only the browser suite sees
  it as a console error. Every icon a new component reaches for is committed
  in the same change.

## Persistence, and which source wins

1. **The address bar wins.** Always. A shared link means what it says.
2. **`localStorage` is the returning reader's default**, and applies only when
   the address bar is silent. The pattern exists — `ui/theme.ts` and
   `ui/shell.ts` both store a preference and both parse what comes back rather
   than trusting it.
3. **The splash is what happens when neither has an answer.**

This creates one requirement that is impossible to retrofit quietly: **"the
whole west" has to be expressible as a parameter.** Today a default is written
as absence — `url.ts` says so, and `?level=6` is never written. But if absence
also means "use the stored choice", a reader with Utah stored cannot be sent a
link to the whole west, because the sender's link has no parameter in it and
the receiver's storage fills the gap. So `?state=all` must be writable, and
the share button must write it when the reader is looking at everything. That
is a deliberate exception to the defaults-as-absence rule and needs recording
as one.

**A quieter hazard.** Storage is per-origin, not per-page. A reader who scopes
the storage map to Wyoming and then opens the drought map gets Wyoming, which
is fine — but a reader who drills to a single Utah basin and then opens the
snow map may land on an area with no sites. The rule the codebase already
follows is to fall back and say why: `applyScope` in `main.ts` already does
exactly this for a drainage area that leaves the scope, and the geographic
filters already keep a surviving selection and drop a dead one to "all".

## Carrying the choice across pages

This is the gap the whole feature depends on, and nothing does it today.

[`src/ui/page-header.ts`](../src/ui/page-header.ts) builds the navigation from a
`PAGES` table of static hrefs — `./`, `./overview.html`, `./snow.html`,
`./drought.html`, `./methods.html`. The only cross-page link anywhere that
carries state is `drought.ts:290`, which writes `./snow.html?area=${unit.huc6}`
by hand.

So a reader who picks a state and clicks "Snowpack" would lose it. **`?level=`
already has this bug**: CLAUDE.md calls it "one parameter across all three
maps", and the navigation drops it on every click. Fixing both together is the
same work, and a state that carries while the level does not would be a worse
inconsistency than neither carrying.

`pageLinksMarkup` becomes a function of the current view rather than a
constant. The buttons and the dropdown items are generated from one table
precisely so the two cannot differ, and that has to stay true when the hrefs
become dynamic. `tests/smoke-modern.mjs` asserts the exact hrefs (around lines
631–633 and 1774–1797); those become path-plus-query assertions.

## What each surface does with a state

**Storage map (`main.ts`).** Narrow `inScope` by `waterbody_states`; both the
predicate and the `where` clause, from the same bounds, because
`filters.test.ts` holds them against each other. Set the opening extent from
the union of the state's area boxes. Repopulate the drainage select from what
the state leaves, keeping a surviving choice — `applyScope` already does this
and is the model. For the five states with no reservoirs, say so where the
count goes; do not draw an empty map with no explanation.

**Does the drawn context follow the state? Recommendation: no.** Context is
what tells a reader their basin is part of something larger, and a map showing
eight polygons on an empty basemap is worse than one showing where those eight
sit. The state moves the camera and dims the reservoirs; it does not delete
the surroundings. It does change what the *drought* map draws, because there
the areas are the subject rather than the context.

**Storage charts (`overview.ts`).** The least work: `state`, `huc4` and `huc6`
already exist, already narrow each other coarsest-first, and already appear in
the URL under the names adopted above. The state is their initial value. The
reader's own controls must stay live — a scope that locks the filters is one
the reader cannot get out of without finding the splash again.

**Snowpack (`snow.ts`).** Filter sites by their own `state`, then regroup
**from sites** with the pipeline's rule — never by averaging the published
basin means (ADR-064). A basin that falls below its `minimum_reporting_sites`
under the state filter publishes no figure, not a zero.

**Drought (`drought.ts`).** Filter rows: each area's shares are published per
area and stay correct under any subset. ADR-046 is the live hazard — a
state-wide "how much of Colorado is in drought" is a new share with a new
denominator, and it may not be produced by averaging or summing the areas'
shares. **Recommendation: do not print one in the first version.** The ranked
list of areas is the drought map's answer and it narrows correctly for free.
This is also the surface that prints the sentence about what a state selection
means.

**Every surface.** The summary sentence names the state. `statewideRollup`
sums `current_storage_af` with no geographic qualifier, and a scoped total in
an unscoped sentence is the same class of error ADR-056 was written about.

## The rename

"Western Water Dashboard" touches 31 strings across ten files:
`src/ui/page-header.ts` (`SITE_NAME`, `SITE_NAME_SHORT`, and all six
`PAGE_SUBJECTS`), the eight HTML entry points, and `src/deploy.test.ts`, which
asserts them. One more sits outside that sweep: the storage map's
`aria-label`, "Interactive map of Utah and connected drainage areas" in
`src/ui/map.ts`.

Two things to get right:

- **`PAGE_SUBJECTS` is what a browser tab, a bookmark and a shared link say.**
  The heading names the page and the site name sits above it as context, which
  is the arrangement `brandMarkup` already establishes. "Western Snowpack" is
  a page subject; "Snowpack in Utah" is a scoped view of it, and the two
  should not be confused — the title should not change as the reader picks a
  state.
- **`SITE_NAME_SHORT` exists because `calcite-navigation` clips rather than
  scrolls.** "Western Water" is the same length as "Utah Water" plus three
  characters; the smoke test measures each control's box against the viewport
  at 1280, 390 and 360, and it is the check that will catch it if that is
  three characters too many.

The rename is independent of everything else here and can land first, on its
own, which is the right way to do it: a rename mixed into a feature is a diff
nobody can review.

## Rules this work stands on

- **ADR-002** — no importing data. The boxes go in `reference.json`.
- **ADR-006** — Simplified Technical English, including in `aria-label`s and
  live regions, which the smoke test reads. Never "HUC-2" or "HUC-4" on
  screen; `LEVEL_LABELS` already models this with "Subregions" and "Basins",
  and a region needs the same treatment.
- **ADR-008** — one colour table. A scoped map is still coloured from
  `ReservoirViz.CLASSES`.
- **ADR-044** — `MAP_BOUNDS` and `MAP_CENTER` stay pinned; the state moves the
  opening view only.
- **ADR-046** — never average or sum shares with different denominators. This
  is what stops a state-wide drought percentage.
- **ADR-048/049** — no geometry in the browser. This forces the published box
  and rules out clipping areas to the state line.
- **ADR-050** — no client file names a hydrologic level.
- **ADR-056** — an empty area is a legal state, and it is always stated. Five
  states will have no reservoirs.
- **ADR-059** — not measured is not zero.
- **ADR-060** — a state is three questions; this picks `waterbody_states` and
  says so.
- **ADR-064** — `?level=` is a navigation, not a re-render, and the control is
  built from what the export offers. `?state=` follows both rules.

**A naming collision already in the tree:** `DEFAULT_SCOPE` means `west-huc6`
in `watershed_scopes.py` and `{geography: "utah", lakePowell: "exclude"}` in
`src/overview-model.ts`. A third `Scope` type for the reader's choice would
make three. Name the new one for what it is and not `Scope`.

## A stale comment to fix on the way

`measuredScope` in `src/snow-model.ts` says the snow map draws 14 areas and
"the other 61" are left out, and CLAUDE.md repeats it: "the snow network
reports in 14 so `measuredScope` narrows the snow map to 14."

Both predate `a598850 Take the snow network west`. The payload now publishes
**51** measured areas and 637 sites across 11 states, so the sentence should
read 51 and 24. The code is correct — it filters by what the payload measures
— but the two places that explain it are describing the site as it was before
the snow network moved. This matters here because "snow is a Utah product" is
exactly the wrong premise to design a western state chooser on.

## Build order

Each step leaves the site working and testable.

1. **The rename**, on its own. `page-header.ts`, the eight HTML entry points,
   `deploy.test.ts`, and the map's `aria-label`.
2. **Fix the four-digit `where` clause** so the predicate and the clause agree
   at 2, 4 and 6 digits. Nothing can write a four-digit `?area=` until this
   lands.
3. **Publish `bbox` per unit** from `watershed_scopes.py`; assert it against
   the committed rings in `tests/test_watershed_scopes.py`; extend
   `extent.test.ts` to hold the published box for the roster scope against
   `HUC6_BOUNDS`. Measure the gzipped delta and update `docs/data-transfer.md`.
4. **Add `?state=` to the three maps**, reading `waterbody_states` for
   reservoirs, the site's own `state` for snow, and the area's `states` for
   drought — with the sentence that says what the third one means. Teach
   `regionExtent` to take an optional box. No control yet: the parameter works
   from a hand-typed link, which is the cheapest way to find out whether the
   idea is any good.
5. **Carry `?state=`, `?area=` and `?level=` across the navigation.**
   `page-header.ts` becomes view-aware; the smoke test's href assertions become
   path-plus-query assertions.
6. **Build the state control**, modelled on `createLevelControl`.
7. **Widen `?area=` to any even code width**, which turns the existing drainage
   control into the region/subregion/basin drill-down.
8. **Persist the choice**, address bar winning, with the explicit `all` token
   and the fallback when a stored state empties a page.
9. **Then the splash.**

## Build slices, and what may run beside what

The nine steps above are an order. This is how they divide into work that can
run at the same time, which is a different question — two steps that are
independent in logic can still collide in a file.

**The conflict map is the whole point.** Three files are contended and each is
contended for a different reason:

- `src/ui/page-header.ts` — the rename edits it, and so does cross-page
  parameter propagation. Those two can never run together.
- `reference.json`, `watershed_scopes.py`, `tests/test_watershed_scopes.py`,
  `src/data/boundaries.ts` — the published bounding boxes need all four, and
  all four are currently carrying the schema-v3 and roster-key work in the
  owner's own tree. That slice waits for that work to land.
- `src/state/url.ts` — under a byte-for-byte parity contract with
  `shared/reservoir-viz.js`. Only one thing may touch it at a time, and
  whatever does must keep `url.test.ts` green.

| Slice | Step | Files | Runs beside |
|---|---|---|---|
| A — Rename | 1 | `page-header.ts`, `map.ts` (label only), `deploy.test.ts`, the HTML entry points | B, C |
| B — Prefix-safe drainage filter | 2, 7 | `filters.ts`, `layers.ts`, their tests, possibly `url.ts` | A, C |
| C — State axis in the model layer | part of 4 | new state-vocabulary module, `snow-model.ts`, `overview-model.ts`, their tests, one stale CLAUDE.md sentence | A, B |
| D — Published bounding boxes | 3 | `watershed_scopes.py`, `reference.json`, `boundaries.ts`, `extent.ts`, their tests | nothing — waits on schema v3 |
| E — Cross-page propagation | 5 | `page-header.ts`, `smoke-modern.mjs`, the page entry files | after A |
| F — Page wiring for `?state=` | rest of 4 | `main.ts`, `snow.ts`, `drought.ts`, `overview.ts` | after B, C, E |
| G — The state control | 6 | new control beside `level-control.ts`, plus its hosts | after F |
| H — Persistence | 8 | the URL modules, a storage helper | after G |
| I — The splash | 9 | new component, the entry points | after H |

A, B and C are the parallel front. Their file sets are disjoint from each
other and from the schema-v3 work in flight, which is what makes them safe to
run at once in one working tree.

D is held rather than merely ordered. It is not blocked by design — it is
blocked by four files being edited elsewhere, and the right move is to wait
rather than to fork the export format twice.

E through I are a chain. Each needs the one before it to exist, and none of
them can be usefully started early: a control with no parameter behind it, or
a splash with no persistence behind it, is a screenshot rather than a feature.

**A note on slicing this way at all.** A, B and C are each shaped so that
their acceptance is a unit test rather than a look at the page. The rename is
proved by `deploy.test.ts`, the filter by `filters.test.ts` holding the
predicate and the clause against each other, the state axis by model
functions over fixtures. Nothing in the parallel front needs a browser, which
is why three of them can run without a shared render loop to fight over —
and, per the known-quirks section of CLAUDE.md, the ArcGIS canvas renders
blank in headless Chromium anyway.

## Tests this needs

- `filters.test.ts` — predicate and clause agree at 2, 4 and 6 digits.
- `url.test.ts` — a six-digit `?area=` link still means what it meant, and
  `searchWithState` parity with the frozen module survives the `all` token.
- `extent.test.ts` — the published box for the roster scope equals
  `HUC6_BOUNDS`; a state's box contains every one of its areas' boxes.
- `boundaries.test.ts` — a unit with no box, or a malformed one, costs that
  unit and not the other 74.
- `tests/test_watershed_scopes.py` — every published box contains its rings;
  the state vocabulary offered to readers excludes `MX` and `CN`.
- `overview-model.test.ts` — state, region, subregion and area narrow each
  other coarsest-first, and a selection that survives is kept.
- `snow-model.test.ts` — a state filter regroups from sites, and a basin below
  its reporting floor publishes nothing rather than zero.
- `smoke-modern.mjs` — the navigation carries the state; a scoped page passes
  axe-core at 1280, 390 and 360; no console error from a missing icon; the
  renamed bar does not clip at 360.
- `content-language.test.ts` — nothing the chooser renders says "HUC".
- `deploy.test.ts` — the new site name, everywhere the old one was asserted.

## Open questions

1. **Are all eleven states offered, including the five with no reservoirs?**
   Recommendation above is yes, with counts on the tile.
2. **Does the storage map's drawn context follow the state?** Recommendation
   is no for storage, yes for drought.
3. **"Western Water" or something else for `SITE_NAME_SHORT`?** It has to fit
   a bar that clips at 360 pixels.
