# Working in this repository

Conventions that are not obvious from the code, and that tests will fail you
for breaking. Read [`docs/decisions/`](docs/decisions/) for why any of them
exist.

## The shape of the project

One typed ArcGIS 5.1 application with two primary surfaces, three compatibility
redirects, one frozen source oracle, and one Python pipeline:

| | |
|---|---|
| `index.html` | Primary Vite entry for the typed ArcGIS 5.1 and Calcite 5 application. |
| `modern.html` | Stable alias for the primary application. |
| `overview.html` | Production ArcGIS Charts data workspace. |
| `methods.html` | Methods and sources page. |
| `data.html` | Public data API documentation. |
| `legacy/index.html` | Compatibility redirect from the former ArcGIS 4.34 path to the storage map. |
| `maplibre/index.html` | Compatibility redirect from the former MapLibre path to the storage map. |
| `explore.html` | Compatibility redirect from the earlier overview to storage charts. |
| `public/retired-route.js` | Allowlisted URL-state translation for all three redirects. |
| `shared/reservoir-viz.js` | Frozen source-only color-table owner and test oracle. It is not published. |
| `src/` | Strict TypeScript modules for the modernization, including the complete runtime data validator. |
| `refresh_reservoirs.py` | The daily data pipeline. Not part of the frontend work. |
| `normals.json` | The 1991-2020 climate normal per reservoir. Committed, read by the pipeline, never published. |
| `huc6.geojson` | The reviewed drainage-area polygons. Committed, read by the pipeline to assign reservoirs, never published: not inside `reference.json` and not copied into `dist/` (ADR-048, ADR-049). Nothing in a browser has fetched it since the outlines became the hosted layer's. |
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
several times -- `snowpack.json` is 1,166 KB on disk and 99 KB on the wire.
Runtime fetches use `cache: "no-cache"`, which is not "do not cache": it means
never use a stored copy without asking, so the morning's rewrite can never be
served stale and an unchanged file costs a 304 instead of the whole payload.
The snow series publishes the water-year calendar once and each site indexes
into it; `validateSnowpackPayload` rebuilds the rows, so nothing downstream
knows. Never encode a missing day as a null value -- a null reading is a row
that exists, and 13,910 of them do.

**The payload carries the roster; the service carries the shapes**
(ADR-047, ADR-048). `reference.json` publishes each area's code, name and
states and no drainage geometry -- it was 1,001 KB and is 21 KB, and every
map page fetches it whole on every load. Outlines come from the hosted
Watershed Boundary Dataset, quantized to the view. A map that needs each area
coloured by one of this project's own numbers does **not** need the shapes in
hand: that is a unique-value renderer keyed on the code, which is what the
snow map does. Never fetch geometry into the browser to colour something.
`docs/data-transfer.md` holds the measurements and is the file to update when
they change.

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

**Terrain is the ground, at the bottom of the stack** (ADR-054, superseding
ADR-043). It was above the drought classes for two versions, so that it varied
their lightness and left the monitor's hues alone. The range between invisible
and intrusive turned out to be empty: a shade over the subject has to be
strong enough to read through a class before it says anything, and by then it
is competing with it. The classes are drawn at 0.45 alpha, so a reader was
always seeing through them — to a flat background. Now there is terrain there.
**The blend operator is not a free choice from below.** `soft-light` and
`overlay` pivot around mid-grey, so their effect scales with `b · (1 − b)` of
the backdrop; against the `canvas/light-gray` theme canvas that is a swing of
about 1% at 0.3 opacity, which is no effect at all. `normal` is the operator,
and `HILLSHADE_BLEND_MODE` in `src/arcgis/hillshade.ts` carries the
arithmetic. The Basemap Styles hillshades need an API key (ADR-004 refuses
one); `World_Hillshade` is public and already inside the content policy.

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
python tools/build_normal_baselines.py   # ~20 min; rewrites normals.json
```

`build_normal_baselines.py` fetches thirty years of readings for all 69
reservoirs, so it is slow and deliberately not part of any build. Run it when
the standard climate period moves (2021-2050 becomes standard in 2031) or when
a reservoir joins the roster. `--dry-run` prints the coverage summary without
writing, and `--only "Name"` builds one.

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
