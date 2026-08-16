/*
 * The snow map: drainage areas filled by their mean percent of normal for
 * one day of the water year, with every measurement site as a point reading
 * on the same scale (the one idiom the agency's own map gets right, adopted
 * by the external product review in the modernization plan).
 *
 * Graphics, not FeatureLayers: fourteen polygons and two hundred points that
 * change symbol when the day changes are cheaper to hold as graphics than to
 * rebuild as a layer, and none of the storage map's renderer machinery is
 * needed. Colours come from `SNOW_CLASSES` only.
 */
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-zoom";

import ArcGISMap from "@arcgis/core/Map";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import type { DrainageArea } from "../data/boundaries";
import type { MapDayValues } from "../snow-model";
import type { SnowSite } from "../types";
import { SNOW_CLASSES, snowClassIndex } from "../viz/snow-classes";
import { followThemeBasemap } from "./theme-basemap";
import {
  fitToAreas,
  hexRgba,
  viewReadyWithin,
  type Rgba,
  type ViewMapElement
} from "./view-map";

export interface SnowMapStatus {
  basemap: boolean;
  basemapDegraded: boolean;
  viewReady: boolean;
  basins: number;
  sites: number;
  basinsWithValues: number;
  sitesWithValues: number;
  day: string | null;
}

export interface SnowMapController {
  status: SnowMapStatus;
  /** Recolours every basin and site for one day. */
  setDay(values: MapDayValues, day: string): void;
  /** Emphasises one drainage area's outline, or none. */
  setArea(huc6: string | null): void;
}

const OUTLINE = { color: "#5b6b7a", width: 0.7 };
const CHOSEN_OUTLINE = { color: "#27363f", width: 2.2 };

/* Symbols are property objects rather than constructed classes, the same
 * convention `ui/layers.ts` records: the SDK autocasts them, and a
 * constructed symbol does not satisfy the property types under
 * `exactOptionalPropertyTypes`. */
type FillSymbol = {
  type: "simple-fill";
  color: Rgba;
  outline: { color: string; width: number };
};
type MarkerSymbol = {
  type: "simple-marker";
  size: number;
  color: Rgba;
  outline: { color: string; width: number };
};

function basinSymbol(percent: number | null, chosen: boolean): FillSymbol {
  const index = snowClassIndex(percent);
  const entry = index === null ? null : SNOW_CLASSES[index];
  return {
    type: "simple-fill",
    color: entry ? hexRgba(entry.color, 0.5) : [148, 155, 162, 0.12],
    outline: chosen ? CHOSEN_OUTLINE : OUTLINE
  };
}

function siteSymbol(percent: number | null): MarkerSymbol {
  const index = snowClassIndex(percent);
  const entry = index === null ? null : SNOW_CLASSES[index];
  return entry
    ? {
      type: "simple-marker",
      size: 6,
      color: hexRgba(entry.color, 0.95),
      outline: { color: "#ffffff", width: 0.8 }
    }
    : {
      type: "simple-marker",
      size: 3.5,
      color: [255, 255, 255, 0.25],
      outline: { color: "#8a949c", width: 0.8 }
    };
}

export async function createSnowMap(
  element: ViewMapElement,
  areas: readonly DrainageArea[],
  sites: readonly SnowSite[],
  firstDay: { values: MapDayValues; day: string } | null
): Promise<SnowMapController> {
  const basinLayer = new GraphicsLayer({ id: "snow-basins" });
  const siteLayer = new GraphicsLayer({ id: "snow-sites" });

  const basinGraphics = new Map<string, Graphic>();
  for (const area of areas) {
    /* All rings of all parts in one polygon: the even-odd rule keeps holes
     * and multiple parts correct without carrying the distinction. */
    const graphic = new Graphic({
      geometry: new Polygon({
        rings: area.polygons.flat().map((ring) => ring.map((point) => [...point]))
      }),
      attributes: { huc6: area.huc6, name: area.name }
    });
    /* Assigned rather than constructed: the constructor's property type
     * refuses a built symbol instance under exact optional properties, the
     * instance property accepts it. */
    graphic.symbol = basinSymbol(null, false);
    basinGraphics.set(area.huc6, graphic);
    basinLayer.add(graphic);
  }

  const siteGraphics = new Map<string, Graphic>();
  for (const site of sites) {
    const graphic = new Graphic({
      geometry: new Point({ longitude: site.lon, latitude: site.lat }),
      attributes: { station: site.station, name: site.name }
    });
    graphic.symbol = siteSymbol(null);
    siteGraphics.set(site.station, graphic);
    siteLayer.add(graphic);
  }

  const status: SnowMapStatus = {
    basemap: false,
    basemapDegraded: false,
    viewReady: false,
    basins: basinGraphics.size,
    sites: siteGraphics.size,
    basinsWithValues: 0,
    sitesWithValues: 0,
    day: null
  };

  const map = new ArcGISMap({ layers: [basinLayer, siteLayer] });
  await followThemeBasemap(map, (basemapStatus) => {
    status.basemap = basemapStatus.basemap;
    status.basemapDegraded = basemapStatus.degraded;
  });
  element.map = map;

  let chosenArea: string | null = null;
  let currentValues: MapDayValues | null = null;

  const controller: SnowMapController = {
    status,
    setDay(values, day) {
      currentValues = values;
      status.day = day;
      let basinsWithValues = 0;
      for (const [huc6, graphic] of basinGraphics) {
        const percent = values.basins.get(huc6) ?? null;
        if (percent !== null) basinsWithValues += 1;
        graphic.symbol = basinSymbol(percent, huc6 === chosenArea);
      }
      let sitesWithValues = 0;
      for (const [station, graphic] of siteGraphics) {
        const percent = values.sites.get(station) ?? null;
        if (percent !== null) sitesWithValues += 1;
        graphic.symbol = siteSymbol(percent);
      }
      status.basinsWithValues = basinsWithValues;
      status.sitesWithValues = sitesWithValues;
    },
    setArea(huc6) {
      chosenArea = huc6;
      if (currentValues && status.day) controller.setDay(currentValues, status.day);
    }
  };

  if (firstDay) controller.setDay(firstDay.values, firstDay.day);

  /* The page must not wait forever on a WebGL view: after the deadline the
   * readiness signal reports the view unready and the page moves on -- the
   * same numbers are all in the chart and tables above it. */
  await viewReadyWithin(element);
  status.viewReady = Boolean(element.view?.ready);
  await fitToAreas(element, areas);

  return controller;
}
