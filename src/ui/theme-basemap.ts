/*
 * The theme-following basemap for view maps without a gallery.
 *
 * The snow and drought maps both open on the canvas that matches the page
 * theme and swap it when the theme changes. Written once: the sequencing
 * that stops two quick toggles landing out of order is exactly the kind of
 * subtlety that drifts when copied. The storage map keeps its own wiring,
 * because it has a gallery and therefore a reader choice to protect; these
 * maps have no gallery, so the swap is unconditional.
 */
import type ArcGISMap from "@arcgis/core/Map";
import { resolveBasemap } from "../arcgis/basemaps";
import { THEME_CHANGE_EVENT, effectiveThemeNow } from "./theme";

export interface ThemeBasemapStatus {
  basemap: boolean;
  degraded: boolean;
}

/**
 * Resolves the current theme's basemap onto the map and keeps it following
 * the theme. `onChange` reports each applied resolution, the first
 * included, so the caller's readiness fields can follow.
 */
export async function followThemeBasemap(
  map: ArcGISMap,
  onChange: (status: ThemeBasemapStatus) => void
): Promise<void> {
  const apply = async (firstLoad: boolean): Promise<void> => {
    const resolution = await resolveBasemap(effectiveThemeNow());
    /* A failed swap keeps what is on screen: the map still wears its
     * previous basemap, so overwriting the status would make the readiness
     * signal report no background on a map that visibly has one. Only the
     * first load reports a failure, because then there really is nothing. */
    if (!resolution.resource) {
      if (firstLoad) onChange({ basemap: false, degraded: resolution.degraded });
      return;
    }
    /* The property is typed for autocast objects only under exact
     * optional properties; a real Basemap is what it wants at runtime. */
    (map as unknown as { basemap: unknown }).basemap = resolution.resource;
    onChange({ basemap: true, degraded: resolution.degraded });
  };
  await apply(true);
  let pending: Promise<void> = Promise.resolve();
  document.addEventListener(THEME_CHANGE_EVENT, () => {
    /* Sequenced, and never left rejected: a throw out of one swap must not
     * silently disable every later one. */
    pending = pending.then(() => apply(false)).catch((error: unknown) => {
      console.warn("A theme basemap swap failed:", error);
    });
  });
}
