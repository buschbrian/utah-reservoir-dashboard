# ADR-032: One colour language per map, enforced across pages

## Status

Accepted

## Date

2026-08-16

## Context

ADR-008 made one class-break table the single source of truth for colour, and
ADR-021 kept the snow scale off the reservoir map so that each map speaks one
colour language. Both held. Each table was internally consistent, each had its
own unit test, and nothing was wrong within any single page.

The rule was still being broken, in the one direction neither record covered.
The storage table and the snow table had independently arrived at the same
five-class red-to-blue ramp. `#fdae61` and `#abd9e9` were byte-identical in
both, so a reader moving between the storage map and the snowpack map saw two
unrelated quantities — percent of capacity, and percent of the normal median —
drawn in the same colours. Nothing detected it, because "one colour language
per map" had only ever been checked *within* a map.

The storage table could not move. It is pinned to the frozen oracle in
`shared/reservoir-viz.js` by a value-for-value test, it is read by the map, the
legend, six charts and the table, and it turned out already to be an
Esri-published, colour-blind-tested ramp — "Blue and Red 9", byte for byte.
The drought table is the U.S. Drought Monitor's own published palette and is
not this project's to change at all; readers who know the national map know
those exact yellows and reds.

That left the snow table as the one that could move, and it was also the one
with the weakest claim to its colours: a hand-picked five-class RdYlBu rather
than a published ramp.

## Decision

Snow moves to Esri's published **Green and Brown 6**, reversed so the deficit
end is warm: brown for the driest through pale olive to teal for the wettest.

A unit test now asserts that no colour in the snow table appears in either the
storage or the drought table. The rule is checked across pages, not only
within one.

Two further constraints were applied when choosing, and both are recorded
because they eliminated the obvious candidate. Esri's "Green and Brown 1" is
the conventional BrBG moisture ramp and was the first choice; its middle class
is `#f5f5f5`, a near-white grey. These are translucent fills over a
shaded-relief basemap, and a near-white middle is indistinguishable from the
grey that means "no value for this day" — so "near normal", the most common
reading of all, would have read as "no reading". Every class is therefore held
to a luminance band by test as well as to a hue.

The second constraint is that the classes are not symmetric about normal.
"90 to 110%: near normal" is the fourth of five, not the middle, so the warm-to-cool
pivot belongs between "75 to 90" and "90 to 110" rather than at the centre of
the ramp.

## Consequences

Brown to teal is the conventional way of showing dry and wet, so the snow map
reads without its legend, which the previous ramp did not.

The three maps can no longer be confused for one another at a glance, which is
the property ADR-021 was reaching for and only half achieved.

A future ramp change on any of the three has to clear the cross-table test.
That is deliberate friction: the failure this record exists to prevent was
invisible precisely because each table looked correct on its own.

The choice is now traceable to a publisher rather than to taste.
`SNOW_RAMP_NAME` records which Esri ramp the values came from, so the colours
can be checked against the source rather than only against this repository.
