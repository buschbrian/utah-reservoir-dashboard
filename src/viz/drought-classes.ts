/*
 * The U.S. Drought Monitor's five intensity classes, in one table.
 *
 * Same rule as the storage classes (ADR-008): every surface that colours,
 * labels or orders drought reads this table, so a class cannot mean two
 * things on two surfaces. The colours are the monitor's own published
 * palette, kept verbatim because readers who know the national map already
 * know these exact yellows and reds -- inventing a nicer ramp would break
 * that recognition for no gain. This table never appears on the reservoir
 * map, which keeps one colour language per map (ADR-021's rule, applied to
 * drought).
 */

export interface DroughtClass {
  /** The payload key: "d0" through "d4". */
  key: "d0" | "d1" | "d2" | "d3" | "d4";
  /** The monitor's short code, for compact labels. */
  code: string;
  /** The monitor's official class name. */
  label: string;
  /** The monitor's published map colour. */
  color: string;
}

export const DROUGHT_CLASSES: readonly DroughtClass[] = [
  { key: "d0", code: "D0", label: "Abnormally dry", color: "#ffff00" },
  { key: "d1", code: "D1", label: "Moderate drought", color: "#fcd37f" },
  { key: "d2", code: "D2", label: "Severe drought", color: "#ffaa00" },
  { key: "d3", code: "D3", label: "Extreme drought", color: "#e60000" },
  { key: "d4", code: "D4", label: "Exceptional drought", color: "#730000" }
] as const;

/** The share of land in no class at all. Not a drought class -- it has no
 * code and no monitor colour -- but the bars need a word and a fill for it. */
export const NO_DROUGHT_LABEL = "No drought";
