import { findReservoir } from "../state/selection";

const RESERVOIR_LAYER_ID = "reservoirs";
const OBJECT_ID_FIELD = "objectid";
const NAME_FIELD = "name";

export interface HitGraphic {
  attributes?: Record<string, unknown>;
  layer?: { id?: string } | null;
}

export interface GraphicHit {
  graphic?: HitGraphic;
}

export interface ReservoirHit<T> {
  reservoir: T;
  graphic: HitGraphic;
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
    if (graphic.layer?.id === RESERVOIR_LAYER_ID
      && Number.isInteger(objectId)
      && (objectId as number) >= 1) {
      const reservoir = reservoirs[(objectId as number) - 1];
      if (reservoir) return { reservoir, graphic };
    }
  }
  return null;
}
