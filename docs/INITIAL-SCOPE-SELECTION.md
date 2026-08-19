# Choosing where to start

Research and design for a reader-chosen opening scope: a state, a region, a
subregion or a single drainage area, picked once and carried across every
surface. Written before any of it is built, on `initial-scope-selection`.

Nothing in this document is implemented. It exists to settle the decisions
that are expensive to reverse — the parameter vocabulary, where the opening
box comes from, and what a state selection is allowed to claim — before any
of them are made accidentally by the first commit.

## What the maps actually do today

The premise is right, but not everywhere, and the difference decides how much
of this is worth building.

| Surface | Draws | Opens on |
|---|---|---|
| Storage map | 75 drainage areas as context, 69 reservoirs | `HUC6_BOUNDS`, the roster box — 14 areas |
| Storage charts | no map | every published reservoir |
| Snowpack | 14 areas (`measuredScope`) | the same roster box |
| Drought | 75 areas | the same roster box |

So the storage map does not open on the full western view. It opens on the
roster box, which ADR-063 chose precisely to avoid "19 degrees of longitude
with 69 reservoirs in one corner". What makes it feel wide is two separate
things, and they have different fixes:

1. **The box grew when Lake Mead was admitted.** `HUC6_BOUNDS` is
   `[[-115.70611, 35.1088], [-105.62642, 43.45212]]` — from southern Nevada
   to Wyoming, from the Mojave to the Wind River. Fourteen areas is a small
   roster covering a large piece of ground. A reader who wants the Wasatch
   Front is looking at a map eight degrees of latitude tall.
2. **Sixty-one drawn areas hold no reservoir.** ADR-063 allowed this on
   purpose — the storage map draws all 75 "as context around its subject" —
   but context that outnumbers the subject four to one reads as the subject.

An opening-scope chooser fixes the first. The second is a separate question
(should the storage map's context follow the chosen scope, or stay the whole
west?) and this document answers it below, because the chooser forces it.

## The three axes, and how much of each already exists

The reader asked for state, HUC-4, or HUC-2. All three are already
expressible; two of them are already tested.

**Region and subregion are nearly free.** Hydrologic codes are fixed-width
and nest, which is the argument ADR-064 already used for `huc6[:4]`. The
machinery that follows from it is in place:

- `HUC_CODE` in `src/data/huc.ts` is `/^(?:\d{2}){1,6}$/` — it already accepts
  a two-digit region and a four-digit subregion.
- `matchesFilter` in `src/state/filters.ts` already matches by prefix, with
  the comment explaining why: "a four-digit choice is the subregion a
  six-digit code sits inside and a six-digit choice still matches only
  itself". A two-digit choice is a region, by the same arithmetic, with no
  new code.
- `filterBounds`'s `DRAINAGE_AREA_CODE` is `/^[0-9]{1,12}$/`, so the `where`
  clause tolerates it too — though see the finding below, because the clause
  compares for *equality* where the predicate compares by prefix.
- `watershedScopeClause(level, codes)` in `src/arcgis/watershed-layers.ts`
  builds the drawn-area filter from a code list. Narrowing what the map draws
  is a shorter list, not a new mechanism.

The regions in the drawn scope, with what each holds:

| Region | Drawn areas | Reservoirs |
|---|---|---|
| 14 Upper Colorado | 10 | 34 |
| 15 Lower Colorado | 15 | 5 |
| 16 Great Basin | 12 | 30 |
| 17 Pacific Northwest | 22 | 0 |
| 18 California | 16 | 0 |

Two of the five regions hold no reservoir at all. A region chooser on the
storage map therefore has three real entries and two that empty it. ADR-056
already allows an empty drainage area and `storageAgainstDrought` already
omits one rather than drawing it at zero, so the state is legal — but a
control that offers a choice leading to a blank page is a control that has to
say what it will do before it is used. Offer counts in the chooser.

**State is the axis with the design problem.** ADR-060 settled which state
question a filter answers — `waterbody_states`, every state the water touches
— and `reservoirInState` in `src/overview-model.ts` already implements it for
the storage charts. That works because the charts filter *reservoirs*, and a
reservoir is a point with a state list.

The three maps do not filter reservoirs. They draw drainage areas, and a
drainage area is not in a state. `reference.json` publishes `states` per unit
— Colorado Headwaters is `"CO,UT"` — and here is how that distributes:

| | UT | CO | WY | AZ | NV | ID | NM | CA | OR | WA | MT | MX | CN |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Drawn areas touching | 15 | 8 | 7 | 18 | 16 | 13 | 5 | 24 | 16 | 10 | 6 | 8 | 4 |
| Roster areas touching | 14 | 6 | 4 | 3 | 3 | 3 | 1 | — | — | — | — | — | — |

Every one of the fourteen roster areas touches Utah. "Show me Utah" on a
drainage-keyed map therefore selects the entire roster and narrows nothing.
Meanwhile "show me Colorado" selects six areas including the whole Colorado
Headwaters and Upper Green, most of whose ground is not in Colorado.

There are only two honest ways out, and one of them is closed:

- **Clip the areas to the state line.** This needs polygon geometry in the
  browser, which ADR-048 and ADR-049 refuse: "Never fetch geometry into the
  browser to colour something." Closed.
- **Say what the selection is.** A state selection means *the drainage areas
  whose water reaches this state*, the map draws those areas whole, and the
  summary says so in words. This is the same admission ADR-060 already makes
  about Hyrum — "wholly in Utah and fed from Idaho" — carried to the map.

So: **a state selection is a reservoir filter everywhere, and a drainage-area
selection only on the drought map, where it is stated.** On the storage map a
state narrows which reservoirs are in scope and leaves the drawn context
alone. On the snow map it narrows which sites report. On the drought map,
where there are no reservoirs and no sites, the only thing a state can mean
is "the areas touching it", and the map has to print that sentence.

## Decision 1 — one vocabulary for "where", not a fifth one

The site already has four parameters that answer "where":

| Parameter | Where | Means |
|---|---|---|
| `?drainage=` | storage map | one drainage area, prefix-matched |
| `?area=` | snow, drought, and as a legacy alias on the storage map | one drainage area |
| `?huc4=` | storage charts | one subregion |
| `?state=` | storage charts | one state, `waterbody_states` |

Adding `?scope=` would make five, and `?scope=UT&state=CO` would be
expressible and meaningless. **The chooser must write parameters that already
exist**, which costs nothing to invent and cannot contradict itself:

- **`?area=` carries the code, at whatever width the reader chose.**
  `HUC_CODE` already accepts 2, 4 and 6 digits; `matchesFilter` already
  prefix-matches; `?area=` is already the shared cross-page name (`snow-url.ts`
  calls it "the shared cross-page vocabulary"). Widening it from six digits to
  any even width is the same move ADR-064 made for `?level=`, and it is
  backward compatible in both directions: every existing six-digit link keeps
  meaning exactly what it meant.
- **`?state=` carries the state**, with the storage charts' existing spelling
  and ADR-060's existing meaning, extended to the three maps.

The two combine and narrow each other, coarsest first, exactly as the storage
charts' three already do. Nothing new is added to `SELECTION_PARAMS` in
`url.ts`, which matters: that table is the set the storage map *strips and
rewrites*, and `searchWithState` is held byte-for-byte against
`shared/reservoir-viz.js`.

**One finding to fix on the way.** `filterBounds` produces
`drainage_area = '1402'` while `matchesFilter` prefix-matches — so at four
digits the map and the list would disagree, the map greying everything and the
list showing the subregion. `filters.test.ts` asserts the two agree over the
committed payload, which is why this is a finding and not a bug in
production: the test will fail the moment a four-digit code is passed, because
today nothing passes one. The clause needs `LIKE '1402%'` (or the layer needs
a `subregion` attribute; `layers.ts` builds the attributes, so this is a
choice, not a constraint). **This must be settled before the chooser can
write a four-digit `?area=`.**

## Decision 2 — where the opening box comes from

`regionExtent()` reads `HUC6_BOUNDS`, a committed constant, and
`src/ui/map.ts:337` sets it on the map element *before* the view exists. The
comment there is explicit about why: "the target is a fixed box, not something
that has to be measured from the data, so there is nothing to wait for and no
race to lose." A reader-chosen scope breaks that — the box is now data.

Three options, and the third is the one:

1. **Compute it from geometry.** Refused by ADR-048.
2. **Commit a table of boxes in TypeScript.** Refused by ADR-002 — 143 boxes
   in a source file is a data payload in a trench coat, and it would go stale
   against `west-huc6.geojson` with nothing to catch it.
3. **Publish a bounding box per unit in `reference.json`.** A box is not
   geometry you draw; it is four numbers, and `HUC6_BOUNDS` is already exactly
   this, committed. `watershed_scopes.py` is already the one place that
   decides which areas exist, and it already has the rings in hand.

**The timing works with no new request.** `src/ui/map.ts:288` already awaits
the reference fetch before it constructs the map element — the Utah mask needs
it. The opening extent can wait on the same promise the mask already waits on.
No extra round trip, no late `goTo`, no visible jump.

**Cost.** `reference.json` is 30.8 KB raw and 7.4 KB gzipped today. Boxes for
all 143 units across the four scopes add roughly 7 KB raw. Per ADR-051 the
raw figure is not the one that matters; measure the gzipped delta with
`tools/audit-transfer.mjs` and update `docs/data-transfer.md`, which is the
file that holds these measurements. If the gzipped cost is material, publish
boxes only for the scopes the chooser offers.

**Rollup boxes for the coarser choices.** A region's box is the union of its
areas' boxes; a state's box is the union of the areas touching it. Both are
arithmetic over the published boxes and belong in the client, not the payload
— one fewer thing to keep consistent.

**The navigation constraint does not move.** ADR-044 pins `MAP_BOUNDS` and
`MAP_CENTER` to `shared/reservoir-viz.js` because "where a reader may go is a
contract with the links the retired routes translate." A chosen scope changes
where the map *opens*, never where it may go. A reader who picks Utah and
pans to Colorado is not doing anything wrong, and a constraint that follows
the chooser would trap them.

`extent.test.ts` recomputes `HUC6_BOUNDS` from whichever file `reference.json`
names as the roster scope's. Adding a `bbox` field must leave that intact —
and gains something: the test becomes the oracle for the published boxes too.

## Decision 3 — a splash, a control, or both

A splash screen has costs the request does not mention, and they are worth
stating before choosing one:

- It is a blocking modal in front of the product on a first visit.
- It has to be skippable — a reader who wants the whole west must reach it in
  one action, and the escape key must work.
- It must never appear for a link that already names a scope, or every shared
  link opens on an interstitial instead of the thing it was sent to show.
- It is an accessibility surface. The smoke test runs axe-core over every page
  at 1280, 390 and 360, and a dialog is exactly the kind of component that
  fails focus-trap and accessible-name checks.
- It delays the data fetch or it does not. If the chooser needs
  `reference.json` to list the areas — it does — then either the splash waits
  on a fetch (a modal with a spinner in it) or it is built from a list that
  can go stale.

**Recommendation: build the control first, the splash second, and make the
splash optional.**

The control is the part that carries its weight regardless: a scope select
beside the level select, on all four surfaces, doing exactly what the level
control does. It is already a solved shape — `createLevelControl` builds from
what the export publishes, returns `null` when there is nothing to choose,
takes a Calcite scale because the storage panel and the snow and drought
filter bars differ by a third of a control's height, and treats a change as a
`location.replace` navigation rather than a re-render. A scope control is the
same component with a different list, and every one of those decisions applies
unchanged.

Then the splash, if it is still wanted, is a first-visit affordance over a
mechanism that already works and is already testable — rather than the only
way to reach a scope, which is what makes an interstitial load-bearing.

**When the splash appears.** Only when all three are true: no `?area=` and no
`?state=` in the address bar, no stored choice, and the reader has not
dismissed it before. Anything else opens the map.

**What it is made of.** Calcite 5.1.2 has `calcite-dialog`, `calcite-tile-group`,
`calcite-segmented-control` and `calcite-chip` — none of which the site
currently imports. Two constraints on picking components:

- `src/architecture.test.ts` fails the build on a package-wide Calcite import.
  Each component is imported by path, as `shell-template.ts` already does.
- **A new Calcite icon is a 404, not a missing glyph.** Icons are committed
  under `public/assets/icon/` (108 files today) and pinned by
  `architecture.test.ts`. Turning on a tile or dialog feature can pull in an
  icon that is not there, the page looks fine, and only the browser suite sees
  it as a console error. Every icon a new component reaches for has to be
  committed in the same change.

## Decision 4 — persistence, and which source wins

Three sources, and the order between them is the whole design:

1. **The address bar wins.** Always. A shared link means what it says.
2. **`localStorage` is the returning reader's default**, and only applies
   when the address bar is silent. The pattern exists — `ui/theme.ts` and
   `ui/shell.ts` both store a preference and both parse what comes back
   rather than trusting it.
3. **The splash is what happens when neither has an answer.**

This creates one requirement that is easy to miss and impossible to retrofit
quietly: **"the whole west" has to be expressible as a parameter.** Today a
default is written as absence — `url.ts` says so, and `?level=6` is never
written. But if absence also means "use the stored choice", then a reader with
Utah stored cannot be sent a link to the whole west, because the sender's link
has no parameter in it and the receiver's storage fills the gap.

So `?area=all` (or an equivalent explicit token) must be writable, and the
share button must write it when the reader is looking at everything. That is a
deliberate exception to the defaults-as-absence rule and needs to be recorded
as one, because `url.test.ts` holds `searchWithState` against the frozen
module and the exception has to be on the storage map's side of that line.

**A second, quieter hazard.** Storage is per-origin, not per-page. A reader
who scopes the drought map to region 15 and then opens the snowpack map gets
region 15, which holds no snow sites — a blank page they did not ask for, on
a page they navigated to fresh. Either the stored choice is per-page (which
defeats "filter the rest of the pages") or the receiving page falls back when
the stored scope empties it, and says why. **Falling back and saying so is the
rule the codebase already follows** — `applyScope` in `main.ts` already does
exactly this for a drainage area that leaves the scope, and the geographic
filters already keep a surviving selection and drop a dead one to "all".

## Decision 5 — carrying the choice across pages

This is the gap the request depends on and the one nothing currently does.

`src/ui/page-header.ts` builds the navigation from a `PAGES` table of static
hrefs — `./`, `./overview.html`, `./snow.html`, `./drought.html`,
`./methods.html` — and the only cross-page link anywhere that carries state is
`drought.ts:290`, which writes `./snow.html?area=${unit.huc6}` by hand.

So today a reader who picks HUC-4 on the drought map and clicks "Snowpack"
loses it. `?level=` has the same hole: CLAUDE.md says it is "one parameter
across all three maps", and the navigation drops it on every click.

`pageLinksMarkup` has to become a function of the current view rather than a
constant. Two consequences:

- The markup is currently built once, from a template literal, at module
  scope. It becomes something that is rebuilt — or whose hrefs are rewritten —
  whenever the scope changes, on both the buttons and the dropdown items,
  which are generated from the same table precisely so the two cannot differ.
- `tests/smoke-modern.mjs` asserts the exact hrefs (around lines 1774–1797 and
  631–633: `"./,./overview.html,./snow.html,./drought.html,./methods.html"`).
  Those assertions become "the path is this and the query carries the scope".

**Fixing `?level=` propagation is the same work** and should ride along — it
is the existing instance of this bug, and a scope that carries while the level
does not is a worse inconsistency than neither carrying.

## What each surface has to do with a scope

**Storage map (`main.ts`).** Narrow `inScope` by state and by area prefix;
both the predicate and the `where` clause, from the same bounds, because
`filters.test.ts` holds them against each other. Set the opening extent from
the scope's box. Repopulate the drainage select from what the scope leaves,
keeping a surviving choice — `applyScope` already does this and is the model.
Decide whether the 75 drawn context areas follow the scope: **recommendation,
they do not.** Context is what tells a reader their basin is part of something
larger, and a map showing one polygon on an empty basemap is worse than one
showing where that polygon sits. The scope moves the camera and dims the
reservoirs; it does not delete the surroundings.

**Storage charts (`overview.ts`).** The least work: `state`, `huc4` and
`huc6` filters already exist, already narrow each other coarsest-first, and
already appear in the URL under the names Decision 1 adopts. The scope is
their initial value. The one thing to get right is that the reader's own
controls must stay live — a scope that locks the filters is a scope the reader
cannot get out of without finding the splash again.

**Snowpack (`snow.ts`).** `measuredScope` already narrows the drawn areas to
the 14 the network reports in. A chosen scope narrows further, and ADR-064's
rule holds: regroup **from sites**, with the pipeline's rule, never by
averaging published basin means. A scope with no sites in it publishes no
figure — not a zero.

**Drought (`drought.ts`).** Filtering rows, not recomputing anything: each
area's shares are published per area and stay correct under any subset.
ADR-046 is the live hazard — a scoped "how much of this region is in drought"
is a new share with a new denominator, and it may not be produced by
averaging the areas' shares or by summing them. Either compute it in the
pipeline per offered scope, or do not print it. **Recommendation: do not
print it in the first version.** The ranked list of areas is the drought map's
answer and it narrows correctly for free.

**Every surface.** The summary sentence has to name the scope. This is the
part that makes the feature honest: `statewideRollup` sums
`current_storage_af` with no geographic qualifier, and a scoped total
presented in an unscoped sentence is the same class of error ADR-056 was
written about.

## The naming problem nobody can avoid

The site is "Utah Water Dashboard". The pages are "Utah Reservoir Storage",
"Utah Storage Charts", "Utah Snowpack", "Utah Drought" — `PAGE_SUBJECTS` in
`page-header.ts`, and `pageTitle` puts them in the browser tab, the bookmark
and every shared link.

A scope chooser that offers Colorado produces a page titled "Utah Snowpack"
showing Colorado's snow. Thirteen reservoirs have Colorado water and four have
Wyoming water; the drawn scope touches thirteen states, Mexico and Canada.

Three ways out, and this is a question for the reader rather than a
recommendation:

- **Offer only the states the roster has water in** — UT, CO, WY, AZ, NV, ID —
  and accept the titles as the site's subject rather than the page's content.
- **Make the titles scope-aware**, which ADR-045 ("name the site for the water
  and each page for its subject") has an opinion about and which changes every
  browser tab on the site.
- **Rename the site**, which is a much larger decision that the western
  expansion has been walking toward since ADR-053 and should not be made as a
  side effect of a splash screen.

## Rules this work is standing on

Collected so none of them is rediscovered by a failing test:

- **ADR-002** — no importing data. The boxes go in `reference.json`.
- **ADR-006** — Simplified Technical English, including in `aria-label`s and
  live regions, which the smoke test reads. Never "HUC-2" or "HUC-4" on
  screen; `LEVEL_LABELS` already models this with "Subregions" and "Basins",
  and a region needs the same treatment.
- **ADR-008** — one colour table. A scoped map is still coloured from
  `ReservoirViz.CLASSES`.
- **ADR-044** — `MAP_BOUNDS` and `MAP_CENTER` stay pinned. The scope moves the
  opening view only.
- **ADR-046** — never subtract or average shares with different denominators.
  This is what stops a scoped drought percentage.
- **ADR-048/049** — no geometry in the browser. This is what forces the
  published box.
- **ADR-050** — no client file names a hydrologic level. A scope carries its
  own code width; nothing hardcodes six.
- **ADR-056** — an empty drainage area is a legal state, and a withdrawal is
  always stated. A scope that empties a page says so.
- **ADR-059** — not measured is not zero. A scope with no measured land
  publishes no share.
- **ADR-060** — a state is three questions. The chooser picks
  `waterbody_states` and says which.
- **ADR-064** — `?level=` is a navigation, not a re-render, and the control is
  built from what the export offers. `?area=` follows both rules.

**And one naming collision already in the tree:** `DEFAULT_SCOPE` means
`west-huc6` in `watershed_scopes.py` and `{geography: "utah", lakePowell:
"exclude"}` in `src/overview-model.ts`. A third `Scope` type for the reader's
choice would make three. Name the new one for what it is — the opening
selection — and not `Scope`.

## Build order

Each step leaves the site working and testable.

1. **Fix the four-digit `where` clause.** `filterBounds` compares for equality
   where `matchesFilter` compares by prefix. Nothing can write a four-digit
   `?area=` until this agrees. `filters.test.ts` is where it is proven.
2. **Publish `bbox` per unit** from `watershed_scopes.py`; assert it against
   the committed rings in `tests/test_watershed_scopes.py`; extend
   `extent.test.ts` to hold the published box for the roster scope against
   `HUC6_BOUNDS`. Measure the gzipped delta and update
   `docs/data-transfer.md`.
3. **Widen `?area=` to any even code width** across the three maps and teach
   `regionExtent` to take an optional box. No control yet; the parameter works
   from a hand-typed link, which is the cheapest possible way to find out
   whether the idea is any good.
4. **Carry `?area=`, `?state=` and `?level=` across the navigation.**
   `page-header.ts` becomes view-aware; `smoke-modern.mjs`'s href assertions
   become path-plus-query assertions.
5. **Add `?state=` to the three maps**, with the sentence that says what a
   state selection means on a drainage-keyed map.
6. **Build the scope control**, modelled on `createLevelControl`: built from
   what the export offers, `null` when there is nothing to choose,
   scale-aware, and a `location.replace` navigation.
7. **Persist the choice**, with the address bar winning, an explicit
   everything token, and a fallback when a stored scope empties the page.
8. **Then the splash**, if it still earns its place once 1–7 exist.

## Tests this needs

- `filters.test.ts` — predicate and clause agree at 2, 4 and 6 digits.
- `url.test.ts` — a six-digit `?area=` link still means what it meant;
  `searchWithState` parity with the frozen module survives the everything
  token.
- `extent.test.ts` — the published box for the roster scope equals
  `HUC6_BOUNDS`; a scope's box contains every one of its areas' boxes.
- `boundaries.test.ts` — a unit with no box, or a malformed one, costs that
  unit and not the other 74.
- `tests/test_watershed_scopes.py` — every published box contains its rings.
- `overview-model.test.ts` — state, region, subregion and area narrow each
  other coarsest-first, and a selection that survives is kept.
- `snow-model.test.ts` — a scope with no sites publishes nothing, not zero.
- `smoke-modern.mjs` — the navigation carries the scope; a scoped page still
  passes axe-core at 1280, 390 and 360; no console errors from a missing icon;
  a scoped storage map draws the reservoirs it says it draws.
- `content-language.test.ts` — nothing the chooser renders says "HUC".

## Open questions

These change what gets built and are the reader's to answer.

1. **Does the storage map's drawn context follow the scope, or stay the whole
   west?** Recommendation above is that it stays.
2. **Which states are offered?** Six have reservoir water; thirteen touch a
   drawn area. Offering thirteen means offering seven that empty the storage
   map.
3. **Do the page titles become scope-aware?** See the naming problem.
4. **Is the splash still wanted once the control exists?** Steps 1–7 deliver
   the whole of "pick a scope and it follows you"; step 8 is the interstitial.
