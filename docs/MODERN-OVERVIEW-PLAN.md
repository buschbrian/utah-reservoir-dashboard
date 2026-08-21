# Modern overview and visual theme

> **Historical implementation journal.** It records a slice of work as it
> was, and is not a description of current architecture — that is
> [`docs/architecture/`](architecture/README.md). See
> [`docs/history/README.md`](history/README.md).

**Status (2026-08-20): delivered.** `overview.html` is the production Storage
Charts workspace; `explore.html` is its compatibility redirect.

## Decision

Keep `explore.html` as a compatibility redirect to `overview.html`. The modern
map links from its header to that Vite/TypeScript entry, which shares the
validated reservoir loader, rollup rules, formatting and storage classes with
the map. This prevents a daily data refresh from becoming application source
and prevents the map, table and charts from calculating the same fact three
different ways.

## Visual direction

Use muted Southwest colors for interface surfaces and emphasis:

- sandstone `#f3eee6` and gypsum `#fffaf2` for light surfaces;
- juniper `#356b6f` for links, focus and the primary accent;
- terracotta `#a65d43` for secondary emphasis;
- charcoal `#2f342f` and sage-gray `#655f55` for readable text.

These colors are not a replacement for the storage ramp. Reservoir condition
is ordered quantitative data, so it keeps the tested storage classes, direct
percentage labels and an equivalent table. Any later ramp change needs
color-vision simulation, lightness-order checks and non-text contrast review.

## Incremental delivery

1. Move the overview link from the map canvas into the modern header.
2. Add the modern overview with shared scope, ArcGIS Charts, search, sort and a
   semantic data table. Redirect saved links from the earlier overview to this
   surface.
3. Extract shared modern navigation and theme primitives so the map and
   overview cannot drift.
4. Add drainage-area and seasonal charts from shared rollups, with a written
   summary and table for each visualization.
5. Add CSV export and URL-backed filters after the displayed values have
   browser and accessibility coverage.

Steps 1–5 are implemented. Search, drainage-area, and reporting filters now
cross-filter the KPI strip, six ArcGIS charts, and exact-value table. The
charts expose interactive inspection, and the workspace exports its filtered
table as a CSV file. Filter and display state is stored in the URL.
`explore.html` and the old map paths remain as compatibility redirects under
ADR-031. Their former implementations are no longer published.

## Control scope

Updated on 2026-08-15 after the chart workspace grew to six ArcGIS charts and
one interactive storage-level strip.

- The **Focus the analysis** row changes every KPI, chart, and table row.
- The storage-level strip is also a dashboard filter. It changes everything
  below the strip while continuing to show the full distribution allowed by
  the other filters.
- The **Chart display** row sits above the full chart grid. Its measure changes
  the largest-reservoir and 12-month charts. Its count and order settings say
  explicitly that they change only the largest-reservoir chart.
- No display setting is placed inside the first chart card when it also changes
  another chart.

The separate row avoids copying controls into six cards and avoids claiming
that a count or order setting applies to a chart that cannot use it.
