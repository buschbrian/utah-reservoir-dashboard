# ADR-012: Build the Phase 2 shell beside the production pages

## Status

Accepted.

## Date

2026-08-10

## Context

The modernization plan previously said that Phase 2 would replace
`index.html`. The repository now has a safer boundary: `modern.html` is a Vite
entry for typed ArcGIS 5.1 and Calcite 5 work, while `index.html`,
`maplibre/index.html`, and `explore.html` remain published production views.

Phase 2 also accumulated controls, charts, tables, animation, and state work
that are assigned to later phases. Replacing the production entry while all of
that is incomplete would make the shell milestone too large to verify or
reverse cleanly.

## Decision

Build Phase 2 at `modern.html`. Do not replace or redirect `index.html` during
this phase. Production cutover is a separate consolidation decision after the
new shell passes its acceptance gates.

The shell uses vanilla TypeScript with ArcGIS and Calcite web components. It
does not introduce React or another application framework. Runtime map data
comes from the committed `reservoirs.json` and `huc6.geojson` files; live
feature services can support discovery but are not required to render the
dashboard.

Phase 2 includes:

- the responsive Calcite application shell;
- loading, empty, and error states;
- the current reservoir points, drainage-area boundaries, Utah mask, class
  colours, and basic selection;
- desktop panels and defined mobile sheets;
- light and dark modes; and
- placeholders for controls and analysis owned by later phases.

Phase 2 does not include the new CIM effects, complete filtering and URL state,
production charts, rankings, CSV export, or replacement of the legacy pages.

## Alternatives Considered

### Replace `index.html` during Phase 2

- Pros: the new work reaches the primary URL sooner.
- Rejected: it couples shell construction to production migration and removes
  a known-good fallback before feature parity is proven.

### Introduce React now

- Pros: a familiar state and component model for a later complex interface.
- Rejected: Calcite and ArcGIS already provide web components, and Phase 2
  does not yet have state complexity that justifies another rendering layer.
  A later ADR can supersede this decision if measured complexity warrants it.

### Render from a live Reclamation feature service

- Pros: provider geometry can update without a repository change.
- Rejected: it makes normal rendering depend on a service that is not the
  authoritative source for all published measurements and weakens the
  reproducible, data-only deployment contract.

## Consequences

- The existing production URLs and browser contract remain unchanged while
  Phase 2 is built.
- The new shell can land in small, testable increments without exposing an
  incomplete replacement.
- A separate smoke contract must cover `modern.html`; it supplements rather
  than replaces the production smoke tests.
- The SDK bundle budget will switch from its fixture to the real shell entry
  once the map slice exists, with a deliberate new baseline.
- The no-credential policy must be installed before map or layer construction,
  and Phase 2 must prove that behavior end to end.
