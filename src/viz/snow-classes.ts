/*
 * The snow map's percent-of-normal classes, in one table.
 *
 * Same rule as the storage and drought tables (ADR-008): the map fills, the
 * site markers and the legend all read these rows, so a break cannot move on
 * one surface and not another. The ramp is red-to-blue rather than the
 * reservoir map's red-to-green: blue is what snow and water read as on every
 * product in this category, the two ramps cannot be mistaken for each other
 * across pages, and red-to-blue stays readable with the common forms of
 * colour-blindness. This table never appears on the reservoir map (ADR-021).
 */

export interface SnowClass {
  /** Inclusive lower bound, percent of the normal median. */
  min: number;
  /** Exclusive upper bound, or null for the open top class. */
  max: number | null;
  label: string;
  color: string;
}

export const SNOW_CLASSES: readonly SnowClass[] = [
  { min: 0, max: 50, label: "Under 50% of normal", color: "#d73027" },
  { min: 50, max: 75, label: "50 to 75% of normal", color: "#fdae61" },
  { min: 75, max: 90, label: "75 to 90% of normal", color: "#fee090" },
  { min: 90, max: 110, label: "90 to 110%: near normal", color: "#abd9e9" },
  { min: 110, max: null, label: "Above 110% of normal", color: "#4575b4" }
] as const;

/** The words and look for a place with no fair value on the chosen day. */
export const NO_VALUE_LABEL = "No value for this day";

/** The class a percent falls in, or null for no value. */
export function snowClassIndex(percent: number | null): number | null {
  if (percent === null || !Number.isFinite(percent) || percent < 0) return null;
  for (let index = 0; index < SNOW_CLASSES.length; index += 1) {
    const entry = SNOW_CLASSES[index]!;
    if (entry.max === null || percent < entry.max) return index;
  }
  return null;
}
