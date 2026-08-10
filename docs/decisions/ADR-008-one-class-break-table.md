# ADR-008: One class-break table is the single source of truth for colour

## Status

Accepted

## Date

2026-08-09

## Context

How full a reservoir is, expressed as colour, appears in at least seven places:
the ArcGIS renderer, the MapLibre paint expression, the legend on both map
pages, the overview's ranking bars, its class breakdown, the trend chart bars,
the sparkline cards and the keyboard list dots.

These were once separate literals. They drifted. When the class-break table was
first ported to TypeScript it shipped a different RdYlGn palette — every class
one stop lighter — and reworded labels, and the snapshot test in place at the
time could not see it.

The ramp itself also changed: three classes became five, because in a drought
year most of the state falls under 50% and the old ramp painted Lake Powell at
34% and Meeks Cabin at 13% the identical red, flattening the map exactly where
the story is.

## Decision

`CLASSES` in `shared/reservoir-viz.js` is the only place class breaks, colours
and labels are written down. Everything else is **generated from it** — the
ArcGIS renderer, the MapLibre `step` expression, both legends, the chart bar
colours and the filter's SQL boundaries.

The ported `src/viz/classes.ts` is asserted equal to the legacy table value for
value by a unit test.

## Alternatives Considered

### A design-token file consumed by both

- Pros: cleaner in principle; not JavaScript-shaped.
- Rejected for now: it needs a build step to reach the two CDN-loaded map pages
  (see ADR-001 — they are deliberately *not* in the module graph). Worth
  revisiting when the unified shell removes that constraint.

### Let each surface pick its own colours from a shared palette

- Rejected. That is what produced the drift this decision exists to stop. The
  boundaries matter as much as the colours: a reservoir at 50.0% must land in
  the same class everywhere.

## Consequences

- **The ArcGIS colour ramp could not be expressed as a visual variable.** A
  `MapView` supports at most 8 stops on a colour visual variable, and five
  classes rendered as hard edges need ten. The map silently drew an
  SDK-simplified approximation of the table — with interpolation across
  boundaries that are supposed to be hard — and logged a warning nobody was
  reading. It is now a `UniqueValueRenderer` whose Arcade expression is
  generated from the same table: no stop limit, genuinely hard edges.
- Boundary semantics are pinned by test: 0 → "Under 25%", 24.99 → "Under 25%",
  25 → "25–50%", 50 → "50–75%", 75 → "75–90%", 90 → "Over 90%". The top class
  is **open-ended** — a reservoir can exceed its listed capacity, and 104% is
  "Over 90%", not off the end of the ramp.
- Two colours outside the table are allowed and named: `STALE_COLOR` for
  unknown values, and `STALE_ACCENT` for the late-data ring.
- The filter's dimmed colours are derived from the same table by a shared
  greyscale conversion, so both engines dim to the same grey.
- Two of the five class colours fail contrast **as text**. They are only ever
  drawn as fills with no text on them, so the fix belongs to any text placed on
  them, never to the ramp.
