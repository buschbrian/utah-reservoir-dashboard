import type { Reservoir } from "./types";
import { isLateForCadence, reservoirInScope, statewideRollup } from "./data/rollup";

export type OverviewSort = "name" | "capacity" | "storage" | "percent" | "updated";
export type OverviewCadence = "all" | "daily" | "monthly" | "late";

export interface OverviewFilters {
  query: string;
  huc6: string;
  cadence: OverviewCadence;
}

export interface OverviewChartRecord {
  id: number;
  label: string;
  percent: number;
  storageAf: number;
  capacityAf: number;
}

export function overviewScope(reservoirs: readonly Reservoir[]): Reservoir[] {
  return reservoirs.filter((reservoir) => reservoirInScope(reservoir, {
    geography: "utah",
    lakePowell: "exclude"
  }));
}

function numberOrLast(value: number | null): number {
  return value === null || !Number.isFinite(value) ? Number.NEGATIVE_INFINITY : value;
}

export function filterAndSort(
  reservoirs: readonly Reservoir[], query: string, sort: OverviewSort
): Reservoir[] {
  const needle = query.trim().toLocaleLowerCase("en-US");
  const filtered = needle
    ? reservoirs.filter((reservoir) =>
      `${reservoir.name} ${reservoir.huc6_name ?? ""}`.toLocaleLowerCase("en-US").includes(needle))
    : [...reservoirs];
  return filtered.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "capacity") return numberOrLast(b.capacity_af) - numberOrLast(a.capacity_af);
    if (sort === "storage") return b.current_storage_af - a.current_storage_af;
    if (sort === "percent") return numberOrLast(b.pct_of_capacity) - numberOrLast(a.pct_of_capacity);
    return b.as_of.localeCompare(a.as_of);
  });
}

export function filterOverview(
  reservoirs: readonly Reservoir[], filters: OverviewFilters
): Reservoir[] {
  const needle = filters.query.trim().toLocaleLowerCase("en-US");
  return reservoirs.filter((reservoir) => {
    const matchesQuery = !needle || `${reservoir.name} ${reservoir.huc6_name ?? ""}`
      .toLocaleLowerCase("en-US").includes(needle);
    const matchesWatershed = filters.huc6 === "all" || reservoir.huc6 === filters.huc6;
    const matchesCadence = filters.cadence === "all"
      || (filters.cadence === "late"
        ? isLateForCadence(reservoir)
        : reservoir.data_frequency === filters.cadence);
    return matchesQuery && matchesWatershed && matchesCadence;
  });
}

export function watershedOptions(reservoirs: readonly Reservoir[]): Array<{
  code: string;
  label: string;
}> {
  const labels = new Map<string, string>();
  for (const reservoir of reservoirs) {
    if (reservoir.huc6) labels.set(reservoir.huc6, reservoir.huc6_name ?? reservoir.huc6);
  }
  return [...labels].map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function largestReservoirRecords(
  reservoirs: readonly Reservoir[], limit = 15
): OverviewChartRecord[] {
  return reservoirs
    .filter((reservoir) => reservoir.capacity_af !== null && reservoir.pct_of_capacity !== null)
    .sort((a, b) => (b.capacity_af ?? 0) - (a.capacity_af ?? 0))
    .slice(0, limit)
    .map((reservoir, index) => ({
      id: index + 1,
      label: reservoir.name,
      percent: reservoir.pct_of_capacity ?? 0,
      storageAf: reservoir.current_storage_af,
      capacityAf: reservoir.capacity_af ?? 0
    }));
}

export function watershedRecords(reservoirs: readonly Reservoir[]): OverviewChartRecord[] {
  const groups = new Map<string, Reservoir[]>();
  for (const reservoir of reservoirs) {
    const label = reservoir.huc6_name ?? "Not assigned";
    groups.set(label, [...(groups.get(label) ?? []), reservoir]);
  }
  return [...groups].map(([label, group], index) => {
    const rollup = statewideRollup(group, { geography: "connected", lakePowell: "exclude" });
    return {
      id: index + 1,
      label,
      percent: Number((rollup.percentFull ?? 0).toFixed(1)),
      storageAf: rollup.storageAf,
      capacityAf: rollup.capacityAf
    };
  }).sort((a, b) => b.capacityAf - a.capacityAf)
    .map((record, index) => ({ ...record, id: index + 1 }));
}
