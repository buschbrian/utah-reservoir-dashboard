# ADR-016: Make ArcGIS the primary application and keep legacy pages for comparison

## Status

Superseded by ADR-019

## Date

2026-08-10

## Context

ADR-007 kept ArcGIS and MapLibre as equal production engines while the typed
application was incomplete. The ArcGIS 5.1 map, Calcite shell, validated data
path, selection model, and responsive detail surfaces now exist. Treating the
MapLibre implementation as an equal product would duplicate each new filter,
chart, and interaction without improving the scientific data.

The data workspace also needs richer analytical behavior than the legacy
overview provides. ArcGIS Charts can query the same client-side feature layers
used by the application and supplies accessible interaction and export tools.

## Decision

1. `modern.html` and `overview.html` are the primary ArcGIS Maps SDK for
   JavaScript application surfaces. They are not labeled as previews.
2. New map, data, table, and chart work targets the ArcGIS application.
3. `index.html`, `maplibre/`, and `explore.html` remain available as legacy
   comparisons for regression research, demonstrations, and later writing.
4. The legacy pages do not need feature parity with the primary application.
5. Modern charts use ArcGIS Charts Components. The semantic HTML table remains
   the exact-value and assistive-technology equivalent.

## Alternatives considered

### Continue equal ArcGIS and MapLibre development

Rejected because it makes every product increment a two-engine migration. The
original comparison already served its purpose by exposing renderer-specific
mask behavior and remains available for future experiments.

### Remove the legacy pages

Rejected because their working examples and differences are useful evidence.
Keeping them costs little when they are explicitly outside the parity contract.

### Keep a separate charting library

Rejected for the modern workspace. A second chart runtime adds another visual,
accessibility, interaction, and export model. ArcGIS Charts aligns with the
primary SDK while the semantic table preserves a library-independent view.

## Consequences

- Documentation and navigation use the official product name, ArcGIS Maps SDK
  for JavaScript.
- MapLibre-specific defects can be scheduled separately from primary ArcGIS
  work.
- The ArcGIS application carries more SDK weight, so the existing bundle budget
  and browser checks remain release gates.
- Legacy URLs remain stable, but their user interface can diverge intentionally.
