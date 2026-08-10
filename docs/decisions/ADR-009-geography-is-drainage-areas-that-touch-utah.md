# ADR-009: The dashboard's geography is drainage areas that intersect Utah

## Status

Accepted

## Date

2026-08-10

## Context

The watershed work raised a question it could not settle: which reservoirs
belong on a Utah dashboard?

Four of the fifteen drainage areas that touch Utah have no tracked reservoir,
and the plan named five Reclamation candidates to fill them — Blue Mesa,
Morrow Point, Crystal, Navajo and Fontenelle.
`tools/audit_connected_reservoirs.py` checked all five against the admission
criteria and found that **the candidate list and the geography rule are
different sets**:

| Candidate | Capacity | Drainage area | Touches Utah |
|---|---|---|---|
| Blue Mesa | 748,430 af | 140200 Gunnison (CO) | no |
| Morrow Point | 117,190 af | 140200 Gunnison (CO) | no |
| Crystal | 25,236 af | 140200 Gunnison (CO) | no |
| Navajo | 1,708,600 af | 140801 Upper San Juan (AZ, CO, NM) | no |
| Fontenelle | 334,411 af | 140401 Upper Green (CO, UT, WY) | **yes** |

Every one has an observed storage series and a traceable capacity. Four fail
on geography alone. The list comes from Reclamation's *Upper Colorado
operating region*; the dashboard's rule is *drainage areas that intersect
Utah*. Blue Mesa's water reaches Lake Powell, but the Gunnison basin never
enters the state.

## Decision

**Keep the intersect-Utah rule.** A site belongs on this dashboard when its
dam or outlet point falls inside one of the fifteen six-digit hydrologic units
whose published `states` field includes Utah.

## Alternatives Considered

### Widen to "anywhere upstream of Utah"

- Pros: it captures the water that actually arrives here. Blue Mesa and Navajo
  are large and genuinely relevant to Lake Powell.
- Cons: it is a much larger set than five reservoirs, it changes every
  statewide total on the page, and "upstream" has no natural boundary short of
  the whole Upper Colorado basin. It also needs a different sentence in the
  methods text than the one there now.
- Rejected. The current rule is one a reader can check on a map, and the page
  says what it means.

### Keep the rule but hand-add the five anyway

- Rejected as the worst of both: the totals change, and the stated rule stops
  describing what is on the page.

## Consequences

- **Fontenelle is admissible and is not yet added.** It qualifies on all four
  criteria (RISE item 347, 334,411 acre-feet from NID WY01389, dam in Upper
  Green). Adding it is a separate, deliberate step because it moves the
  statewide totals.
- **The four empty drainage areas stay empty**, and none of the five
  candidates would have filled them. Why each is empty is a separate question
  and is not answered by the Reclamation list.
- The rule is already enforced in code: `huc.py` assigns against the committed
  fifteen units, and a site outside all of them gets no drainage area rather
  than a guessed one.
- `in_utah` remains a **different** field from the drainage area, and stays
  computed from the reservoir's own point (ADR-005). The rule here is about
  which sites are tracked; `in_utah` is about where a tracked site sits.
