/*
 * Putting the basemap's own boundary and label layer underneath our data.
 *
 * ## The bug this exists for
 *
 * A basemap is two stacks, not one. `basemap.baseLayers` draws below every
 * operational layer, and `basemap.referenceLayers` draws **above every
 * operational layer** — that is what the reference stack is for, so that place
 * names stay readable over whatever a map puts on top of the ground.
 *
 * Oceans carries "World Ocean Reference" in that second stack, and it contains
 * state boundaries as well as labels. So every map on this site was drawing a
 * borrowed grey administrative line over its own subject: most visibly a line
 * straight through Flaming Gorge, which sits on the Utah–Wyoming border.
 *
 * The important part is that **no operational reordering could have fixed
 * this.** An earlier pass moved the hosted state boundaries to the bottom of
 * the operational stack and the line stayed exactly where it was, because the
 * line was never in the operational stack. It was in the basemap.
 *
 * ## What this does
 *
 * Takes the reference layers out of the basemap and re-adds them as the
 * bottom-most operational layers, where they draw above the base tiles and
 * below everything this project draws.
 *
 * The trade is that the borrowed place names now sit under our own layers
 * rather than over them. On these maps that is the right way round: what
 * draws above them is thin drainage-area outlines and small reservoir
 * circles, so the names still read — and where they do not, the thing
 * covering them is the subject the reader came for.
 *
 * ## Why it has to be repeatable
 *
 * The basemap is swapped when the theme changes. Each swap brings a fresh
 * reference stack, so this runs again — and it has to take the previous swap's
 * layers back out, or every toggle would leave another copy behind. That is
 * what the register is for.
 */
import type ArcGISMap from "@arcgis/core/Map";
import type Layer from "@arcgis/core/layers/Layer";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";

/**
 * The layers this module has moved into each map, so a later run can remove
 * exactly those and leave the map's own layers alone. Keyed by map so a page
 * with more than one map cannot clear another map's entry.
 */
const moved = new WeakMap<ArcGISMap, Layer[]>();

interface BasemapLike {
  referenceLayers?: {
    toArray(): Layer[];
    removeAll(): void;
  };
}

/**
 * Moves the current basemap's reference layers to the bottom of the
 * operational stack. Safe to call repeatedly, and safe on a map whose basemap
 * has no reference layers or has not resolved.
 *
 * Returns how many layers were moved, which is what the readiness signal
 * reports: a map that silently stopped moving them would look identical until
 * someone noticed a line through a reservoir again.
 */

export function sinkBasemapReferenceLayers(map: ArcGISMap): number {
  const previous = moved.get(map);
  if (previous) {
    for (const layer of previous) map.remove(layer);
    moved.delete(map);
  }

  const basemap = (map as unknown as { basemap?: BasemapLike }).basemap;
  const reference = basemap?.referenceLayers;
  if (!reference) return 0;

  const layers = reference.toArray();
  if (layers.length === 0) return 0;

  /* Out of the basemap first. Left in both places the SDK would draw them
   * twice, and the copy still in the reference stack would draw on top --
   * which is the exact problem this function exists to remove. */
  reference.removeAll();
  layers.forEach((layer, index) => map.add(layer, index));
  moved.set(map, layers);
  return layers.length;
}

/**
 * Takes the reference layers out and throws them away.
 *
 * For a map that draws its own boundaries *and* labels the same features, in
 * which case the basemap's copy is not context, it is a second set of the
 * same names -- and sinking it makes that worse rather than better, because a
 * buried duplicate is mush under the subject rather than a legible label.
 *
 * The drought map is that case: it carries hosted state and county
 * boundaries with its own labelling, on the ladder in `viz/label-scales.ts`,
 * drawn in the label pass above every layer. One legible set is the goal, and
 * this is how it gets one.
 */
export function dropBasemapReferenceLayers(map: ArcGISMap): number {
  const previous = moved.get(map);
  if (previous) {
    for (const layer of previous) map.remove(layer);
    moved.delete(map);
  }
  const basemap = (map as unknown as { basemap?: BasemapLike }).basemap;
  const reference = basemap?.referenceLayers;
  if (!reference) return 0;
  const count = reference.toArray().length;
  reference.removeAll();
  return count;
}

/** How a map wants its basemap's reference layers treated. */
export type BasemapReferenceMode = "sink" | "drop";

/**
 * Applies the mode now, and again every time the basemap changes.
 *
 * The gallery is why this exists. A reader picking a background assigns
 * `map.basemap` directly, which goes nowhere near the code that resolved the
 * first one -- so without a watcher the new basemap arrives with its
 * reference layers on top of the data again, and the previous basemap's sunk
 * copy is left behind in the operational stack as a second, stale ground.
 * Both were observed the moment the gallery was added to these maps.
 *
 * Returns the count from the first application, for the readiness signal.
 */
export function followBasemapReference(
  map: ArcGISMap,
  mode: BasemapReferenceMode = "sink",
  /* Called on every application, so a caller reporting the count in a
   * readiness signal keeps it current instead of holding the number from
   * first paint. */
  onApplied?: (count: number) => void
): number {
  const apply = (): number => {
    const count = mode === "drop"
      ? dropBasemapReferenceLayers(map)
      : sinkBasemapReferenceLayers(map);
    onApplied?.(count);
    return count;
  };
  const first = apply();
  reactiveUtils.watch(
    () => (map as unknown as { basemap: unknown }).basemap,
    () => { apply(); }
  );
  return first;
}
