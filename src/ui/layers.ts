/*
 * The drawn layers, built from data already in memory.
 *
 * Separate layers, added independently on purpose: the mask, drainage
 * outlines and drainage text are context; the reservoirs are the page.
 * A boundary file that fails to load costs the reader context and nothing
 * else, so nothing here throws on the way to drawing the points.
 *
 * The context is drawn once and is not part of reservoir selection. The
 * reservoirs are a client-side `FeatureLayer`, because a layer view is
 * what `featureEffect`, named highlights and attribute filters operate on;
 * a graphic has no layer view to ask.
 */

import Graphic from "@arcgis/core/Graphic";
import Polygon from "@arcgis/core/geometry/Polygon";
import Point from "@arcgis/core/geometry/Point";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import type { UniqueValueInfoProperties } from "@arcgis/core/renderers/support/UniqueValueInfo";

import {
  DRAINAGE_FILL,
  DRAINAGE_LINE,
  MASK_FILL,
  MASK_LINE,
  utahMaskRings,
  type DrainageArea,
  type UtahBoundary
} from "../data/boundaries";
import { drainageLabelPoint, type Ring } from "../data/huc";
import { DRAINAGE_AREA_FIELD } from "../state/filters";
import { sizeBasis } from "../data/rollup";
import type { NullableNumber, Reservoir } from "../types";
import { STALE_COLOR, STORAGE_CLASSES } from "../viz/classes";
import { reservoirCIMTemplate, reservoirCIMTemplateSimple } from "../viz/cim";
import {
  DRAINAGE_LABEL_SIZE_PX,
  LABEL_FONT_FAMILY,
  LABEL_FONT_WEIGHT_BOLD,
  RESERVOIR_LABEL_SCALE,
  RESERVOIR_LABEL_SIZE_PX
} from "../viz/label-scales";
import { headlinePercent, reservoirSymbol, reservoirSymbolFor, sizeDomain } from "../viz/symbols";

/** The attribute every reservoir feature carries, and the only one selection reads. */
export const NAME_FIELD = "name";

/** The stable identity the layer is keyed on. Assigned in draw order. */
export const OBJECT_ID_FIELD = "objectid";

/** Which of the renderer's twelve symbols a reservoir draws with. */
export const SYMBOL_KEY_FIELD = "symbol_key";

/** One source feature and therefore at most one label for each drainage area. */
export const DRAINAGE_OBJECT_ID_FIELD = "objectid";
/* Deliberately not the reservoir layer's `name` field: pointer hit testing
 * treats that field as selectable reservoir identity. */
export const DRAINAGE_NAME_FIELD = "area_name";
export const DRAINAGE_LABEL_MIN_SCALE = 25_000_000;
export const DRAINAGE_LABEL_HALO_PX = 2;
export const DRAINAGE_LABEL_HALO_COLOR = "rgba(255,255,255,0.5)";

/** The layer the snow and drought maps carry reservoirs on for reference. */
export const RESERVOIR_REFERENCE_LAYER_ID = "reservoir-reference";

/**
 * When reservoir names appear, and what they look like.
 *
 * Both answers come from `viz/label-scales.ts`, which holds the whole
 * ladder: states, then drainage areas, then reservoirs, then counties, each
 * arriving as the one above it has done its work. Two rules from that table
 * land here.
 *
 * They are off at the opening view. Fifty-one names over the whole region
 * before the reader has asked the map anything is a busy map for no reason;
 * past 1:4,500,000 -- about one zoom step in from where both surfaces open
 * -- the names arrive because the reader went looking for them.
 *
 * And they are the quietest type on the map. A reservoir sits inside a
 * drainage area, so its name is never larger than the drainage area's:
 * 9 pixels against 11, normal weight against bold, grey against the near
 * black those names are drawn in. It is a caption on a dot.
 *
 * The mechanism is the SDK label engine rather than a layer of text
 * symbols. The drainage names could not use it (ADR-030) because they have
 * to sit *under* the reservoirs and the label pass always paints above --
 * which is exactly what a name on a reservoir wants. It also brings the one
 * thing a text-symbol layer cannot: deconfliction. Where Deer Creek sits
 * inside Jordanelle's ring, one of the two names drops out and comes back
 * as the reader zooms between them.
 */
export function reservoirLabelingInfo(): unknown[] {
  return [{
    labelExpressionInfo: { expression: `$feature.${NAME_FIELD}` },
    /* Above the symbol, not beside it: the circles run from 8 to 36 pixels
     * and the label engine offsets from each symbol's own box, so every
     * name clears the ring it belongs to by the amount that ring needs. */
    labelPlacement: "above-center",
    minScale: RESERVOIR_LABEL_SCALE.minScale,
    maxScale: RESERVOIR_LABEL_SCALE.maxScale,
    /* Static rather than the default dynamic placement: a name that slides
     * around its reservoir as the reader pans is a name they have to
     * re-find, and these points do not move. */
    deconflictionStrategy: "static",
    /* The halo does the legibility work, not the text colour: these maps
     * follow the page theme, so the canvas under a name is light gray on
     * one and dark gray on the other, and only a solid halo reads on both.
     * The drainage names already work this way. */
    symbol: {
      type: "text",
      color: "rgba(74,91,102,0.95)",
      haloColor: "rgba(255,255,255,0.8)",
      haloSize: "1.2px",
      font: { family: LABEL_FONT_FAMILY, size: RESERVOIR_LABEL_SIZE_PX, weight: "normal" }
    }
  }];
}

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

export interface DrainageLayerResult {
  layer: FeatureLayer;
  /** Text symbols drawn below the reservoir layer. */
  labelLayer: GraphicsLayer;
  /** One background label symbol for each HUC6. */
  labels: number;
}

export function createDrainageLayer(areas: readonly DrainageArea[]): DrainageLayerResult {
  const labelGraphics: Graphic[] = [];
  /* A multipolygon remains one feature. Building one graphic per polygon
   * made a label repeat on every island or disconnected piece. One feature
   * and one interior label point per HUC6 preserve every ring and keep one
   * name per area. The text is a symbol in its own layer, not FeatureLayer
   * labeling: a text-symbol layer can stay physically below reservoirs. */
  const source = areas.map((area, index) => {
    const geometry = new Polygon({
      rings: area.polygons.flatMap((polygon) => mutableRings(polygon)),
      spatialReference: WGS84
    });
    const labelPoint = drainageLabelPoint(area.polygons);
    /* The outline still draws without its name, but not silently: the label
     * count this feeds is a readiness signal, and a shape that defeats the
     * interior-point search should say so where someone debugging the count
     * will look. */
    if (!labelPoint) {
      console.warn(`No interior label point for drainage area ${area.name} (${area.huc6}); its name is not drawn.`);
    }
    if (labelPoint) {
      labelGraphics.push(new Graphic({
        geometry: new Point({ longitude: labelPoint[0], latitude: labelPoint[1],
          spatialReference: WGS84 }),
        attributes: { huc6: area.huc6, [DRAINAGE_NAME_FIELD]: area.name },
        symbol: {
          type: "text",
          text: area.name,
          color: "#263f52",
          haloColor: DRAINAGE_LABEL_HALO_COLOR,
          haloSize: `${DRAINAGE_LABEL_HALO_PX}px`,
          /* The one bold tier on the map. Family and weight, not a
           * "Bold" family: the SDK builds the glyph-atlas slug from both,
           * so folding the weight into the name asks for a font that does
           * not exist and falls back silently. */
          font: {
            family: LABEL_FONT_FAMILY,
            size: `${DRAINAGE_LABEL_SIZE_PX}px`,
            weight: LABEL_FONT_WEIGHT_BOLD
          }
        }
      }));
    }
    return new Graphic({
      geometry,
      attributes: {
        [DRAINAGE_OBJECT_ID_FIELD]: index + 1,
        huc6: area.huc6,
        [DRAINAGE_NAME_FIELD]: area.name
      }
    });
  });

  const layer = new FeatureLayer({
    id: "drainage-areas",
    listMode: "hide",
    source,
    fields: [
      { name: DRAINAGE_OBJECT_ID_FIELD, type: "oid" },
      { name: "huc6", type: "string" },
      { name: DRAINAGE_NAME_FIELD, type: "string" }
    ],
    objectIdField: DRAINAGE_OBJECT_ID_FIELD,
    geometryType: "polygon",
    spatialReference: WGS84,
    /* Declared rather than inferred, for the reason the reservoir layer
     * learned the hard way: this renderer reads no field at all, so a layer
     * view would materialize the object id alone and every hit on an
     * outline would come back without the name it is meant to describe. */
    outFields: ["*"],
    popupEnabled: false,
    renderer: {
      type: "simple",
      symbol: areaSymbol(DRAINAGE_FILL, DRAINAGE_LINE)
    } as never
  });
  const labelLayer = new GraphicsLayer({
    id: "drainage-labels",
    listMode: "hide",
    minScale: DRAINAGE_LABEL_MIN_SCALE,
    maxScale: 0
  });
  labelLayer.addMany(labelGraphics);
  return { layer, labelLayer, labels: labelGraphics.length };
}

export interface ReservoirLayerResult {
  layer: FeatureLayer;
  /** Reservoirs actually drawn -- what the readiness signal reports. */
  drawn: number;
  /**
   * Symbols the renderer ended up holding. A separate fact from `drawn`,
   * and separate on purpose: the last renderer this map used accepted ten
   * class stops, silently kept eight, and drew a plausible map of the
   * wrong table. A count the page publishes is a count a test can hold.
   */
  symbols: number;
  /** True while the layer is carrying reservoir names. A separate fact from
   * `drawn`: a layer draws its points whether or not it labels them. */
  labelled: boolean;
}

/* The client-side schema. Every field is a fact a later slice filters or
 * labels on; none of them is re-derived from another. `late` repeats the
 * basis the ring accent is drawn from rather than the list's own lateness
 * rule, because a filter that hides a dashed ring has to agree with the
 * ring it is hiding. */
const RESERVOIR_FIELDS = [
  { name: OBJECT_ID_FIELD, type: "oid" as const },
  { name: NAME_FIELD, type: "string" as const },
  { name: "size_basis", type: "double" as const },
  { name: "fill_percent", type: "double" as const },
  { name: "late", type: "small-integer" as const },
  { name: DRAINAGE_AREA_FIELD, type: "string" as const },
  { name: SYMBOL_KEY_FIELD, type: "string" as const }
];

/**
 * One feature per reservoir, drawn by one composed CIM symbol.
 *
 * The renderer is keyed on the object ID rather than on a class or a size
 * break: every reservoir's ring is a different width, so there are as many
 * symbols as features by construction. A `UniqueValueRenderer` has no stop
 * limit -- unlike a colour visual variable, which silently truncated the
 * ten-stop ramp to eight the last time this map was drawn a different way.
 */
interface ReservoirEntries {
  graphics: Graphic[];
}

/**
 * Twelve symbols, not fifty-one.
 *
 * Size is Arcade over the layer's own fields, so the SDK re-reads it from
 * attributes rather than recompiling a symbol per feature. Colour is the
 * renderer key: a `Color` primitive override does not work here -- pointed
 * at the marker or at the fill inside it, either way the SDK draws nothing
 * at all rather than reporting a problem.
 *
 * So the key is the storage class and the late state together: six colours
 * (five classes plus the grey for no reading) times two. Assigned once, and
 * a month change moves a feature between existing symbols instead of
 * building new ones.
 */
function reservoirRenderer(domain: number): unknown {
  const palette = [...STORAGE_CLASSES.map((entry) => entry.color), STALE_COLOR];
  const infos: { value: string; symbol: unknown; alternateSymbols: unknown[] }[] = [];
  for (const late of [false, true]) {
    palette.forEach((color, index) => {
      infos.push({
        value: symbolKey(index === STORAGE_CLASSES.length ? -1 : index, late),
        symbol: reservoirCIMTemplate(domain, late, color),
        /* SDK 5.1. Each info may carry alternates for other scale windows,
         * and the renderer picks whichever window contains the view scale.
         * Twelve symbols become twenty-four, but they are still assigned
         * once -- the count that mattered was never the number of symbols,
         * it was whether the SDK had to recompile one per feature. */
        alternateSymbols: [reservoirCIMTemplateSimple(domain, late, color)]
      });
    });
  }
  return {
    type: "unique-value",
    field: SYMBOL_KEY_FIELD,
    defaultSymbol: reservoirCIMTemplate(domain, false, STALE_COLOR),
    uniqueValueInfos: infos
  };
}

/** The renderer key: which class, and whether the reading is late. Twelve
 * combinations, assigned once, instead of one symbol per reservoir. */
export function symbolKey(classIndex: number, late: boolean): string {
  return `${classIndex}|${late ? 1 : 0}`;
}

/**
 * The features and their symbols, built once and used two ways.
 *
 * `createReservoirLayer` builds a layer from these; `updateReservoirPercents`
 * pushes the same values onto a layer that already exists. Sharing the
 * construction is what stops the month view and the first draw disagreeing
 * about what a reservoir looks like.
 */
function reservoirEntries(
  reservoirs: readonly Reservoir[],
  percentOf: (reservoir: Reservoir) => NullableNumber
): ReservoirEntries {
  const domain = sizeDomain(reservoirs);
  const graphics: Graphic[] = [];

  reservoirs.forEach((reservoir, index) => {
    const objectId = index + 1;
    const percent = percentOf(reservoir);
    const symbol = reservoirSymbolFor(reservoir, domain, percent);
    graphics.push(new Graphic({
      geometry: new Point({
        longitude: reservoir.lon,
        latitude: reservoir.lat,
        spatialReference: WGS84
      }),
      attributes: {
        [OBJECT_ID_FIELD]: objectId,
        [NAME_FIELD]: reservoir.name,
        size_basis: sizeBasis(reservoir),
        fill_percent: percent,
        late: symbol.accent === null ? 0 : 1,
        /* The empty string rather than null: a null fails every comparison,
         * so a reservoir with no drainage area is excluded by any area
         * choice, which is what the list does with it too. */
        [DRAINAGE_AREA_FIELD]: reservoir.huc6 ?? "",
        [SYMBOL_KEY_FIELD]: symbolKey(
          STORAGE_CLASSES.findIndex((entry) => entry.color === symbol.color),
          symbol.accent !== null
        )
      }
    }));
  });

  return { graphics };
}

/**
 * Redraws an existing layer at new percentages, without replacing it.
 *
 * The month slider used to call `createReservoirLayer` on every tick, which
 * removed the layer, rebuilt 51 features and 51 composed symbols, added a
 * new layer and waited for a new layer view -- roughly 9ms of main-thread
 * work per tick before any of the GPU cost, against a 16.7ms frame. Swapping
 * the renderer and editing one field is a fraction of that and keeps the
 * layer view, so the map stays interactive while the handle moves.
 *
 * `fill_percent` is edited as well as the symbols because the storage filter
 * reads it: leaving it on today's value would grey reservoirs by one month's
 * class while drawing them in another's.
 */
export function updateReservoirPercents(
  layer: FeatureLayer,
  reservoirs: readonly Reservoir[],
  percentOf: (reservoir: Reservoir) => NullableNumber
): void {
  const { graphics } = reservoirEntries(reservoirs, percentOf);
  /* The renderer is untouched. Size and colour are expressions over the
   * fields being edited here, so the SDK re-reads them -- which is the whole
   * reason this is fast enough to run while a slider handle moves. */
  void layer.applyEdits({ updateFeatures: graphics }).catch((error: unknown) => {
    console.warn("The map could not update to the selected month:", error);
  });
}

export function createReservoirLayer(
  reservoirs: readonly Reservoir[],
  /* What each reservoir's fill should show. Defaults to the newest reading,
   * which is what the map opens on; the month slider passes that month's
   * percentage instead. The ring is unaffected either way -- it carries
   * physical scale, which does not change with the month. */
  percentOf: (reservoir: Reservoir) => NullableNumber = headlinePercent
): ReservoirLayerResult {
  const { graphics: source } = reservoirEntries(reservoirs, percentOf);

  const layer = new FeatureLayer({
    id: "reservoirs",
    listMode: "hide",
    source,
    fields: RESERVOIR_FIELDS,
    objectIdField: OBJECT_ID_FIELD,
    geometryType: "point",
    spatialReference: WGS84,
    /* Every field, on the layer view as well as in the source.
     *
     * Without this the SDK materializes only the fields it can prove it
     * needs -- the renderer's `symbol_key`, `size_basis` and `fill_percent`,
     * plus the object id -- and `hitTest` hands back a graphic with no
     * `name` on it, so pointer selection and the hover card both look for a
     * reservoir that the answer does not identify. It went unnoticed because
     * it is only true of the *first* layer view: redrawing for a scope
     * change produced a graphic carrying all seven fields, so clicking
     * started working the moment the reader touched the scope control and
     * never failed again. There is no fetch here to economize on -- the
     * source is already in memory -- so the fields the interface reads are
     * declared rather than inferred.
     */
    outFields: ["*"],
    // The details panel is the page's own surface and is already wired to
    // selection. An SDK popup would open a second, unstyled description of
    // the same reservoir over the map.
    popupEnabled: false,
    /* Draw order, so a large reservoir cannot bury a small neighbour it
     * happens to be listed before. The circles are proportional and they
     * overlap wherever reservoirs are close together -- Deer Creek sits
     * inside Jordanelle's ring at the opening extent -- and without an
     * explicit order the winner is whichever the source array names last,
     * which is alphabetical and therefore arbitrary. Smallest on top: the
     * small circle is the one that can be completely covered. */
    orderBy: [{ field: "size_basis", order: "descending" }],
    labelsVisible: true,
    labelingInfo: reservoirLabelingInfo() as never,
    /* The SDK's own CIM property types mark every optional member
     * `T | null | undefined`, where ours are `T | undefined` under
     * `exactOptionalPropertyTypes`, so the two shapes never unify even
     * though the JSON they describe is identical. Narrowed here, once. */
    renderer: reservoirRenderer(sizeDomain(reservoirs)) as never
  });

  const rendered = layer.renderer as { uniqueValueInfos?: unknown[] } | null;
  return {
    layer,
    drawn: source.length,
    symbols: rendered?.uniqueValueInfos?.length ?? 0,
    labelled: (layer.labelingInfo?.length ?? 0) > 0 && layer.labelsVisible
  };
}

/** The least a map needs to place and describe a reservoir it does not own
 * the subject of. `pct_of_capacity` and `pct_of_record_max` are both read
 * because the headline percentage falls back from one to the other. */
export type ReservoirReference = Pick<
  Reservoir, "name" | "lon" | "lat" | "pct_of_capacity" | "pct_of_record_max" | "huc6"
>;

export interface ReservoirReferenceResult {
  layer: FeatureLayer;
  drawn: number;
  labelled: boolean;
}

/**
 * The reservoirs as *reference* on a map about something else.
 *
 * One neutral slate dot each, one size for all of them, and the name beside
 * it. Explicitly not the storage symbol: the storage colour table belongs to
 * the map that is about storage, and a page rule this project holds is one
 * colour language per map (the snow scale owns the snow map, the monitor's
 * palette owns the drought map). A proportional ring would be a second claim
 * too -- it would say the map is ranking reservoirs when it is only saying
 * where they are.
 *
 * They still earn their place. "Which reservoirs are in the basin that is
 * at 46% of normal snow" and "which reservoirs are under the D4 patch" are
 * exactly the readings these two pages exist to make possible, and until now
 * the reader had to hold fourteen area names in their head to make them.
 */
export function createReservoirReferenceLayer(
  reservoirs: readonly ReservoirReference[]
): ReservoirReferenceResult {
  const source = reservoirs.map((reservoir, index) => new Graphic({
    geometry: new Point({
      longitude: reservoir.lon,
      latitude: reservoir.lat,
      spatialReference: WGS84
    }),
    attributes: {
      [OBJECT_ID_FIELD]: index + 1,
      [NAME_FIELD]: reservoir.name
    }
  }));

  const layer = new FeatureLayer({
    id: RESERVOIR_REFERENCE_LAYER_ID,
    listMode: "hide",
    source,
    fields: [
      { name: OBJECT_ID_FIELD, type: "oid" },
      { name: NAME_FIELD, type: "string" }
    ],
    objectIdField: OBJECT_ID_FIELD,
    geometryType: "point",
    spatialReference: WGS84,
    /* Declared, not inferred. The renderer here uses no field at all, so
     * the layer view would materialize the object id and nothing else, and
     * every hover would ask a graphic for a name it was never given. That
     * failure took a while to find on the storage map; it is not worth
     * finding a second time. */
    outFields: ["*"],
    // These pages describe a reservoir in their own hover card.
    popupEnabled: false,
    labelsVisible: true,
    labelingInfo: reservoirLabelingInfo() as never,
    renderer: {
      type: "simple",
      symbol: {
        type: "simple-marker",
        style: "circle",
        size: 5.5,
        /* Translucent, because on these maps the fill underneath is the
         * subject and a solid dot would punch a hole in it. */
        color: [39, 54, 63, 0.75],
        outline: { color: "rgba(255,255,255,0.9)", width: 1 }
      }
    } as never
  });

  return {
    layer,
    drawn: source.length,
    labelled: (layer.labelingInfo?.length ?? 0) > 0 && layer.labelsVisible
  };
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
      size: `${symbol.ringPx + 14}px`,
      outline: { color: "#1b2b34", width: 2.5 }
    }
  }));
}
