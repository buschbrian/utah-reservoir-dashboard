/*
 * The drawn layers, built as plain graphics from data already in memory.
 *
 * Three separate layers, and they are added independently on purpose: the
 * mask and the drainage outlines are context, the reservoirs are the page.
 * A boundary file that fails to load costs the reader context and nothing
 * else, so nothing here throws on the way to drawing the points.
 */

import Graphic from "@arcgis/core/Graphic";
import Polygon from "@arcgis/core/geometry/Polygon";
import Point from "@arcgis/core/geometry/Point";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import {
  DRAINAGE_FILL,
  DRAINAGE_LINE,
  MASK_FILL,
  MASK_LINE,
  utahMaskRings,
  type DrainageArea,
  type UtahBoundary
} from "../data/boundaries";
import type { Ring } from "../data/huc";
import type { Reservoir } from "../types";
import { reservoirSymbol, sizeDomain } from "../viz/symbols";

/** The attribute every reservoir graphic carries, and the only one selection reads. */
export const NAME_FIELD = "name";

const WGS84 = { wkid: 4326 };

/* Symbols are written as property objects rather than constructed classes.
 * The SDK autocasts them, and a constructed symbol does not satisfy the
 * property types under `exactOptionalPropertyTypes`: its own optional
 * members are `T | null | undefined` where the property type accepts only
 * `T | null`. */
type Fill = { type: "simple-fill"; color: string; outline: { color: string; width: number } };

const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0];

function areaSymbol(fill: string, line: string): Fill {
  return { type: "simple-fill", color: fill, outline: { color: line, width: 1 } };
}

/** ArcGIS polygon rings want mutable arrays; ours are readonly by design. */
function mutableRings(rings: readonly Ring[]): number[][][] {
  return rings.map((ring) => ring.map(([lon, lat]) => [lon, lat]));
}

export function createMaskLayer(boundary?: UtahBoundary): GraphicsLayer {
  const layer = new GraphicsLayer({ id: "utah-mask", listMode: "hide" });
  layer.add(new Graphic({
    geometry: new Polygon({ rings: mutableRings(utahMaskRings(boundary)), spatialReference: WGS84 }),
    symbol: areaSymbol(MASK_FILL, MASK_LINE)
  }));
  return layer;
}

export function createDrainageLayer(areas: readonly DrainageArea[]): GraphicsLayer {
  const layer = new GraphicsLayer({ id: "drainage-areas", listMode: "hide" });
  for (const area of areas) {
    for (const polygon of area.polygons) {
      layer.add(new Graphic({
        geometry: new Polygon({ rings: mutableRings(polygon), spatialReference: WGS84 }),
        symbol: areaSymbol(DRAINAGE_FILL, DRAINAGE_LINE),
        attributes: { huc6: area.huc6, name: area.name }
      }));
    }
  }
  return layer;
}

export interface ReservoirLayerResult {
  layer: GraphicsLayer;
  /** Reservoirs actually drawn -- what the readiness signal reports. */
  drawn: number;
}

/**
 * Two graphics per reservoir: the ring carries physical scale, the fill
 * carries how full it is. Both carry the name, so a pointer landing on
 * either one selects the same reservoir.
 */
export function createReservoirLayer(
  reservoirs: readonly Reservoir[]
): ReservoirLayerResult {
  const layer = new GraphicsLayer({ id: "reservoirs", listMode: "hide" });
  const domain = sizeDomain(reservoirs);
  let drawn = 0;

  for (const reservoir of reservoirs) {
    const symbol = reservoirSymbol(reservoir, domain);
    const geometry = new Point({
      longitude: reservoir.lon,
      latitude: reservoir.lat,
      spatialReference: WGS84
    });
    const attributes = { [NAME_FIELD]: reservoir.name };

    layer.add(new Graphic({
      geometry,
      attributes,
      symbol: {
        type: "simple-marker",
        style: "circle",
        color: TRANSPARENT,
        size: symbol.ringPx,
        outline: {
          color: symbol.accent ?? symbol.color,
          width: symbol.accent ? 1.5 : 1,
          // A dashed ring is how both production maps say "this reading is
          // older than this reservoir's own update schedule".
          style: symbol.accent ? "short-dash" : "solid"
        }
      }
    }));

    if (symbol.fillPx > 0) {
      layer.add(new Graphic({
        geometry,
        attributes,
        symbol: {
          type: "simple-marker",
          style: "circle",
          color: symbol.color,
          size: symbol.fillPx,
          outline: { color: [0, 0, 0, 0.4], width: 0.75 }
        }
      }));
    }
    drawn += 1;
  }

  return { layer, drawn };
}

export function createHighlightLayer(): GraphicsLayer {
  return new GraphicsLayer({ id: "selection", listMode: "hide" });
}

/** The ring around the selected reservoir. One graphic, replaced each time. */
export function showHighlight(
  layer: GraphicsLayer,
  reservoir: Reservoir | null,
  reservoirs: readonly Reservoir[]
): void {
  layer.removeAll();
  if (!reservoir) return;
  const symbol = reservoirSymbol(reservoir, sizeDomain(reservoirs));
  layer.add(new Graphic({
    geometry: new Point({
      longitude: reservoir.lon,
      latitude: reservoir.lat,
      spatialReference: WGS84
    }),
    symbol: {
      type: "simple-marker",
      style: "circle",
      color: TRANSPARENT,
      size: symbol.ringPx + 14,
      outline: { color: "#1b2b34", width: 2.5 }
    }
  }));
}
