/*
 * The drought map: the U.S. Drought Monitor's national polygons in the
 * monitor's own palette, under the fourteen drainage-area outlines.
 *
 * This map lives on the drought view, never on the reservoir map, keeping
 * one colour language per map. The polygons are the committed weekly
 * download the coverage figures were computed from, so the paint and the
 * bars describe the same week by construction. The national sweep is drawn
 * whole -- drought does not stop at the region's edge, and seeing the
 * region inside the wider pattern is context the bars cannot give -- while
 * the outlines say which land the figures below describe.
 */
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-zoom";

import ArcGISMap from "@arcgis/core/Map";
import Graphic from "@arcgis/core/Graphic";
import Polygon from "@arcgis/core/geometry/Polygon";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import type { DrainageArea } from "../data/boundaries";
import type { UsdmPolygons } from "../data/usdm-load";
import { DROUGHT_CLASSES } from "../viz/drought-classes";
import { followThemeBasemap } from "./theme-basemap";
import {
  fitToAreas,
  hexRgba,
  viewReadyWithin,
  type Rgba,
  type ViewMapElement
} from "./view-map";

/* Symbols are property objects rather than constructed classes, the same
 * convention `ui/layers.ts` records: the SDK autocasts them, and anything
 * else fails the property types under `exactOptionalPropertyTypes`. */
type FillSymbol = {
  type: "simple-fill";
  color: Rgba;
  outline: { color: string | Rgba; width: number };
};

export interface DroughtMapStatus {
  basemap: boolean;
  basemapDegraded: boolean;
  viewReady: boolean;
  /** Intensity classes the weekly file carried and the map drew. */
  classesDrawn: number;
  /** Drainage-area outlines drawn over the polygons. */
  outlines: number;
}

export async function createDroughtMap(
  element: ViewMapElement,
  areas: readonly DrainageArea[],
  usdm: UsdmPolygons
): Promise<DroughtMapStatus> {
  const droughtLayer = new GraphicsLayer({ id: "usdm-classes" });
  for (const feature of usdm.features) {
    const entry = DROUGHT_CLASSES[feature.level];
    if (!entry) continue;
    const graphic = new Graphic({
      geometry: new Polygon({ rings: feature.rings }),
      attributes: { level: entry.code }
    });
    /* Fills only, no per-class outline: five national boundaries in five
     * colours over a basemap is noise, and the classes are exclusive so
     * their shared edges already read as edges. */
    const fill: FillSymbol = {
      type: "simple-fill",
      color: hexRgba(entry.color, 0.45),
      outline: { color: [0, 0, 0, 0], width: 0 }
    };
    graphic.symbol = fill;
    droughtLayer.add(graphic);
  }

  const outlineLayer = new GraphicsLayer({ id: "drainage-outlines" });
  for (const area of areas) {
    const graphic = new Graphic({
      geometry: new Polygon({
        rings: area.polygons.flat().map((ring) => ring.map((point) => [...point]))
      }),
      attributes: { huc6: area.huc6, name: area.name }
    });
    const outline: FillSymbol = {
      type: "simple-fill",
      color: [0, 0, 0, 0],
      outline: { color: "#3f4d57", width: 1.2 }
    };
    graphic.symbol = outline;
    outlineLayer.add(graphic);
  }

  const status: DroughtMapStatus = {
    basemap: false,
    basemapDegraded: false,
    viewReady: false,
    classesDrawn: droughtLayer.graphics.length,
    outlines: outlineLayer.graphics.length
  };

  const map = new ArcGISMap({ layers: [droughtLayer, outlineLayer] });
  await followThemeBasemap(map, (basemapStatus) => {
    status.basemap = basemapStatus.basemap;
    status.basemapDegraded = basemapStatus.degraded;
  });
  element.map = map;

  await viewReadyWithin(element);
  status.viewReady = Boolean(element.view?.ready);
  await fitToAreas(element, areas);

  return status;
}
