import { findReservoir } from "../state/selection";

const RESERVOIR_LAYER_ID = "reservoirs";
const OBJECT_ID_FIELD = "objectid";
const NAME_FIELD = "name";

export interface HitGraphic {
  attributes?: Record<string, unknown>;
  /** Kept as a compatibility fallback for SDK hits that attach the layer
   * to the graphic rather than the result wrapper. */
  layer?: { id?: string } | null;
}

export interface GraphicHit {
  graphic?: HitGraphic;
  /**
   * The layer the hit belongs to. This lives on the hit result itself, per
   * the SDK's `GraphicHit` type -- `graphic.layer` is documented as set only
   * "if applicable", and the 2D feature layer view only ever assigns it for
   * track and aggregate hits. Reading it off the graphic instead reads a
   * field that is `undefined` for every plain feature hit, which is why the
   * layer check below never matched.
   */
  layer?: { id?: string } | null;
}

export interface ReservoirHit<T> {
  reservoir: T;
  graphic: HitGraphic;
}

/**
 * Which layer a hit came from, from whichever of the two places carries it.
 *
 * The SDK documents `graphic.layer` as set only "if applicable", and the 2D
 * feature layer view assigns it for track and aggregate hits only -- while a
 * graphic added to a `GraphicsLayer` does carry it. The snow and drought maps
 * put three and four layers into one hit test and tell them apart by this, so
 * both places are read rather than the one that happened to work first.
 */
export function hitLayerId(result: GraphicHit): string | null {
  return result.layer?.id ?? result.graphic?.layer?.id ?? null;
}

/**
 * Resolves a map hit without assuming the layer view returned every field.
 *
 * ArcGIS can materialize a new client-side layer view with only the fields
 * used by its renderer. The reservoir object ID is always present, so it is
 * the stable fallback when the human-readable name has not arrived in the
 * hit graphic yet. Object IDs are assigned from one in source-array order by
 * `createReservoirLayer`; the layer ID check keeps polygon object IDs from
 * being mistaken for reservoir identities.
 */
export function reservoirFromHits<T extends { name: string }>(
  reservoirs: readonly T[],
  results: readonly GraphicHit[]
): ReservoirHit<T> | null {
  for (const result of results) {
    const graphic = result.graphic;
    const attributes = graphic?.attributes;
    if (!graphic || !attributes) continue;

    const name = attributes[NAME_FIELD];
    const named = typeof name === "string" ? findReservoir(reservoirs, name) : null;
    if (named) return { reservoir: named, graphic };

    const objectId = attributes[OBJECT_ID_FIELD];
    const layerId = result.layer?.id ?? graphic.layer?.id;
    if (layerId === RESERVOIR_LAYER_ID
      && Number.isInteger(objectId)
      && (objectId as number) >= 1) {
      const reservoir = reservoirs[(objectId as number) - 1];
      if (reservoir) return { reservoir, graphic };
    }
  }
  return null;
}
