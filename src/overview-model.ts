import type { Reservoir } from "./types";

export type OverviewSort = "name" | "capacity" | "storage" | "percent" | "updated";

export function overviewScope(reservoirs: readonly Reservoir[]): Reservoir[] {
  return reservoirs.filter((reservoir) =>
    reservoir.intersects_utah && reservoir.name.trim().toLowerCase() !== "lake powell");
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
