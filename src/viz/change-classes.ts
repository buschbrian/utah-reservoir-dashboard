/*
 * How much drier or wetter a drainage area got, in one table.
 *
 * Same rule as every other palette here (ADR-008, ADR-032): one table, read
 * by the map, the legend, the table column and the ranked chart, so a change
 * cannot mean two things on two surfaces.
 *
 * ## Why these colours and not a nicer red
 *
 * This table draws on the drought page, and the drought page already owns a
 * palette a reader knows by heart — the monitor's own yellows and reds. A
 * change ramp reaching for orange or red there would be read as a drought
 * class, whatever the legend said, so the whole warm half of the wheel is
 * spent before this table starts. Storage owns the yellow-green to blue run
 * and snow owns brown through cyan to blue, which leaves magenta and green.
 *
 * So this is the pink-green diverging scheme, sampled and then *measured*
 * against every colour this project publishes rather than eyeballed. The
 * closest any entry comes to another table is 48.7 in RGB distance — the
 * neutral blue-grey against the storage table's palest yellow-green — and no
 * two entries here are closer than 87.3 to each other. `change-classes.
 * test.ts` holds both, and holds the luminance range that keeps every entry
 * legible as a translucent fill over shaded relief.
 *
 * ## Why the break is ten points
 *
 * Not tuned to a week. The monitor publishes to a tenth of a point, so a move
 * of ten points is two orders of magnitude above its own precision, and it is
 * a tenth of the area's land — a quantity a reader can state without
 * consulting a scale. Measured against the week this table was written, it
 * separates four areas that really moved (Bill Williams at −33.8, Snake
 * Headwaters at −25.1) from the ordinary drift, and leaves 58 of 75 in the
 * middle, which is what a quiet week should look like.
 */

export interface ChangeClass {
  /** The smallest change, in points of land, that lands in this class.
   * Signed, and read as "at least this": the table is scanned from the driest
   * end down, the same way `storageClass` scans the storage breaks. */
  min: number;
  label: string;
  color: string;
}

/** A move smaller than this is rounding rather than weather, and reads as no
 * change. The published precision is a tenth of a point; this is half of one,
 * so a value that rounds to 0.0 can never be reported as a move. Shared with
 * `CHANGE_EPSILON` in the model by a test, so the map and the count cannot
 * disagree about whether an area moved. */
export const CHANGE_EPSILON = 0.05;

/** A tenth of an area's land. See the note above for why it is not tuned. */
export const LARGE_CHANGE_POINTS = 10;

export const CHANGE_CLASSES: readonly ChangeClass[] = [
  { min: LARGE_CHANGE_POINTS, label: "Much drier", color: "#8e0152" },
  { min: CHANGE_EPSILON, label: "Drier", color: "#de77ae" },
  { min: -CHANGE_EPSILON, label: "Little change", color: "#bfc4c9" },
  { min: -LARGE_CHANGE_POINTS, label: "Wetter", color: "#a1d76a" },
  { min: -Infinity, label: "Much wetter", color: "#276419" }
] as const;

/**
 * The class a signed change falls in, driest first.
 *
 * Null for a change that does not exist — an area the previous week did not
 * publish, or one the monitor does not measure. Never the middle class: "we
 * did not measure this" and "this did not move" are two different statements
 * and the map draws them differently (ADR-059).
 */
export function changeClass(points: number | null): ChangeClass | null {
  if (points === null || !Number.isFinite(points)) return null;
  for (const entry of CHANGE_CLASSES) {
    if (points >= entry.min) return entry;
  }
  return null;
}

/** The colour for a signed change, or null where there is no comparison. */
export function changeColor(points: number | null): string | null {
  return changeClass(points)?.color ?? null;
}

/** The change said in words, with its sign carried by the word rather than a
 * symbol: "3.2 points drier" reads aloud correctly and "+3.2" does not. */
export function changeLabel(points: number | null): string {
  if (points === null || !Number.isFinite(points)) return "No comparison";
  const size = Math.abs(points).toFixed(1);
  if (Math.abs(points) <= CHANGE_EPSILON) return "No change";
  return points > 0 ? `${size} points drier` : `${size} points wetter`;
}
