# Frontend architecture

The reader-facing application: strict TypeScript, Vite, ArcGIS Maps SDK 5.1,
ArcGIS Charts 5.1, Calcite Components 5.1. Scoped agent rules for this area
are in [`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) and
[`src/AGENTS.md`](../../src/AGENTS.md).

## Where to start, per page

The four entry points are large because they are wiring: they read the URL,
load payloads, build the shell, and hand work to modules that are testable on
their own. **The logic is almost never in the entry point.** Start at the
module that owns the behaviour and read the entry point only for the sequence.

| Page | Entry point | Where the behaviour actually lives |
|---|---|---|
| Storage map | `src/main.ts` | `src/ui/map.ts`, `src/ui/layers.ts`, `src/ui/shell.ts`, `src/state/filters.ts`, `src/state/url.ts`, `src/state/detail.ts`, `src/data/rollup.ts` |
| Storage charts | `src/overview.ts` | `src/overview-model.ts` (all filtering and grouping), `src/overview-charts.ts`, `src/state/overview-url.ts`, `src/weekly-model.ts` |
| Snowpack | `src/snow.ts` | `src/snow-model.ts`, `src/ui/snow-map.ts`, `src/viz/snow-curve.ts`, `src/state/snow-url.ts` |
| Drought | `src/drought.ts` | `src/drought-model.ts`, `src/ui/drought-map.ts`, `src/viz/drought-*.ts`, `src/state/drought-url.ts` |
| Methods, data, terms | `src/methods.ts`, `src/data-docs.ts` | `src/data-docs-schema.ts` is the field-by-field contract |

Shared by all of them: `src/data/` (fetch, validate, scope, rollup),
`src/state/` (URL, filters, preferences), `src/viz/` (colour, symbols,
formatting), `src/ui/` (shell, header, controls, map).

A model module (`*-model.ts`) is pure and unit-tested; an entry point is not.
Put new behaviour in the model.

## SDK boundaries

**No `@arcgis/core/widgets/*`.** Every widget is deprecated in 5.0 and removed
in 6.0. Import one web component per custom element, never a package root.
*Enforced:* `src/architecture.test.ts`, which also fails the build on a second
physical Calcite installation.

**A new Calcite icon is a 404, not a missing glyph.** Icons are committed under
`public/assets/icon/` and pinned by `architecture.test.ts`; turning a component
feature on can pull in an icon that is not there. The browser suite catches it
as a console error.

**Public pages never ask for credentials** (ADR-004). No API key. The Basemap
Styles service hillshades need one and are therefore unavailable;
`World_Hillshade` is public and inside the measured content policy.

**Label fonts are a family and a weight, never a family with a weight in its
name.** The SDK builds the glyph-atlas slug from both, so
`"Atkinson Hyperlegible Next Bold"` asks for
`atkinson-hyperlegible-next-bold-regular`, which does not exist: the atlas
404s, the labels fall back to the default sans, and the page looks fine. Ask
for the family and set `weight` instead. The smoke suite watches the
font host because nothing else can see it.

## Layers and what may sit over what

**A basemap has two layer stacks** (ADR-042). `basemap.referenceLayers` draw
*above* every operational layer, so a boundary in them lands on the data
whatever order the operational layers are in — that is what drew a grey state
line through Flaming Gorge. `sinkBasemapReferenceLayers` moves them below on
every basemap assignment, theme swap and gallery pick;
`basemapReferenceSunk` reports it. A caller inserting at a fixed index must
count from a layer it owns, not from zero.

**What may sit over the subject depends on whether the subject is continuous
or discrete** (ADR-061, superseding ADR-054 and narrowing ADR-042's claimed
scope). Drought classes tile the region with no gaps: a line over them
partitions the surface and cannot hide it, so state and county outlines draw
*above* the drought classes. A reservoir is a point, and a boundary across a
point occludes it, so the storage and snow maps keep their reference layers
sunk. The test is whether the mark can be hidden, not whether it is vector.

**The drought map draws no terrain.** The flattest available background is the
right one for a choropleth. If a hillshade is ever used again, the blend
operator is not a free choice: `soft-light` and `overlay` pivot around
mid-grey, so against the `canvas/light-gray` theme canvas their effect is a
swing of about 1% at 0.3 opacity — no effect at all. `normal` is the operator
and `HILLSHADE_BLEND_MODE` in `src/arcgis/hillshade.ts` carries the arithmetic.

**Never fetch geometry into the browser to colour something** (ADR-047,
ADR-048). A map that needs each area coloured by one of this project's own
numbers wants a unique-value renderer keyed on the code, which is what the
snow map does. Where the outlines come from, and what the roster costs on the
wire, is in [`scopes.md`](scopes.md#the-payload-carries-the-roster-the-service-carries-the-shapes).

## Colour and visible text

**Colour comes from one table** (ADR-008). `ReservoirViz.CLASSES` in the
frozen `shared/reservoir-viz.js` is the only place storage breaks, colours and
labels are written down; renderers, legends, charts and filters are generated
from it. *Enforced:* a unit test compares the ported copy value for value
through `src/data/legacy-harness.ts`.

**The frozen oracle stays source-only.** Do not copy `shared/reservoir-viz.js`
into `dist/` or load it in a browser page. It predates Lake Mead, so oracle
parity is only meaningful with both dominant-reservoir controls open.

**It does not own everything it exports** (ADR-044). `MAP_BOUNDS` and
`MAP_CENTER` stay pinned to it because where a reader may go is a contract
with the links the retired routes translate. The zoom envelope is the view's
own. Before pinning anything else to that module, ask whether it is a contract
with something still running, or parity with a page that no longer exists.

**Visible text is Simplified Technical English** (ADR-006). The banned
vocabulary and its replacements are in
[`.claude/rules/visible-language.md`](../../.claude/rules/visible-language.md).
*Enforced:* `src/content-language.test.ts` and the smoke suite, which reads
`aria-label`s and live-region messages too.

## Failure, readiness and accessibility

**Anything that can wait forever needs a deadline.** A promise that never
settles is a loading state that never ends, and a spinner that cannot resolve
is an error the reader is not being told about. Runtime fetches go through
`src/data/fetch.ts`; the basemap chain has its own deadline in
`src/arcgis/fallback.ts`; the chart render races an SDK event that has been
observed never to arrive against a timer. `aria-busy` reports one fact, so
every way of no longer being busy has to clear it, the unhappy ones included.

**A readiness signal field reports one fact.** Current surfaces publish
`window.__dashboardReady`. Two fields that read the same expression make two
assertions about one fact, which is how a whole map layer was deleted without
a test noticing. Add fields; never remove one.

**Accessibility is a release gate** (ADR-036). The smoke suite runs axe-core
over every page at every tested width and watches the font host. Calcite and
the ArcGIS components put their real controls inside shadow roots, so a
DOM-only check never sees them. One violation is accepted, in a vendor
component, and `AXE_EXCEPTIONS` in `tests/smoke-modern.mjs` says why.

## Layout constraints that are already solved

Each was found by a failing test or a screenshot. Do not regress them.

- The pages are tested at **1280, 390 and 360** pixels wide. No page may
  scroll sideways at any of them.
- **`innerText` returns what CSS transformed, not what the code wrote.** A
  `text-transform: uppercase` makes the page say `STORED NOW` to a screen
  reader and to the smoke suite alike. There is no `text-transform` anywhere
  in `src/styles/` or the pages, and adding one needs a reason better than
  emphasis. *Enforced:* `src/content-language.test.ts`.
- **A grid track sized `auto` grows to its longest content.** The details
  panel resolved a label track to 261 of 320 pixels the moment one label had
  to name a period. Labels stack above values now.
- **A header action that reports state must read it from the surface.** The
  storage summary's `active` was a literal in the template, so it was lit from
  first paint whether the panel was open or shut.
- The title card keeps a **56px right gutter below 640px** — the zoom
  control's lane. A measured offset is late by definition: the measurement
  happens after the data loads. A gutter cannot be late.
- The card's height is **measured against the legend**, not capped at a
  constant, and needs `border-box` plus a `ResizeObserver`.
- Grid and flex children carrying unbreakable controls need `min-width: 0`, or
  one `<select>` widens the whole page by a platform-dependent amount.
- **`calcite-navigation` clips, it does not scroll.** An overflowing header
  never widens the page, so a `scrollWidth` check cannot see it — it amputates
  the controls on the end of the bar. The smoke test measures each control's
  box against the viewport.
- **A `calcite-sheet` takes its height from `--calcite-sheet-height`.**
  `--calcite-sheet-max-height` only caps it.
- **`ResizeObserver` needs a render loop.** Its callbacks arrive with the
  rendering steps, so in a hidden pane or headless CI they never arrive while
  `getBoundingClientRect` reports the new size perfectly well. Persist a
  measured size when the gesture ends — `pointerup`, `keyup`.
- Controls belong **above** the reservoir list. The list scrolls inside its own
  box, so anything after it is behind a nested scroller.

## Filters

**The geographic filters narrow each other, coarsest first.** State holds
subregion holds drainage area, and each control is repopulated from what the
ones above it leave. A selection that survives the narrowing is kept; one that
does not falls back to "all" rather than silently filtering to nothing.
Repopulating a `<select>` must preserve the reader's choice when it is still
on offer, or the control resets on every keystroke.

**A subregion code is published nowhere**: codes are fixed-width, so it is
`huc6.slice(0, 4)`. Only the *names* are published, in `reservoirs.json`'s
`watersheds.subregions` — the payload every surface fetches, not
`reference.json` which only the maps do.

## Retired routes

**Retired routes preserve bookmarks, not runtimes** (ADR-031). `legacy/`,
`maplibre/` and `explore.html` stay small accessible redirects. Do not restore
their SDKs, chart libraries or copies of application logic.

## Environment quirks

- The ArcGIS map canvas renders **blank in headless Chromium**, CI included.
  Uploaded screenshots prove much less than they look like they do.
- `requestAnimationFrame` never fires in a hidden browser pane, and
  `view.hitTest()` never settles there — it is resolved by the same render
  loop. Hover cannot be exercised in that environment.
