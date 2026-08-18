# ADR-054: Make the terrain the ground under the drought classes

- Status: Accepted
- Date: 2026-08-18
- Supersedes: [ADR-043](ADR-043-shade-thematic-fills-from-above-with-a-no-key-hillshade.md)

## Context

ADR-043 added terrain to the drought map and put it **above** the Drought
Monitor's classes, blending it so that it varied their lightness without
touching their hue. The reasoning was sound and is still sound: this site
reports the monitor's palette, it does not restyle it, and shading from above
is the arrangement that guarantees that.

It shipped first as `multiply` at 0.35 and then, once it was clear that
`multiply` can only darken, as `soft-light` at 0.6. Both were tuned by moving
the one number ADR-043 said was the whole tuning surface, and neither settled.

What review found is that the tuning surface was not the problem. A shade over
the subject puts terrain and drought in the same pixels. To be visible at all
the relief has to be strong enough to read *through* a class — and at that
strength it is competing with the class, which is the thing it was added to
support. Every setting was either invisible or in the way, and there was no
value in between, because the arrangement itself is what produces that.

The premise ADR-043 argued from also turns out not to bind. The classes are
drawn at 0.45 alpha. A reader has been seeing through them since the first
version of this map; what they were seeing through to was the flattest
possible background.

## Decision

Draw the hillshade at the **bottom** of the operational stack — below the
borrowed state and county outlines, below the classes, below everything — with
`blendMode: "normal"` and `opacity: 0.3`. `src/arcgis/hillshade.ts` still owns
it, and it is still `World_Hillshade`, still public, still no key (ADR-004).

Layer order on the drought map, bottom to top:

```
basemap reference (sunk, ADR-042)
terrain shade            <- normal, 0.3: the ground
state boundaries
county boundaries
drought classes          <- the subject, at 0.45 alpha, in the monitor's colours
drainage outlines
reservoirs
```

Below the state and county lines as well, and not merely below the classes:
those layers are outlines over a transparent fill, so a shade above them would
tint the lines themselves and gain nothing.

**The operator is `normal`, and it is not a free choice.** `soft-light` and
`overlay` both pivot around mid-grey, so their entire effect is proportional
to `b · (1 − b)` of the backdrop they composite over. Above the classes that
backdrop is a mid-tone fill, where the term is large — which is exactly why it
worked there. Underneath, the backdrop is the theme canvas: on
`canvas/light-gray`, b is about 0.93, `b · (1 − b)` is 0.065, and at 0.3
opacity the whole luminance swing between a lit slope and a shaded one is
about 1.2%. `overlay` computes to the same magnitude. From below, those two
operators are not a subtle effect; they are no effect. `normal` at the same
opacity separates the same two slopes by about fifteen points, which is what a
greyscale relief image is drawn to do when it is the ground.

`multiply` was measured as well: over a near-white canvas it is
indistinguishable from `normal` — a multiply against white is the source — and
over the dark canvas it goes nearly dead, so it buys a theme-dependent result
for nothing.

## Consequences

- The classes and the terrain no longer occupy the same pixels. The relief can
  be quiet, because it is not fighting to be seen through anything.
- **The monitor's hues are no longer strictly preserved, and that is the cost
  of this record.** A 0.45-alpha fill composites with whatever is under it, so
  a class over a dark slope is a slightly darker version of that class than
  the same class over a flat basin. It was already compositing with the
  basemap; what changes is that what it composites with now varies across the
  map. The legend chips are drawn from `viz/drought-classes.ts` at full
  strength and remain the reference for what a colour means.
- The opacity is still the tuning surface, and it is now halved by the fills
  above it before a reader sees it — 0.3 here is not comparable to 0.3 under
  ADR-043's arrangement.
- The layer still answers no hit test and appears in no hover include list.
- Still not applied to the snow and storage maps, which sit on Oceans and
  bring their own relief.

## Alternatives considered

**Keep it above and keep tuning the opacity.** What ADR-043 prescribed. The
range between invisible and intrusive is empty, so there is nothing to tune
toward.

**Below, with `soft-light` or `overlay` as ADR-043 suggested trying.** The
arithmetic above: about a 1% swing against the light canvas. Rejected on
measurement, not on taste.

**Below, with `multiply`.** Identical to `normal` in the light theme and
almost nothing in the dark one. Rejected for adding a theme dependency that
buys no difference.

**Raise the classes' alpha so terrain shows less.** Backwards: the fills are
at 0.45 because five exclusive national classes at full strength are a wall
of colour, which is a separate decision this one does not reopen.
