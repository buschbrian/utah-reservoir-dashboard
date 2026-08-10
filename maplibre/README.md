# MapLibre parity view

[`maplibre/index.html`](index.html) presents the same reservoir data and
interactions as the production [ArcGIS map](../index.html), using
[MapLibre GL JS](https://maplibre.org/) with CARTO vector basemaps.

This is a deliberate second rendering engine, not a fallback implementation
waiting to be removed. Both maps render vector data with WebGL, so differences
between them expose real SDK tradeoffs rather than a raster-versus-vector
comparison. [ADR-007](../docs/decisions/ADR-007-two-rendering-engines.md)
records why both engines remain in the project.

## Parity contract

Both maps use the same runtime files:

- `reservoirs.json` for observations, metrics, and reservoir points;
- `huc6.geojson` for drainage-area boundaries; and
- `shared/reservoir-viz.js` for class breaks, formatting, popup markup,
  charts, freshness text, filters, selection state, and keyboard lists.

Only engine-specific work remains in each page: constructing layers, applying
paint or renderer expressions, hit testing, popup lifecycle, and basemap
selection. The browser smoke test reads its expected count from the current
payload and checks both engines at desktop and phone widths.

## Shared symbology

Each reservoir uses the same visual model in both engines:

1. An outline ring is sized by the reservoir's full level.
2. A colored fill is sized by current storage on the same square-root scale.
3. A dashed amber ring marks late data.

The gap between outline and fill therefore represents missing storage, not a
second arbitrary scale. Real capacity is the preferred full level; highest
observed storage since 2015 is the fallback. Color always comes from the one
shared percent-full class table.

| Concern | ArcGIS Maps SDK | MapLibre GL JS |
|---|---|---|
| Reservoir data | Graphics in `FeatureLayer` instances | One GeoJSON source shared by circle and symbol layers |
| Size expressions | Arcade expressions | Native `interpolate` and `sqrt` expressions |
| Color classes | `UniqueValueRenderer` generated from the shared table | `step` expression generated from the shared table |
| Popups | SDK-owned popup with shared HTML content | Page-owned `Popup` with the same shared HTML content |
| Hover | Coalesced `hitTest` on pointer movement | Layer-scoped `mousemove` event |
| Late-data ring | Dashed simple-marker outline | Canvas sprite registered with `addImage()` and drawn in a symbol layer |
| Basemaps | Esri topographic, gray, streets, and imagery | CARTO Voyager, Positron, and Dark Matter |

## Findings

### One GeoJSON source is simpler for layered marks

MapLibre's fill, outline, and late-data layers all read one source. The ArcGIS
page uses separate feature layers for the marks. The shared-source model is
easier to inspect for this particular visualization, while ArcGIS provides
more declarative popup and symbol APIs.

### Dashed circle strokes require a workaround

ArcGIS supports a dashed marker outline directly. MapLibre circle layers do
not, so the parity view draws a reusable dashed-ring image to a canvas and
scales it as a symbol. That is more machinery, but it stays isolated in the
MapLibre page and is covered by the readiness and browser checks.

### Monthly arrays stay outside map features

Each reservoir contains 12 monthly records. ArcGIS feature fields are scalar,
and legacy MapLibre versions returned nested GeoJSON properties through the
feature path in an inconvenient serialized form. Both pages therefore keep a
full-record lookup keyed by reservoir name and put only rendering scalars on
map features. MapLibre 6 can preserve nested properties, but the side lookup
remains the common contract until the Phase 6 parity rewrite is measured.

### Different engines catch different failures

The comparison exposed an ArcGIS antimeridian polygon inversion that did not
occur in MapLibre, while the shared module prevents ordinary wording and class
break drift from being mistaken for engine differences. A parity page is only
useful when common behavior is truly common.

## Verification

Run the production build before the browser contract:

```bash
npm run build
mkdir -p screenshots
node tests/smoke.mjs
```

The test checks that both maps render every published reservoir, create all
three reservoir layers, draw the Utah mask and drainage-area boundaries, show
the shared legend and totals, avoid console errors, and fit 1280-, 390-, and
360-pixel viewports. The screenshots are supporting evidence; runtime readiness
signals are authoritative because ArcGIS map pixels can be blank in headless
Chromium even when its layers are ready.
