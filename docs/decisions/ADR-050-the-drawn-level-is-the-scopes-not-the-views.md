# ADR-050: The drawn level is the scope's, not the view's

## Status

Accepted

## Date

2026-08-17

## Context

The western expansion plan called for driving hydrologic level from view
scale — HUC-4 wide, HUC-6 regional, HUC-8 close — on the precedent of the
label ladder in `viz/label-scales.ts` (ADR-035). The motivation was sound:
1,247 HUC-8 subbasins drawn at once is not a map, and a ladder makes the count
on screen follow the viewport instead of the scope.

It is also technically available. Measured against the hosted service with the
published fourteen-area scope:

| level | clause | units |
|---|---|---:|
| HUC-4 | `huc4 IN (…)` from the distinct four-digit prefixes | 11 |
| HUC-6 | `huc6 IN (…)`, the scope itself | 14 |
| HUC-8 | `SUBSTRING(huc8, 1, 6) IN (…)` | 92 |

Both cross-level forms work. `SUBSTRING` is supported and is less than half
the clause length of the `LIKE` alternative (152 characters against 318).

**What does not work is the meaning.** On every surface here a drainage area
carries a number, not just an outline:

- the storage map's hover answers with the storage banked in the area,
- the drought map's with the area's coverage share and its storage,
- the snow map fills each area by its percent of normal,
- and each reservoir's own `huc6` is what joins it to any of them.

All of those are six-digit facts. Drawing HUC-8 at close zoom would put 92
shapes on the map that **no figure on the page describes**: hover an outline
and the card has nothing to say, because `areaStorage` has never heard of a
subbasin. A ladder that changes what the reader can point at, without changing
what the site can answer, is worse than no ladder — it looks like more detail
and is less information.

Rolling the numbers up to HUC-4 would be honest arithmetic — storage sums,
coverage is area-weighted — but that is a data-model change, not a rendering
one, and it belongs with the payload work rather than here.

## Decision

The level the maps draw is the level the published scope declares. It is read
from `reference.json`, where `geography.watersheds.scopes.<scope>.level`
already records it, and travels to the maps as `DrainageScope { level, areas }`
so that neither half can arrive without the other.

The client no longer names a level anywhere. Four hard-coded `level: 6` are
gone, and `parseDrainageUnits` reads each code from the attribute the level
names — `huc4` for a HUC-4 scope — the same rule `watershed_scopes.py` applies
writing it. Reading a fixed `huc6` from a HUC-4 payload yields no areas at
all, which is a blank map rather than an error, and this project has been
caught by that shape of failure enough times to test for it.

`JOINABLE_LEVEL = 6` names, in one place, the level every figure is keyed at.
A published scope at another level draws its areas and says out loud that its
numbers will not join, rather than presenting empty hover cards as if they
were the answer.

## Consequences

Publishing a different geography is now a payload change rather than a code
change, which is what the expansion plan asked for. Point the default scope at
`west-huc6` and the maps draw 181 areas at level 6 without a line of
TypeScript moving.

`window.__dashboardReady.drainageLevel` reports the size actually drawn, and
the browser suite asserts it is 6. That is the guard against a scope change
that quietly draws the wrong size — invisible in a screenshot, since one
drainage outline looks much like another.

A ladder is not ruled out forever. It becomes available the moment the figures
exist at more than one level, and that is the order these have to happen in:
the numbers first, the rendering second. Doing the rendering first is how a
map ends up confidently wrong rather than visibly incomplete.

## Related

- Builds on [ADR-018](ADR-018-reference-data-ships-as-one-versioned-export.md):
  which geography this site draws is the export's answer to give, and the size
  of it is part of that answer.
- [ADR-035](ADR-035-a-label-ladder-tied-to-containment.md) is the ladder this
  deliberately does not copy. Labels can appear and disappear with scale
  because a label makes no claim the page cannot support; an outline that
  invites a hover does.
- [ADR-048](ADR-048-publish-the-roster-not-the-polygons.md) is what made the
  level a payload fact rather than a property of a committed file.
