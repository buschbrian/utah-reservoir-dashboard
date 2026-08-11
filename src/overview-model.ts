import type { Reservoir } from "./types";
import {
  isLate,
  reservoirInScope,
  statewideRollup,
  type LakePowellChoice,
  type ReservoirGeography
} from "./data/rollup";
import { STALE_COLOR, storageClass } from "./viz/classes";

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
  /** The storage class this value falls in, so a chart can be coloured by
   * the same table the map is drawn from (ADR-008). */
  classLabel: string;
  classColor: string;
}

/* A bar reads as a quantity twice: its length and its colour. The two have
 * to be the same claim, so the class is taken from the same function the
 * renderer and the legend use rather than re-derived from the breaks. */
function classOf(percent: number): { classLabel: string; classColor: string } {
  const found = storageClass(percent);
  return {
    classLabel: found?.label ?? "Not reported",
    classColor: found?.color ?? STALE_COLOR
  };
}

/**
 * The reservoirs a page shows, for a given Lake Powell choice.
 *
 * ADR-011 made this two dimensions on purpose and said Lake Powell stays "a
 * deliberate comparison control instead of an accidental geographic
 * filter". It was a constant at every call site instead, which made the
 * control impossible to offer: excluding one large reservoir is not a
 * geographic rule, and a reader who wants the total with it has no way to
 * ask. Geography stays fixed at `utah` here -- that is the page's subject,
 * not a preference.
 */
export interface ScopeChoice {
  geography: ReservoirGeography;
  lakePowell: LakePowellChoice;
}

export const DEFAULT_SCOPE: ScopeChoice = { geography: "utah", lakePowell: "exclude" };

/**
 * The reservoirs a page shows.
 *
 * Both of ADR-011's dimensions are now the reader's to choose. Geography was
 * pinned to `utah` here, which is why Fontenelle and Woodruff Narrows -- two
 * reservoirs the refresh pays for every morning, connected to Utah by
 * drainage but never touching it -- were published and then drawn nowhere.
 */
export function overviewScope(
  reservoirs: readonly Reservoir[],
  scope: ScopeChoice = DEFAULT_SCOPE
): Reservoir[] {
  return reservoirs.filter((reservoir) => reservoirInScope(reservoir, scope));
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
        ? isLate(reservoir)
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
      capacityAf: reservoir.capacity_af ?? 0,
      ...classOf(reservoir.pct_of_capacity ?? 0)
    }));
}

export function watershedRecords(reservoirs: readonly Reservoir[]): OverviewChartRecord[] {
  const groups = new Map<string, Reservoir[]>();
  for (const reservoir of reservoirs) {
    const label = reservoir.huc6_name ?? "Not assigned";
    groups.set(label, [...(groups.get(label) ?? []), reservoir]);
  }
  return [...groups].map(([label, group], index) => {
    /* The group is already scoped by the caller; including Lake Powell here
     * only means "do not filter it out a second time", not "add it back". */
    const rollup = statewideRollup(group, { geography: "connected", lakePowell: "include" });
    const percent = Number((rollup.percentFull ?? 0).toFixed(1));
    return {
      id: index + 1,
      label,
      percent,
      storageAf: rollup.storageAf,
      capacityAf: rollup.capacityAf,
      ...classOf(percent)
    };
  }).sort((a, b) => b.capacityAf - a.capacityAf)
    .map((record, index) => ({ ...record, id: index + 1 }));
}
