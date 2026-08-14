import type { NullableNumber } from "../types";

export interface StorageClass {
  min: number;
  label: string;
  color: string;
}

/* Ported verbatim from `shared/reservoir-viz.js`. Five equal 20-point bands
 * keep the legend predictable and distribute the published reservoirs more
 * evenly than the former 25/25/25/15/10 split. ColorBrewer's colorblind-safe
 * five-class RdYlBu palette runs from low-storage red through pale yellow to
 * high-storage blue. The direction is deliberate: a full reservoir should
 * not carry the warning colour.
 *
 * The values are asserted against the legacy table in classes.test.ts.
 * Both map engines, the legend, the charts and the table read their colors
 * from here, so a well-meaning tweak to one stop silently desynchronizes
 * the new dashboard from the pages still in production -- which is how the
 * palette drifted a full class lighter during the first port.
 */
export const STORAGE_CLASSES: readonly StorageClass[] = [
  { min: 0, label: "Under 20%", color: "#d7191c" },
  { min: 20, label: "20–40%", color: "#fdae61" },
  { min: 40, label: "40–60%", color: "#ffffbf" },
  { min: 60, label: "60–80%", color: "#abd9e9" },
  { min: 80, label: "80% and over", color: "#2c7bb6" }
] as const;

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
