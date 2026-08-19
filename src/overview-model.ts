import type { Reservoir } from "./types";
import { monthKeys, monthLabel, monthlyRollup } from "./data/months";
import {
  isLate,
  reservoirInScope,
  statewideRollup,
  WIDEST_SCOPE,
  type LakePowellChoice,
  type ReservoirInclusion,
  type ReservoirGeography
} from "./data/rollup";
import { STALE_COLOR, storageClass } from "./viz/classes";
import { formatPercent } from "./viz/format";

export type OverviewSort = "name" | "capacity" | "storage" | "percent" | "updated";
export type OverviewCadence = "all" | "daily" | "monthly" | "late";

export interface OverviewFilters {
  query: string;
  /**
   * The three geographic filters narrow each other, coarsest first: a state
   * holds subregions, a subregion holds drainage areas. A reader can start
   * anywhere and stop anywhere.
   */
  state: string;
  /** A four-digit subregion code, or "all". The first four digits of `huc6`. */
  huc4: string;
  huc6: string;
  /** A five-digit FIPS code, or "all". Never a county name -- see `Reservoir`. */
  county: string;
  cadence: OverviewCadence;
}

/**
 * Which state filter means what.
 *
 * ADR-060 records that "in Idaho" is three questions. This picks the second:
 * every state the *water* touches. It is what `intersects_utah` has always
 * meant for Utah, so Bear Lake stays in Utah's list where a reader expects
 * it, and it is the only one of the three that answers "show me the water in
 * my state" rather than "show me the dams filed under it".
 */
export function reservoirInState(reservoir: Reservoir, state: string): boolean {
  if (state === "all") return true;
  const states = reservoir.waterbody_states;
  /* Fall back to the point's own state for a payload published before
   * `waterbody_states` existed -- the field is optional for that reason. */
  return states && states.length > 0
    ? states.includes(state)
    : reservoir.state === state;
}

/** The subregion a drainage area belongs to. Codes are fixed-width (ADR-050). */
export function subregionOf(reservoir: Reservoir): string | null {
  return reservoir.huc6 ? reservoir.huc6.slice(0, 4) : null;
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
  /** Absent means excluded, like Lake Powell's default (ADR-062). */
  lakeMead?: ReservoirInclusion;
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

/**
 * Lowercased, with commas as spaces and runs of space collapsed.
 *
 * The comma is the point. The county control's own labels read "Summit
 * County, CO", so a reader who copies one into the search box types a comma
 * the joined text never contained -- the match failed on punctuation the
 * reader had every reason to include. Normalising both sides means the label
 * a reader can see is a query that works.
 */
function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The text a reservoir can be found by.
 *
 * County is in here because it is the reason the axis exists (ADR-058):
 * readers ask for "Washington County", not for a drainage area. The state
 * goes in with it so Summit UT and Summit CO are separable by typing, the
 * same way the filter separates them by code.
 */
function searchText(reservoir: Reservoir): string {
  return normalize([
    reservoir.name,
    reservoir.huc6_name ?? "",
    reservoir.county_name ?? "",
    reservoir.state ?? ""
  ].join(" "));
}

function numberOrLast(value: number | null): number {
  return value === null || !Number.isFinite(value) ? Number.NEGATIVE_INFINITY : value;
}

export function filterAndSort(
  reservoirs: readonly Reservoir[], query: string, sort: OverviewSort
): Reservoir[] {
  const needle = normalize(query);
  const filtered = needle
    ? reservoirs.filter((reservoir) => searchText(reservoir).includes(needle))
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
  const needle = normalize(filters.query);
  return reservoirs.filter((reservoir) => {
    const matchesQuery = !needle || searchText(reservoir).includes(needle);
    const matchesState = reservoirInState(reservoir, filters.state);
    const matchesSubregion = filters.huc4 === "all"
      || subregionOf(reservoir) === filters.huc4;
    const matchesWatershed = filters.huc6 === "all" || reservoir.huc6 === filters.huc6;
    /* A reservoir with no county cannot match a chosen county. It is left
     * out rather than shown, because a filter naming one county and
     * answering with a reservoir whose county is unknown is a claim the
     * payload does not support. */
    const matchesCounty = filters.county === "all"
      || reservoir.county_fips === filters.county;
    const matchesCadence = filters.cadence === "all"
      || (filters.cadence === "late"
        ? isLate(reservoir)
        : reservoir.data_frequency === filters.cadence);
    return matchesQuery && matchesState && matchesSubregion && matchesWatershed
      && matchesCounty && matchesCadence;
  });
}

export interface FilterOption {
  code: string;
  label: string;
}

/**
 * The states a set of reservoirs touches.
 *
 * Every state in `waterbody_states`, not one per reservoir: Lake Powell is in
 * both Utah's list and Arizona's, because its water is in both. That is the
 * whole reason the field is an array (ADR-060).
 *
 * Two-letter codes are the label as well as the key. Spelling them out would
 * be a second table to keep, and a filter listing UT, WY, CO reads fine.
 */
export function stateOptions(reservoirs: readonly Reservoir[]): FilterOption[] {
  const codes = new Set<string>();
  for (const reservoir of reservoirs) {
    const states = reservoir.waterbody_states?.length
      ? reservoir.waterbody_states
      : (reservoir.state ? [reservoir.state] : []);
    for (const code of states) codes.add(code);
  }
  return [...codes].sort().map((code) => ({ code, label: code }));
}

/**
 * The subregions a set of reservoirs falls in.
 *
 * `names` comes from the payload's own roster; a code with no name is
 * labelled by its code rather than dropped, because a subregion that exists
 * in the data and not in the roster is still somewhere a reader can be.
 */
export function subregionOptions(
  reservoirs: readonly Reservoir[], names: ReadonlyMap<string, string>
): FilterOption[] {
  const codes = new Set<string>();
  for (const reservoir of reservoirs) {
    const code = subregionOf(reservoir);
    if (code) codes.add(code);
  }
  return [...codes].sort()
    .map((code) => ({ code, label: names.get(code) || code }));
}

export function watershedOptions(
  reservoirs: readonly Reservoir[],
  level = 6,
  names: ReadonlyMap<string, string> = new Map()
): Array<{
  code: string;
  label: string;
}> {
  const labels = new Map<string, string>();
  for (const reservoir of reservoirs) {
    if (!reservoir.huc6) continue;
    /* At the coarser level the code is the first four digits -- fixed-width
     * codes nest -- and the name has to come from a roster, because the
     * record carries its basin's name and not its subregion's. That roster is
     * `watersheds.subregions` in the same payload (ADR-060, ADR-064); an area
     * it does not name is labelled by its code. */
    const code = reservoir.huc6.slice(0, level);
    const label = code === reservoir.huc6
      ? reservoir.huc6_name ?? code
      : names.get(code) ?? code;
    labels.set(code, label);
  }
  return [...labels].map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The subregion names a payload publishes, for `watershedOptions` to label
 * the coarser grouping with. Empty for a payload written before they were
 * published, which labels by code rather than failing. */
export function subregionNames(payload: {
  watersheds?: { subregions?: { huc4: string; name: string }[] };
}): Map<string, string> {
  return new Map((payload.watersheds?.subregions ?? [])
    .filter((entry) => typeof entry?.huc4 === "string" && entry.huc4.length === 4)
    .map((entry) => [entry.huc4, typeof entry.name === "string" ? entry.name : ""]));
}

/**
 * The counties present in a set, for a filter control.
 *
 * Empty when the payload carries no county at all, which is what the morning
 * before the assignment first ships looks like. A caller offering an empty
 * control would show a reader a filter that can only narrow to nothing, so
 * the emptiness is the signal to leave the control out.
 *
 * Labelled with the state and keyed on the code. Sorted by label, which puts
 * "Summit County, CO" before "Summit County, UT" rather than leaving two
 * identical-looking rows in payload order.
 */
export function countyOptions(reservoirs: readonly Reservoir[]): Array<{
  code: string;
  label: string;
}> {
  const labels = new Map<string, string>();
  for (const reservoir of reservoirs) {
    if (!reservoir.county_fips || !reservoir.county_name) continue;
    labels.set(
      reservoir.county_fips,
      reservoir.state
        ? `${reservoir.county_name}, ${reservoir.state}`
        : reservoir.county_name
    );
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
 *
 * Only the newest twelve month keys. Each reservoir carries twelve months,
 * but a late reservoir's twelve are older ones, so the union across the set
 * stretches further back than any single reservoir's window -- and the chart
 * says "the last twelve months", so drawing fourteen or fifteen makes the
 * title wrong on exactly the mornings a reservoir goes quiet. The map's
 * month slider still takes the whole union: a slider position is a claim
 * that some reservoir reported then, not that the last year contains it.
 */
export function monthlyTrend(reservoirs: readonly Reservoir[]): TrendPoint[] {
  return monthKeys(reservoirs).slice(-12).map((month, index) => {
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

/**
 * The three statistics the histogram draws lines for.
 *
 * Computed here so the key under the chart can print them. The chart draws
 * the lines from its own arithmetic over the same values, so these have to
 * agree with it exactly or the page states one number and marks another.
 *
 * The standard deviation is the **sample** one, dividing by n - 1. That is
 * not a preference: it is what the SDK's own overlay uses, verified against a
 * rendered chart -- 51 reservoirs, mean 41.05, median 38.8, and the legend
 * printing 23.58 where the population figure is 23.34. The difference is a
 * quarter of a point, which is small enough to look like rounding and large
 * enough to be wrong.
 *
 * Null for fewer than two values, where a sample standard deviation has no
 * denominator. The chart refuses to draw below three (`renderArcgis-
 * DistributionChart`), so a caller with a key and no chart has nothing to
 * label anyway.
 */
export interface DistributionStats {
  mean: number;
  median: number;
  standardDeviation: number;
}

export function distributionStats(
  values: readonly ValuePoint[]
): DistributionStats | null {
  const numbers = values.map((point) => point.value)
    .filter((value) => Number.isFinite(value));
  if (numbers.length < 2) return null;
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  /* An even count has no single middle value, so the two either side are
   * averaged -- which is what "the middle value" means for an even sample and
   * what the chart's own median line sits at. */
  const median = sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const variance = numbers.reduce(
    (sum, value) => sum + (value - mean) ** 2, 0) / (numbers.length - 1);
  return { mean, median, standardDeviation: Math.sqrt(variance) };
}

/**
 * The histogram's legend: what each line means and where it sits.
 *
 * Here rather than beside the chart because it is text and arithmetic, and
 * the chart module cannot be imported without the SDK and its stylesheets --
 * which is how this key went untested while it was the only thing on the page
 * naming four otherwise unexplained lines.
 *
 * `key` is what the chart module attaches a colour to, so the label and the
 * colour cannot come apart: one list, one order, and a line that gains a
 * label without a colour fails to compile.
 */
export type OverlayKeyStyle = "solid" | "dashed" | "dotted";

export interface OverlayKeyLine {
  key: "mean" | "median" | "deviation" | "curve";
  label: string;
  style: OverlayKeyStyle;
}


export function distributionKeyLines(
  stats: DistributionStats | null = null
): OverlayKeyLine[] {
  return [
    {
      key: "mean",
      label: stats ? `Mean ${formatPercent(stats.mean)}` : "Mean",
      style: "solid"
    },
    {
      key: "median",
      label: stats
        ? `Middle value ${formatPercent(stats.median)}`
        : "Middle value",
      style: "dashed"
    },
    {
      key: "deviation",
      /* Points, not percent: this is a distance between two percentages, and
       * writing it as 23.6% invites a reader to take it for a share of
       * something (ADR-046's rule, one scale down). */
      /* One decimal like every percentage here, but no percent sign: the
       * site's own formatter would add one. The SDK's rail printed two
       * decimals, which is below what the reading is worth. */
      label: stats
        ? `One standard deviation ${stats.standardDeviation.toFixed(1)} points`
        : "One standard deviation",
      style: "dotted"
    },
    { key: "curve", label: "Fitted normal curve", style: "solid" }
  ];
}

/** One reservoir's storage against what is normal for the date. */
export interface NormalPoint {
  id: number;
  label: string;
  watershed: string;
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
      watershed: reservoir.huc6_name ?? "Not assigned",
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
    /* The group is already scoped by the caller; WIDEST_SCOPE only means
     * "do not filter them out a second time", not "add them back". A
     * hand-written option object here once dropped Lake Mead's storage out
     * of its own drainage area's total (ADR-062). */
    const rollup = statewideRollup(group, WIDEST_SCOPE);
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
