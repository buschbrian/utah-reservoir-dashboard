/*
 * The U.S. Drought Monitor's national polygons, fetched for the drought
 * map. The file is the committed weekly download -- the same one the
 * coverage figures were computed from, so the map and the bars cannot
 * describe two different weeks unless the dates say so, and a test holds
 * the two committed files to one date.
 *
 * The check here is lighter than the payload validators: the geometry is
 * drawn, not calculated with, so it is enough that each feature is one
 * known intensity with polygon coordinates. What is refused is the shape
 * that would lie: a repeated intensity, an unknown one, or a feature that
 * is not a polygon at all.
 */
import type { NullableNumber } from "../types";
import { fetchWithin } from "./fetch";

export interface UsdmPolygons {
  mapDate: string;
  releaseDate: string;
  /** One entry per intensity present, 0 through 4, ascending. */
  features: { level: 0 | 1 | 2 | 3 | 4; rings: number[][][] }[];
}

/** Big file, national geometry: the reservoir deadline is too short. */
export const USDM_TIMEOUT_MS = 30000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ringsOf(geometry: Record<string, unknown>): number[][][] | null {
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates)) return null;
  const polygons = geometry.type === "Polygon" ? [coordinates]
    : geometry.type === "MultiPolygon" ? coordinates : null;
  if (!polygons) return null;
  const rings: number[][][] = [];
  for (const polygon of polygons as unknown[]) {
    if (!Array.isArray(polygon)) return null;
    for (const ring of polygon) {
      /* A degenerate sliver -- under four points, a simplification artifact
       * the weekly download can legitimately carry -- is skipped, not fatal:
       * one bad ring must not blank a map the other thousand rings can
       * draw. A wrong *type* is still fatal above, because that is not an
       * artifact, it is a different file. */
      if (!Array.isArray(ring)) return null;
      if (ring.length < 4) continue;
      rings.push(ring as number[][]);
    }
  }
  return rings.length > 0 ? rings : null;
}

export function parseUsdmPolygons(value: unknown): UsdmPolygons {
  if (!isObject(value) || value.type !== "FeatureCollection"
      || !Array.isArray(value.features)) {
    throw new Error("the drought polygons are not a feature collection");
  }
  if (typeof value.map_date !== "string" || typeof value.release_date !== "string") {
    throw new Error("the drought polygons carry no map or release date");
  }
  const features: UsdmPolygons["features"] = [];
  const seen = new Set<number>();
  for (const feature of value.features as unknown[]) {
    if (!isObject(feature) || !isObject(feature.properties)
        || !isObject(feature.geometry)) {
      throw new Error("a drought feature is malformed");
    }
    const level = feature.properties.DM as NullableNumber;
    if (typeof level !== "number" || !Number.isInteger(level)
        || level < 0 || level > 4) {
      throw new Error(`a drought feature has intensity ${String(level)}`);
    }
    if (seen.has(level)) {
      throw new Error(`intensity D${level} appears twice`);
    }
    seen.add(level);
    const rings = ringsOf(feature.geometry);
    if (!rings) throw new Error(`intensity D${level} is not a polygon`);
    features.push({ level: level as 0 | 1 | 2 | 3 | 4, rings });
  }
  if (features.length === 0) {
    throw new Error("the drought polygons carry no features");
  }
  features.sort((a, b) => a.level - b.level);
  return {
    mapDate: value.map_date,
    releaseDate: value.release_date,
    features
  };
}

export async function loadUsdmPolygons(
  url = "./data/drought/usdm-current.geojson"
): Promise<UsdmPolygons> {
  const response = await fetchWithin(url, USDM_TIMEOUT_MS);
  return parseUsdmPolygons(await response.json() as unknown);
}
