import type { NullableNumber } from "../types";

export interface StorageClass {
  min: number;
  label: string;
  color: string;
}

/* Ported verbatim from `shared/reservoir-viz.js`. Five classes instead of
 * the original three: the old ramp put every reservoir under 50% into one
 * bucket, which in a drought year is most of the state -- Lake Powell at
 * 34% and Meeks Cabin at 13% rendered the same red, so the map could not
 * distinguish "low" from "nearly empty" exactly where the story is.
 * Sequential red -> green, ordered worst-first, colorblind-safe (RdYlGn,
 * ColorBrewer).
 *
 * The values are asserted against the legacy table in classes.test.ts.
 * Both map engines, the legend, the charts and the table read their colors
 * from here, so a well-meaning tweak to one stop silently desynchronizes
 * the new dashboard from the pages still in production -- which is how the
 * palette drifted a full class lighter during the first port.
 */
export const STORAGE_CLASSES: readonly StorageClass[] = [
  { min: 0, label: "Under 25%", color: "#a50026" },
  { min: 25, label: "25–50%", color: "#d73027" },
  { min: 50, label: "50–75%", color: "#fdae61" },
  { min: 75, label: "75–90%", color: "#a6d96a" },
  { min: 90, label: "Over 90%", color: "#1a9850" }
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
