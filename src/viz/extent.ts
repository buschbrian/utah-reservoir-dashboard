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

import type { DrainageArea, DrainageAreaBox } from "../data/boundaries";

/**
 * The bounding box of the drainage areas that hold published reservoirs.
 *
 * The drainage areas are the primary source, so the map's geography comes
 * from them -- but from the ones with reservoirs in them, not from every area
 * drawn. Those were the same fourteen areas until the coverage moved west
 * (ADR-063), and 75 areas with 69 reservoirs in a corner of them is a wider
 * map rather than a fuller one: the box would have grown from 10 degrees of
 * longitude to 19 without one more reservoir to look at. So the extent
 * follows the roster and grows when the roster does.
 *
 * A constant rather than a computation because the navigation constraint is
 * needed when the view is constructed, before any boundary file has been
 * fetched -- and a constraint that arrives late is a map that can be panned
 * away in the meantime. `extent.test.ts` recomputes it from whichever file
 * `reference.json` names as the roster scope's, so it cannot drift from the
 * areas it describes and it cannot be left behind when they move.
 *
 * The exact extremes of the committed rings rather than a rounded box. Three
 * decimals cannot express them without either clipping a divide or drifting
 * further from the file than the test's tolerance allows, and this box has to
 * *contain* every polygon. The values moved by about a hundred metres when
 * the boundaries were refetched at 56 metres (ADR-037): finer geometry finds
 * the true extremes that a 500-metre generalization had cut the corners off.
 */
export const HUC6_BOUNDS: readonly [readonly [number, number], readonly [number, number]] =
  [[-115.70611, 35.1088], [-105.62642, 43.45212]];

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
 * The box that contains every one of a set of drainage areas' published
 * boxes -- an opening view built from whichever areas a reader has chosen,
 * rather than the fixed one every map opens on today.
 *
 * `HUC6_BOUNDS` above stays a constant pinned to the frozen oracle
 * (ADR-044) and is not built from this: it is the roster scope's box today,
 * and moving it is slice R1's job, gated on a chooser existing to make the
 * wider box usable (`docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md`). This
 * function is what that chooser (S2) will call once it has narrowed the
 * published areas down to the ones a reader's state, region, subregion or
 * single-area choice actually means.
 *
 * An area with no box (`DrainageArea.box`, absent when `reference.json`
 * published nothing usable for it -- see `parseDrainageUnits`) is skipped
 * rather than failing the whole union: a reader who chose a state with
 * thirteen areas and one broken box still gets a view built from the other
 * twelve, not no view at all. `null` comes back only when *none* of the
 * areas offered a box, which is the caller's signal to fall back to
 * `MAP_BOUNDS` rather than opening on nothing.
 */
export function unionOfAreaBoxes(
  areas: readonly DrainageArea[]
): DrainageAreaBox | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  let found = false;
  for (const area of areas) {
    const box = area.box;
    if (!box) continue;
    const [[boxWest, boxSouth], [boxEast, boxNorth]] = box;
    west = Math.min(west, boxWest);
    south = Math.min(south, boxSouth);
    east = Math.max(east, boxEast);
    north = Math.max(north, boxNorth);
    found = true;
  }
  return found ? [[west, south], [east, north]] : null;
}

/**
 * Where the map opens, and the furthest out it goes -- the same box, one
 * zoom level out from the drainage areas. Opening on the polygons exactly
 * puts them against the edges of the canvas; one level out gives them the
 * middle of it with the surrounding geography for context, and there is
 * nothing useful further out than that for a dashboard about these
 * drainage areas. Since the coverage moved west there is context in the
 * literal sense too: the areas beyond the roster's are drawn, and this box
 * reaches into them.
 */
export const MAP_BOUNDS: readonly [readonly [number, number], readonly [number, number]] =
  expandBounds(HUC6_BOUNDS, 2);

/**
 * How far out any of the maps will go.
 *
 * Measured rather than chosen. In Web Mercator a zoom level is about
 * 1:591,657,527 / 2^z, so this was 4, which is 1:37,000,000 -- most of North
 * America, on a dashboard about one state's water. The three maps open
 * between 1:5,000,000 and 1:11,000,000, so four levels of zoom-out were
 * available and only the first was about Utah.
 *
 * 5 is 1:18,500,000, a little under two levels out from the widest opening
 * view. That still holds the whole connected Colorado River and Great Basin
 * geography this dashboard covers, which reaches from -115.7 to -105.6, and
 * stops well short of a world map.
 *
 * `constraints.geometry` does not do this job. It restricts where the view's
 * centre may go, so on its own it stops a reader panning to Europe and does
 * nothing at all about zooming out until Europe is on screen anyway.
 */
export const MAP_MIN_ZOOM = 5;

export const MAP_CENTER: readonly [number, number] = [-111.55, 39.50];

/**
 * The closest any of the maps will zoom. Deep enough to read a dam.
 *
 * 16 is about 1:9,000, which puts a single dam and its outlet across the
 * canvas. It was 23, roughly 1:70 -- a scale at which a reservoir polygon is
 * kilometres off screen in every direction and the basemap has no tiles left
 * to draw. Nothing this site publishes is measured finely enough to reward
 * going past a dam.
 */
export const MAP_MAX_ZOOM = 16;

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

/**
 * The drainage areas themselves, with no margin around them.
 *
 * Where a map opens depends on the shape of the box it opens in, and the
 * two shapes on this site are very different. The storage map has a whole
 * viewport and opens at `regionExtent`, one zoom level out, which puts the
 * areas in the middle of the canvas with context around them. The snow and
 * drought maps are wide, short cards inside a scrolling page: an extent is
 * a *minimum*, so containing that much latitude in a third of the height
 * spreads the same box across a continent of longitude -- measured at
 * 1:18,000,000 against the storage map's 1:10,700,000, which is far enough
 * out that the region reads as a shape rather than a map.
 *
 * So the cards open on this instead, and land within about a zoom level of
 * the storage map's scale. It is the same subject, framed for the box it is
 * in. The navigation bounds stay `regionExtent` on all three maps, so what
 * a reader can pan to is identical everywhere.
 */
export function drainageExtent(): Extent {
  const [[xmin, ymin], [xmax, ymax]] = HUC6_BOUNDS;
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
