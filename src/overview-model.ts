import type { Reservoir } from "./types";
import { monthKeys, monthLabel, monthlyRollup } from "./data/months";
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

/**
 * What a bar's length means.
 *
 * The colour is always the storage class (ADR-008), so a reader switching to
 * acre-feet still sees which reservoirs are low -- the two encodings answer
 * different questions and only one of them changes here.
 */
export type ChartMeasure = "percent" | "storage";

/** How the bars are ordered. Separate from the table's sort, which sorts rows. */
export type ChartRank = "capacity" | "storage" | "percent" | "name";

export interface ChartOptions {
  limit?: number;
  measure?: ChartMeasure;
  rank?: ChartRank;
}

function rankReservoirs(reservoirs: readonly Reservoir[], rank: ChartRank): Reservoir[] {
  const ordered = [...reservoirs];
  if (rank === "name") return ordered.sort((a, b) => a.name.localeCompare(b.name));
  if (rank === "storage") return ordered.sort((a, b) => b.current_storage_af - a.current_storage_af);
  if (rank === "percent") {
    return ordered.sort((a, b) =>
      numberOrLast(b.pct_of_capacity) - numberOrLast(a.pct_of_capacity));
  }
  return ordered.sort((a, b) => numberOrLast(b.capacity_af) - numberOrLast(a.capacity_af));
}

export function largestReservoirRecords(
  reservoirs: readonly Reservoir[], options: number | ChartOptions = {}
): OverviewChartRecord[] {
  /* A bare number is still the limit. This function was called that way from
   * two places and from a test before it grew options, and quietly changing
   * what the second argument means is how a chart ends up ranked by
   * something nobody chose. */
  const settings: ChartOptions = typeof options === "number" ? { limit: options } : options;
  const limit = settings.limit ?? 15;
  const measure = settings.measure ?? "percent";
  return rankReservoirs(
    reservoirs.filter((reservoir) =>
      reservoir.capacity_af !== null && reservoir.pct_of_capacity !== null),
    settings.rank ?? "capacity"
  )
    .slice(0, limit)
    .map((reservoir, index) => ({
      id: index + 1,
      label: reservoir.name,
      /* `percent` is the bar's length, so it carries whichever measure the
       * reader chose. The class -- and therefore the colour -- is always
       * taken from the percentage, never from the length. */
      percent: measure === "storage"
        ? reservoir.current_storage_af
        : reservoir.pct_of_capacity ?? 0,
      storageAf: reservoir.current_storage_af,
      capacityAf: reservoir.capacity_af ?? 0,
      ...classOf(reservoir.pct_of_capacity ?? 0)
    }));
}

/** One point per month in the payload, oldest first. */
export interface TrendPoint {
  id: number;
  month: string;
  label: string;
  /**
   * The label the category axis uses, year first.
   *
   * A category axis sorts its values, and month names sort alphabetically:
   * the axis read April, August, February, July, March -- every month
   * present and none in the order they happened. A temporal axis fixed the
   * order but chose its own tick interval, which for thirteen months came
   * out as 2025, 2026, 2027: three ticks, one of them past the end of the
   * data. Year-first text sorts chronologically as text, which is the one
   * arrangement that needs nothing from the axis at all.
   */
  axisLabel: string;
  percent: number;
  storageAf: number;
  /** Reservoirs that reported anything for this month. */
  reporting: number;
}

/**
 * Combined storage across the last twelve months, for whatever the filters
 * currently include.
 *
 * The denominator is each month's own reporting set rather than the whole
 * scope, which is `monthlyRollup`'s rule already: a reservoir that did not
 * report in November must not be counted as empty in November.
 */
export function monthlyTrend(reservoirs: readonly Reservoir[]): TrendPoint[] {
  return monthKeys(reservoirs).map((month, index) => {
    const rollup = monthlyRollup(reservoirs, month);
    return {
      id: index + 1,
      month,
      label: monthLabel(month),
      axisLabel: month,
      percent: Number((rollup.percentFull ?? 0).toFixed(1)),
      storageAf: rollup.storageAf,
      reporting: rollup.reporting
    };
  });
}

/**
 * One value per reservoir, with the group it belongs to.
 *
 * The shape the distribution and spread charts both take: a histogram bins
 * the values and a box plot splits them by the group, so the same rows serve
 * "how is the state doing" and "how does each drainage area vary inside
 * itself" without deriving the set twice.
 */
export interface ValuePoint {
  id: number;
  label: string;
  value: number;
  group: string;
}

export function percentFullValues(reservoirs: readonly Reservoir[]): ValuePoint[] {
  return reservoirs
    .map((reservoir) => ({
      reservoir,
      percent: reservoir.pct_of_capacity ?? reservoir.pct_of_record_max
    }))
    /* A reservoir with no readable percentage is left out rather than
     * counted as zero: a histogram is a claim about how many reservoirs sit
     * in each band, and "we do not know" is not a band. */
    .filter((entry): entry is { reservoir: Reservoir; percent: number } =>
      entry.percent !== null && Number.isFinite(entry.percent))
    .map((entry, index) => ({
      id: index + 1,
      label: entry.reservoir.name,
      value: Number(entry.percent.toFixed(1)),
      group: entry.reservoir.huc6_name ?? "Not assigned"
    }));
}

/** One reservoir's storage against what is normal for the date. */
export interface NormalPoint {
  id: number;
  label: string;
  storageAf: number;
  normalAf: number;
  /** Above 100 is wetter than usual for the date, below is drier. */
  percentOfNormal: number;
  classLabel: string;
  classColor: string;
}

/**
 * Storage against the normal value for this date, per reservoir.
 *
 * Only reservoirs that have a normal at all: it is the median of readings
 * near the same date in earlier years, and a reservoir with too little
 * history has none. Plotting those at zero would invent a drought.
 */
export function normalComparison(reservoirs: readonly Reservoir[]): NormalPoint[] {
  return reservoirs
    .filter((reservoir) =>
      reservoir.seasonal_normal_af !== null && reservoir.seasonal_normal_af > 0)
    .map((reservoir, index) => ({
      id: index + 1,
      label: reservoir.name,
      storageAf: reservoir.current_storage_af,
      normalAf: reservoir.seasonal_normal_af ?? 0,
      percentOfNormal: Number((reservoir.pct_of_seasonal_normal
        ?? (reservoir.current_storage_af / (reservoir.seasonal_normal_af ?? 1)) * 100).toFixed(1)),
      ...classOf(reservoir.pct_of_capacity ?? reservoir.pct_of_record_max ?? 0)
    }))
    .sort((a, b) => a.percentOfNormal - b.percentOfNormal);
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
