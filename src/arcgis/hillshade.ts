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
 * ## Why it is drawn with `soft-light`
 *
 * Blending is not new in 5.x — `layer.blendMode` has been there since 4.16 —
 * but it is what makes a hillshade usable as an overlay rather than a
 * background.
 *
 * This was `multiply` first, and `multiply` can only darken: it keeps a
 * layer's darks and lets its lights pass through, so where the hillshade is
 * light it multiplies toward 1 and does nothing at all. The result was
 * shadows and no highlights — terrain that reads as shading on the shaded
 * side and disappears on the lit side, which is exactly what it looked like
 * in use. Raising the opacity does not fix that; it only deepens the
 * shadows, because the operator has no way to make anything brighter.
 *
 * `soft-light` is the operator that does both. Mid-grey leaves the colour
 * beneath unchanged, lighter than mid-grey lightens it and darker darkens
 * it — so a hillshade's lit slopes brighten the class beneath them and its
 * shaded slopes deepen it, which is what relief shading is for. It is also
 * the gentler of the two candidates: `overlay` applies the same idea with
 * far more contrast and pushes the paler drought classes toward white.
 *
 * That is why this layer goes *above* the thematic fills on the drought map
 * rather than beneath them. Multiplying the fills over a hillshade would work
 * too, and would change the fills' own colours in the process — and those
 * fills are the Drought Monitor's published palette, which this site reports
 * rather than restyles. Shading from above varies their lightness with the
 * ground and leaves every hue exactly as the monitor set it.
 *
 * The opacity is the whole tuning surface. Too high and the map reads as a
 * relief map with a drought tint; too low and the terrain does nothing. It is
 * higher here than it was under `multiply`, because `soft-light` is a gentler
 * operator: the same opacity through it would be less terrain, not more.
 */
import TileLayer from "@arcgis/core/layers/TileLayer";

/** The public, no-key terrain service. */
export const HILLSHADE_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer";

/**
 * How strongly the ground shows through.
 *
 * Restrained on purpose. At 1 the drought classes read as a terrain map that
 * happens to be tinted; the point is the opposite — classes first, with just
 * enough relief to say which of them are mountains and which are desert
 * basin. This is the one number to change if the terrain is too strong or too
 * faint; the operator below is what decides whether it can brighten at all.
 */
export const HILLSHADE_OPACITY = 0.6;

/**
 * How the shade is combined with what is beneath it.
 *
 * `soft-light` both lightens and darkens around mid-grey. `multiply` — what
 * this was — can only darken. `overlay` is the same idea as `soft-light` with
 * much more contrast, and is the one to try if the relief is still too
 * subtle at a high opacity.
 */
export const HILLSHADE_BLEND_MODE = "soft-light";

/**
 * A terrain layer meant to be drawn over thematic fills.
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
