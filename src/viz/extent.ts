/*
 * Where the map is allowed to go, and where selecting a reservoir takes it.
 *
 * The bounds and the minimum zoom are ported from
 * `shared/reservoir-viz.js` and asserted against it in `extent.test.ts`.
 * Both production maps already constrain navigation to this region; the
 * modern shell did not constrain it at all, so a reader could pan a Utah
 * dashboard to the middle of the Pacific and find an empty basemap with no
 * way back except reloading.
 *
 * Everything here is arithmetic over plain numbers. `goTo` is the SDK's,
 * but *where* to go is a decision, and a decision is worth testing.
 */

/**
 * The bounding box of the committed drainage-area polygons.
 *
 * The drainage areas are the primary source, so the map's geography comes
 * from them. A constant rather than a computation because the navigation
 * constraint is needed when the view is constructed, before any boundary
 * file has been fetched -- and a constraint that arrives late is a map that
 * can be panned away in the meantime. `extent.test.ts` recomputes it from
 * `huc6.geojson`, so it cannot drift from the file it describes.
 */
export const HUC6_BOUNDS: readonly [readonly [number, number], readonly [number, number]] =
  [[-115.706, 35.109], [-105.627, 43.451]];

/** A bounding box scaled about its own centre. Two is one zoom level. */
export function expandBounds(
  bounds: readonly [readonly [number, number], readonly [number, number]],
  factor: number
): [[number, number], [number, number]] {
  const [[west, south], [east, north]] = bounds;
  const midX = (west + east) / 2;
  const midY = (south + north) / 2;
  const halfX = ((east - west) / 2) * factor;
  const halfY = ((north - south) / 2) * factor;
  return [[midX - halfX, midY - halfY], [midX + halfX, midY + halfY]];
}

/**
 * Where the map opens, and the furthest out it goes -- the same box, one
 * zoom level out from the drainage areas. Opening on the polygons exactly
 * puts them against the edges of the canvas; one level out gives them the
 * middle of it with the surrounding geography for context, and there is
 * nothing useful further out than that for a dashboard about these
 * drainage areas.
 */
export const MAP_BOUNDS: readonly [readonly [number, number], readonly [number, number]] =
  expandBounds(HUC6_BOUNDS, 2);

/** Keeps a Utah dashboard from becoming a world map, while leaving the
 * connected Colorado River and Great Basin context visible. */
export const MAP_MIN_ZOOM = 4;

export const MAP_CENTER: readonly [number, number] = [-111.55, 39.50];

/** The closest any of the maps will zoom. Deep enough to read a dam. */
export const MAP_MAX_ZOOM = 23;

/**
 * How close selecting a reservoir gets. Chosen so the neighbours stay on
 * screen: a reservoir is worth understanding next to the ones around it,
 * and a view that fills the canvas with one reservoir has thrown away the
 * comparison the map exists to make.
 */
export const SELECTION_ZOOM = 8;

export interface Extent {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  spatialReference: { wkid: number };
}

export function regionExtent(): Extent {
  const [[xmin, ymin], [xmax, ymax]] = MAP_BOUNDS;
  return { xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function withinRegion(lon: number, lat: number): boolean {
  const [[xmin, ymin], [xmax, ymax]] = MAP_BOUNDS;
  return lon >= xmin && lon <= xmax && lat >= ymin && lat <= ymax;
}

export interface SelectionTarget {
  center: [number, number];
  zoom: number;
}

/**
 * Where the view should move when a reservoir is selected.
 *
 * Two rules, and both exist because of what selecting does *not* mean:
 *
 *   - It never zooms out. A reader who has zoomed into a valley and then
 *     picks a reservoir from the list wants to see that reservoir, not to
 *     lose the detail they just navigated to. So the target zoom is the
 *     closer of the current zoom and `SELECTION_ZOOM`.
 *   - It never leaves the region. The centre is clamped into `MAP_BOUNDS`
 *     rather than trusted: the SDK's own constraint would drag the view
 *     back afterwards, and an eased animation that flies out of bounds and
 *     is yanked back reads as a bug even though it ends up correct.
 */
export function selectionTarget(
  reservoir: { lon: number; lat: number },
  currentZoom?: number
): SelectionTarget {
  const [[xmin, ymin], [xmax, ymax]] = MAP_BOUNDS;
  const zoom = Number.isFinite(currentZoom) && (currentZoom as number) > SELECTION_ZOOM
    ? (currentZoom as number)
    : SELECTION_ZOOM;
  return {
    center: [clamp(reservoir.lon, xmin, xmax), clamp(reservoir.lat, ymin, ymax)],
    zoom: Math.max(MAP_MIN_ZOOM, zoom)
  };
}
