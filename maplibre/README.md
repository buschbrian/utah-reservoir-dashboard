# Archived MapLibre comparison

**Status:** the runtime is retired. [`maplibre/index.html`](index.html) is an
accessible compatibility redirect to the production storage map.

This directory once held a second reservoir-map implementation built with
MapLibre GL JS. ADR-007 adopted two rendering engines for comparison. ADR-016
made ArcGIS primary, and ADR-031 later retired the duplicate runtimes while
preserving their URLs and saved-link state. Do not restore the MapLibre SDK or
application logic here.

The findings below remain useful engineering history.

## What the comparison established

Both engines once read the same `reservoirs.json`, drainage geometry, and
`shared/reservoir-viz.js` behavior. Keeping common data, class breaks,
formatting, filters, selection, and popup content outside either renderer was
what made engine differences measurable rather than differences between two
copies of the application.

### One GeoJSON source suited layered marks

MapLibre could draw fill, outline, and late-data marks from one GeoJSON source.
The ArcGIS implementation expressed the same idea through a client-side
`FeatureLayer` and later one composed CIM symbol. The shared-source shape was
easier to inspect in MapLibre; ArcGIS supplied the stronger component, popup,
label, and chart integration used by the final application.

### Dashed circle strokes needed a workaround

ArcGIS could draw a dashed marker outline directly. MapLibre circle layers
could not, so the comparison page generated a reusable dashed-ring canvas
image and drew it in a symbol layer. That workaround was isolated to the
retired runtime and is not part of the production contract.

### Large record arrays stayed outside map features

Each reservoir carries twelve months of history. Both implementations kept a
full-record lookup keyed by reservoir identity and placed only rendering
scalars on map features. That boundary survives in the typed application: map
features are for drawing and hit testing, while complete records stay in the
validated data model.

### Different engines exposed different failures

The comparison exposed an ArcGIS antimeridian polygon inversion and several
engine-specific lifecycle differences. It also proved that a second renderer
only provides useful evidence while shared behavior is genuinely shared.
Once product behavior diverged, maintaining two complete applications cost
more than the comparison returned.

## Current redirect contract

`maplibre/index.html`, `legacy/index.html`, and `explore.html`:

- load no retired SDK, chart library, data payload, or application module;
- translate only allowlisted URL parameters through
  `public/retired-route.js`;
- expose a normal link if script does not run; and
- remain covered by `tests/smoke.mjs` at 1280, 390, and 360 pixels.

Run:

```bash
npm run build
mkdir -p screenshots
node tests/smoke.mjs
```

The authoritative architecture is in the project [README](../README.md) and
[ADR-031](../docs/decisions/ADR-031-retire-comparison-implementations-and-redirect-their-urls.md).
