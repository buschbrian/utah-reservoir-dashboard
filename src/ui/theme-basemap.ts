/*
 * The theme-following basemap for view maps without a gallery.
 *
 * Every map now opens on Oceans, which leads both chains, so re-resolving
 * on a theme change usually lands on the same background it started with.
 * The wiring stays anyway, because the chain is still theme-aware one step
 * down: a reader on the dark page whose oceans style is blocked should get
 * the dark canvas, and that is decided at resolve time, not at load time.
 *
 * Written once: the sequencing that stops two quick toggles landing out of
 * order is exactly the kind of subtlety that drifts when copied. The storage
 * map keeps its own wiring, because it has a gallery and therefore a reader
 * choice to protect; these maps have no gallery, so the swap is
 * unconditional.
 */
import type ArcGISMap from "@arcgis/core/Map";
import { resolveStyledBasemap, type BasemapStyle } from "../arcgis/basemaps";
import {
  followBasemapReference, type BasemapReferenceMode
} from "../arcgis/basemap-reference";
import { THEME_CHANGE_EVENT, effectiveThemeNow } from "./theme";

export interface ThemeBasemapStatus {
  basemap: boolean;
  degraded: boolean;
  /** Basemap reference layers moved below this project's own layers. */
  referenceSunk: number;
}

/**
 * Resolves the current theme's basemap onto the map and keeps it following
 * the theme. `onChange` reports each applied resolution, the first
 * included, so the caller's readiness fields can follow.
 */
export async function followThemeBasemap(
  map: ArcGISMap,
  onChange: (status: ThemeBasemapStatus) => void,
  /* Which chain to resolve from. A map that draws its own place names asks
   * for `minimal` so the background does not label them a second time. */
  style: BasemapStyle = "context",
  /* What to do with the basemap's own reference layers.
   *
   * "sink" for a map that relies on the background for place names, which is
   * most of them. "drop" for one that draws and labels the same features
   * itself -- there a sunk copy is not context, it is a buried second set of
   * the same names. See `arcgis/basemap-reference.ts`. */
  reference: BasemapReferenceMode = "sink"
): Promise<void> {
  /* Registered once, and it covers every later change of basemap -- the
   * theme swaps below and the reader's own choice from the gallery alike. */
  /* Declared before the call, not from it. The callback runs synchronously
   * during the first application, so initialising the variable *from* the
   * call reads it inside its own temporal dead zone -- which threw, and took
   * the whole map down with it. */
  let referenceSunk = 0;
  followBasemapReference(map, reference, (count) => { referenceSunk = count; });
  /* What this module last put on the map, as an object identity.
   *
   * The reader can now pick a background from the gallery, and a theme change
   * must not overrule that choice. The swap only proceeds while the map is
   * still wearing what this module assigned -- the same guard the storage map
   * has always had. */
  let assigned: unknown = null;

  const apply = async (firstLoad: boolean): Promise<void> => {
    if (!firstLoad && assigned !== null
      && (map as unknown as { basemap: unknown }).basemap !== assigned) {
      return;
    }
    const resolution = await resolveStyledBasemap(effectiveThemeNow(), style);
    /* A failed swap keeps what is on screen: the map still wears its
     * previous basemap, so overwriting the status would make the readiness
     * signal report no background on a map that visibly has one. Only the
     * first load reports a failure, because then there really is nothing. */
    if (!resolution.resource) {
      if (firstLoad) {
        onChange({ basemap: false, degraded: resolution.degraded, referenceSunk: 0 });
      }
      return;
    }
    /* The property is typed for autocast objects only under exact
     * optional properties; a real Basemap is what it wants at runtime. */
    (map as unknown as { basemap: unknown }).basemap = resolution.resource;
    assigned = resolution.resource;
    onChange({ basemap: true, degraded: resolution.degraded, referenceSunk });
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
