# ADR-007: Keep two rendering engines, and keep the old pages live

## Status

Superseded by ADR-016

## Date

2026-08-09

## Context

The project renders the same 53 reservoirs twice: once with the ArcGIS Maps SDK
for JavaScript, once with MapLibre GL JS and CARTO. Maintaining two maps is an
obvious cost, and it needs a reason.

There is also a second, related question. A unified dashboard on ArcGIS 5.1 and
Calcite 5 is being built. Do the three current pages get replaced now?

## Decision

1. **Keep both engines.** The MapLibre page is a genuine parity comparison, not
   a leftover.
2. **Keep the current pages live** until the unified shell actually replaces
   them. Their URLs are the production contract.
3. **Everything that is not engine-specific lives in
   `shared/reservoir-viz.js`** and is loaded by all three pages.

## Alternatives Considered

### One engine

- Pros: half the map code; no cross-engine bugs.
- Rejected because the comparison keeps paying. It is what caught the
  antimeridian mask inversion — a ring spanning -180…180 renders correctly in
  MapLibre and *inverts* in the ArcGIS SDK, dimming Utah instead of its
  surroundings. One engine would have shipped that as "the mask looks wrong".

### Leaflet as the open-source comparison

- Rejected as not a fair test. Leaflet is a raster/DOM renderer; the ArcGIS SDK
  is a WebGL vector renderer. MapLibre is WebGL vector, so the comparison
  measures the engines rather than their rendering models.

### Replace the pages with the new shell as it is built

- Rejected. The shell is several phases away and these are the pages people are
  using now. Interaction work (hover, filtering, the month slider, deep links,
  keyboard access) has therefore been pulled forward onto the current pages
  rather than held back for a rewrite.

## Consequences

- **The shared module is load-bearing.** Class breaks, popup markup, the trend
  chart, the legend, the status wording, the Utah mask geometry, the selection
  store and the statewide rollup all live there. They were duplicated by hand
  once and had already drifted, which made the comparison partly a measurement
  of copy drift.
- The MapLibre page is also the **Esri-outage fallback**, and `explore.html`
  loads no map SDK at all, so it survives a CDN failure entirely.
- Engine differences are recorded rather than smoothed over — they are the
  output of this arrangement. Two examples worth keeping:
  - MapLibre hit-tests itself: a `mousemove` bound to a layer id only fires
    over that layer and already carries the feature, so hover needs no
    throttle. ArcGIS needs a coalesced `hitTest` on `pointer-move`.
  - Popups: the ArcGIS SDK owns its popup, so the page stays out of its way;
    MapLibre has none, so the page owns the whole lifecycle.
- **Parity has to be asserted, not hoped for.** Both pages report a readiness
  signal that the browser smoke test checks field by field, and a signal that
  reports two different facts from the same expression is worse than no signal
  — that is how the Utah mask was deleted for several commits without a test
  noticing.
