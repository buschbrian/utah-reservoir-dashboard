# ADR-061: Reference geometry may sit over continuous data, never over discrete

- Status: Accepted
- Date: 2026-08-18
- Supersedes: ADR-054 (for the drought map's terrain); refines the scope of ADR-042

## Context

Two decisions governed what sits above the subject on these maps, and both
were reached from a single map each.

**ADR-042** sinks a basemap's reference layers below every operational layer,
because they draw above the data whatever order the operational stack is in --
and a grey state line landed across Flaming Gorge, a boundary through the
subject.

**ADR-054** put the hillshade underneath the drought classes, on the argument
that the classes are drawn at 0.45 alpha so a reader is already seeing through
them to *something*, and it may as well be the ground that makes the water.

Read against the live drought page, the result is too much ink. Relief, plus
five saturated classes, plus two cased boundary sets, on a map that asks one
question. The classes are the measurement and everything else was competing
with them.

The fix is not that the drought map is a special page. It is that the two
earlier records generalised from the wrong property.

## Decision

**What may be drawn over the subject depends on whether the subject is
continuous or discrete.**

**Continuous data — reference geometry may sit above it.** The drought classes
tile the region with no gaps, so a line drawn over them always has fill on
both sides. It partitions the surface and says which land a colour describes.
It cannot hide the subject, because there is subject on either side of every
line. This is the ordinary cartography of a choropleth, and it is why the
state and county outlines now draw above the drought classes.

**Discrete data — investigate before raising anything above it.** A reservoir
is a point. A boundary drawn across a point does not partition it; it occludes
it. That is exactly the Flaming Gorge failure, and it is why ADR-042 is right
about the storage and snow maps and stays in force there. "Investigate" rather
than "never": a thin line over a large polygon may be fine, and the test is
whether the mark can be hidden, not whether it is vector.

**The drought map draws no terrain.** The flattest available background is the
right background for a choropleth. ADR-054's reasoning about seeing through a
0.45-alpha fill is sound and simply argues for a quiet ground rather than an
interesting one.

**The drainage outlines are quieter again.** The cased pair goes from a
2.6px/0.62 casing and a 0.9px/0.68 core to 1.6px/0.34 and 0.7px/0.44. The
cased arrangement is unchanged and still earns its place -- one of the two
passes is always carrying the line, whether it crosses pale D0 yellow or the
darkest D4 maroon. Only the volume moves.

## Consequences

ADR-054 is superseded for the drought map. Its blend-operator arithmetic in
`src/arcgis/hillshade.ts` stands and is untouched: `soft-light` and `overlay`
pivot around mid-grey and are worth about 1% against a light canvas, so
`normal` remains the operator wherever a hillshade is used. Nothing uses one
today, and the module stays because that measurement is expensive to redo.

ADR-042 is unchanged in force and narrower in claimed scope. It applies to
discrete subjects, which is every map it was written against.

**This is not verified visually here.** The ArcGIS canvas renders blank in
headless Chromium, so the browser suite proves the layers load, the page has
no console errors and axe is clean -- it proves nothing about whether the map
now looks right. That judgement is the reader's, against a real browser.

The layer order on the drought map is now, bottom to top: drought classes,
drainage casing, drainage core with its labels, state outlines, county
outlines, label reference. The reference labels stay topmost, which is where
`viz/label-scales.ts` already puts the ladder.
