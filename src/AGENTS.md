# Frontend rules (`src/`, `*.html`, `src/styles/`)

Authority: [`docs/architecture/frontend.md`](../docs/architecture/frontend.md).
Read that before a non-trivial change; this is the checklist.

- **No `@arcgis/core/widgets/*`** — removed in 6.0. Import one web component
  per custom element, never a package root. (`src/architecture.test.ts`)
- **Colour comes from one table** (ADR-008). `ReservoirViz.CLASSES` in the
  frozen `shared/reservoir-viz.js` owns storage breaks, colours and labels;
  renderers, legends, charts and filters are generated from it.
- **Visible text is Simplified Technical English** (ADR-006), `aria-label`s and
  live-region messages included. Vocabulary:
  [`.claude/rules/visible-language.md`](../.claude/rules/visible-language.md).
- **Data is fetched at runtime, never imported** (ADR-002). Fetch through
  `src/data/fetch.ts`, which carries the deadline.
- **Anything that can wait forever needs a deadline**, and every exit from a
  loading state must clear `aria-busy` — the unhappy ones too.
- **A readiness field reports one fact.** Add fields to
  `window.__dashboardReady`; never remove one.
- **Reference layers sink below discrete data and may sit above continuous
  data** (ADR-042, ADR-061). A point can be hidden by a line; a tiled surface
  cannot.
- **Rows that are already scoped keep their type.** Use `scopeReservoirs` and
  `rollupOfScoped` rather than passing scope options twice
  ([`docs/architecture/scopes.md`](../docs/architecture/scopes.md)).
- **No `text-transform` anywhere.** `innerText` returns what CSS transformed,
  which is what a screen reader and the smoke suite both read.
- Layout constraints already solved — page widths, the 56px zoom gutter,
  `min-width: 0`, `calcite-navigation` clipping, sheet height, `ResizeObserver`
  in hidden panes — are listed in the frontend architecture document. Do not
  rediscover them.

Verify: `npm run verify:fast` while working, `npm run verify:frontend` before
finishing, and `npm run verify:browser` for anything a browser renders —
layout, visible text, layers, URL state and console errors are invisible to the
other targets.
