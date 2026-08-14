# ADR-029: The table narrows where the map dims

## Status

Accepted

## Date

2026-08-14

## Context

The primary application expresses one filter on three surfaces. The map greys
excluded reservoirs and keeps drawing them; the reservoir list in the storage
summary dims their rows and leaves them operable. Phase 5 adds a fourth: a
sortable table under the map, with a CSV export that Phase 5 requires to
contain "exactly the rows on screen".

Those two rules cannot both hold on the table. If the table dims excluded rows
the way the list does, they are interleaved through whatever order the reader
just sorted into, and the export either writes rows the reader did not ask for
or stops matching the rows on screen.

The reason the map dims rather than hides is specific to a map: removing a
circle removes the geography around it, and the reader loses the ability to
read one basin against the state. A table has no geography to lose. A row
removed from a table is not context removed, it is a row that is not part of
the answer.

## Decision

**The table lists the reservoirs the filter matches, and says how many of how
many.** The map and the list keep dimming.

The obligations that made dimming right elsewhere are met by the surfaces that
already meet them:

- The keyboard path to every reservoir on the map is the reservoir list, which
  keeps excluded rows focusable and operable.
- ADR-020's reachability is a property of the scope controls, not of the
  filter. Every published reservoir remains reachable by clearing the filter,
  which the panel offers as one control.
- The count is always stated. A table holding 12 of 51 rows says so, so it can
  never be mistaken for a dashboard that lost 39 reservoirs.

The export writes the same `TableRow[]` the renderer was handed. There is no
second query, so "the file is the rows on screen" is a property of the
construction rather than a promise two code paths have to keep.

## Alternatives Considered

### Dim excluded rows in the table too

- Pros: one rule for every surface, nothing to explain.
- Rejected: it defeats sorting, which is the table's reason to exist, and it
  forces the export to choose between the reader's filter and the reader's
  screen.

### Filter the map as well, so every surface narrows

- Rejected: it discards what dimming is for. The drainage-area filter is
  deliberately a filter and not a scope (ADR-011) precisely so one basin is
  read against the state rather than instead of it.

### Export everything in scope regardless of the filter

- Rejected. The button sits under a table showing twelve rows. A file with
  fifty-one in it is a different answer from the one the reader is looking at.

## Consequences

- The table can be empty, which the map and the list cannot be. It says so in
  words rather than rendering an empty frame.
- `tableRows` is published in the readiness signal separately from `shown`.
  They agree today, and the point of two fields is that a change making them
  disagree is caught rather than assumed away.
- Anything added to the bottom row later — a ranking chart, sparklines — has
  this decision already made for it: the row shows what the filter matched.
