# ADR-011: Separate reservoir location from Lake Powell inclusion

## Status

Accepted.

## Date

2026-08-10

## Context

The dashboard now tracks reservoirs outside Utah when their drainage areas
connect to Utah through the Colorado River or Great Basin systems. Four of the
54 published reservoirs are currently outside the state. The existing typed
rollup has only an `excludeLakePowell` option, and the development workbench
labels that result as "Utah without Lake Powell."

That label used to be a useful shorthand, but it is no longer a geographic
rule. Excluding one large reservoir does not exclude Bear Lake, Fontenelle,
Woodruff Narrows, or Meeks Cabin. It also hides two independent questions:

1. Is the dam or outlet point in Utah?
2. Is Lake Powell included in this total?

Phase 2 needs stable answers before KPI cards, filters, charts, exports, and
deep links start sharing state.

## Decision

Every statewide rollup has two explicit dimensions:

- `geography`: `utah` includes records whose dam or outlet point has
  `in_utah: true`; `connected` includes every published reservoir.
- `lakePowell`: `include` or `exclude`, applied independently of geography.

The unified dashboard starts with **Utah reservoirs without Lake Powell**.
The connected-area comparison includes every published reservoir by default.
Visible labels must state both choices when Lake Powell is excluded; neither
"Utah" nor "without Lake Powell" can stand in for the other.

The typed rollup requires both dimensions from callers. It has no implicit
default. UI state can have defaults, but the arithmetic interface must make
the scope visible at every call site.

## Alternatives Considered

### Keep `excludeLakePowell` as the only option

- Pros: no interface change.
- Rejected: it produces totals that include connected out-of-state reservoirs
  while presenting them as Utah totals.

### Treat all connected reservoirs as "Utah reservoirs"

- Pros: one headline number and one filter.
- Rejected: hydrologic relevance and physical location are different facts.
  The published `in_utah` field exists specifically to preserve that
  distinction.

### Remove the Lake Powell comparison

- Pros: the scope model becomes smaller.
- Rejected: Lake Powell is large enough to dominate a combined storage total.
  The comparison remains useful when its label is exact.

## Consequences

- The default Phase 2 headline contains 49 current records: the 50 records in
  Utah less Lake Powell. This count can change as the published inventory
  changes; tests derive it from record fields rather than hard-code it.
- Connected totals can include out-of-state reservoirs without mislabelling
  them as being in Utah.
- Lake Powell remains a deliberate comparison control instead of an accidental
  geographic filter.
- Existing production pages keep their current behavior until the Phase 2
  cutover. This decision first applies to typed modules and the new shell.
