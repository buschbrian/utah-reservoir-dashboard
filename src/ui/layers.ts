/*
 * The drawn layers, built from data already in memory.
 *
 * Separate layers, added independently on purpose: drainage outlines and
 * drainage text are context; the reservoirs are the page. A boundary file
 * that fails to load costs the reader context and nothing else, so nothing
 * here throws on the way to drawing the points.
 *
 * The context is drawn once and is not part of reservoir selection. The
 * reservoirs are a client-side `FeatureLayer`, because a layer view is
 * what `featureEffect`, named highlights and attribute filters operate on;
 * a graphic has no layer view to ask.
 */

import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import { DRAINAGE_FILL, DRAINAGE_LINE } from "../data/boundaries";
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

/**
 * The drainage-area name, as the label engine draws it.
 *
 * The field is a parameter rather than this module's own constant, because
 * the name arrives under a different attribute depending on where the
 * geometry came from -- `area_name` from the payload, `name` from the hosted
 * service. An arcade expression naming a field the layer does not have does
 * not draw nothing quietly; it throws once per tile, in a worker, as
 * `invalid-arcade-expression`, and the map looks merely unlabelled.
 *
 * The same size, weight, colour and halo the text symbols carry, so moving
 * from one to the other is a change of *who places the words*, not of what
 * they look like -- and the halo stays at ADR-027's two pixels and ADR-030's
 * 50% opacity.
 */
export function drainageLabelingInfo(nameField: string): unknown[] {
  return [{
    labelExpressionInfo: { expression: `$feature.${nameField}` },
    labelPlacement: "always-horizontal",
    minScale: DRAINAGE_LABEL_MIN_SCALE,
    maxScale: 0,
    /* The engine's whole reason for being here: at fourteen names a fixed
     * position was fine, and past that a name that cannot be placed has to
     * drop rather than pile onto its neighbour. There are 75 since the
     * coverage moved west (ADR-063), so this is now load-bearing rather than
     * provident. */
    deconflictionStrategy: "dynamic",
    symbol: {
      type: "text",
      color: "#263f52",
      haloColor: DRAINAGE_LABEL_HALO_COLOR,
      haloSize: `${DRAINAGE_LABEL_HALO_PX}px`,
      font: {
        family: LABEL_FONT_FAMILY,
        size: `${DRAINAGE_LABEL_SIZE_PX}px`,
        weight: LABEL_FONT_WEIGHT_BOLD
      }
    }
  }];
}

/** The fill and outline the drainage areas are drawn with, wherever the
 * geometry comes from. */
export function drainageRenderer(): unknown {
  return { type: "simple", symbol: areaSymbol(DRAINAGE_FILL, DRAINAGE_LINE) };
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
 * the reader had to hold every area name in their head to make them.
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
      /*
       * A dark core inside a light halo, because one colour cannot do it.
       *
       * This sits on the drought classes, and that ramp runs from D0 yellow
       * (#ffff00) to D4 maroon (#730000) -- relative luminance 0.93 down to
       * 0.04. A single dark dot is 13:1 against the yellow end and about
       * 1.2:1 against the maroon end, which is not a low contrast so much as
       * no contrast: the reservoirs disappeared exactly where a reservoir
       * inside extreme drought is the most worth seeing.
       *
       * An earlier version did carry a white ring and was removed for
       * reading as a field of pale specks. That version's fill was
       * *translucent* slate, so the ring was most of what showed; this one
       * is opaque, so the mark reads dark and the halo only separates it
       * from what is underneath. Slightly larger too, which is what lets the
       * ring be a smaller fraction of the symbol than it was then.
       *
       * Still achromatic on purpose. These points carry no value of their
       * own, so they must not introduce a second colour language competing
       * with the monitor's.
       */
      symbol: {
        type: "simple-marker",
        style: "circle",
        size: 6.5,
        color: [31, 43, 51, 1],
        outline: { color: "rgba(247,250,252,0.92)", width: 1.1 }
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
