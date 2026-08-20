# Working in this repository

Conventions that are not obvious from the code, and that tests will fail you
for breaking. Read [`docs/decisions/`](docs/decisions/) for why any of them
exist.

## The shape of the project

One typed ArcGIS 5.1 application with four analytical surfaces, three
documentation pages, three compatibility redirects, one frozen source oracle,
and Python data pipelines:

| | |
|---|---|
| `index.html` | Primary reservoir-map entry for the typed ArcGIS 5.1 and Calcite 5 application. |
| `modern.html` | Stable alias for the primary application. |
| `overview.html` | Production ArcGIS Charts data workspace. |
| `snow.html` | Production snowpack curves, drainage-area map, site map, and detail views. |
| `drought.html` | Production weekly drought map and comparison charts. |
| `methods.html` | Methods and sources page. |
| `data.html` | Public data API documentation. |
| `terms.html` | Terms and license page. |
| `legacy/index.html` | Compatibility redirect from the former ArcGIS 4.34 path to the storage map. |
| `maplibre/index.html` | Compatibility redirect from the former MapLibre path to the storage map. |
| `explore.html` | Compatibility redirect from the earlier overview to storage charts. |
| `public/retired-route.js` | Allowlisted URL-state translation for all three redirects. |
| `shared/reservoir-viz.js` | Frozen source-only color-table owner and test oracle. It is not published. |
| `src/` | Strict TypeScript modules for the modernization, including the complete runtime data validator. |
| `refresh_reservoirs.py`, `refresh_snowpack.py` | The daily reservoir and snow pipelines. Not part of frontend-only work. |
| `watershed_scopes.py`, `huc.py` | Named western scopes, drainage assignment, and grouping. |
| `data/drought/` and `tools/compute_drought_coverage.py` | Verified weekly drought polygons, level-specific measurements, and history. |
| `normals.json` | The 1991-2020 climate normal per reservoir. Committed, read by the pipeline, never published. |
| `data/watersheds/west-huc6.geojson` | The 75 default drainage areas the maps draw and the western roster is assigned against. Committed, never published: browser outlines come from the hosted layer (ADR-048, ADR-049, ADR-068). |
| `huc6.geojson` | The fourteen-area Utah-connected historical scope. Still committed and reviewed for compatibility and parity checks; it no longer defines the opening map or roster. |
| `data/drought/usdm-huc6-history.json` | Every weekly drought map this pipeline has computed, oldest first, capped at ten years. Published. |

## Rules

**Visible text is Simplified Technical English** (ADR-006). Never write `af`,
`period-of-record`, `stale`, `cadence`, `seasonal percentile`, `RISE` or
`AWDB` anywhere a reader can see them — including `aria-label`s and live
region messages, which the smoke test also reads. Write "acre-feet", "highest
recorded storage", "late data", "update schedule", "history rank", "Bureau of
Reclamation", "Natural Resources Conservation Service".

**Colour comes from one table** (ADR-008). `ReservoirViz.CLASSES` is the only
place breaks, colours and labels are written down; renderers, legends, charts
and filters are generated from it. A unit test asserts the ported copy matches
value for value.

**Data is fetched at runtime, never imported** (ADR-002). `reservoirs.json` is
rewritten every morning and that commit is the deploy. The build *copies* it;
nothing imports it, and the deploy workflow fails if the payload appears in
`dist/assets`.

**Tests must not depend on today's numbers.** The build runs the unit tests, so
a test asserting a literal percentage would turn the build red on a morning
when no code changed — and a red build freezes the published numbers. Compare
against `shared/reservoir-viz.js` in a `node:vm` sandbox instead; see
`src/data/legacy-harness.ts`.

**A calendar date is one position in every year.** `canonical_day` in
`refresh_reservoirs.py` maps a date into a 365-day year where 29 February
shares 28 February's place; `seasonal_window`, the climate normal table and
its lookup all match on it. Never reach for `dayofyear` again: it makes 19
August day 231 in an ordinary year and 232 in a leap year, so a window centred
on 19 August was centred on 18 August for every leap year in the record, and
the normals table was built over a leap year while being read by ordinary-year
numbers. The wrap at the year end is a flat 365 for every year, which is what
the per-year length here used to be working around.

**Every year gets one vote.** A seasonal normal is the median of one
representative value per year (`annual_seasonal_values`), never a median over
the pooled readings: a reservoir reported daily brings about 450 readings to a
thirty-year window and one reported at month end brings about 15, so pooling
made the statistic a fact about reporting density. The history rank ranks the
same annual values, and the details panel leads with the ordinal — "3rd-lowest
of 12" carries its own sample size and a percentile does not.

**A method version is not a schema version** (review of 2026-08-20). A field
can keep its name, type and units while the estimator under it changes, and
`schema_version` cannot see that. `METHOD_VERSION` can, and three places
refuse to mix: `build_normal_baselines.py` stops a partial run against a file
built by another estimator, `load_normals` warns when the payload and the
committed normals disagree, and `merge_history` refuses a drought week
measured by another method exactly as it already refused one at another level.
An interrupted full normals build is the single exception — it keeps its
fetches and drops the rest, because it has already paid for them.

**Long-lived reference data carries the date it was checked.**
`tools/check_reference_freshness.py` reads each committed reference file's own
date field against a review interval and reports what is due. It is a tool and
**must never become a test**: a test that fails when a date passes turns the
build red on a morning when no code changed, and a red build freezes the
published numbers. What is tested is that every file carries a date and a
policy at all. The generators stamp `retrieved` themselves, so a re-fetch
carries its own provenance.

**These reservoirs are not one population.** No fitted normal curve, no
standard deviation as an interpretive frame: they differ by size, purpose,
hydrology, operating rules and flood-control duty, so a flood-control
reservoir held deliberately low in spring sits in the same histogram bins as a
supply reservoir kept full. `distributionStats` publishes the mean, the median
and the middle half. The SDK's histogram offers no quantile overlay, so the
key states the middle half rather than drawing it.

**A change names the reading it is a change from.** "30-day change" is the
date the pipeline asks for; the reading it gets is the nearest one inside a
tolerance of ten days for a daily feed and forty-five for a month-end one, so
"change in 1 year" has covered 320 days to 410. `change_*_reference_date` and
`change_*_elapsed_days` publish the interval, and the details panel prints the
measured one whenever it differs from the name.

**A normal names the years it came from** (ADR-041). Two comparison periods
are published per reservoir and the reader picks; `normals.json` holds the
standard 1991-2020 one and is rebuilt by `tools/build_normal_baselines.py`, not
by the daily refresh — a median over a period that has ended cannot change. Two
rules have tests behind them: a comparison never answers with a period it was
not asked for without saying so, and a median never appears without the number
of years behind it. A baseline thinner than the payload's own `minimum_years`
counts as unavailable, because a three-year median labelled "1991 through 2020"
is true in every word and wrong as a whole.

**Measure payload cost gzipped, never raw** (ADR-051, ADR-052). GitHub Pages
compresses the JSON, so a raw byte count overstates what a reader pays by
several times -- `snowpack.json` is 3,607 KB on disk and 322 KB on the wire.
Runtime fetches use `cache: "no-cache"`, which is not "do not cache": it means
never use a stored copy without asking, so the morning's rewrite can never be
served stale and an unchanged file costs a 304 instead of the whole payload.
The snow series publishes the water-year calendar once and each site indexes
into it; `validateSnowpackPayload` rebuilds the rows, so nothing downstream
knows. Never encode a missing day as a null value -- a null reading is a row
that exists, and 13,910 of them do.

**The payload carries the roster; the service carries the shapes**
(ADR-047, ADR-048). `reference.json` publishes each area's code, name and
states and no drainage geometry -- it was 1,001 KB and is 27 KB, and every
map page fetches it whole on every load. Outlines come from the hosted
Watershed Boundary Dataset, quantized to the view. A map that needs each area
coloured by one of this project's own numbers does **not** need the shapes in
hand: that is a unique-value renderer keyed on the code, which is what the
snow map does. Never fetch geometry into the browser to colour something.
`docs/data-transfer.md` holds the measurements and is the file to update when
they change.

**The drawn scope and the roster scope are two names** (ADR-063).
`DEFAULT_SCOPE` is what the maps draw -- `west-huc6`, 75 basins across regions
14 to 18. `ROSTER_SCOPE` is the geography the published reservoirs were
admitted from -- still `utah-connected`, fourteen areas -- and it is what
`HUC6_BOUNDS` is the box of, so the map opens on the reservoirs rather than on
19 degrees of longitude with 69 reservoirs in one corner. Both are published
in `reference.json` as `default_scope` and `roster_scope`; no test, tool or
fixture may name a boundary file directly, because which file holds which
geography has moved once and will move again when the roster expands west.
**61 drawn areas hold no reservoir**, which is a state ADR-056 already allowed
for. **Each map draws what it can say something about**: the drought engine
measures all 75 so the drought map draws 75, the snow network reports in 51 so
`measuredScope` narrows the snow map to 51, and the storage map draws all 75
as context around its subject. The two committed files must agree area for
area -- fetched at different generalizations they did not, and two drought
figures moved by a rounding step with no weather behind them.

**Two levels are offered and the reader picks** (ADR-064). HUC-6 is the
default and HUC-4 is the other; every figure is published at both, which is
what makes a reader-chosen level a scope change rather than the view-scale
change ADR-050 refuses. Drought coverage is computed per level into
`data/drought/usdm-huc{level}.json`; storage regroups on `huc6[:4]`, exact
because codes nest; snow regroups from *sites* with the pipeline's rule, never
by averaging the published basin means. **Every coverage file must describe
one week** -- `check_drought_pair.py` globs them all, because a reader who
changes the level fetches a different file. **The archive is one level**, and
`merge_history` refuses a payload at another rather than joining two series on
one set of codes.

**`?level=` is one parameter across all three maps**, like `?area=`, and it
carries the digit count rather than a word because that is what every payload
states and `data.html` documents. Absent means basins; a link never carries
`level=6`. Changing it is a **navigation**, not a re-render: the level changes
which files a page fetches and every figure computed from them, so the control
takes the path a shared link already takes -- `location.replace`, never push.
The control is appended when `reference.json` resolves rather than written into
a template, because which levels are on offer is the export's answer
(`drawn_scopes`), and it is built at the Calcite scale of the controls beside
it -- the filter bars hold native selects a third taller than a default-scale
Calcite one.

**The maps draw the level the payload declares** (ADR-050). No client file
names a hydrologic level; it arrives as `DrainageScope { level, areas }` and
the code is read from the attribute that level names. `JOINABLE_LEVEL` in
`src/data/boundaries.ts` is the level every figure on the site is keyed at,
and a scope published at another size says so out loud rather than drawing
areas whose hover cards come back empty. Level is deliberately *not* driven by
view scale: a finer outline a reader can point at, with no figure behind it,
is less information rather than more.

**A watershed scope carries its own level.** `watershed_scopes.py` is the one
place that decides which drainage areas exist and how big they are; the level
picks the WBD service layer and the attribute the code arrives in. Codes are
fixed-width, so the level *is* the digit count -- `HUC_CODE` in
`src/data/huc.ts` is the shared pattern and accepts any even length to twelve.
Never write `/^\d{6}$/` again. Levels finer than HUC-8 are refused on purpose:
the drought engine's sampled share carries about 0.21 points of error at
HUC-10 against a published precision of 0.1.

**A scope can be registered before it is published.** `published=False` means
the geography exists to be fetched and reviewed and nothing draws it yet; the
reference export skips those and still fails loudly for anything missing that
*is* published.

**A basemap has two layer stacks** (ADR-042). `basemap.referenceLayers` draw
*above* every operational layer, so a boundary in them lands on the data
whatever order the operational layers are in — that is what drew a grey state
line through Flaming Gorge, and why reordering the operational stack could not
fix it. `sinkBasemapReferenceLayers` moves them below, on every basemap
assignment including theme swaps and the gallery, and `basemapReferenceSunk`
reports it. A caller inserting at a fixed index must count from a layer it owns,
not from zero.

**What may sit over the subject depends on whether the subject is continuous
or discrete** (ADR-061, superseding ADR-054 and narrowing ADR-042's claimed
scope). Drought classes tile the region with no gaps, so a line over them
always has fill on both sides: it partitions the surface and cannot hide it.
State and county outlines therefore draw *above* the drought classes. A
reservoir is a point, and a boundary across a point occludes rather than
partitions — which is the Flaming Gorge failure ADR-042 was written from, so
the storage and snow maps keep their reference layers sunk. Investigate before
raising anything over discrete data; the test is whether the mark can be
hidden, not whether it is vector.

**The drought map draws no terrain.** The flattest available background is the
right one for a choropleth, and relief plus five saturated classes plus two
cased boundary sets was more ink than the map's one question. **The blend
operator is still not a free choice** if a hillshade is ever used again:
`soft-light` and `overlay` pivot around mid-grey, so their effect scales with
`b · (1 − b)` of the backdrop; against the `canvas/light-gray` theme canvas
that is a swing of about 1% at 0.3 opacity, which is no effect at all.
`normal` is the operator, and `HILLSHADE_BLEND_MODE` in
`src/arcgis/hillshade.ts` carries the arithmetic. The Basemap Styles
hillshades need an API key (ADR-004 refuses one); `World_Hillshade` is public
and already inside the content policy.

**A week-over-week drought change needs two files and uses one.** The current
coverage file carries the week before it, which is about a kilobyte and is all
a change needs; `usdm-huc6-history.json` is the archive for work that wants a
series. Never fetch the archive to compute one subtraction. `previous` is
always strictly older than `map_date` — a file comparing a week with itself
would publish a change of zero for every area and present it as a measurement,
and the validator refuses it.

**Never subtract two shares with different denominators** (ADR-046). A share of
land minus a share of reservoir capacity is not a quantity. Such a difference
may rank rows and may set the length of a line; it may not be printed as a
number or given a baseline.

**A county is where a thing is; a drainage area is where its water goes**
(ADR-058, ADR-060). Counties are a *search and filter* axis and never a
grouping one — 69 reservoirs fall in 35 counties and 19 hold exactly one, so a
county total is a reservoir total wearing a county's name. The key is the
five-digit FIPS code and never the name: this roster holds two Summit, two
Carbon and two Garfield Counties. The assignment point is the **waterbody**,
deliberately not the dam the drainage area uses — Glen Canyon Dam is in
Coconino County, Arizona and Lake Powell is in San Juan County, Utah. No
county geometry is ever committed; the service resolves the point and answers
with a code, and the *detailed* Living Atlas layer is required rather than
preferred, because the generalized one puts Lost Lake outside Wasatch County.

**The geographic filters narrow each other, coarsest first.** State holds
subregion holds drainage area, and each control is repopulated from what the
ones above it leave — a reader who picks Wyoming is never offered a subregion
Wyoming has none of. A selection that survives the narrowing is kept; one that
does not falls back to "all" rather than silently filtering to nothing.
Repopulating a `<select>` must preserve the reader's choice when it is still on
offer, or the control resets on every keystroke. **A subregion code is
published nowhere**: codes are fixed-width, so it is `huc6.slice(0, 4)`. Only
the *names* are published, in `reservoirs.json`'s `watersheds.subregions` —
in the payload every surface fetches, not in `reference.json` which only the
maps do, because one copy of a roster is the point of having one.

**A state filter means the water** (ADR-060). Of the three questions, the
control picks `waterbody_states`: it is what `intersects_utah` has always
meant, so Bear Lake stays in Utah's list where a reader expects it. A payload
without the array falls back to the point's own state rather than vanishing
from every state filter.

**A state is three questions** (ADR-060). `state` is the one state holding the
published point, `waterbody_states` every state the water touches, and
`connected_states` every state the drainage area reaches. Hyrum is wholly in
Utah and fed from Idaho. A filter must pick one and say which; ADR-011's
warning is unchanged. `waterbody_states` defaults to the point's state, and
that default is *not* a finding — the reviewed table holds three waterbodies
and does not claim to be complete. Re-run the dam-versus-waterbody check when
the roster grows; it is cheap, it is already written, and it is what found
Lake Powell.

**Not measured is not no drought** (ADR-059). The monitor maps the United
States and stops at both borders, so cells outside `data/us-land.geojson` are
dropped before any class is counted rather than falling into `none`. Class
shares divide by the **measured** land; `measured.percent_of_area` divides by
the whole area and lives in its own block so nothing can sum the two
(ADR-046). An area with no measured land publishes no share at all, not zeros.
**A missing mask stops the run** — without one the engine reports every border
basin's far half as drought-free and looks like a clean run.

**Two reservoirs are large enough to be controls, not filters** (ADR-011,
ADR-062). Lake Powell and Lake Mead each dominate any total they enter, so
both have their own include/exclude choice and **absent means excluded** —
a default of include would have every existing caller silently start adding
28 million acre-feet. `shared/reservoir-viz.js` predates Mead, so oracle
parity is only meaningful with both controls open.

**A dam match is not the whole question** (review of 2026-08-20). `admit`
asks whether the inventory holds the right dam and answers from the inventory
alone. `discrepancies` asks whether everything else known about the same
reservoir agrees with it: whether the provider's own full level and the
inventory's differ, whether the water has stood above the capacity it would be
divided by, whether it has ever stood a third of the way up it, and whether one
reading sits far above the rest of the series. All four reuse the measured
`SURCHARGE_ALLOWANCE` rather than a new number. Of 169 California candidates
the inventory admitted 162 and the screens hold 36 — Keswick's conservation
pool of 7,470 acre-feet against the service's 23,772, and O'Neill Forebay
matched to a dam 1.18 km away and carrying San Luis Reservoir's 2,094,900,
thirty-seven times its own. The spike screen reads the **third** highest
reading, because Lake Havasu carries two and a rule reading the second would
have called them agreement. **Nothing is repaired**: every correction available
is a guess about which source is wrong, so the screen reports and a person
decides ([#25](https://github.com/buschbrian/western-water-dashboard/issues/25)).
`publishable` is the field a roster builder reads and it is deliberately
narrower than `admitted`, which still states that the dam match itself stands.

**A roster addition needs a refresh in the same change.** `tests/test_refresh.py`
asserts every roster name is either published or withdrawn, and there is no
"pending" state on purpose: a name on the roster and absent from the payload is
what a silently failed fetch looks like. `refresh_reservoirs.py --only` prints
and never writes, so it is a probe. `tools/build_normal_baselines.py` merges on
every path — `--only` used to write its one reservoir as the whole file, and a
full run used to drop the normal of every reservoir withdrawn that morning.

**Late and out-of-season are different faults** (ADR-056). `carry_forward`
keeps publishing a quiet feed's last value because a point vanishing with no
explanation is worse — true for days, false for months. Past
`WITHDRAW_AFTER_DAYS` (60) a record is withdrawn from the payload entirely,
because `statewideRollup` sums `current_storage_af` with no freshness filter,
so a spring figure is not just shown out of season, it is *added into a total
presented as now*. A withdrawal is always stated (`withdrawn`,
`withdrawn_count`, `withdraw_after_days`) and a withdrawal notice must never
carry a measurement — the validator rejects one holding
`current_storage_af`. Nothing is deleted: the roster is committed and the
judgement is remade every run. **A drainage area may therefore be empty**;
`storageAgainstDrought` already omits it rather than drawing it at zero.
Tests about *where* a reservoir is must read the roster, never
`reservoirs.json`, or a quiet feed silently retires an assertion.

**`cos(lat)` is the sphere's exact area element, not a rough projection**
(ADR-055). The drought engine measures equal area already, so "move it to
Albers" is not an accuracy fix — measured, the area model is worth 0.004
points, against a rounding boundary of 0.05.
Albers and geodesic agree on these polygons to 0.1 ppm. **Geodesic is the
measure of record for any area this project states**, and it lives in
`tests/test_area_model.py` as an oracle: `geographiclib` is in
`requirements-test.txt` and must never reach `requirements-pipeline.txt`,
which stays at numpy, pandas and requests. If the published precision ever
tightens past 0.1 of a point, reach for a finer step first and exact clipping
second — never for a projection.

**The sampling step is the term that mattered, and it has moved.** At 0.01
degrees, 59 of the 844 shares the drought engine publishes would round to a
different tenth than a fine reference gives. `DEFAULT_STEP` is 0.002, where
that falls to 5 — the engine's own floor, since those five sit on a rounding
boundary and no step settles them. It costs about 70 seconds a morning, in a
job that runs once a day and otherwise waits on other people's services.
`tools/measure_drought_convergence.py` measures it again and writes nothing;
run it before moving the step. Passing `--output` to
`compute_drought_coverage.py` now implies `--no-history`, because a trial run
redirected away from the committed coverage file used to rewrite the committed
archive anyway.

**Retired routes preserve bookmarks, not runtimes** (ADR-031). Keep
`legacy/`, `maplibre/`, and `explore.html` as small accessible redirects. Do
not restore their SDKs, chart libraries, or copies of application logic.

**The frozen oracle stays source-only.** `shared/reservoir-viz.js` remains the
ADR-008 color-table owner and test oracle until a later ADR moves that
ownership. Do not copy it into `dist/` or load it in a browser page.

**It does not own everything it exports** (ADR-044). `MAP_BOUNDS` and
`MAP_CENTER` stay pinned to it, because where a reader may go is a contract
with the links the retired routes translate. The zoom envelope is the view's
own and is asserted for what it must be true of. Before pinning anything else
to that module, ask whether it is a contract with something still running or
parity with a page that no longer exists.

**No `@arcgis/core/widgets/*`.** All widgets are deprecated in 5.0 and removed
in 6.0. `src/architecture.test.ts` fails the build on a widget import, on a
package-wide component import, and on a second physical Calcite installation.

**Architecture decision records are history.** Do not rewrite an accepted ADR
to match later work. Add a new ADR and mark the old one superseded; only the
status of an existing record changes after acceptance.

## Layout constraints that are already solved

Do not regress these; they were each found by a failing test or a screenshot.

- The pages are tested at **1280, 390 and 360** pixels wide. No page may scroll
  sideways at any of them.
- **`innerText` returns what CSS transformed, not what the code wrote.** A
  `text-transform: uppercase` on a label makes the page say `STORED NOW`, and
  every test and reader that goes through rendered text sees that instead. It
  caught a real design problem too: these labels now name a period, and long
  uppercase strings are harder to read than sentence case.
- **A grid track sized `auto` grows to its longest content.** The details
  panel was `minmax(0, auto) minmax(0, 1fr)`, which was survivable while every
  label was two words and resolved to 261 of 320 pixels the moment one had to
  name a period — leaving the values 14 pixels to wrap inside. Labels stack
  above values now.
- **A header action that reports state must read it from the surface.** The
  storage summary's `active` was written into the template as a literal, so it
  was lit from first paint whether the panel was open or shut.
- The title card keeps a **56px right gutter below 640px** — that is the zoom
  control's lane. The primary map does this. The retired MapLibre page used to
  push the control down by a measured offset instead, which is late by definition: the
  measurement happens after the data loads, and the control sits under the
  card until then. A gutter cannot be late.
- The card's height is **measured against the legend**, not capped at a
  constant, and needs `border-box` plus a `ResizeObserver` to stay correct.
- Grid and flex children carrying unbreakable controls need `min-width: 0`, or
  one `<select>` widens the whole page — by a platform-dependent amount, since
  it comes from font metrics.
- **`calcite-navigation` clips, it does not scroll.** An overflowing header
  never widens the page, so a `scrollWidth` check cannot see it — it just
  amputates the controls on the end of the bar. The modern shell drops the
  logo description and the "Storage charts" label below 48rem to fit; the
  smoke test measures each control's box against the viewport.
- **A `calcite-sheet` takes its height from `--calcite-sheet-height`.**
  `--calcite-sheet-max-height` only caps it, so on its own the sheet stays at
  its `height` preset.
- **`ResizeObserver` needs a render loop.** Its callbacks are delivered with
  the rendering steps, so in a hidden pane or headless CI they never arrive,
  while `getBoundingClientRect` reports the new size perfectly well. Anything
  that has to persist a measured size reads it when the gesture ends —
  `pointerup`, `keyup` — not from an observer.
- **A new Calcite icon is a 404, not a missing glyph.** Icons are committed
  under `public/assets/icon/` and pinned by `architecture.test.ts`. Turning on
  a component feature can pull in an icon that is not there; the browser suite
  catches it as a console error.
- Controls belong above the reservoir list, not below it. The list scrolls
  inside its own box, so anything after it is behind a nested scroller.

## Verify before you finish

```bash
npm run build             # typecheck, unit tests, SDK budget, production build
python -m pytest tests/ -q
mkdir -p screenshots
node tests/smoke.mjs        # compatibility redirects; needs Playwright Chromium
node tests/smoke-modern.mjs # complete ArcGIS application; same requirements
```

On demand, not part of the build and not runnable in CI:

```bash
node tools/profile-symbols.mjs   # needs a real, visible browser window
node tools/audit-transfer.mjs    # needs a built dist/ and Playwright Chromium
python tools/build_normal_baselines.py           # ~4.5 min for 203 reservoirs
python tools/build_normal_baselines.py --missing # only what has no normal yet
python tools/check_reference_freshness.py        # what is due to be re-checked
python tools/measure_drought_convergence.py      # what the sampling step is worth
```

`build_normal_baselines.py` fetches thirty years of readings for every
reservoir in `reservoirs.json`, so it is a network job and deliberately not
part of any build. Run it when the standard climate period moves (2021-2050
becomes standard in 2031) or when a reservoir joins the roster.

**It is network-bound, not slow.** One reservoir is 12.2 seconds of wall clock
for 0.8 seconds of processor, so it fetches `--workers` at a time (six by
default, kept small because both providers are public services this project
does not pay for). Two hundred and three reservoirs take about four and a half
minutes rather than forty.

**Every run merges; none replaces.** `--only "A" "B"` builds those,
`--missing` builds what the committed file has no usable normal for — which is
also how an interrupted run is resumed, and what makes a roster addition cost
one fetch rather than all of them. A reservoir absent from today's payload
keeps its normal and the run says so: the roster this reads is what the
providers answered *this morning*, and a reservoir withdrawn for a quiet feed
(ADR-056) would otherwise have a thirty-year fact deleted over a fortnight of
silence. **A reservoir with no record is not asked again** — "no readings in
the period" is a finding about a dam built in 2011, not a fetch to retry;
only "the provider did not answer" is retryable.

`audit-transfer.mjs` reports what each page actually requests and from which
hosts. It is the measurement the content policy was written from: if a new
layer or service is added, run it and widen the policy from what it reports
rather than from what the service's documentation claims.

It measures what the composed symbol and the filter effect cost on the machine
you run it on, and refuses to run in CI rather than report a perfect score from
a renderer that never drew. Leave the window in front for the duration. The
result of the 2026-08-13 run is in the modernization plan.

**Playwright is not in `package.json` on purpose, so `npm install` deletes
it.** CI installs it with `--no-save --no-package-lock` to keep the lockfile
exactly what `npm ci` produced, which means any ordinary `npm install` prunes
it as extraneous and every browser test stops resolving `playwright`. Put it
back the same way:

```bash
npm install --no-save --no-package-lock playwright
```

All three browser tools take `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. A machine
with Google Chrome installed does not need a second Chromium downloaded to run
them:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tests/smoke.mjs
```

The primary smoke test is the one that catches what the others cannot: a page
that loads, paints a basemap and renders no reservoirs at all. It asserts every
reservoir rendered, no retired vocabulary is visible, nothing overlaps the map
controls, and there are no console errors. The smaller redirect suite checks
saved-link translation and proves no retired runtime is requested.

**It also runs axe-core over every page at every width, and watches the font
host.** Both catch things nothing else can. Calcite and the ArcGIS components
put their real controls inside shadow roots, so a DOM-only check never sees
them — the slider handle that had no accessible name is a `div` three levels
down. And a mistyped label font does not fail: the atlas 404s, the labels fall
back to the default sans, and the page looks fine, so the only place it shows
is the request. Two violations are accepted, both in vendor components, and
`AXE_EXCEPTIONS` in the suite says why for each.

**Label fonts are a family and a weight, never a family with a weight in its
name.** The SDK builds the glyph-atlas slug from both, so
`"Atkinson Hyperlegible Next Bold"` asks for
`atkinson-hyperlegible-next-bold-regular`, which does not exist. Ask for the
family and set `weight` instead.

**Anything that can wait forever needs a deadline.** A promise that never
settles is a loading state that never ends, and a spinner that cannot resolve
is an error the reader is not being told about. Runtime fetches go through
`src/data/fetch.ts`; the basemap chain has its own in `src/arcgis/fallback.ts`;
the chart render waits on an SDK event that has been observed never to arrive
and races it against a timer. `aria-busy` is part of this: it reports one fact,
so every way of no longer being busy has to clear it, the unhappy ones
included.

**A readiness signal field must report one fact.** Current application surfaces
publish `window.__dashboardReady`. Two fields that read the same expression make two
assertions about one fact, which is how a whole map layer was deleted without a
test noticing. Add fields; never remove one.

## Known environment quirks

- The ArcGIS map canvas renders **blank in headless Chromium**, including in
  CI. The uploaded screenshots therefore prove much less than they look like
  they do. It renders correctly in a real browser.
- `requestAnimationFrame` never fires in a hidden browser pane, and
  `view.hitTest()` never settles there either — it is resolved by the same
  render loop. Hover cannot be exercised in that environment.
