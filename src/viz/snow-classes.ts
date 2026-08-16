/*
 * The snow map's percent-of-normal classes, in one table.
 *
 * Same rule as the storage and drought tables (ADR-008): the map fills, the
 * site markers and the legend all read these rows, so a break cannot move on
 * one surface and not another. This table never appears on the reservoir map
 * (ADR-021).
 *
 * The ramp is Fabio Crameri's **roma**, a scientific colour map: perceptually
 * uniform, colour-vision-deficiency safe, and readable in greyscale. It runs
 * warm to cool -- dry earth through pale olive to water -- which is the
 * conventional moisture direction, so the map reads without its legend.
 *
 * It was not chosen by eye. Every Crameri diverging map was sampled at these
 * six class positions and filtered on four rules at once: no class outside
 * the luminance band a translucent fill over shaded relief needs, no two
 * adjacent classes closer than 30 in RGB distance, the dry end warm and the
 * wet end cool, and no colour close to anything in the storage or drought
 * tables. Eighteen combinations survived; this one had the largest separation
 * from the other two tables.
 *
 * **The breaks matter more than the ramp, and that is the real change here.**
 * The four thresholds the measuring service reports against -- 50, 75, 90 and
 * 110 -- are kept exactly. A fifth was added at 25, because the four on their
 * own put 62% of every published basin-day into the single lowest class: in a
 * dry year the map was one colour and the ramp was decoration. Splitting the
 * bottom takes the worst class from 62% to 39% of observations and gives the
 * range the region actually occupies somewhere to spread. Six classes is
 * still inside the five-to-seven a reader can hold.
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

/** The colour map these values were sampled from, named so the choice can be
 * checked against its publisher rather than only against this file. */
export const SNOW_RAMP_NAME = "Crameri roma";

export const SNOW_CLASSES: readonly SnowClass[] = [
  { min: 0, max: 25, label: "Under 25% of normal", color: "#984e14" },
  { min: 25, max: 50, label: "25 to 50% of normal", color: "#ae7c28" },
  { min: 50, max: 75, label: "50 to 75% of normal", color: "#c6ae4f" },
  { min: 75, max: 90, label: "75 to 90% of normal", color: "#d2d98d" },
  { min: 90, max: 110, label: "90 to 110%: near normal", color: "#74cfd6" },
  { min: 110, max: null, label: "Above 110% of normal", color: "#2a81bb" }
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
