import type { NullableNumber } from "../types";

export interface StorageClass {
  min: number;
  label: string;
  color: string;
}

/* Ported verbatim from `shared/reservoir-viz.js`. Five equal 20-point bands
 * keep the legend predictable and distribute the published reservoirs more
 * evenly than the former 25/25/25/15/10 split (ADR-028); the bands are
 * unchanged. The ramp is not.
 *
 * Percent full is *sequential* data -- one direction, nothing special in the
 * middle -- and it was drawn with a diverging red-to-blue scheme, which
 * implies a pivot at 50% that the quantity does not have. The colours now
 * come from Crameri's `davos`, reversed: a scientific colour map, perceptually
 * uniform, colour-vision-deficiency safe, readable in greyscale, and with
 * monotonically decreasing luminance so the ramp survives being photocopied
 * or seen by a reader who cannot separate the hues. Pale and dry at empty,
 * deep water at full, which is the depth convention every water map borrows.
 *
 * The sampling was measured, not eyeballed: pulled in from the ends of the
 * ramp so the lightest class stays readable on a white legend card rather
 * than washing out, and checked so no adjacent pair is closer than 50 in RGB
 * distance and nothing lands near the snow or drought tables (ADR-032).
 *
 * The values are asserted against the legacy table in classes.test.ts.
 * Both map engines, the legend, the charts and the table read their colors
 * from here, so a well-meaning tweak to one stop silently desynchronizes
 * the new dashboard from the pages still in production -- which is how the
 * palette drifted a full class lighter during the first port.
 */
/** The colour map these values were sampled from, named so the choice can be
 * checked against its publisher rather than only against this file. */
export const STORAGE_RAMP_NAME = "Crameri davos, reversed";

export const STORAGE_CLASSES: readonly StorageClass[] = [
  { min: 0, label: "Under 20%", color: "#dde2b1" },
  { min: 20, label: "20–40%", color: "#95aa87" },
  { min: 40, label: "40–60%", color: "#698c94" },
  { min: 60, label: "60–80%", color: "#416e9d" },
  { min: 80, label: "80% and over", color: "#1b3e82" }
] as const;

/**
 * The capacity ring, which no longer takes the storage colour.
 *
 * The ring is sized by the reservoir's own capacity and the fill by how full
 * it is, so the ring has always meant "how big" and the fill "how much".
 * Colouring both by the storage class conflated the two, and it broke outright
 * once the ramp became sequential: a near-empty reservoir is a ring with almost
 * no fill inside it, so with a pale low end the whole symbol disappeared --
 * and empty is the reading this map exists to show.
 *
 * One constant slate outline instead. Every reservoir now has a visible edge
 * whatever its value, the fill carries the value alone, and the two parts of
 * the symbol each say one thing.
 */
export const CAPACITY_RING_COLOR = "#33434e";

/** Grey for a reservoir whose headline percentage cannot be computed. */
export const STALE_COLOR = "#9e9e9e";

/** Amber-700, for the dashed "data is old" ring. */
export const STALE_ACCENT = "#b45309";

export function storageClass(percent: NullableNumber): StorageClass | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  for (let index = STORAGE_CLASSES.length - 1; index >= 0; index -= 1) {
    const candidate = STORAGE_CLASSES[index];
    if (candidate && percent >= candidate.min) return candidate;
  }
  return STORAGE_CLASSES[0] ?? null;
}

/** The color the maps draw, including the grey the legacy `colorFor` used. */
export function storageColor(percent: NullableNumber): string {
  return storageClass(percent)?.color ?? STALE_COLOR;
}
