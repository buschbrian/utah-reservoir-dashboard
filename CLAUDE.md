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

**Retired routes preserve bookmarks, not runtimes** (ADR-031). Keep
`legacy/`, `maplibre/`, and `explore.html` as small accessible redirects. Do
not restore their SDKs, chart libraries, or copies of application logic.

**The frozen oracle stays source-only.** `shared/reservoir-viz.js` remains the
ADR-008 color-table owner and test oracle until a later ADR moves that
ownership. Do not copy it into `dist/` or load it in a browser page.

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
```

`audit-transfer.mjs` reports what each page actually requests and from which
hosts. It is the measurement the content policy was written from: if a new
layer or service is added, run it and widen the policy from what it reports
rather than from what the service's documentation claims.

It measures what the composed symbol and the filter effect cost on the machine
you run it on, and refuses to run in CI rather than report a perfect score from
a renderer that never drew. Leave the window in front for the duration. The
result of the 2026-08-13 run is in the modernization plan.

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
