# Phase 3 execution plan — symbology and map interactions

Phase 2 established the responsive shell, local data layers, anonymous basemap
fallback, and accessible reservoir list. Phase 3 improves how readers scan and
interact with those same 51 in-scope reservoirs. It does not change the
scientific scope or replace the production URLs.

## Recommendations

1. Land interaction behavior before replacing the symbol layer. Pointer
   events, selection, reduced motion, and browser gates can be proven against
   today's graphics without coupling every risk to CIM rendering.
2. Convert the reservoir graphics to one client-side `FeatureLayer` before
   adding `featureEffect` or SDK highlights. Both capabilities operate most
   cleanly on a layer view; implementing them against temporary parallel
   layers would create work we immediately remove.
3. Treat bloom and shadows as measured enhancements. Keep the current clear
   ring/fill encoding as the baseline, test an integrated-GPU profile, and
   retain the baseline when reduced motion or rendering cost calls for it.
4. Keep the focusable reservoir list as the keyboard interface. Canvas hit
   testing is a pointer enhancement, not a substitute for semantic controls.
5. Add one readiness fact and one browser assertion with each slice. A map can
   look plausible while an interaction path or whole operational layer is
   missing.

## Ordered implementation

### 3.1 Pointer interaction — complete

- Throttle `arcgisViewPointerMove` hit testing to one request per animation
  frame and ignore late responses.
- Show a lightweight card with reservoir name, percent full, and reading date.
- Hide it on pointer leave or selection and do not expose it as a noisy live
  region.
- Use the map component's documented `event.detail.x/y` contract for both
  hover and click selection.
- Browser-test hover and map click with deterministic hit-test results.

### 3.2 One reservoir feature layer and CIM symbols — complete

- Replace the two graphics per reservoir with one client-side `FeatureLayer`
  feature carrying stable object ID, name, size basis, fill percentage, and
  late-data state.
- Compose capacity ring, proportional storage fill, stale accent, and a light
  shadow in one CIM symbol while preserving the tested square-root size domain
  and class colors.
- Prove pointer selection, list selection, boundary independence, and the
  no-basemap fallback before removing the graphics implementation.
- Record bundle and frame-time measurements; do not enable a heavier effect
  solely because the SDK supports it.

The renderer is keyed on the object ID, one composed symbol per feature: every
reservoir's ring is a different width, so there are as many symbols as features
by construction, and a `UniqueValueRenderer` is the one renderer with no stop
limit. `src/viz/cim.ts` builds the symbol as a plain property object with no
SDK import, so its arrangement is asserted in the same node environment that
already holds the radii against `shared/reservoir-viz.js`.

Two new assertions, because a feature layer can fail at either end. The page
publishes `symbols`, the count the renderer holds, which catches a renderer
that quietly kept fewer than it was given. The browser gate queries the layer
itself, which catches a layer that accepted the renderer and rejected the
source.

### 3.3 Layer-view hover and filter effects — next

- Move the visual hover emphasis to the layer view's named `temporary`
  highlight after 3.2 supplies a feature layer.
- Replace the disabled analysis placeholder with percent-full and late-data
  controls.
- Apply `featureEffect` so excluded reservoirs remain visible in grayscale at
  reduced opacity; the list and summary must report the same filter state.
- Disable bloom under reduced motion and when the performance measurement does
  not support it.

### 3.4 Selection motion and shareable state

- Ease `goTo` toward a selected reservoir without exceeding the constrained
  regional extent; skip animation under reduced motion.
- Keep list and map selection synchronized and update `?reservoir=` without a
  reload.
- Restore selection from the URL and preserve focus when mobile sheets open or
  close.

### 3.5 Loading and release gates

- Replace remaining loading copy with Calcite loader/skeleton states without
  hiding error explanations.
- Run unit/type/build, all three modern viewports, first-basemap refusal, and
  all-basemap refusal.
- Profile the final symbol and filter path on integrated graphics, then record
  the measured decision in the modernization plan.

## Phase acceptance

Phase 3 is complete when one reservoir feature layer drives symbology,
pointer feedback, selection, and filters; keyboard users retain an equivalent
list path; reduced motion removes nonessential animation; and the production
browser gates pass with and without a basemap.
