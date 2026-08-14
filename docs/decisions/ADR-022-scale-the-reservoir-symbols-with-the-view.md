# ADR-022: Scale the reservoir symbols with the view

## Status

Accepted

## Date

2026-08-14

## Context

The reservoir circles are drawn at a fixed pixel size at every zoom level.
The ring is sized from the reservoir's own size basis and the fill from its
percentage, both in pixels, and neither term mentions the view. A circle is
therefore the same number of pixels across whether the reader is looking at
the whole Colorado River system or at one dam.

That is not a cosmetic problem. Measured at the opening extent, seven pairs
of reservoirs overlap, and three of those are effectively total occlusions:
Trial Lake's centre is 0px from Washington Lake's, Lost Lake's is 1px away,
and Lower Enterprise sits 1px from Upper Enterprise. Two reservoirs were
drawn entirely inside a third, and the reader had no way to discover them on
the map at all.

Draw order was the first repair, and it is kept: the layer orders by size
basis so the smallest circle is painted last. That reveals a reservoir which
is *partly* covered, which fixes the Currant Creek and Strawberry case. It
does nothing for a 4px circle concentric with a 5px one — there is no order
in which both of those are visible.

Zooming in did not help either, and this is the part that made the symbols
feel wrong rather than merely dense. Zooming in moves the two points further
apart on screen, but the circles do not grow with them, so the map scales and
its symbols do not. The reader's instinct — get closer to separate them — is
correct and the map declined to honour it.

## Decision

Every size expression multiplies by a zoom factor derived from
`$view.scale`:

```text
k = clamp(sqrt(REFERENCE_SCALE / $view.scale), 1, 3)
```

Square root rather than a straight ratio, so the circles grow noticeably
without doubling at every zoom level.

**The floor is 1, not a fraction.** This term may enlarge a circle and may
never shrink one. There is no single "opening scale" to normalise against:
the opening extent is fixed, but the scale that shows it depends on the
viewport. Measured, it is 8,416,703 on a 1280px window, 21,746,566 at 390px
and 23,558,780 at 360px. A floor below 1 would therefore shrink the symbols
by around 40% on exactly the screens where they are hardest to hit, in order
to relieve crowding that is worst on the screens where they are easiest to
hit. The ceiling stops Lake Powell covering a county at street level.

`REFERENCE_SCALE` is 8,400,000, the measured desktop opening scale. A 1280px
window therefore opens at a factor of exactly 1, and every narrower viewport
is held at 1 by the floor. **Every view starts with the circles it has always
had**, and the term only ever adds size as the reader zooms in.

The ring, the fill and the shadow all carry the term. A ring that grows
around a fill that does not is a reservoir that appears to empty as the
reader zooms in, and the shadow spread is scaled rather than added afterwards
because a constant 2px halo reads as a hairline at 3x and as a second ring at
the floor.

The two comparison maps keep fixed-size symbols and are not getting this.

## Consequences

The parity tests in `symbols.test.ts` still hold `symbols.ts` to
`shared/reservoir-viz.js` value for value, and they are still meaningful,
because the arithmetic in `symbols.ts` is this map at every scale at which it
opens.
What the TypeScript no longer describes on its own is what the map draws at
every *other* scale. `arcade.test.ts` covers that gap directly: it asserts
the factor is 1 at all three measured opening scales, that it clamps at both
ends, that an unsettled view reporting no usable scale falls back to 1, and
that all three size expressions carry the term.

ADR-007's comparison changes shape. The 5.1 map and the two legacy maps no
longer draw the same circles once the reader zooms in, so a screenshot
comparison between engines is only valid at the scale each one opens at. This is a deliberate
divergence rather than drift: the legacy pages are retained as a record of
what was shipped, and holding the primary application to a defect they share
would be the wrong direction for that record to point.

`$view.scale` inside a CIM primitive override was verified against the
running SDK before this was written, on both counts that matter: it resolves,
and it re-evaluates as the view scale changes. Neither is documented clearly
enough to have assumed.
