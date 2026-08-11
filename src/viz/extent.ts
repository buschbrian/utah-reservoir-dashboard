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

/** Provisional (ADR-009 / Phase 1.5): it stops making sense once the
 * connected out-of-state reservoirs land, at which point the region should
 * be computed from the sites and boundaries actually on the map. */
export const MAP_BOUNDS: readonly [readonly [number, number], readonly [number, number]] =
  [[-117.55, 33.90], [-105.55, 45.10]];

/** Keeps a Utah dashboard from becoming a world map, while leaving the
 * connected Colorado River and Great Basin context visible. */
export const MAP_MIN_ZOOM = 4;

export const MAP_CENTER: readonly [number, number] = [-111.55, 39.50];

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
