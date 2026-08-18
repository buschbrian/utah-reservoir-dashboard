/*
 * The geographic context the maps draw from this project's own files: the
 * translucent mask over everything outside Utah, and the roster of drainage
 * areas in the published scope.
 *
 * Both are fetched at runtime, never imported (ADR-002), and both arrive in
 * `reference.json`. The state outline is still the committed
 * `utah-boundary.geojson` unchanged (ADR-018). The drainage areas are no
 * longer geometry at all -- their outlines come from the hosted Watershed
 * Boundary Dataset, and what travels here is which areas are in scope and
 * what each is called, read out of the same committed file the pipeline
 * assigns reservoirs with. That file went from 1,001 KB to 21 KB when the
 * polygons left it.
 *
 * Failure here is deliberately soft. A missing or malformed boundary file
 * costs the reader context; it must not cost them the reservoirs, which are
 * the point of the page.
 */

import { fetchWithin } from "./fetch";
import type { Point, Ring } from "./huc";

export const MASK_FILL = "rgba(226,232,239,0.62)";
export const MASK_LINE = "#8fa3b8";
export const DRAINAGE_FILL = "rgba(226,232,239,0.22)";
export const DRAINAGE_LINE = "#6f8498";

/* Last-resort approximation only. Production loads the maintained UGRC
 * polygon from the reference export; retaining a tiny fallback means a
 * damaged context file cannot take the reservoir map down with it. */
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

export type UtahBoundary = Ring[][];

/**
 * One drainage area in the published scope: which it is and what it is
 * called. No geometry.
 *
 * The outlines come from the hosted Watershed Boundary Dataset now, quantized
 * to the view (`arcgis/watershed-layers.ts`), so what this file carries is
 * the roster rather than the shapes. The codes are read out of the same
 * committed GeoJSON the pipeline assigns reservoirs with, which is what keeps
 * a drawn outline from disagreeing with the area a reservoir was assigned to
 * -- the guarantee ADR-018 was written for, kept without shipping a megabyte
 * to keep it.
 */
export interface DrainageArea {
  huc6: string;
  name: string;
  /** State codes as the national boundary dataset publishes them. */
  states: string;
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

export function parseUtahBoundary(value: unknown): UtahBoundary | null {
  if (!isObject(value) || !Array.isArray(value.features) || value.features.length !== 1) {
    return null;
  }
  const feature = value.features[0];
  if (!isObject(feature)) return null;
  return toPolygons(feature.geometry);
}

/** ArcGIS polygon rings: outer clockwise first, then one state-shaped hole. */
export function utahMaskRings(boundary: UtahBoundary = [[UTAH_RING.slice()]]): Ring[] {
  const stateOuters = boundary.map((polygon) => polygon[0]).filter(Boolean) as Ring[];
  return [SURROUND_RING.slice(), ...stateOuters.map((ring) => ring.slice())];
}

/** Where the reference export is published (ADR-018). */
const REFERENCE_URL = import.meta.env.DEV ? "./reference.json" : "./data/reference.json";

/**
 * The export shape this build understands.
 *
 * Checked rather than assumed. A payload written to a later shape is not a
 * payload with a few unfamiliar keys in it -- it is one whose outlines may
 * live somewhere else entirely, and drawing whatever happens to parse out of
 * it is how a map ends up confidently wrong. An unrecognised version reads
 * as no boundaries, which is a case both callers already handle.
 */
export const REFERENCE_SCHEMA_VERSION = 2;

export interface ReferenceGeography {
  /** The state outline, in the collection shape `parseUtahBoundary` reads. */
  state: unknown;
  /** The published scope's roster, for `parseDrainageUnits`. Codes and
   * names; the outlines are the hosted layer's. */
  drainage: unknown;
}

/**
 * The two collections the maps draw, taken from the reference export.
 *
 * Which scope is the published one is the export's answer to give, not this
 * module's: it names it in `default_scope`, and the research scopes travel
 * in the same file without being drawn (ADR-018). Reading the scope by name
 * from a constant here would be a second place deciding the dashboard's
 * geography, and the two would eventually disagree.
 */
export function referenceGeography(value: unknown): ReferenceGeography | null {
  if (!isObject(value) || value.schema_version !== REFERENCE_SCHEMA_VERSION) return null;
  const geography = isObject(value.geography) ? value.geography : null;
  if (!geography) return null;
  const watersheds = isObject(geography.watersheds) ? geography.watersheds : null;
  const scopes = watersheds && isObject(watersheds.scopes) ? watersheds.scopes : null;
  const published = watersheds?.default_scope;
  const scope = scopes && typeof published === "string" && isObject(scopes[published])
    ? scopes[published]
    : null;
  return { state: geography.state, drainage: scope ? scope.units : null };
}

/* One request, not one per caller. The mask and the outlines are loaded from
 * two independent places in `main.ts` so that either can fail without the
 * other, and both now want the same file -- so the request is shared while
 * the failure is not. Each caller still decides on its own what to do
 * without its boundaries. Keyed by URL so a test can ask for a different
 * file without being handed the previous answer. */
const inFlight = new Map<string, Promise<unknown>>();

/** The reference export, fetched once per URL for as long as the page lives. */
export function loadReference(url = REFERENCE_URL): Promise<unknown> {
  let request = inFlight.get(url);
  if (!request) {
    request = fetchWithin(url).then((response) => response.json() as Promise<unknown>);
    inFlight.set(url, request);
  }
  return request;
}

/** Test seam: drop the shared request so the next load asks again. */
export function forgetReference(): void {
  inFlight.clear();
}

export async function loadUtahBoundary(url = REFERENCE_URL): Promise<UtahBoundary> {
  const boundary = parseUtahBoundary(referenceGeography(await loadReference(url))?.state);
  if (!boundary) throw new Error(`Malformed Utah boundary in ${url}`);
  return boundary;
}

/**
 * Reads the scope's roster, keeping every area it can understand and dropping
 * the ones it cannot. A single malformed entry must not cost the reader the
 * other thirteen.
 *
 * This replaced `parseDrainageAreas`, which read the same list out of a
 * GeoJSON collection and type-checked every coordinate pair on the main
 * thread on the way past -- about 982 KB of walking, on every map page, for
 * geometry the maps no longer draw from.
 */
export function parseDrainageUnits(value: unknown): DrainageArea[] {
  if (!Array.isArray(value)) return [];
  const areas: DrainageArea[] = [];
  for (const entry of value as unknown[]) {
    if (!isObject(entry) || typeof entry.huc6 !== "string") continue;
    areas.push({
      huc6: entry.huc6,
      name: typeof entry.name === "string" && entry.name !== "" ? entry.name : entry.huc6,
      states: typeof entry.states === "string" ? entry.states : ""
    });
  }
  return areas;
}

export async function loadDrainageAreas(url = REFERENCE_URL): Promise<DrainageArea[]> {
  return parseDrainageUnits(referenceGeography(await loadReference(url))?.drainage);
}
