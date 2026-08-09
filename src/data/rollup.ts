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

export function sizeBasis(reservoir: Reservoir): number {
  return reservoir.capacity_af ?? reservoir.record_max_af;
}

export function percentFull(reservoir: Reservoir): number | null {
  const denominator = sizeBasis(reservoir);
  return denominator > 0 ? reservoir.current_storage_af / denominator * 100 : null;
}

export function expectedStaleAfterDays(reservoir: Reservoir): number {
  return reservoir.stale_after_days ?? (reservoir.data_frequency === "monthly" ? 45 : 2);
}

export function isLateForCadence(reservoir: Reservoir): boolean {
  return !reservoir.fetch_ok || reservoir.days_stale > expectedStaleAfterDays(reservoir);
}

export function statewideRollup(
  allReservoirs: readonly Reservoir[],
  options: { excludeLakePowell?: boolean } = {}
): StatewideRollup {
  const reservoirs = options.excludeLakePowell
    ? allReservoirs.filter((reservoir) => reservoir.name.trim().toLowerCase() !== "lake powell")
    : [...allReservoirs];
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
    stale: reservoirs.filter(isLateForCadence).length,
    belowHalf: reservoirs.filter((reservoir) => {
      const percent = percentFull(reservoir);
      return percent !== null && percent < 50;
    }).length,
    classes
  };
}
