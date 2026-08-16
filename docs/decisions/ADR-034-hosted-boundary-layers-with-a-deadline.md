# ADR-034: Take state and county boundaries from hosted services, against a deadline

## Status

Accepted

## Date

2026-08-16

## Context

The drought map draws the U.S. Drought Monitor's national polygons whole,
because drought does not stop at a drainage-area edge and seeing the region
inside the wider pattern is context the coverage bars cannot give. Drawn
whole, that pattern needs something that says *which* West it crosses. The
fourteen drainage-area outlines cannot do it: outside them there is nothing.

Every geography this project draws until now has been a committed file —
`huc6.geojson`, `utah-boundary.geojson`, the weekly drought polygons. ADR-005
and the source inventory set that pattern deliberately, so a published result
can be reproduced from the repository.

State and county boundaries are a different kind of thing. Nothing on any page
is computed from them. No figure moves if Esri regeneralizes a coastline. They
are decoration on a map that is already drawn from local data. Committing them
would add a third megabyte of GeoJSON to a repository that already ships a
1.9 MB snow payload and a 2 MB drought file, in exchange for reproducibility
that nothing needs.

The plan's own rule already covered this case: prefer an authoritative public
REST layer for optional map context **when it has a bounded failure path**.
The condition is the whole rule, and a `FeatureLayer` added to a map and left
to fail on its own does not meet it — it sits in the layer list forever,
unloaded and unexplained.

## Decision

State and county boundaries come from Esri's generalized hosted layers,
loaded through `src/arcgis/reference-layers.ts`.

The bounded failure path is enforced rather than assumed. Each layer is loaded
against an eight-second deadline **before** it is added to the map, and a layer
that does not answer is simply not added. Eight seconds rather than the view's
own twenty-five: this is decoration on a map that is already drawn, and a
reader should not wait half a minute to find out that an outline is not coming.

The counties are scale-limited as a layer, not only in their labels, so three
thousand hairlines are neither drawn nor fetched at regional scale.

Both services were verified anonymous before being written down, per ADR-004,
and both are recorded in the authoritative source inventory with their fields,
failure behaviour and copy policy.

## Consequences

This is the first runtime service dependency any view has taken for map
context. The precedent it sets is narrow and should stay narrow: optional
context, nothing computed from it, a deadline, and no layer on the map unless
it loaded.

The browser suite checks the layer list against what actually loaded rather
than against a fixed list. A refused service is a supported outcome, and a test
that failed on it would be testing Esri's uptime instead of this project's
behaviour.

Two things to watch upstream. The name fields are read once each
(`STATE_NAME`, `NAME`); a rename would produce blank labels rather than an
error. And these are Esri's own generalizations rather than a tolerance this
project requested, so the 100-metre default in the source inventory does not
apply — if either layer is ever used for an analytical result it stops being
optional context and has to be re-sourced from the owner at a stated tolerance.
