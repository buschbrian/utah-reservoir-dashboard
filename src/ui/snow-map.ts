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
 *
 * The reservoirs are deliberately *not* drawn here, and were removed on
 * 2026-08-16 after being tried. This map already carries fourteen filled
 * basins and two hundred and seventeen site markers on one scale, and sixty
 * nine more points with names beside them buried the readings the page
 * exists to show. They earn their place on the drought map, which has five
 * broad national classes and room for them, and they have a whole map of
 * their own besides. Density is the argument, not principle: the same points
 * are good context there and noise here.
 */
import ArcGISMap from "@arcgis/core/Map";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import type { DrainageArea } from "../data/boundaries";
import type { MapDayValues } from "../snow-model";
import type { SnowSite } from "../types";
import { SNOW_CLASSES, snowClassIndex } from "../viz/snow-classes";
import { hitLayerId, type GraphicHit } from "./hit";
import {
  referenceReservoirLines,
  snowBasinLines,
  snowSiteLines
} from "./hover-content";
import {
  createReservoirReferenceLayer,
  RESERVOIR_REFERENCE_LAYER_ID,
  type ReservoirReference
} from "./layers";
import { wireMapHover, type HoverResolution } from "./map-hover";
import { followThemeBasemap } from "./theme-basemap";
import {
  hexRgba,
  viewReadyWithin,
  type Rgba,
  type ViewMapElement
} from "./view-map";

const BASIN_LAYER_ID = "snow-basins";
const SITE_LAYER_ID = "snow-sites";

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
  card: HTMLElement,
  areas: readonly DrainageArea[],
  sites: readonly SnowSite[],
  firstDay: { values: MapDayValues; day: string } | null
): Promise<SnowMapController> {
  const basinLayer = new GraphicsLayer({ id: BASIN_LAYER_ID });
  const siteLayer = new GraphicsLayer({ id: SITE_LAYER_ID });

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

  const siteByStation = new Map(sites.map((site) => [site.station, site]));
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

  /* Order is the reading order: the basin fill is the background and the
   * sites read on top of it. */
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

  /*
   * Hover, on the same wiring the storage map uses.
   *
   * Two layers in one hit test, resolved in the order they are listed -- the
   * SDK answers topmost first, so a site beats the basin under it. Each
   * answer says what the colour under the pointer cannot: how many sites the
   * basin mean came from, and how much snow the percentage is a percentage
   * of.
   */
  wireMapHover(element, {
    card,
    include: () => [siteLayer, basinLayer],
    resolve: (results: readonly GraphicHit[]): HoverResolution | null => {
      for (const result of results) {
        const attributes = result.graphic?.attributes;
        if (!attributes) continue;
        const layerId = hitLayerId(result);

        if (layerId === SITE_LAYER_ID) {
          const site = siteByStation.get(String(attributes["station"]));
          if (!site || !currentValues) continue;
          const percent = currentValues.sites.get(site.station) ?? null;
          const depth = currentValues.depths.get(site.station);
          return {
            content: {
              heading: site.name,
              lines: snowSiteLines(site, percent, depth)
            },
            graphic: result.graphic
          };
        }

        if (layerId === BASIN_LAYER_ID) {
          const huc6 = String(attributes["huc6"]);
          if (!currentValues) continue;
          const percent = currentValues.basins.get(huc6) ?? null;
          const reporting = currentValues.reporting.get(huc6) ?? 0;
          return {
            content: {
              heading: String(attributes["name"]),
              lines: snowBasinLines(percent, reporting)
            },
            graphic: result.graphic
          };
        }
      }
      return null;
    }
  });

  /* The page must not wait forever on a WebGL view: after the deadline the
   * readiness signal reports the view unready and the page moves on -- the
   * same numbers are all in the chart and tables above it. The opening
   * frame is the storage map's region box, set on the element before the
   * view resolves, so there is nothing to fit afterwards. */
  await viewReadyWithin(element);
  status.viewReady = Boolean(element.view?.ready);

  return controller;
}
