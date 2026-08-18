/*
 * Terrain shading, from a service that answers without a key.
 *
 * ## Why not the basemap styles service
 *
 * Esri publishes `arcgis/hillshade/light` and `arcgis/terrain` through the
 * Basemap Styles service, and either would be the obvious choice — but that
 * service requires an ArcGIS Location Platform account or an API key, and
 * this project runs deliberately without one (ADR-004). There is no anonymous
 * tier for it.
 *
 * `World_Hillshade` is the older ArcGIS Online map service, and it is public.
 * It needs no token, it is already inside the content policy's
 * `*.arcgisonline.com` allowance, and the policy was written from a
 * measurement of what the pages actually request, so nothing widened for it.
 *
 * ## Why it is the ground now, and not a glaze
 *
 * This layer was drawn *above* the drought classes for its first two
 * versions, first with `multiply` and then with `soft-light` (ADR-043). The
 * argument was that shading from above varies the classes' lightness and
 * leaves every hue exactly as the Drought Monitor published it. That is true,
 * and it is also what made the map hard to read: a glaze over the subject
 * puts terrain and drought in the same pixels, so neither is clean, and the
 * relief has to be strong enough to see through a class before it says
 * anything at all.
 *
 * ADR-054 puts the shade underneath instead. The classes are drawn at 0.45
 * alpha, so the ground is already visible through them — it was simply the
 * flattest possible ground. Terrain beneath gives the classes something to
 * sit on without touching the pixels the monitor's palette occupies.
 *
 * ## Why `normal` and not `soft-light`
 *
 * Because from underneath, `soft-light` does nothing measurable, and the
 * arithmetic says so before a screenshot does.
 *
 * `soft-light` and `overlay` both pivot around mid-grey: their whole effect
 * is proportional to `b * (1 - b)` of the backdrop they are composited over.
 * Above the classes that backdrop is a mid-tone fill, where the term is
 * large — which is exactly why it worked there. Underneath, the backdrop is
 * the theme canvas. On `canvas/light-gray`, b is about 0.93, `b * (1 - b)`
 * is 0.065, and at 0.3 opacity the entire luminance swing between a lit
 * slope and a shaded one comes to roughly 1.2%. `overlay` computes to the
 * same magnitude. Neither is a subtle effect; both are no effect.
 *
 * `normal` is what a hillshade is drawn for. It is a greyscale relief image
 * meant to be ground, and over the light canvas at 0.3 the same two slopes
 * land about fifteen points of luminance apart — relief a reader can see
 * without it competing with the classes above. `multiply` was measured too
 * and is indistinguishable from `normal` over a near-white canvas (a
 * multiply against white *is* the source) while going nearly dead over the
 * dark one, so it buys a theme-dependent result for nothing.
 */
import TileLayer from "@arcgis/core/layers/TileLayer";

/** The public, no-key terrain service. */
export const HILLSHADE_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer";

/**
 * How strongly the ground shows.
 *
 * Restrained on purpose, and more so now that the shade is the ground rather
 * than a glaze: the drought classes are drawn at 0.45 alpha over this, so
 * whatever relief is here arrives at the reader already halved. At 1 the map
 * reads as a relief map with a drought tint; the point is the opposite —
 * classes first, with just enough terrain to say which of them are mountains
 * and which are desert basin. This is the one number to change if the ground
 * is too strong or too faint.
 */
export const HILLSHADE_OPACITY = 0.3;

/**
 * How the shade is combined with what is beneath it.
 *
 * `normal`, because this layer is now underneath the subject rather than
 * over it, and the pivot-around-mid-grey operators have almost nothing to
 * work with against a near-white canvas — see the note above for the
 * arithmetic. Change this line to `soft-light` or `overlay` to see that for
 * yourself; the layer is otherwise unchanged.
 */
export const HILLSHADE_BLEND_MODE = "normal";

/**
 * A terrain layer meant to be drawn as the ground beneath thematic fills.
 *
 * `listMode: "hide"` because it is not a layer a reader turns on and off; it
 * is part of how the map is drawn. It carries no data and answers no hit
 * test, so it is excluded from hover by never being named in a hit-test
 * include list.
 */
export function createHillshadeLayer(): TileLayer {
  const layer = new TileLayer({
    id: "terrain-shade",
    url: HILLSHADE_URL,
    listMode: "hide",
    opacity: HILLSHADE_OPACITY
  });
  /* Set after construction rather than in the constructor properties: the
   * SDK's typings for `TileLayer` properties do not carry `blendMode` under
   * `exactOptionalPropertyTypes`, and it is a plain settable property at
   * runtime. */
  (layer as unknown as { blendMode: string }).blendMode = HILLSHADE_BLEND_MODE;
  return layer;
}
