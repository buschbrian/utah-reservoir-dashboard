# ADR-043: Shade thematic fills from above, with a hillshade that needs no key

- Status: Accepted
- Date: 2026-08-16

## Context

The drought map was the hardest surface on the site to read. It draws the
Drought Monitor's national polygons over a deliberately quiet background
(ADR-033's `minimal` chain, chosen because this map writes its own state
names and Oceans would write them a second time). The result was correct and
flat: five class colours on a near-featureless ground, with nothing to say
where the mountains that make the water actually are, and boundaries hard to
pick out.

Two questions had to be answered before adding terrain.

**Which service.** Esri publishes `arcgis/hillshade/light` and
`arcgis/terrain` through the Basemap Styles service, and either would be the
obvious choice. Both **require an ArcGIS Location Platform account or an API
key**, and this project runs deliberately without one (ADR-004). There is no
anonymous tier. `World_Hillshade`, the older ArcGIS Online map service, is
public, needs no token, and is already inside the content policy's
`*.arcgisonline.com` allowance — so ADR-036's rule that the policy is widened
only from measurement is not touched.

**Which way round.** The standard technique is to multiply thematic fills over
a hillshade. That works, and it changes the fills' own colours in the process.
These fills are the Drought Monitor's published palette. This site reports the
monitor; it does not restyle it.

## Decision

Draw the hillshade as a `TileLayer` **above** the drought classes and below
this project's own reference geometry, with `blendMode: "multiply"` and
`opacity: 0.35`. `src/arcgis/hillshade.ts` owns it.

Layer order on the drought map, bottom to top:

```
basemap reference (sunk, ADR-042)
state boundaries
county boundaries
drought classes          <- the subject, in the monitor's own colours
terrain shade            <- multiply, 0.35
drainage outlines
reservoirs
```

Above the classes so the terrain varies their **lightness** and leaves every
hue exactly as the monitor set it. Below the outlines and reservoirs so it
never darkens this project's own reference geometry.

Blending is not new in 5.x — `layer.blendMode` has been there since 4.16 —
but it is what makes a hillshade usable as an overlay rather than a
background. `multiply` keeps the shade's darks and lets its lights pass
through, so slopes shade what is beneath and flat ground leaves it alone.

## Consequences

- The drought classes sit on visible terrain without any class changing hue.
- The opacity is the tuning surface, and it is the whole of it. Too high and
  the map reads as a relief map with a drought tint; too low and the terrain
  does nothing.
- **`multiply` can only darken.** Where the hillshade is light it multiplies
  toward 1 and does nothing at all, so this technique produces shadows and no
  highlights. If lit slopes should also brighten, `multiply` is the wrong
  operator and `soft-light` or `overlay` is the one to try — both lighten
  above mid-grey and darken below it. That is a live tuning question at the
  time of writing, not a defect in the arrangement above.
- The layer answers no hit test: it is never named in a hover include list,
  and it carries no data.
- The same arrangement is available to the snow and storage maps and is not
  applied to them. They already sit on Oceans, which brings its own relief.

## Alternatives considered

**`arcgis/hillshade/light` or `arcgis/terrain` from the Basemap Styles
service.** Rejected: needs a key, which ADR-004 refuses.

**Multiply the classes over a hillshade base.** The conventional direction,
and rejected because it restyles the monitor's published colours.

**A grey canvas with no terrain.** What was there. It is legible and says
nothing about the ground, which is most of what a drought map is about.
