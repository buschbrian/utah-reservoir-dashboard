# Phase 2 execution plan

> **Historical implementation journal.** It records a slice of work as it
> was, and is not a description of current architecture — that is
> [`docs/architecture/`](architecture/README.md). See
> [`docs/history/README.md`](history/README.md).

**Status:** complete. The shell later moved to the root under ADR-019, and the
three comparison runtimes were retired to redirects under ADR-031. The
milestones below preserve the boundary Phase 2 used when it was built.

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

**Status:** Complete on 2026-08-10; corrected by ADR-013 on the same date.

**Work**

- Replace the ambiguous rollup option with explicit `geography` and
  `lakePowell` dimensions.
- Cover Utah, connected-area, and Lake Powell combinations with unit tests.
- Make the workbench labels state the selected scope exactly.

**Acceptance**

- Utah totals contain records whose waterbody has `intersects_utah: true`.
- Lake Powell inclusion changes only the Lake Powell record.
- Every rollup call site supplies both dimensions.
- Focused tests, the full Vitest suite, and TypeScript checks pass.

### P2.2 — Shell skeleton and states

**Status:** Complete on 2026-08-10.

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

**Implementation note:** The shell vendors only the Calcite icons and English
messages it uses (under 200 KiB), so privacy tools that block the public asset
CDN do not leave navigation controls blank. Browser smoke automation and the
real-entry bundle budget remain P2.4 work.

### P2.3 — Current map parity

**Status:** Complete on 2026-08-10.

**Work**

- Fetch and validate `reservoirs.json` and `huc6.geojson` at runtime.
- Draw the Utah mask, drainage-area outlines, and reservoir points from local
  committed data.
- Derive colours and sizes from the existing typed visualization modules.
- Add basic pointer and keyboard selection with a concise detail summary.
- Keep optional layer failures independent so reservoir points still render.

**Acceptance**

- The readiness signal reports every reservoir drawn for the selected Utah
  waterbody scope, excluding Lake Powell.
- Each point has the current class colour and shared size basis.
- Selecting a reservoir exposes its name, percent full, data date, source, and
  whether its data is late.
- A missing boundary file does not remove reservoir points.

**Implementation note:** Both halves of selection are wired, and they are not
the same control. The pointer half is a map hit test; the keyboard half is a
list of real buttons in the storage summary, because a canvas cannot be tabbed
through and `hitTest` never settles in a hidden browser pane — so the list is
also the only selection path automation can exercise. The readiness signal
gained `drawn`, `late`, `basemap`, `drainageAreas`, `listItems` and `selected`;
no existing field changed. The browser smoke test that reads them is P2.4.

### P2.4 — Integration gates

**Status:** Complete on 2026-08-10.

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

**Implementation note:** The credential-prompt assertion found a real gap
rather than confirming one. Refusing the preferred basemap's style with 401
left `Basemap.load()` resolving happily, so the fallback never engaged and the
page kept a background that could not draw. Candidates now carry an optional
`verify` step — `loadAll()` for a basemap — and a refused style is an ordinary
candidate failure. Removing the anonymous-auth policy makes the same test fail
with a password field, which is what makes it worth having.

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
