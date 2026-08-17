# ADR-030: Draw drainage-area names below reservoir symbols

## Status

Superseded by ADR-047

## Date

2026-08-15

## Context

ADR-025 and ADR-027 used one polygon feature and one ArcGIS label candidate
for each six-digit drainage area. The source layer was ordered below the
reservoir layer, but the names still covered reservoir points. The SDK paints
FeatureLayer labels in its label pass, so operational layer order did not make
those names background marks.

The two-pixel, near-white halo was also almost opaque. It separated the names
from the basemap, but it covered too much of the reservoir marks and drainage
lines around each name.

The ArcGIS label-point operator produced the needed positions, but a static
import increased the opening gzip path from 2.11 MiB to 2.43 MiB and failed the
2.3 MiB SDK budget. The committed rings already contain everything this
fourteen-label calculation needs.

## Decision

Keep one multipart polygon feature for each drainage area, but remove
FeatureLayer labeling from that layer. Calculate one deterministic interior
label point from the committed polygon rings. Draw the name as a TextSymbol in
a dedicated GraphicsLayer. The helper prefers the largest ring's centroid and
uses a bounded horizontal-span scan when a concave ring or hole puts that
centroid outside.

Put the polygon layer and the text-symbol layer above the Utah mask and below
the reservoir layer. Recheck that order whenever the reservoir scope replaces
its layer. Keep the 25,000,000 minimum scale, 11-pixel bold text, and two-pixel
halo from ADR-027. Set the halo to 50% opacity.

Keep separate readiness facts for the number of drainage-area text symbols and
whether their layer is below the reservoir layer. A browser check holds the
layer type, symbol count, halo opacity, and order through a scope redraw.

All reservoir-symbol unit conversions and fixed-size decisions from ADR-027
remain in force.

## Alternatives Considered

### Reorder the labeled FeatureLayer

- Rejected because the polygon layer was already below the reservoirs. The
  SDK label pass, not the layer collection position, caused the overlap.

### Reduce only the halo opacity

- Rejected because it would make an overlapping name less opaque without
  making the reservoir point the foreground mark.

### Remove drainage-area names from the opening map

- Rejected because the names provide the geographic context shared by the map,
  filters, charts, and future snowpack view.

## Consequences

- A drainage-area name cannot cover a reservoir point because its TextSymbol
  is in a lower operational layer.
- Each drainage area still contributes exactly one name, including multipart
  areas. The geometry helper chooses an interior point in the largest ring and
  has focused tests for concave, holed, and multipart shapes.
- Background TextSymbols do not use FeatureLayer label deconfliction. The
  current inventory has fourteen names; viewport smoke checks guard layout,
  and a later denser geography would need a measured decluttering rule.
- The opening bundle stays at 2.11 MiB gzip instead of importing the SDK's
  larger geometry-operator graph for fourteen points.
- ADR-027 is superseded. Its reservoir symbol sizing, label scale, font size,
  and halo width remain in force here.
