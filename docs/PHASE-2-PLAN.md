# Phase 2 execution plan

Phase 2 builds the ArcGIS 5.1 and Calcite 5 dashboard at `modern.html`. The
three production views remain unchanged until a later cutover decision. See
[ADR-011](decisions/ADR-011-separate-location-scope-from-lake-powell.md) for
rollup scope and
[ADR-012](decisions/ADR-012-build-phase-2-beside-production.md) for the
application boundary.

## Outcome

A reader can open `modern.html` at desktop or phone width, see every published
reservoir in the selected scope on a responsive map, select one reservoir, and
understand whether data is loading, unavailable, or late. The page never asks
for ArcGIS credentials. Existing production pages continue to work.

## Scope

Phase 2 includes the shell, current map parity, basic selection, responsive
panel behavior, theme support, and robust loading and failure states. Later
phases own advanced symbol effects, complete filters and deep links, charts,
rankings, tables, CSV export, and final production consolidation.

## Milestones

### P2.1 — Scope contract and workbench copy

**Status:** Complete on 2026-08-10.

**Work**

- Replace the ambiguous rollup option with explicit `geography` and
  `lakePowell` dimensions.
- Cover Utah, connected-area, and Lake Powell combinations with unit tests.
- Make the workbench labels state the selected scope exactly.

**Acceptance**

- Utah totals contain only records with `in_utah: true`.
- Lake Powell inclusion changes only the Lake Powell record.
- Every rollup call site supplies both dimensions.
- Focused tests, the full Vitest suite, and TypeScript checks pass.

### P2.2 — Shell skeleton and states

**Work**

- Add the Calcite shell, navigation, start panel, end panel, and map region.
- Install the anonymous-auth policy before constructing any map or layer.
- Add loading, empty, data-error, map-error, and unsupported states.
- Keep analysis controls as clearly labelled placeholders.

**Responsive contract**

| Width | Initial behavior |
|---|---|
| 1280 px | Start panel open; detail panel closed until selection; map controls remain unobstructed. |
| 390 px | Panels open as dismissible sheets; map and zoom controls retain a clear touch lane. |
| 360 px | Same behavior as 390 px; no horizontal page scroll and no clipped navigation actions. |

The theme starts from the reader's system preference, can be changed in the
navigation, and persists locally. Reduced-motion preferences disable shell
transitions.

**Acceptance**

- Keyboard focus follows navigation, controls, map alternative, and details in
  reading order.
- Loading and errors are visible text, not console-only failures.
- No tested width scrolls horizontally or overlaps map controls.
- Existing production smoke tests remain green.

### P2.3 — Current map parity

**Work**

- Fetch and validate `reservoirs.json` and `huc6.geojson` at runtime.
- Draw the Utah mask, drainage-area outlines, and reservoir points from local
  committed data.
- Derive colours and sizes from the existing typed visualization modules.
- Add basic pointer and keyboard selection with a concise detail summary.
- Keep optional layer failures independent so reservoir points still render.

**Acceptance**

- The readiness signal reports every published reservoir drawn for the
  connected scope.
- Each point has the current class colour and shared size basis.
- Selecting a reservoir exposes its name, percent full, data date, source, and
  whether its data is late.
- A missing boundary file does not remove reservoir points.

### P2.4 — Integration gates

**Work**

- Add a `modern.html` browser smoke test at 1280, 390, and 360 pixels.
- Assert no credential or password prompt exists, including inside open shadow
  roots, when the first basemap choice fails.
- Replace the SDK budget fixture with the real shell entry and record the
  intentional baseline.
- Verify that a data-only commit triggers a deployment without requiring an
  application source change.

**Acceptance**

- Unit, Python, build, production smoke, and modern-shell smoke checks pass.
- Browser runs have no unexpected console errors.
- The basemap fallback renders without a credential prompt.
- The emitted SDK bundle stays within the recorded budget.

## Cutover is not part of Phase 2

Moving the unified shell to `index.html` requires a later review of feature
parity, accessibility, performance, rollback, and the future roles of the
legacy ArcGIS page and `explore.html`. Passing Phase 2 proves the shell; it does
not authorize that migration.

## Deferred work that does not block Phase 2

- Validation of the remaining connected-reservoir candidates
- Snowpack and drought context
- MapLibre 6 migration
- Advanced CIM symbols, bloom, and animation
- Production charts, rankings, sparklines, tables, and CSV export
- Complete filter state, time animation, and deep links
- 3D and deck.gl experiments
