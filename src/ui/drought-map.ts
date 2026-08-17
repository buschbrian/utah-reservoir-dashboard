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
 *
 * State outlines and, once the reader is close enough for them to mean
 * anything, county outlines come from the authoritative hosted services
 * rather than committed copies (`arcgis/reference-layers.ts`). The national
 * sweep is the reason: a drought pattern drawn across the whole West needs
 * something that says which West, and the coverage figures below do not
 * depend on those boundaries in any way, so a service that may simply not
 * answer is the right kind of dependency for them.
 *
 * The reservoirs are drawn over both as neutral labelled reference points.
 * They carry no storage colour: the monitor's palette owns this map. What
 * they add is the join the page is built around, made visible rather than
 * only tabulated -- a reader can see which reservoirs sit inside the D4
 * patch instead of matching two lists of drainage-area names by eye.
 */
import ArcGISMap from "@arcgis/core/Map";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import type { ReferenceLayers } from "../arcgis/reference-layers";
import { createHillshadeLayer } from "../arcgis/hillshade";
import type { DrainageArea } from "../data/boundaries";
import { drainageLabelPoint } from "../data/huc";
import type { StorageContext } from "../drought-model";
import type { UsdmPolygons } from "../data/usdm-load";
import type { DroughtUnit } from "../types";
import { DROUGHT_CLASSES } from "../viz/drought-classes";
import {
  DRAINAGE_LABEL_SIZE_PX, LABEL_FONT_FAMILY, LABEL_FONT_WEIGHT_BOLD
} from "../viz/label-scales";
import { hitLayerId, type GraphicHit } from "./hit";
import {
  droughtAreaLines,
  droughtClassLines,
  droughtNoteForArea,
  referenceReservoirLines
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

const CLASS_LAYER_ID = "usdm-classes";
const OUTLINE_LAYER_ID = "drainage-outlines";
const AREA_LABEL_LAYER_ID = "drainage-names";

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
  /** Drainage areas carrying their name. One per area with an interior
   * point, which is every area unless a shape defeats the search. */
  areaLabels: number;
  /** Reservoirs drawn for reference, 0 when that payload could not be read. */
  reservoirs: number;
  /** True while those reference reservoirs are carrying their names. */
  reservoirLabels: boolean;
  /** True when the hosted state boundaries answered and were drawn. False
   * is a supported outcome, not a failure: the page is complete without
   * them. */
  stateBoundaries: boolean;
  /** True when the hosted county boundaries answered. They stay hidden
   * until the reader is close enough for them to mean anything, so this
   * reports that the layer is there, not that it is on screen. */
  countyBoundaries: boolean;
}

/** What the map needs to describe an area under the pointer: the coverage
 * row the bars are drawn from, and the storage joined beside it. */
export interface DroughtMapContext {
  units: readonly DroughtUnit[];
  storage: ReadonlyMap<string, StorageContext>;
}

export async function createDroughtMap(
  element: ViewMapElement,
  card: HTMLElement,
  areas: readonly DrainageArea[],
  usdm: UsdmPolygons,
  reservoirs: readonly ReservoirReference[],
  context: DroughtMapContext,
  boundaries: ReferenceLayers
): Promise<DroughtMapStatus> {
  const droughtLayer = new GraphicsLayer({ id: CLASS_LAYER_ID });
  for (const feature of usdm.features) {
    const entry = DROUGHT_CLASSES[feature.level];
    if (!entry) continue;
    const graphic = new Graphic({
      geometry: new Polygon({ rings: feature.rings }),
      attributes: { level: entry.code, label: entry.label }
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

  /*
   * Cased boundaries, because one stroke cannot survive this palette.
   *
   * The Drought Monitor's classes run #ffff00 through #730000 -- relative
   * luminance about 0.93 down to 0.04. A single dark line was 1.2px of
   * #3f4d57: clear on the yellow end and all but invisible on the maroon,
   * which is where a drainage boundary matters most, because that is where a
   * reader is trying to see which basin the worst class is inside.
   *
   * No single colour works across that range, so each boundary is drawn
   * twice: a wide near-white casing first, then a narrow near-black core over
   * it. On a pale class the core carries the line and the casing disappears;
   * on a dark class the casing carries it and the core disappears. One of the
   * two is always doing the work.
   *
   * Achromatic on purpose. These outlines are reference geometry over the
   * monitor's own palette, and a coloured boundary would read as a sixth
   * class (ADR-032).
   */
  const outlineLayer = new GraphicsLayer({ id: OUTLINE_LAYER_ID });
  const boundaryRings = (area: DrainageArea): number[][][] =>
    area.polygons.flat().map((ring) => ring.map((point) => [...point]));
  for (const area of areas) {
    outlineLayer.add(new Graphic({
      geometry: new Polygon({ rings: boundaryRings(area) }),
      attributes: { huc6: area.huc6, name: area.name },
      symbol: {
        type: "simple-fill",
        color: [0, 0, 0, 0],
        outline: { color: "rgba(255,255,255,0.85)", width: 3.4 }
      } as FillSymbol
    }));
  }
  for (const area of areas) {
    /* The core in its own pass, so every casing is already down before any
     * core is drawn -- otherwise one area's casing paints over its
     * neighbour's core along a shared edge. */
    outlineLayer.add(new Graphic({
      geometry: new Polygon({ rings: boundaryRings(area) }),
      attributes: { huc6: area.huc6, name: area.name },
      symbol: {
        type: "simple-fill",
        color: [0, 0, 0, 0],
        outline: { color: "rgba(23,32,38,0.95)", width: 1.3 }
      } as FillSymbol
    }));
  }

  /*
   * The drainage areas' own names.
   *
   * This map's whole subject is what the monitor says about each of these
   * fourteen areas, and every figure below it is keyed to one of them by
   * name -- so the map has to say which shape is which. It carried no names
   * at all, which left a reader matching an outline to a table row by
   * position.
   *
   * Text symbols in a layer of their own rather than feature labelling. The
   * outlines are graphics, and a text symbol sits exactly where this puts it,
   * above the classes and the terrain and below the reservoirs. The name goes
   * at each area's interior point -- `drainageLabelPoint` finds one inside
   * the shape rather than at the average of its vertices, which for a
   * horseshoe-shaped basin is outside it.
   *
   * Cased like the boundaries and for the same reason: a dark name with a
   * bright halo reads on the pale classes because the letters are dark, and
   * on the dark classes because the halo is bright.
   */
  const labelLayer = new GraphicsLayer({ id: AREA_LABEL_LAYER_ID });
  let areaLabels = 0;
  for (const area of areas) {
    const point = drainageLabelPoint(area.polygons);
    if (!point) {
      console.warn(`No interior label point for ${area.name}; its name is not drawn.`);
      continue;
    }
    areaLabels += 1;
    labelLayer.add(new Graphic({
      /* `drainageLabelPoint` answers a [longitude, latitude] tuple, not an
       * SDK geometry -- passing it straight in is silently rejected by the
       * accessor and the name never draws. The storage map wraps it the same
       * way. */
      geometry: new Point({
        longitude: point[0], latitude: point[1], spatialReference: { wkid: 4326 }
      }),
      attributes: { huc6: area.huc6, name: area.name },
      symbol: {
        type: "text",
        text: area.name,
        color: "rgba(23,32,38,0.98)",
        haloColor: "rgba(255,255,255,0.92)",
        haloSize: "2.4px",
        font: {
          family: LABEL_FONT_FAMILY,
          size: `${DRAINAGE_LABEL_SIZE_PX}px`,
          weight: LABEL_FONT_WEIGHT_BOLD
        }
      }
    } as unknown as ConstructorParameters<typeof Graphic>[0]));
  }

  const reference = createReservoirReferenceLayer(reservoirs);
  const reservoirByName = new Map(
    reservoirs.map((reservoir) => [reservoir.name, reservoir]));
  const areaNames = new Map(areas.map((area) => [area.huc6, area.name]));
  const unitByHuc6 = new Map(context.units.map((unit) => [unit.huc6, unit]));

  const status: DroughtMapStatus = {
    basemap: false,
    basemapDegraded: false,
    viewReady: false,
    classesDrawn: droughtLayer.graphics.length,
    /* Areas outlined, not graphics drawn. Each boundary is a casing and a
     * core, so the graphic count is twice the number of drainage areas and
     * would answer a different question from the one this field asks. */
    outlines: areas.length,
    areaLabels,
    reservoirs: reference.drawn,
    reservoirLabels: reference.labelled,
    stateBoundaries: boundaries.states !== null,
    countyBoundaries: boundaries.counties !== null
  };

  /*
   * Bottom to top, and the rule is that borrowed reference geography goes
   * behind everything this project draws -- on this map and on any other that
   * gains it.
   *
   * States and counties are context: they say which land the pattern crosses.
   * Drawing them over the monitor's classes put a borrowed line on top of the
   * subject and made the fills look sliced. Underneath, they read as ground
   * the data sits on, which is what they are.
   *
   * Their names are unaffected by this, and that is the reason it costs
   * nothing: the SDK paints labels in a pass above the features of every
   * layer, whatever the operational order (the same behaviour ADR-030 had to
   * work around for the drainage names). So the outlines recede and the place
   * names stay legible.
   *
   * Above them the order is the label ladder in `viz/label-scales.ts` drawn
   * out: the classes are the subject, then the fourteen drainage outlines and
   * their reservoirs, because those are what the figures on the page describe.
   */
  /*
   * Terrain over the classes, not under them.
   *
   * The usual way round is to multiply thematic fills over a hillshade, but
   * that darkens the fills themselves -- and these fills are the Drought
   * Monitor's own published colours, which this site is not entitled to
   * restate in a different hue. Putting the shade *above* the classes and
   * multiplying it leaves every class the colour the monitor gave it and
   * varies only its lightness with the ground, which is the part a reader
   * was missing: the classes are drawn on the flattest possible background,
   * so nothing said where the mountains that make the water actually are.
   *
   * Above the classes and below the outlines and reservoirs, so the shade
   * never darkens this project's own reference geometry.
   */
  const hillshade = createHillshadeLayer();
  const map = new ArcGISMap({
    layers: [
      ...(boundaries.states ? [boundaries.states] : []),
      ...(boundaries.counties ? [boundaries.counties] : []),
      droughtLayer,
      hillshade,
      outlineLayer,
      labelLayer,
      reference.layer
    ]
  });
  /* A quiet background on purpose. This map labels states itself, from the
   * same hosted layer it outlines them with, and the Oceans reference layer
   * labels them too -- so every state carried two names, in two typefaces, at
   * two sizes. The relief Oceans brings is worth that trade on the storage
   * and snow maps, where the subject sits on terrain and nothing else writes
   * place names; here it is a background competing with the foreground. */
  await followThemeBasemap(map, (basemapStatus) => {
    status.basemap = basemapStatus.basemap;
    status.basemapDegraded = basemapStatus.degraded;
    /* This map draws hosted state and county boundaries and labels them on
     * the ladder, in the label pass above every layer. The background's own
     * copy of those names is therefore a duplicate, and sinking it leaves the
     * duplicate underneath the drought classes where it reads as mush. One
     * legible set instead. */
  }, "minimal", "drop");
  element.map = map;

  /*
   * Hover, on the same wiring the storage and snow maps use.
   *
   * The drainage outlines are hit before the national polygons, so pointing
   * inside the region answers with the figures the page below is actually
   * about -- the area's own coverage and the storage banked in it -- and
   * pointing outside it still names the class, which is what the wider
   * pattern is drawn for.
   */
  wireMapHover(element, {
    card,
    include: () => [reference.layer, outlineLayer, droughtLayer],
    resolve: (results: readonly GraphicHit[]): HoverResolution | null => {
      for (const result of results) {
        const attributes = result.graphic?.attributes;
        if (!attributes) continue;
        const layerId = hitLayerId(result);

        if (layerId === RESERVOIR_REFERENCE_LAYER_ID) {
          const reservoir = reservoirByName.get(String(attributes["name"]));
          if (!reservoir) continue;
          const areaName = reservoir.huc6 ? areaNames.get(reservoir.huc6) ?? null : null;
          const unit = reservoir.huc6 ? unitByHuc6.get(reservoir.huc6) : undefined;
          return {
            content: {
              heading: reservoir.name,
              lines: referenceReservoirLines(
                reservoir, areaName, droughtNoteForArea(unit))
            },
            graphic: result.graphic
          };
        }

        if (layerId === OUTLINE_LAYER_ID) {
          const huc6 = String(attributes["huc6"]);
          const unit = unitByHuc6.get(huc6);
          if (!unit) continue;
          return {
            content: {
              heading: unit.huc6_name,
              lines: droughtAreaLines(unit, context.storage.get(huc6))
            },
            graphic: result.graphic
          };
        }

        if (layerId === CLASS_LAYER_ID) {
          return {
            content: {
              heading: String(attributes["label"]),
              lines: droughtClassLines(String(attributes["level"]))
            },
            graphic: result.graphic
          };
        }
      }
      return null;
    }
  });

  /* The opening frame is the storage map's region box, set on the element
   * before the view resolves, so there is nothing to fit afterwards. */
  await viewReadyWithin(element);
  status.viewReady = Boolean(element.view?.ready);

  return status;
}
