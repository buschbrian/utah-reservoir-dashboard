/*
 * The drawn layers, built from data already in memory.
 *
 * Four separate layers, and they are added independently on purpose: the
 * mask and the drainage outlines are context, the reservoirs are the page.
 * A boundary file that fails to load costs the reader context and nothing
 * else, so nothing here throws on the way to drawing the points.
 *
 * The context layers are graphics -- they are drawn once and never queried.
 * The reservoirs are a client-side `FeatureLayer`, because a layer view is
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
import type { Ring } from "../data/huc";
import { DRAINAGE_AREA_FIELD } from "../state/filters";
import { sizeBasis } from "../data/rollup";
import type { NullableNumber, Reservoir } from "../types";
import { STALE_COLOR, STORAGE_CLASSES } from "../viz/classes";
import { reservoirCIMTemplate } from "../viz/cim";
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
  /** Source features eligible for labels. One feature represents one HUC6. */
  labels: number;
}

export function createDrainageLayer(areas: readonly DrainageArea[]): DrainageLayerResult {
  /* A multipolygon remains one feature. Building one graphic per polygon
   * made a label renderer repeat the same drainage-area name on every island
   * or disconnected piece. One feature per HUC6 gives the label engine one
   * placement decision and one label, while preserving every ring. */
  const source = areas.map((area, index) => new Graphic({
    geometry: new Polygon({
      rings: area.polygons.flatMap((polygon) => mutableRings(polygon)),
      spatialReference: WGS84
    }),
    attributes: {
      [DRAINAGE_OBJECT_ID_FIELD]: index + 1,
      huc6: area.huc6,
      [DRAINAGE_NAME_FIELD]: area.name
    }
  }));

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
    popupEnabled: false,
    labelsVisible: true,
    renderer: {
      type: "simple",
      symbol: areaSymbol(DRAINAGE_FILL, DRAINAGE_LINE)
    } as never,
    labelingInfo: [{
      labelExpressionInfo: { expression: `$feature.${DRAINAGE_NAME_FIELD}` },
      labelPlacement: "always-horizontal",
      allowOverrun: true,
      deconflictionStrategy: "static",
      minScale: DRAINAGE_LABEL_MIN_SCALE,
      maxScale: 0,
      symbol: {
        type: "text",
        color: "#263f52",
        haloColor: "rgba(255,255,255,0.98)",
        haloSize: `${DRAINAGE_LABEL_HALO_PX}px`,
        font: { family: "sans-serif", size: "11px", weight: "bold" }
      }
    }] as never
  });
  return { layer, labels: source.length };
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
  const infos: { value: string; symbol: unknown }[] = [];
  for (const late of [false, true]) {
    palette.forEach((color, index) => {
      infos.push({
        value: symbolKey(index === STORAGE_CLASSES.length ? -1 : index, late),
        symbol: reservoirCIMTemplate(domain, late, color)
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
    /* The SDK's own CIM property types mark every optional member
     * `T | null | undefined`, where ours are `T | undefined` under
     * `exactOptionalPropertyTypes`, so the two shapes never unify even
     * though the JSON they describe is identical. Narrowed here, once. */
    renderer: reservoirRenderer(sizeDomain(reservoirs)) as never
  });

  const rendered = layer.renderer as { uniqueValueInfos?: unknown[] } | null;
  return { layer, drawn: source.length, symbols: rendered?.uniqueValueInfos?.length ?? 0 };
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
