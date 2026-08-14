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
    // The details panel is the page's own surface and is already wired to
    // selection. An SDK popup would open a second, unstyled description of
    // the same reservoir over the map.
    popupEnabled: false,
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
      size: symbol.ringPx + 14,
      outline: { color: "#1b2b34", width: 2.5 }
    }
  }));
}
