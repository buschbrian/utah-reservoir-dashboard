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
 * rather than over them. On these maps that is the right way round: the fills
 * above them are either semi-transparent (the Utah mask) or thin outlines and
 * small circles, so the names still read — and where they do not, the thing
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
 * The index the first layer this project owns should sit at.
 *
 * Callers that insert a layer at a fixed position need this, because the
 * reference layers have taken the bottom of the stack and a hard-coded `1` no
 * longer means what it did.
 */
export function firstOwnLayerIndex(map: ArcGISMap): number {
  return (moved.get(map) ?? []).length;
}
