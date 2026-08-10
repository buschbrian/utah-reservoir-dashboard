/*
 * The two pieces of geographic context both production maps already draw:
 * the translucent mask over everything outside Utah, and the drainage-area
 * outlines.
 *
 * Both are fetched or built at runtime, never imported (ADR-002). The
 * boundaries come from the committed `huc6.geojson` rather than from the
 * live national service, so the outlines cannot disagree with the drainage
 * assignments already in `reservoirs.json`, and a service outage cannot
 * blank the map.
 *
 * Failure here is deliberately soft. A missing or malformed boundary file
 * costs the reader context; it must not cost them the reservoirs, which are
 * the point of the page.
 */

import type { Point, Ring } from "./huc";

export const MASK_FILL = "rgba(226,232,239,0.62)";
export const MASK_LINE = "#8fa3b8";
export const DRAINAGE_FILL = "rgba(226,232,239,0.22)";
export const DRAINAGE_LINE = "#6f8498";

/* Utah's borders are surveyed lines of latitude and longitude, which is why
 * this is six corners and not a shapefile: 42°N to 37°N, 114°03'W to
 * 109°03'W, with the northeast notch belonging to Wyoming. Ported from
 * `shared/reservoir-viz.js`, value for value, and asserted against it. */
const UTAH_W = -114.052;
const UTAH_E = -109.041;
const UTAH_S = 37.0;
const UTAH_N = 42.0;
const NOTCH_W = -111.047;
const NOTCH_S = 41.0;

/** Counterclockwise from the northwest corner: an ArcGIS hole ring. */
const UTAH_RING: readonly Point[] = [
  [UTAH_W, UTAH_N], [UTAH_W, UTAH_S], [UTAH_E, UTAH_S],
  [UTAH_E, NOTCH_S], [NOTCH_W, NOTCH_S], [NOTCH_W, UTAH_N],
  [UTAH_W, UTAH_N]
];

/* Continent-sized rather than global: a ring spanning the antimeridian is
 * ambiguous about which side it encloses, and the SDK resolved that by
 * dropping the outer ring and dimming Utah instead of everything else. */
const SURROUND_RING: readonly Point[] = [
  [-160, 72], [-45, 72], [-45, 8], [-160, 8], [-160, 72]
];

/** ArcGIS polygon rings: outer clockwise first, then the hole. */
export function utahMaskRings(): Ring[] {
  return [SURROUND_RING.slice(), UTAH_RING.slice()];
}

export interface DrainageArea {
  huc6: string;
  name: string;
  /** State codes as the national boundary dataset publishes them. */
  states: string;
  /** One polygon is one ring list; a multipolygon is several. */
  polygons: Ring[][];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRing(value: unknown): Ring | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const ring: Point[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) return null;
    const [lon, lat] = entry as unknown[];
    if (typeof lon !== "number" || typeof lat !== "number") return null;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    ring.push([lon, lat]);
  }
  return ring;
}

function toPolygons(geometry: unknown): Ring[][] | null {
  if (!isObject(geometry) || !Array.isArray(geometry.coordinates)) return null;
  const nested = geometry.type === "MultiPolygon"
    ? geometry.coordinates
    : geometry.type === "Polygon" ? [geometry.coordinates] : null;
  if (!nested) return null;

  const polygons: Ring[][] = [];
  for (const polygon of nested as unknown[]) {
    if (!Array.isArray(polygon)) return null;
    const rings: Ring[] = [];
    for (const candidate of polygon) {
      const ring = toRing(candidate);
      if (!ring) return null;
      rings.push(ring);
    }
    if (rings.length > 0) polygons.push(rings);
  }
  return polygons.length > 0 ? polygons : null;
}

/**
 * Reads the boundary collection, keeping every area it can understand and
 * dropping the ones it cannot. A single malformed feature must not cost the
 * reader the other thirteen outlines.
 */
export function parseDrainageAreas(value: unknown): DrainageArea[] {
  if (!isObject(value) || !Array.isArray(value.features)) return [];
  const areas: DrainageArea[] = [];
  for (const feature of value.features as unknown[]) {
    if (!isObject(feature)) continue;
    const properties = isObject(feature.properties) ? feature.properties : {};
    const polygons = toPolygons(feature.geometry);
    if (!polygons || typeof properties.huc6 !== "string") continue;
    areas.push({
      huc6: properties.huc6,
      name: typeof properties.name === "string" ? properties.name : properties.huc6,
      states: typeof properties.states === "string" ? properties.states : "",
      polygons
    });
  }
  return areas;
}

export async function loadDrainageAreas(
  url = import.meta.env.DEV ? "./huc6.geojson" : "./data/huc6.geojson"
): Promise<DrainageArea[]> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
  return parseDrainageAreas(await response.json() as unknown);
}
