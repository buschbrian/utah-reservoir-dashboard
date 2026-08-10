# Modern overview and visual theme

## Decision

Keep `explore.html` unchanged as the legacy comparison. The modern map links
from its header to `overview.html`, a new Vite/TypeScript entry that shares the
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
2. Add the modern overview with shared scope, a capacity chart, search, sort
   and a semantic data table. Keep the legacy overview linked for comparison.
3. Extract shared modern navigation and theme primitives so the map and
   overview cannot drift.
4. Add drainage-area and seasonal charts from shared rollups, with a written
   summary and table for each visualization.
5. Add CSV export and URL-backed filters after the displayed values have
   browser and accessibility coverage.

The first two steps are the initial implementation. They deliberately avoid
changing `explore.html` or the legacy map pages.
