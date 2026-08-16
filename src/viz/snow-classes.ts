/*
 * The snow map's percent-of-normal classes, in one table.
 *
 * Same rule as the storage and drought tables (ADR-008): the map fills, the
 * site markers and the legend all read these rows, so a break cannot move on
 * one surface and not another. This table never appears on the reservoir map
 * (ADR-021).
 *
 * The ramp is Esri's published **Green and Brown 6**, reversed so the deficit
 * end is warm, and it was changed on 2026-08-16 for a reason worth recording:
 * the old one was not merely *similar* to the storage ramp, it overlapped it.
 * Storage draws Esri's Blue and Red 9; snow drew a hand-picked five-class
 * RdYlBu, and `#fdae61` and `#abd9e9` were byte-identical in both tables. Two
 * maps of two different quantities were speaking the same colour language,
 * which is the failure "one colour language per map" exists to prevent -- it
 * just happened across pages instead of within one.
 *
 * Brown to teal is also the better ramp on its own merits. It is the
 * conventional moisture ramp, so dry reads as dry without a legend, and none
 * of its five classes is washed out or near black -- which matters because
 * these are translucent fills over a shaded-relief basemap, where a
 * near-white middle would be indistinguishable from the grey that means "no
 * value for this day". Esri publishes it as colour-blind friendly, tested
 * with a simulator against all three types.
 *
 * The break between warm and cool falls between "75 to 90" and "90 to 110",
 * not at the middle of the five: the classes are not symmetric about normal,
 * and the pivot belongs where the meaning pivots.
 */

export interface SnowClass {
  /** Inclusive lower bound, percent of the normal median. */
  min: number;
  /** Exclusive upper bound, or null for the open top class. */
  max: number | null;
  label: string;
  color: string;
}

/** The Esri ramp these colours are taken from, named so the choice can be
 * checked against the publisher rather than only against this file. */
export const SNOW_RAMP_NAME = "Green and Brown 6";

export const SNOW_CLASSES: readonly SnowClass[] = [
  { min: 0, max: 50, label: "Under 50% of normal", color: "#8c270e" },
  { min: 50, max: 75, label: "50 to 75% of normal", color: "#c7811e" },
  { min: 75, max: 90, label: "75 to 90% of normal", color: "#d2e096" },
  { min: 90, max: 110, label: "90 to 110%: near normal", color: "#6ca68b" },
  { min: 110, max: null, label: "Above 110% of normal", color: "#308fa6" }
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
