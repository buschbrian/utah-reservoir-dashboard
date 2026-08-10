# ADR-001: Adopt a build step, retiring the zero-build constraint

## Status

Accepted

## Date

2026-08-09

## Context

The dashboard began as three hand-written HTML pages with no build step, no
framework and no dependencies: the two map pages loaded their SDK from a CDN
with plain `<script>` tags, and the overview loaded nothing at all. That
constraint was deliberate and it paid for itself for a long time — the pages
could be opened from disk, there was nothing to install, and nothing between
the source and what shipped.

Three things pushed against it at once:

- **Shared logic could not be tested.** `shared/reservoir-viz.js` had grown to
  hold the class breaks, the statewide rollup, the popup markup and the trend
  chart. The rollup is arithmetic with no DOM in it, and the only thing
  exercising it was a browser smoke test. Its own comment said to revisit the
  no-module decision "the moment a third page shows up". A third page had.
- **Charting had hit the ceiling.** The 12-month trend was hand-rolled inline
  SVG. Adding pointer tooltips, focusable marks and responsive axes by hand is
  a lot of code to write and more to keep correct.
- **Nothing type-checked.** `reservoirs.json` has around forty fields per
  record and every page indexed into it by string.

## Decision

Adopt Vite 8 + TypeScript 7 (strict, including `exactOptionalPropertyTypes`) +
Vitest. `explore.html` becomes a Vite entry point; the two map pages keep their
CDN `<script>` tags and are copied verbatim into the published output.

## Alternatives Considered

### Stay zero-build

- Pros: no toolchain, no lockfile, no version churn; the pages keep working
  with no infrastructure at all.
- Cons: the shared module stays untestable, the charts stay hand-rolled, and
  the payload stays untyped.
- Rejected: the cost was no longer theoretical. Two real bugs had already
  shipped in code a unit test would have caught.

### A bundler without TypeScript

- Pros: solves charting and modules without a type system to satisfy.
- Cons: leaves the largest class of defect in the project — indexing a
  forty-field payload by string — completely unaddressed.
- Rejected: types were most of the reason to do this at all.

### Rewrite as a framework application immediately

- Rejected: it would have replaced the working pages before the replacement
  existed. See ADR-007 for why the current pages stay live.

## Consequences

- `npm run build` runs typecheck, unit tests, an SDK bundle budget and then the
  production build, in that order, so a type error is reported as a type error.
- A red build now freezes the dashboard's numbers, because the deploy publishes
  the build output. This is the trap ADR-002 exists to contain, and it is why
  the unit tests are written against the legacy script rather than against
  literals from one day's payload.
- The two map pages are **not** in the module graph. They are copied. Their
  SDK still comes from a CDN and they would still work if the build did not.
- The zero-build property is genuinely lost: there is now a toolchain to keep
  current, and `npm ci` is required to work on the project.
