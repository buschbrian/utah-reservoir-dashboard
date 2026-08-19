/*
 * The drought map: the U.S. Drought Monitor's national polygons in the
 * monitor's own palette, under the drainage-area outlines.
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
import Polygon from "@arcgis/core/geometry/Polygon";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import type { ReferenceLayers } from "../arcgis/reference-layers";
import {
  createWatershedLayer,
  watershedCodeField,
  WATERSHED_NAME_FIELD
} from "../arcgis/watershed-layers";
import type { DrainageScope } from "../data/boundaries";
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
const OUTLINE_CASING_LAYER_ID = "drainage-outline-casing";

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
  /** Drainage areas carrying their name, which is every area in scope --
   * the label engine decides per frame which of them fit. */
  areaLabels: number;
  /** True while those names are placed by the label engine rather than at
   * fixed points, so a name that cannot fit is dropped instead of being
   * drawn over its neighbour (ADR-047). */
  areaLabelsDeconflicted: boolean;
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
  scope: DrainageScope,
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
   *
   * **Both passes are quieter than they were**, and the casing more than the
   * core. A 3.4px casing at 0.85 is a white line in its own right: fourteen
   * of them ringed the region in a colour no class uses, and the eye went to
   * the rings before the pattern they were drawn to locate. The casing's job
   * is to keep the core legible on a maroon fill, which is a job it can do
   * without being visible as a line -- so it is narrower and much more
   * transparent, and the core is thinner and no longer near-opaque. The
   * cased arrangement is unchanged; only its volume is. These are reference
   * geometry on a map whose subject is underneath them.
   */
  const { level, areas } = scope;
  const codes = areas.map((area) => area.huc6);
  /* The attribute the hosted features carry their code in, named by the
   * scope's own level (ADR-050) -- never a literal "huc6". */
  const codeField = watershedCodeField(level);
  const boundarySymbol = (color: string, width: number): FillSymbol => ({
    type: "simple-fill",
    color: [0, 0, 0, 0],
    outline: { color, width }
  });
  /*
   * The casing and the core are two layers over one service, not two symbol
   * layers in one.
   *
   * A cased line only works if every casing is already down before any core
   * is drawn. Within a single layer that ordering is not ours to choose, so
   * one area's casing paints over its neighbour's core along the edge they
   * share -- which is the artifact the graphics version was written in two
   * passes to avoid, and it does not stop being an artifact because the
   * geometry now arrives over the network.
   *
   * The price is that the same features are fetched twice. It is quantized
   * to the view both times, so it is a doubling of tens of kilobytes rather
   * than of the 982 KB file this replaces; `docs/data-transfer.md` carries
   * the measurement.
   */
  const casingLayer = createWatershedLayer({
    id: OUTLINE_CASING_LAYER_ID,
    level,
    codes,
    renderer: { type: "simple", symbol: boundarySymbol("rgba(255,255,255,0.34)", 1.6) }
  });
  /*
   * The core carries the names as well as the dark line.
   *
   * ADR-047: fixed text symbols do not deconflict, and this map's inventory
   * grows with the scope like every other. The treatment is in the label
   * symbol below, which is where the note about it lives.
   */
  const outlineLayer = createWatershedLayer({
    id: OUTLINE_LAYER_ID,
    level,
    codes,
    renderer: { type: "simple", symbol: boundarySymbol("rgba(23,32,38,0.44)", 0.7) },
    labelsVisible: true,
    labelingInfo: [{
      labelExpressionInfo: { expression: `$feature.${WATERSHED_NAME_FIELD}` },
      labelPlacement: "always-horizontal",
      deconflictionStrategy: "dynamic",
      /*
       * Cased like the boundary, and for the same reason -- dark letters
       * read on the pale classes, the halo reads on the dark ones -- but
       * the halo was doing far more than that. At 2.4px and 0.92 it drew a
       * white slab the width of the word behind every name, and fourteen of
       * those over a five-class pattern is the map's loudest element sitting
       * on top of its quietest question. Enough halo to separate the letters
       * from a maroon fill, and no more.
       *
       * The weight stays bold. That is the label ladder's own rule
       * (`viz/label-scales.ts`): drainage names are the one bold tier on
       * every map on this site, and a name that changed weight per page
       * would be the ladder disagreeing with itself. Colour and halo are
       * where this map's volume is set.
       */
      symbol: {
        type: "text",
        color: "rgba(31,41,48,0.82)",
        haloColor: "rgba(255,255,255,0.62)",
        haloSize: "1.4px",
        font: {
          family: LABEL_FONT_FAMILY,
          size: `${DRAINAGE_LABEL_SIZE_PX}px`,
          weight: LABEL_FONT_WEIGHT_BOLD
        }
      }
    }]
  });

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
    areaLabels: areas.length,
    areaLabelsDeconflicted: true,
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
   * No terrain on this map, and the borrowed boundaries sit above the classes
   * rather than below them (ADR-061).
   *
   * ADR-054 put the hillshade underneath on the argument that the classes are
   * drawn at 0.45 alpha, so a reader is already seeing through them to
   * something and it may as well be the ground that makes the water. The
   * argument still holds and the picture did not: relief plus five saturated
   * classes plus two cased boundary sets is more ink than the single question
   * this map asks, and the classes are the measurement. The flattest
   * available background is the right background for a choropleth.
   *
   * The boundaries move above the data because of what the data *is*, not
   * because this page is special. Drought classes are a continuous surface:
   * they tile the region with no gaps, so a line drawn over them always has
   * fill on both sides and reads as a partition of the subject. Reference
   * geometry over continuous data divides; it cannot hide.
   *
   * Discrete data is the case ADR-042 was written from. A reservoir is a
   * point, and a boundary drawn across a point does not partition it -- it
   * occludes it, which is how a grey state line came to run through Flaming
   * Gorge. The storage and snow maps keep their reference layers sunk for
   * that reason and not by accident.
   *
   * So: continuous underneath, reference over. Discrete, investigate before
   * raising anything above it.
   */
  const map = new ArcGISMap({
    layers: [
      droughtLayer,
      casingLayer,
      outlineLayer,
      ...(boundaries.states ? [boundaries.states] : []),
      ...(boundaries.counties ? [boundaries.counties] : []),
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
          const huc6 = String(attributes[codeField]);
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
