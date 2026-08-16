# ADR-033: Open every map on the Oceans basemap

## Status

Accepted

## Date

2026-08-16

## Context

Every map opened on the calm canvas that matched the page theme: light gray
canvas on the light theme, dark gray on the dark one, swapping when the reader
changed the theme control. That was the right choice while the maps were about
one quantity each, because the gray canvases are deliberately featureless and
a featureless background is correct when the data is the only thing worth
seeing.

The maps stopped being about one quantity each. They now carry reservoirs,
drainage areas, snow basins and measurement sites, and national drought
classes — and every one of those is about water moving across terrain. A
background that shows no terrain makes the reader supply it from memory. Where
the snow is, which basin drains into which reservoir, and why a drought class
stops at a particular line are all questions the land itself answers.

## Decision

`oceans` leads the basemap chain for both themes. It carries bathymetry and
shaded relief under a restrained label set, and it is keyless — a public tile
service for the base and a public vector style for the reference labels, both
verified to serve anonymously before adoption, per ADR-004.

The theme canvases stay one step down the chain, and stay theme-aware: if Esri
ever gates the oceans style, a reader on the dark page falls to the dark canvas
rather than to a bright rectangle on a dark page.

The theme-following machinery in `src/ui/theme-basemap.ts` is kept rather than
deleted, even though it now normally resolves to the same background it started
with. What it protects is the fallback, and the fallback is still theme-aware.
That is decided at resolve time, not at load time, so the listener has to stay.

## Consequences

The land is visible on every map, which is the point.

A theme toggle now usually produces no visible basemap change. That reads as
"nothing happened" rather than as a fault, and the alternative — swapping to a
gray canvas on the dark theme — would be worse, because it would take the
terrain away from a reader who did not ask to lose it.

The storage map's basemap gallery is unaffected. A background the reader picks
from it is still a choice, still detected by object identity, and still not
overruled by a theme change.

Drought classes and snow fills are translucent over a busier background than
before. Both class tables were checked against it: ADR-032 records the
luminance constraint that came out of that, and the drought palette is the
monitor's own and was left alone.
