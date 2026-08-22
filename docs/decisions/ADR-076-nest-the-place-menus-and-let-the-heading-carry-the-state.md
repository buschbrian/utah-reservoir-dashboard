# ADR-076: Nest the place menus and let the heading carry the state

- Status: Accepted
- Date: 2026-08-21

## Context

The storage map's place control offers four selects -- state, region level,
subregion, drainage area -- that narrow each other correctly and say nothing
about how they nest. Nothing on screen tells a reader that a subregion lives
inside a region or a basin inside a subregion; the hierarchy is knowledge the
reader brings or lacks. The storage charts' filter bar had the same shape plus
a fifth select whose 157 county options were narrowed by nothing at all, so
choosing California still offered every county from eleven states.

The county rows also carried a suffix no other control needed: **"Summit
County, CO"** beside "Summit County, UT", which [ADR-058](ADR-058-assign-the-county-from-the-water-not-the-dam.md)
required because a flat list cannot hold two of the same name. Measured
against the current roster, seven county names span more than one state
(Summit, San Juan, Lincoln, Carbon, Washington, Garfield, Lake), so the suffix
was doing real work -- in the least readable way available: state repeated as
punctuation on every row of 157.

Three shapes were considered for showing the hierarchy:

- **Flyout submenus** -- rejected by measurement. At 360 px, where these pages
  are tested, a submenu holding the full county list is several screens of
  popup scroll, and hover does not exist there.
- **A drill-down** (pick region, then subregion replaces it) -- rejected as a
  new component answering a question the existing narrowing already answers,
  and as a second drainage-area control, which [ADR-071](ADR-071-one-drainage-area-control-to-a-page.md)
  removed.
- **Indented option groups** inside the existing single-select menus --
  keeps today's exact footprint, keeps the browser's own keyboard navigation
  of a native `<select>`, and states the hierarchy as headings rather than
  implying it.

## Decision

**Place choices render as indented option groups inside their existing
menus.** The storage map's `where` control groups subregion rows under their
region's name and basin rows under their subregion's (`calcite-option-group`);
the storage charts' filter bar groups counties under their state and basins
under their subregion (`optgroup`). Consecutive options carrying the same
group label form one heading; both builders sort so same-group rows are
contiguous, and a choice with no parent on offer stays ungrouped rather than
gaining a heading that names nothing.

**The state moves from every county row to its group heading.** County option
labels drop the `, ST` suffix -- "Summit" under Colorado, "Summit" under Utah
-- because the heading is the state, stated once per group instead of
repeated per row. This amends [ADR-058](ADR-058-assign-the-county-from-the-water-not-the-dam.md)'s
reader-facing-label clause, which was written for a flat list and said so;
its *key* rule is untouched and is what makes the change safe: the value is
still the five-digit FIPS code, so two Summit Counties remain two different
choices whatever their rows read. Search is also untouched -- it matches the
county name and the state as separate normalized words, so "summit county co"
resolves exactly as it did.

**The charts' county list narrows by the chosen state**, the way the
subregion list beside it always did, and by the state alone: a county cuts
across drainage areas, so holding a reader's county while they move between
subregions is a choice still on offer, not a stale one. A county the new
state does not hold falls back to "all" under the same rule every other
narrowed control follows.

## Consequences

One drainage-area control per page ([ADR-071](ADR-071-one-drainage-area-control-to-a-page.md))
and a level control that stays its own question ([ADR-064](ADR-064-offer-two-levels-and-let-the-reader-choose.md))
are unchanged. The browser suite holds the arrangement in place: groups must
render as real `optgroup`/`calcite-option-group` elements with nothing loose
outside them, county headings must be two-letter state codes, drainage-area
headings must not be raw codes, and the page must not scroll sideways with
grouped selects at any tested width.

[ADR-058](ADR-058-assign-the-county-from-the-water-not-the-dam.md) is amended,
not superseded: assignment point, FIPS key, committed assignment, queried
geometry, and source layer all stand. Only where the reader sees the state has
moved.

## Related

- Amends [ADR-058](ADR-058-assign-the-county-from-the-water-not-the-dam.md):
  the state travels as a group heading rather than a per-row suffix.
- Bound by [ADR-071](ADR-071-one-drainage-area-control-to-a-page.md): one
  drainage-area control to a page, which is why nesting lives inside the
  existing menu.
- Scoped in
  [`docs/WATER-BODY-AND-NAVIGATION-SCOPING.md`](../WATER-BODY-AND-NAVIGATION-SCOPING.md),
  item 3 of five.
