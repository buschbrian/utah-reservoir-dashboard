# ADR-071: One drainage-area control to a page

## Status

Accepted

## Date

2026-08-21

## Context

Slice S4 (`docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md`) added the where
control: four selects — state, region, subregion, drainage area — built from
the published roster and wired into all three map pages. It was the right
control and it was added to two pages that already had one.

The storage panel has carried `[data-filter="drainage"]` since long before
S4, labelled **Drainage area**. The snow filter bar has carried `#snow-area`,
labelled **Drainage area**. S4 appended a fourth select labelled **Drainage
area** into each of those same two control groups. On the snow page the two
sit adjacent in one row.

That is AGENTS.md invariant 8 read backwards. The invariant says a term that
names two things gets two names; here one term named one thing twice, with
two different answers about what could be chosen.

**They are not two questions.** On snow, both controls write `?area=`.
`payloadForOpeningScope` already documents the division — it skips its own
narrowing whenever the code names one of the drawn level's own areas exactly,
"because this page's own drainage-area picker already narrows precisely to a
code like that". On storage, `?area=` is the legacy spelling of `?drainage=`
in `state/url.ts`, and the S3a wiring deliberately leaves `?area=` to the
existing filter rather than narrowing the roster with it (decision D5: on this
page the drainage areas are context, not the subject). So on both pages a
drainage-area pick reaches the same place whichever of the two controls makes
it.

**The lists were not the same, and the shared one was the wrong list.** The
page-owned controls are built from what the page actually draws.
`basinChoices` filters to areas with a publishable figure and prints each
one's site count; `drainageAreaChoices` offers the areas the map currently
holds, plus the coarser code a link opened on. The where control is built from
the published roster, which is a different set: **24 of the 75 published
basins hold no snow measurement site at all.** Choosing one of those from the
snow page's area axis narrows the payload to nothing and leaves the reader on
an empty page — the exact failure `basinChoices` names in its own comment as
the reason it filters ("a picker holds a choice that changes nothing").

**And the shared axis was at the wrong width on snow.** Its options are always
six-digit basins, while the snow page groups at `?level=` (ADR-064).
At level 4 `areaAtLevel` coarsens whatever basin is picked back to its
subregion, so the axis was already a subregion picker wearing a basin's name.

## Decision

**A page shows one control per drainage-area question, and it is the page's
own.** `createWhereControl` takes a `finest` option naming the last axis to
build; every coarser axis is built and nothing finer is. The rule is one line:
**the shared control stops one step above the page's own picker.**

| Page | Its own picker offers | `finest` | The where control offers |
|---|---|---|---|
| Storage | basins the map holds, and a coarser linked code | `subregion` | state → region → subregion |
| Snow, level 6 | basins with a publishable snow figure | `subregion` | state → region → subregion |
| Snow, level 4 | subregions with a publishable snow figure | `region` | state → region |
| Drought | — | `area` (default) | state → region → subregion → drainage area |

Drought keeps all four because it owns no drainage-area control of its own:
`?area=` filters the drought map and opens the row it names (decision D4), and
this axis is the only way a reader reaches one area there.

`offeredAxes` — the prefix rule — lives in `where-control-model.ts`, the pure
half, so a Node test can call it. It is a **prefix and never a subset**: each
axis's options are `resolveOpeningScope`'s answer under the axes above it, so
a basin select with no subregion select above it would offer whichever basins
the last link happened to narrow to, with no way for a reader to change or see
the reason for that narrowing.

**No visible text changes.** Nothing is renamed, so ADR-006's vocabulary is
untouched and invariant 6's rule for a terminology change does not apply. What
changes is how many controls a page builds.

**`openingAreaCleared` is untouched.** The snow page's "The whole region"
option, and the rule that only a real `change` event — never the programmatic
`area.value` assignment — counts as a reader clearing a coarser linked
`?area=`, are exactly as they were. Removing the shared axis rather than the
page's picker is what makes that possible: the clearing path a shared `?area=14`
link depends on is the picker's, and it keeps working because the picker keeps
working.

## Alternatives considered

**Remove `#snow-area` and keep the shared control.** Rejected — it is the
control that cannot do the job. It would have to grow snow-gating, level
following, site counts in its labels, and an in-page update path instead of a
navigation, at which point it is `#snow-area` with a different file name and
three other pages depending on it. It would also cost the `openingAreaCleared`
clearing semantics: the shared control's "All drainage areas" falls back to the
subregion, deliberately (`nextSelectionForArea`), so it has no way to say
"nothing at all" — which is the one thing a reader who arrived on a coarse
`?area=14` link needs to say.

**Keep both and rename one.** Rejected on its own terms. Renaming visible text
is a vocabulary change under ADR-006, and it would buy two names for a
distinction the parameter does not make: both controls write `?area=` and both
reach the same filter. Two names for one thing is the mirror of the invariant,
not a repair of it. It would also leave the empty-page defect standing, which
is the half of this that is a bug rather than a wording problem.

**Make the shared axis read the page's list.** Rejected. It is a shared
control across three pages with three different rules about what the area axis
means (D5) — that is why changing it is a navigation and not a re-render. A
`choices` callback threaded through it would put all three rules back inside
one control, which is what the S4 design avoided.

**Drop the axis from the shared control everywhere.** Rejected: drought needs
it and has nothing else.

## Consequences

Storage and snow each show three place selects where they showed four; drought
still shows four. No page loses a reachable choice: every basin the storage map
holds is in `[data-filter="drainage"]`, and every area the snow page can draw a
figure for is in `#snow-area`. The choices that do disappear from the snow page
are the 24 published basins it holds no measurement site for, which is a repair
rather than a loss.

A saved link is unaffected. `?state=`, `?area=` and `?drainage=` are read and
written exactly as before, including a link naming a basin the shared control
no longer offers — the page's own picker carries it, or `payloadForOpeningScope`
coarsens it, exactly as it already did.

The snow filter bar and the storage panel each lose a row, which is what the
browser suite measures at 1280, 390 and 360. That suite now asserts the axes
each host builds by name, and asserts that no two controls in the group the
where control joins carry the same visible label — the invariant-8 check that
would have caught this when S4 landed.

## Related

- Extends [ADR-064](ADR-064-offer-two-levels-and-let-the-reader-choose.md):
  the snow page's own picker follows `?level=`, so what the shared control
  must stop above follows it too.
- Rests on [ADR-011](ADR-011-separate-location-scope-from-lake-powell.md)'s
  distinction between a filter and a scope, and on the storage panel's
  existing division between the two — this record settles which *control*
  asks the question, not what the answer means.
- Supersedes nothing. Slice S4 is recorded in
  [`docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md`](../OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md),
  a journal rather than a decision record; it is left as written.
