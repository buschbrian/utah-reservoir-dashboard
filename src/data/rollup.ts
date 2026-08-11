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

export interface StatewideRollupOptions {
  geography: ReservoirGeography;
  lakePowell: LakePowellChoice;
}

/** RISE item 509 is Lake Powell's stable provider identity (ADR-003). */
export function isLakePowell(reservoir: Reservoir): boolean {
  return reservoir.rise_item_id === 509
    || reservoir.name.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ") === "lake powell";
}

export function reservoirInScope(
  reservoir: Reservoir, options: StatewideRollupOptions
): boolean {
  if (options.geography === "utah" && !reservoir.intersects_utah) return false;
  return options.lakePowell === "include" || !isLakePowell(reservoir);
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
