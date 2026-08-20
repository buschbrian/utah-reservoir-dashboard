# ADR-068: Move the roster scope west, and decouple the opening box from it

- Status: Accepted
- Date: 2026-08-19
- Supersedes: the part of ADR-063 that pinned `ROSTER_SCOPE` to
  `utah-connected` and derived `MAP_BOUNDS` from `HUC6_BOUNDS`

## Context

ADR-063 gave the drawn scope and the roster scope different names for the
first time -- `DEFAULT_SCOPE` at 75 basins, `ROSTER_SCOPE` at the fourteen
that touch Utah -- because coverage moved west before the roster could follow
it. It named the day the roster caught up as the day this would need
revisiting: "`ROSTER_SCOPE` is a thing to move, and a test moves it."

R1 (`admit-awdb-west`) is that day. The AWDB-west candidate pool was measured
in `docs/WESTERN-RESERVOIR-ADMISSION.md` and reviewed candidate by candidate
in `docs/WESTERN-ROSTER-ADMISSION-REVIEW.md`: 137 admissible by the rules, of
which the owner excluded four (Lake Mead, already published and offered only
by a tool bug; Lemon Reservoir, CO, whose own source record contradicts
itself by 10x; Eden, WY and Fruitland Reservoir, CO, both refused dam
matches). Of the 133 that remained, Elkhead Reservoir was already on the
roster -- withdrawn from the payload for stale data, but never absent from
`admitted_reservoirs.json` -- so this change admits 133 new stations, all
keyed by station triplet (ADR-066).

Moving `ROSTER_SCOPE` to `DEFAULT_SCOPE` is what the plan
(`docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md`) calls "the coupling that
decides the order," and it has a consequence the plan named but did not
resolve: `src/viz/extent.ts` had `MAP_BOUNDS = expandBounds(HUC6_BOUNDS, 2)`,
and `extent.test.ts` asserted both that `HUC6_BOUNDS` equals the frozen
oracle's and that it equals the roster scope's own published box. Those two
assertions were compatible only while the roster stayed `utah-connected`.
Moving the scope and satisfying the second naively would have dragged
`MAP_BOUNDS` west with it -- from a 10-degree box to a 19-degree one -- which
breaks the actual contract ADR-044 wrote down: `MAP_BOUNDS` and `MAP_CENTER`
stay pinned to `shared/reservoir-viz.js` because they are where the retired
routes' saved links still resolve to, not a measurement that should track
whatever the roster happens to be today.

## Decision

**`ROSTER_SCOPE` moves to `DEFAULT_SCOPE`** (`watershed_scopes.py`): both name
`west-huc6`, the same 75 basins the maps already draw. `utah-connected` stays
registered and published in its own right -- 16 of the 137 R1 candidates land
inside it, and a reader holding an old link that names it must keep
resolving.

**`HUC6_BOUNDS` and `MAP_BOUNDS` are decoupled.** `HUC6_BOUNDS` stays what it
has always been -- the bounding box of whichever file `reference.json` names
as the roster scope's, recomputed and asserted in `extent.test.ts` -- and now
reads as the whole west because that is what the roster scope is. `MAP_BOUNDS`
stops being derived from it. It is its own constant, computed from a private,
frozen copy of the roster scope's box on the day it was still
`utah-connected` (`OPENING_SCOPE_HUC6_BOUNDS` in `extent.ts`), so its value is
unchanged: still `expandBounds([[-115.70611, 35.1088], [-105.62642,
43.45212]], 2)`, still equal to the frozen oracle's `MAP_BOUNDS`, still the
box the storage map opens on for a reader who has chosen no scope.

**The frozen-oracle parity test on `HUC6_BOUNDS` retires.** ADR-044's own
question -- is this a contract with something still running, or parity with a
page that no longer exists -- answers itself the same way here as it did for
the zoom envelope: `shared/reservoir-viz.js`'s `HUC6_BOUNDS` is a snapshot of
the roster scope from the day it was `utah-connected`, not a running page a
saved link resolves against. `MAP_BOUNDS` keeps its parity test; `HUC6_BOUNDS`
keeps only the tests that hold it to the *current* roster scope's published
file.

## Why this is safe

Two things the plan asked to be checked rather than assumed, both confirmed:

- **`NAVIGABLE_BOUNDS`, not `MAP_BOUNDS`, is what `constraints.geometry` reads
  on all three maps.** It already unions `expandBounds(DRAWN_BOUNDS, 1.1)`
  with `MAP_BOUNDS`, and `DRAWN_BOUNDS` already covers all 75 drawn areas.
  Where a reader may pan does not change.
- **Every newly published reservoir passes `withinRegion`.** `withinRegion`
  and `selectionTarget` clamp to `NAVIGABLE_BOUNDS`, so all 133 new stations
  --spanning Puget Sound to the Upper Sacramento -- are selectable and
  navigable even though `MAP_BOUNDS`, the *default opening* box, stayed at
  its pre-R1 size.

One geographic edge case surfaced in review and is recorded rather than
smoothed over: San Carlos Reservoir, AZ (Coolidge Dam) sits within 66 metres
of the Upper Gila / Middle Gila HUC-6 boundary by its reviewed dam point, and
within 10 metres of it by its published point -- both inside
`MIN_ASSIGNMENT_MARGIN_KM` (`huc.py`), so `describe()`'s divide-on-a-dam
fallback cannot resolve it either. Its stored `huc6` is set to the dam-point
assignment (Middle Gila), matching what `attach_watersheds` computes at
refresh time, and it is the one named exception in
`tests/test_huc.py::BOUNDARY_MARGIN_EXCEPTIONS`. This is a fact about a dam
built at a literal drainage divide, not a data fault.

## Consequences

- **The storage map's default opening view is unchanged** for a reader who
  has picked no state, region or area -- exactly the box it opened on before
  R1. The chooser (`src/data/opening-scope.ts`) is what a reader's actual
  choice narrows from there; `MAP_BOUNDS` is only its fallback.
- **The snow and drought maps' unscoped opening view widens with the roster**,
  because `drainageExtent()` reads `HUC6_BOUNDS` directly and that constant
  now spans the whole west. This is the answer open question 1 of the
  scoping plan named as "honest": those two pages have no ADR-044 contract of
  their own tying them to the pre-R1 box.
- **`connected_reservoirs.json` is renamed `admitted_reservoirs.json`** (D6 in
  the scoping plan), because "connected to Utah" and "the three areas that
  previously had no tracked reservoir" were both false the moment the file
  held a western roster.
- A future roster expansion (R2, the RISE-only west; R3, non-federal sources)
  that stays inside `west-huc6` needs no further move here. One that outgrows
  it -- a source outside regions 14-18 -- would need a new scope and a new
  record, the same way this one did.

## Alternatives Considered

### Let `MAP_BOUNDS` move with `HUC6_BOUNDS`

- Pros: one box, one source, no second frozen constant to maintain.
- Rejected: this is the exact failure ADR-044 already named and fixed once
  for the zoom envelope. `MAP_BOUNDS` is a contract with saved links a
  retired route still translates; a roster that grows west is not a reason
  those links should resolve to a different view.

### Keep `ROSTER_SCOPE` at `utah-connected` and publish the AWDB-west roster
under a second scope name

- Pros: no coupling to resolve at all.
- Rejected: `ROSTER_SCOPE` is specifically the scope the *box* is built from,
  and the box has to include every published reservoir or `withinRegion`
  starts refusing real ones. A second roster scope would need its own box,
  unioned with the first, which is `unionOfAreaBoxes` already built for the
  chooser -- reinventing it here for one purpose it already serves.

### Widen `MIN_ASSIGNMENT_MARGIN_KM` or otherwise special-case San Carlos out
of the boundary-margin guard generally

- Pros: no named exception to maintain.
- Rejected: the margin exists to catch exactly this shape of risk, and
  raising it for every reservoir because one dam happens to sit on a divide
  would blunt the guard for the next one. A named, documented exception is
  the same pattern the browser suite already uses for its two accepted axe
  violations.
