# ADR-053: Scope the west by where the water goes, not by longitude

## Status

Accepted

## Date

2026-08-18

## Context

The three western scopes were first registered over hydrologic regions 10
through 18 — every region whose land lies in the western United States. That
rule reads naturally on a map and is wrong about the subject. Regions 10
through 13 are western in longitude and eastern in hydrology: the Missouri and
the Arkansas leave through the Mississippi, Texas-Gulf drains to the Gulf of
Mexico directly, and the Rio Grande reaches it at Brownsville. None of that
water is this product's subject.

## Decision

The western scopes cover regions 14 through 18 only: Upper Colorado, Lower
Colorado, Great Basin, Pacific Northwest and California — everything draining
to the Pacific, including the Colorado through the Gulf of California, plus
the Great Basin, which reaches nothing. `WEST_REGION_WHERE` in
`watershed_scopes.py` is the one place the rule is written, and a test asserts
it from the committed files rather than from the clause, so a refetch that
quietly widened the scope fails.

One case is excluded knowingly: HUC4 1305, "Rio Grande Closed Basins", is
Basin and Range country whose water reaches no ocean, filed under a region
that does. It is administered as part of the Rio Grande system, and one closed
basin inside an excluded region is a footnote rather than a rule. If it is
ever wanted it is one added clause.

## Consequences

Two thirds of the registered geography leaves:

    west-huc4   110 ->  44 units
    west-huc6   181 ->  75 units
    west-huc8  1247 -> 571 units

    committed geometry  31 MB -> 13 MB

Nothing published moves — `utah-connected` is entirely regions 14, 15 and 16.
The western roster measures as 68 tracked plus 124 capacity-admissible
candidates, not 68 plus 232; Fort Peck Lake and Canyon Ferry are Missouri
River water and are gone from it.

**This corrects counts stated in two earlier records rather than reversing
either decision.** [ADR-047](ADR-047-let-the-label-engine-place-drainage-names.md)
says the western scope is "181 drainage areas at HUC-6 and 1,247 at HUC-8",
and [ADR-050](ADR-050-the-drawn-level-is-the-scopes-not-the-views.md) says
pointing the default scope at `west-huc6` draws 181 areas. Both were true when
written, under the longitude rule; the committed files those statements now
describe hold 75 and 571 units, and a `west-huc6` default scope draws 75.
Both records stand as written — the label-engine argument only strengthens at
smaller counts, and ADR-050's mechanism never depended on the number.

## Related

- Corrects counts in [ADR-047](ADR-047-let-the-label-engine-place-drainage-names.md)
  and [ADR-050](ADR-050-the-drawn-level-is-the-scopes-not-the-views.md), the
  way [ADR-049](ADR-049-stop-publishing-the-drainage-polygons.md) corrected
  ADR-048.
- The scopes remain `published=False`; nothing a reader sees changes until a
  later record flips one.
