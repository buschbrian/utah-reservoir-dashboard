# Utah Reservoir Drought Dashboard — MapLibre GL JS + CARTO

Same dashboard as [`../index.html`](../index.html), rebuilt with
[MapLibre GL JS](https://maplibre.org/) and [CARTO's](https://carto.com/basemaps)
free, no-signup "Positron" vector style, instead of the ArcGIS Maps SDK for
JavaScript.

This replaces an earlier Leaflet + OpenTopoMap comparison. Leaflet renders
tiles as raster images in the DOM; the ArcGIS Maps SDK for JS renders vector
data on WebGL. Comparing the two wasn't really testing the same class of
technology. MapLibre GL JS — the open-source continuation of Mapbox GL JS —
is also a WebGL vector renderer, so it's the fairer baseline for this
comparison.

Identical data (`reservoirs.json`, fetched from the parent folder, not
copied), identical color/size logic, identical popup content and wording.
Loaded straight from unpkg's CDN, no npm/build step, same "zero tooling"
constraint as every other phase.

The "identical" part is now enforced rather than maintained by hand: class
breaks, status wording, popup markup, the 12-month trend chart and the
legend all come from [`../shared/reservoir-viz.js`](../shared/reservoir-viz.js),
which both pages load. They had been two hand-kept copies and had already
diverged, which quietly turned part of this comparison into a measurement of
copy drift. Only engine-specific code — layers, paint properties, Arcade vs.
MapLibre expressions — lives in the pages now.

## The dual-circle symbology

Both versions render two circles per reservoir: a gray outline ring sized by
the reservoir's period-of-record max storage, and a colored filled circle on
top sized by current storage — the gap between the two is a visual read of
how depleted a reservoir is, not just its color.

- **ArcGIS Maps SDK for JS:** two `FeatureLayer`s, each with a `SimpleRenderer`
  and `visualVariables` driven by Arcade `valueExpression`s (`Sqrt($feature.record_max_af)`,
  `Sqrt($feature.current_storage_af)`), sharing one size domain so the rings
  never render smaller than their own fill.
- **MapLibre GL JS:** one GeoJSON source, two `circle` layers, each with a
  `circle-radius` paint property using an `interpolate` + `["sqrt", ["get", ...]]`
  expression — MapLibre's own expression language standing in for Arcade,
  same sqrt-scaling logic, same shared domain.

Both engines hit the identical "clicking either layer at the same point
produces a duplicate popup" trap, since the fill circle always sits inside
the outline circle. Fixed identically in both: only the front-most
(current-storage) layer/renderer gets an active popup.

## Findings vs. the ArcGIS Maps SDK for JS version

| | ArcGIS Maps SDK for JS | MapLibre GL JS |
|---|---|---|
| Rendering | WebGL vector | WebGL vector |
| Basemap | Esri "topo-vector" (bundled) | CARTO Positron (free vector style, external fetch) |
| Data-driven styling | Arcade `valueExpression`s inside `visualVariables` | Native expressions (`interpolate`, `step`, `sqrt`) inside paint properties |
| Popups | Declarative `PopupTemplate` + `expressionInfos`, `{field}`/`{expression/name}` substitution | Manual HTML string built in JS, `Popup().setHTML()` |
| Multi-layer setup | Two separate `FeatureLayer`s, each rebuilding the same `Graphic` array from JSON | One shared GeoJSON source, two `circle` layers reading from it |
| Bundle | Full SDK incl. 3D/scene/widget framework | MapLibre GL JS core only, no plugins |
| Dashed circle stroke | `outline: { style: "short-dash" }` on a `simple-marker` | Not supported on `circle` layers — requires drawing the ring to a canvas, `map.addImage()`, and a `symbol` layer scaled with `icon-size` |
| Nested feature attributes | `FeatureLayer` fields are scalar-typed; arrays need a side lookup | GeoJSON properties survive as JSON *strings* through the tile pipeline; arrays need a side lookup |
| Rich popup content | `content` accepts a function returning a DOM node | `setHTML()` on plain markup |

Two findings from adding the staleness ring and the 12-month trend chart:

- **Dashed strokes are a real gap.** Marking stale reservoirs with a dashed
  amber ring is one property on an Esri `simple-marker`
  (`outline.style = "short-dash"`). MapLibre's `circle` layer has no
  stroke-dash equivalent, so parity took a canvas-drawn sprite registered
  via `map.addImage()`, a `symbol` layer, and an `icon-size` expression
  converting the desired radius into a multiple of the sprite's own size —
  three moving parts against Esri's one.
- **Neither engine will carry a nested array on a feature.** The JSON now
  holds twelve monthly records per reservoir. Esri's `FeatureLayer` fields
  are scalar-typed and reject it outright; MapLibre accepts it and hands it
  back from `e.features[0].properties` as a JSON string. Both pages ended up
  at the same answer independently: put only the scalars the paint
  expressions read on the feature, and keep the full record in a
  `Map` keyed by name for the popup.

Bottom line: with both engines actually rendering vector data on WebGL, the
proportional dual-circle symbology and Arcade-equivalent expressions came out
functionally identical — same math, same visual result, verified pixel-for-
pixel against the same `reservoirs.json` (Flaming Gorge: 2,669,060 af current,
3,557,090 af record max, both dashboards agree exactly). The real difference
is tooling depth, same conclusion as the Leaflet pass it replaces: Esri's
`PopupTemplate` is declarative and free once you know Arcade; MapLibre's
popups are plain HTML you build yourself. MapLibre's single-source/multi-layer
model is arguably simpler to reason about than Esri's two-full-FeatureLayer
approach for this specific use case, since both layers already share one
authoritative feature set.

Verified via local server + Playwright: zero console errors, dual circles
render correctly across all 28 reservoirs, popup content confirmed identical
to the ArcGIS version by clicking the same reservoir (Flaming Gorge) in both.

**Not yet re-verified in a browser** as of the shared-module / trend-chart
change: that work was done in an environment whose network policy blocks
`js.arcgis.com`, `unpkg.com` and `basemaps.cartocdn.com`, so neither map
could be loaded. What *was* verified there: `shared/reservoir-viz.js`
rendered in headless Chromium against a synthetic 28-reservoir fixture
(popup, trend chart, 12-month table, legend, staleness banner — zero
console errors), plus a syntax check of both pages' inline scripts. The
map layers themselves — the stale-ring sprite, the generated class stops,
the Arcade size expressions — still need a real browser pass.
