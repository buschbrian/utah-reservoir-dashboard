import type { Reservoir } from "../types";
import { STORAGE_CLASSES, storageClass } from "../viz/classes";

export interface ClassCount {
  label: string;
  color: string;
  count: number;
}

export interface StatewideRollup {
  count: number;
  storageAf: number;
  capacityAf: number;
  percentFull: number | null;
  change30dAf: number;
  change365dAf: number;
  normalAf: number;
  percentOfNormal: number | null;
  normalCovers: number;
  stale: number;
  belowHalf: number;
  classes: ClassCount[];
}

export type ReservoirGeography = "utah" | "connected";
export type LakePowellChoice = "include" | "exclude";
/** The same two values, for any reservoir large enough to need its own control. */
export type ReservoirInclusion = LakePowellChoice;

export interface StatewideRollupOptions {
  geography: ReservoirGeography;
  lakePowell: LakePowellChoice;
  /** Defaults to excluded, like Lake Powell, for the same reason (ADR-062). */
  lakeMead?: ReservoirInclusion;
}

/**
 * Reservoirs big enough that including them answers a different question.
 *
 * ADR-011 made Lake Powell a control rather than a filter: at 25 million
 * acre-feet it is most of any total it appears in, so a combined figure with
 * it and one without are both true and are not the same measurement. Lake
 * Mead is 28 million and sits in Lower Colorado-Lake Mead, one of the
 * fourteen published areas, where it would be substantially the whole of that
 * area's storage (ADR-062).
 *
 * Keyed on the RISE item id, which is the stable provider identity (ADR-003),
 * with the name as a fallback for a payload that predates the id.
 */
const DOMINANT_RESERVOIRS = [
  { key: "lakePowell", riseItemId: 509, name: "lake powell" },
  { key: "lakeMead", riseItemId: 6124, name: "lake mead" }
] as const;

function matches(reservoir: Reservoir, entry: (typeof DOMINANT_RESERVOIRS)[number]): boolean {
  return reservoir.rise_item_id === entry.riseItemId
    || reservoir.name.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ") === entry.name;
}

/** RISE item 509 is Lake Powell's stable provider identity (ADR-003). */
export function isLakePowell(reservoir: Reservoir): boolean {
  return matches(reservoir, DOMINANT_RESERVOIRS[0]);
}

/** RISE item 6124 is Lake Mead's, reached through catalog record 4370. */
export function isLakeMead(reservoir: Reservoir): boolean {
  return matches(reservoir, DOMINANT_RESERVOIRS[1]);
}

export function reservoirInScope(
  reservoir: Reservoir, options: StatewideRollupOptions
): boolean {
  if (options.geography === "utah" && !reservoir.intersects_utah) return false;
  /* Absent means excluded, which keeps every existing caller's answer
   * unchanged: they were written before Mead was on the roster and would
   * otherwise silently start including 28 million acre-feet. */
  for (const entry of DOMINANT_RESERVOIRS) {
    if (options[entry.key] !== "include" && matches(reservoir, entry)) return false;
  }
  return true;
}

export function sizeBasis(reservoir: Reservoir): number {
  return reservoir.capacity_af ?? reservoir.record_max_af;
}

export function percentFull(reservoir: Reservoir): number | null {
  const denominator = sizeBasis(reservoir);
  return denominator > 0 ? reservoir.current_storage_af / denominator * 100 : null;
}

/**
 * Whether a reservoir's reading is older than its own update schedule.
 *
 * One rule, and it is the pipeline's own answer rather than a second
 * calculation of it. `refresh_reservoirs.py` sets `is_stale` from
 * `days_stale > stale_after_days` using the threshold it publishes on the
 * same record -- two days for a daily feed, 45 for a month-end one -- and
 * forces it true whenever a fetch fails, which is also when `fetch_ok` goes
 * false. The validator requires all three fields, so there is nothing left
 * for a client-side rule to add.
 *
 * This used to be re-derived here, from a time when the pipeline compared
 * every reservoir against a single threshold. It no longer does. Deriving it
 * twice meant the dashed ring on the map and the "Late" badge in the list
 * were two rules with one name, agreeing only by luck -- and the map's
 * reporting filter would have greyed a row that still wore the badge on the
 * first morning they disagreed.
 */
export function isLate(reservoir: Reservoir): boolean {
  return reservoir.is_stale;
}

export function statewideRollup(
  allReservoirs: readonly Reservoir[],
  options: StatewideRollupOptions
): StatewideRollup {
  const reservoirs = allReservoirs.filter((reservoir) => reservoirInScope(reservoir, options));
  const sum = (pick: (reservoir: Reservoir) => number | null): number =>
    reservoirs.reduce((total, reservoir) => total + (pick(reservoir) ?? 0), 0);
  const storageAf = sum((reservoir) => reservoir.current_storage_af);
  const capacityAf = sum(sizeBasis);
  const withNormal = reservoirs.filter((reservoir) => reservoir.seasonal_normal_af !== null);
  const normalAf = withNormal.reduce((total, reservoir) =>
    total + (reservoir.seasonal_normal_af ?? 0), 0);
  const storageWithNormal = withNormal.reduce((total, reservoir) =>
    total + reservoir.current_storage_af, 0);

  const classes = STORAGE_CLASSES.map((entry) => ({
    label: entry.label,
    color: entry.color,
    count: reservoirs.filter((reservoir) =>
      storageClass(percentFull(reservoir))?.min === entry.min).length
  }));

  return {
    count: reservoirs.length,
    storageAf,
    capacityAf,
    percentFull: capacityAf > 0 ? storageAf / capacityAf * 100 : null,
    change30dAf: sum((reservoir) => reservoir.change_30d_af),
    change365dAf: sum((reservoir) => reservoir.change_365d_af),
    normalAf,
    percentOfNormal: normalAf > 0 ? storageWithNormal / normalAf * 100 : null,
    normalCovers: withNormal.length,
    stale: reservoirs.filter(isLate).length,
    belowHalf: reservoirs.filter((reservoir) => {
      const percent = percentFull(reservoir);
      return percent !== null && percent < 50;
    }).length,
    classes
  };
}
