import type { Reservoir } from "./types";
import { monthKeys, monthLabel, monthlyRollup } from "./data/months";
import type { OpeningRosters, OpeningSelection } from "./data/opening-scope";
import {
  asScoped,
  isLate,
  rollupOfScoped,
  scopeReservoirs,
  type ScopedReservoirs,
  sizeBasis,
  type LakePowellChoice,
  type ReservoirInclusion,
  type ReservoirGeography
} from "./data/rollup";
import { stateName } from "./data/state-vocabulary";
import { capacityBasisName, changeLabel, formatChange, rankWithYears } from "./state/detail";
import { formatAcreFeet } from "./viz/format";
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

/**
 * Looks a resolved `?area=` code up in the published roster it belongs to,
 * by its own width -- two digits is a region, four a subregion, six a basin
 * (`data/opening-scope.ts`). Reads the rosters straight from the reference
 * export rather than `OpeningScope`'s own `regions`/`subregions`/`areas`
 * lists, which are narrowed by *state* first: a region whose own `states`
 * attribute happens not to list a state one of its basins still reaches
 * (the same shape of inexactness ADR-060 already accepts for Hyrum) would
 * otherwise cost the reader the region's name for a reason that has nothing
 * to do with whether the code exists.
 */
function namedOpeningArea(area: string, rosters: OpeningRosters): string | null {
  const roster = area.length === 2 ? rosters.regions
    : area.length === 4 ? rosters.subregions
    : rosters.areas;
  return roster.find((candidate) => candidate.huc6 === area)?.name ?? null;
}

/**
 * The place a reader's `?state=` and `?area=` opened this page on, in
 * Simplified Technical English (ADR-006) -- "the summary sentence that
 * names the chosen place" slice S3d owes
 * (docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md).
 *
 * Reads `selection` rather than the live filter controls: it reports what
 * the *link* asked for, once, the way a map's opening extent does. The
 * controls' own answer to "what is on screen right now" is
 * `#filter-status`, which already exists and already changes on every
 * keystroke -- a second sentence chasing the same value would just be behind
 * it by one render.
 *
 * `selection.area` has already been through `resolveOpeningScope`'s
 * aliveness check by the time it reaches here, so a region or subregion the
 * chosen state does not reach has already fallen back to `null` -- this
 * function only has to decide how to phrase what survived, never whether it
 * did. A code that survived but carries no published name (`namedOpeningArea`
 * returns `null`) is dropped from the sentence rather than printed as a raw
 * digit string, the same "silently narrow to what can be said" rule
 * `resolveOpeningScope` itself follows for a dead selection.
 */
export function openingScopeSummary(
  selection: OpeningSelection, rosters: OpeningRosters
): string {
  const { state, area } = selection;
  const areaName = area === null ? null : namedOpeningArea(area, rosters);
  if (state !== "all" && areaName) {
    return `Showing reservoir storage for ${areaName}, in ${stateName(state)}.`;
  }
  if (state !== "all") return `Showing reservoir storage for ${stateName(state)}.`;
  if (areaName) return `Showing reservoir storage for ${areaName}.`;
  return "";
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
  /**
   * What a hover on this mark adds beyond the bar's own number.
   *
   * Present only when the mark answers for one reservoir. A drainage area's
   * rollup has no history rank or county to name, and inventing one from its
   * largest member would put one reservoir's facts under an area's name --
   * so the field stays unset there and the tooltip stays short.
   */
  detail?: ChartRecordDetail;
}

/**
 * The per-reservoir rows a chart tooltip can add, phrased once.
 *
 * The wording comes from the details panel's own helpers, so a rank or a
 * full level reads the same under a chart as it does in the panel -- two
 * surfaces saying one thing in two ways is how a vocabulary drifts (ADR-006).
 */
export interface ChartRecordDetail {
  /** The reservoir's full level and which kind of full level it is. */
  fullLevel: string;
  /** Position in this site's own record, said as a position first. */
  historyRank?: string;
  /** The thirty-day movement, labelled with the interval it really covers. */
  change30d?: { label: string; value: string };
  /** Where the water is, when the payload names a county. */
  countyState?: string;
  /** Rollups only: how many reservoirs the group's numbers answer for. */
  reservoirCount?: number;
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
): ScopedReservoirs {
  /* The branded return is the point: rows that leave here have had every
   * scope question answered, and `rollupOfScoped` is the only way to total
   * them -- it accepts no scope dimensions, so the second narrowing that
   * once put 59 reservoirs under a card reading "Every reservoir" cannot be
   * written any more (ADR-062). */
  return scopeReservoirs(reservoirs, scope);
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
  /**
   * The coarser place this choice sits in, rendered as the heading of the
   * group it appears under. Absent for a choice with no parent on offer --
   * the leading "All ..." rows, and any record whose payload carries no
   * parent to name. Consecutive equal headings become one group; callers
   * must keep same-group rows adjacent (the builders here sort so they are).
   */
  group?: string;
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
): FilterOption[] {
  const labels = new Map<string, { label: string; group?: string }>();
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
    /* At the finest level each basin is grouped under the subregion it
     * belongs to, so the hierarchy shows in one control rather than being
     * implied by a second select beside it. Only when the roster can name
     * the subregion: a raw four-digit heading says nothing a reader reads. */
    const subregion = level === 6 ? names.get(reservoir.huc6.slice(0, 4)) : undefined;
    labels.set(code, subregion ? { label, group: subregion } : { label });
  }
  return [...labels].map(([code, choice]) => ({ code, ...choice }))
    .sort((a, b) =>
      (a.group ?? "").localeCompare(b.group ?? "") || a.label.localeCompare(b.label));
}

/**
 * The two geographic controls that narrow each other, built together.
 *
 * State holds subregion holds drainage area, so each list is what the
 * controls above it leave -- and the caller passes the roster to narrow,
 * which is deliberately the *widest* scope rather than the reader's chosen
 * one. These controls answer "where can a reader go", a question about which
 * reservoirs this payload carries. The geography select and the two
 * dominant-reservoir switches answer ADR-011's other dimension, what is in
 * the total, and a control that followed them would change shape under
 * them: with Lake Powell excluded, which ADR-062 makes the default, the
 * drainage-area list lost four of the roster's areas including Powell's own.
 *
 * Both lists come from one function because the narrowing order is one rule.
 * Split across two call sites it was possible to give them different
 * sources, which is exactly what happened.
 */
export function geographicChoices(
  roster: readonly Reservoir[],
  chosen: { state: string; subregion: string },
  names: ReadonlyMap<string, string>
): { subregions: FilterOption[]; drainageAreas: FilterOption[]; counties: FilterOption[] } {
  const byState = roster.filter((item) => reservoirInState(item, chosen.state));
  /* Read from `byState`, not from the subregion list just built: a subregion
   * the reader still holds after a state change is kept by the control, and
   * one that did not survive falls back to "all" -- which the caller's
   * `fillOptions` decides, after this runs. */
  const bySubregion = byState.filter((item) =>
    chosen.subregion === "all" || subregionOf(item) === chosen.subregion);
  return {
    subregions: subregionOptions(byState, names),
    drainageAreas: watershedOptions(bySubregion, 6, names),
    /* Narrowed by the state alone, not by the subregion: a county cuts
     * across drainage areas, so holding the reader's county while they move
     * between subregions is a choice still on offer, not a stale one. */
    counties: countyOptions(byState)
  };
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
 * Keyed on the five-digit FIPS code and grouped under the county's own state,
 * so two Summit Counties sit under different headings and the label does not
 * have to carry `, ST` to tell them apart -- which is why the suffix went
 * away with the nesting. A record with no state stays ungrouped under its
 * bare name rather than vanishing. Sorted state first, then name, so each
 * group's rows are contiguous.
 */
export function countyOptions(reservoirs: readonly Reservoir[]): FilterOption[] {
  const labels = new Map<string, { label: string; group?: string }>();
  for (const reservoir of reservoirs) {
    if (!reservoir.county_fips || !reservoir.county_name) continue;
    labels.set(reservoir.county_fips,
      reservoir.state
        ? { label: reservoir.county_name, group: reservoir.state }
        : { label: reservoir.county_name });
  }
  return [...labels].map(([code, choice]) => ({ code, ...choice }))
    .sort((a, b) =>
      (a.group ?? "").localeCompare(b.group ?? "") || a.label.localeCompare(b.label));
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

/**
 * The hover rows a one-reservoir mark can add, phrased by the details
 * panel's own helpers so the two surfaces cannot drift apart.
 *
 * Each row is present only when the payload carries the fact: a reservoir
 * with no history rank yet shows no rank row rather than an empty one.
 */
function chartDetail(reservoir: Reservoir): ChartRecordDetail {
  const basis = capacityBasisName(reservoir.capacity_basis);
  const detail: ChartRecordDetail = {
    fullLevel: `${formatAcreFeet(reservoir.capacity_af)} acre-feet${
      basis ? `, measured as ${basis}` : ""}`
  };
  if (reservoir.seasonal_percentile !== null) {
    detail.historyRank = rankWithYears(
      reservoir.seasonal_percentile, reservoir.seasonal_sample_years,
      reservoir.seasonal_rank ?? null, reservoir.seasonal_rank_of ?? null);
  }
  if (reservoir.change_30d_af !== null) {
    detail.change30d = {
      label: changeLabel("Change in 30 days", reservoir.change_30d_elapsed_days),
      value: formatChange(reservoir.change_30d_af, reservoir.change_30d_pct,
        reservoir.change_30d_reference_date)
    };
  }
  if (reservoir.county_name && reservoir.state) {
    detail.countyState = `${reservoir.county_name}, ${reservoir.state}`;
  }
  return detail;
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
      ...classOf(reservoir.pct_of_capacity ?? 0),
      detail: chartDetail(reservoir)
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
  /**
   * The scope the month was drawn from, and the share of its combined full
   * level that reported.
   *
   * The twelve points are not twelve measurements of one population. The
   * newest month is the one this matters most for: monthly providers publish
   * at month end, so the current month holds only the daily reservoirs until
   * they do. Measured on the payload of 2026-08-19, eleven of the twelve
   * points covered about 100% of the combined full level and the twelfth
   * covered 79% -- and the fall from July to August read four points steeper
   * than the same reservoirs measured across both months.
   */
  scopeCount: number;
  percentCapacityReporting: number | null;
  /**
   * The same month over the reservoirs that reported in *every* month drawn.
   *
   * The series beside it changes population between points, so a move in it
   * can be a move in the water, a move in who reported, or both. This one
   * cannot: it is one fixed set of reservoirs measured twelve times, so every
   * move in it is a move in the water.
   *
   * It answers a narrower question than the series it sits beside -- a cohort
   * of 116 rather than 196 -- which is why it accompanies that series rather
   * than replacing it. Null when no reservoir reported every month.
   */
  cohortPercent: number | null;
  cohortCount: number;
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
  const months = monthKeys(reservoirs).slice(-12);
  const cohort = fixedCohort(reservoirs, months);
  return months.map((month, index) => {
    const rollup = monthlyRollup(reservoirs, month);
    const cohortRollup = cohort.length > 0 ? monthlyRollup(cohort, month) : null;
    return {
      id: index + 1,
      month,
      label: monthLabel(month),
      axisLabel: month,
      percent: Number((rollup.percentFull ?? 0).toFixed(1)),
      storageAf: rollup.storageAf,
      reporting: rollup.reporting,
      scopeCount: rollup.scopeCount,
      percentCapacityReporting: rollup.percentCapacityReporting,
      cohortPercent: cohortRollup?.percentFull === null
        || cohortRollup?.percentFull === undefined
        ? null : Number(cohortRollup.percentFull.toFixed(1)),
      cohortCount: cohort.length
    };
  });
}

/**
 * Reservoirs that reported every one of the months drawn.
 *
 * Chosen once for the whole series rather than per point: a cohort that
 * changed between months would be the thing it exists to rule out. A
 * reservoir with no usable size basis is excluded here too, because it
 * cannot contribute to either side of the ratio and would otherwise shrink
 * the cohort for every month without ever appearing in one.
 */
export function fixedCohort(
  reservoirs: readonly Reservoir[], months: readonly string[]
): Reservoir[] {
  if (months.length === 0) return [];
  return reservoirs.filter((reservoir) => {
    if (sizeBasis(reservoir) <= 0) return false;
    const reported = new Map(reservoir.monthly.map((row) => [row.month, row.mean_af]));
    return months.every((month) => {
      const mean = reported.get(month);
      return mean !== null && mean !== undefined && Number.isFinite(mean);
    });
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

/** The five numbers a box plot draws for one group, and the points it draws
 * beside them. */
export interface SpreadBox {
  group: string;
  /** The whiskers: the furthest values still inside 1.5 times the middle
   * half, which is Tukey's rule and the one the SDK's box plot used. */
  low: number;
  high: number;
  p25: number;
  median: number;
  p75: number;
  /** Every value outside the whiskers, each still carrying its reservoir --
   * these are the ones worth opening on the map, which is the whole reason
   * this chart shows them. */
  outliers: readonly ValuePoint[];
  count: number;
}

/**
 * One box per group, with the reservoirs that fall outside the whiskers.
 *
 * The five numbers are the ordinary ones and the whisker rule is Tukey's:
 * the furthest value still within 1.5 times the middle half of each hinge.
 * Stated here rather than left to a chart library because the outliers are
 * this chart's subject -- a single reservoir far below its neighbours is the
 * one to go and look at -- and "which points are outliers" is exactly what
 * the rule decides.
 *
 * Groups with fewer than `minimum` values are left out. A box drawn over two
 * reservoirs has quartiles that are just the two values again, and a reader
 * cannot tell that from a genuinely tight spread.
 */
export function spreadBoxes(
  values: readonly ValuePoint[], minimum = 3
): SpreadBox[] {
  const byGroup = new Map<string, ValuePoint[]>();
  for (const point of values) {
    if (!Number.isFinite(point.value)) continue;
    const bucket = byGroup.get(point.group);
    if (bucket) bucket.push(point);
    else byGroup.set(point.group, [point]);
  }
  const boxes: SpreadBox[] = [];
  for (const [group, members] of byGroup) {
    if (members.length < minimum) continue;
    const sorted = [...members].sort((left, right) => left.value - right.value);
    const numbers = sorted.map((point) => point.value);
    /* The same `quantile` the histogram's middle half is drawn from, further
     * down this file. Two interpolation rules in one module would let the
     * box's hinges and the key's stated middle half disagree over the same
     * reservoirs. */
    const p25 = quantile(numbers, 0.25);
    const median = quantile(numbers, 0.5);
    const p75 = quantile(numbers, 0.75);
    const reach = (p75 - p25) * 1.5;
    const lowFence = p25 - reach;
    const highFence = p75 + reach;
    const inside = numbers.filter((value) => value >= lowFence && value <= highFence);
    boxes.push({
      group,
      low: inside.length > 0 ? inside[0]! : p25,
      high: inside.length > 0 ? inside[inside.length - 1]! : p75,
      p25,
      median,
      p75,
      outliers: sorted.filter(
        (point) => point.value < lowFence || point.value > highFence),
      count: members.length
    });
  }
  /* Driest first, so the chart is a ranking as well as a spread and the areas
   * worth looking at are at the top. `localeCompare` on the name breaks a
   * tie, so two areas with the same middle value keep a stable order between
   * renders rather than swapping places when the filter changes. */
  return boxes.sort((left, right) =>
    left.median - right.median || left.group.localeCompare(right.group));
}

/**
 * The statistics under the histogram: two it draws, and one it states.
 *
 * Computed here so the key under the chart can print them. The mean and the
 * median are drawn by the chart from its own arithmetic over the same values,
 * so those two have to agree with it exactly or the page states one number
 * and marks another.
 *
 * The middle half is this module's alone. The SDK's histogram offers a mean,
 * a median, a standard-deviation band and a fitted normal curve, and no
 * quantile overlay -- so the two statistics worth having here are the two it
 * cannot draw, and the key carries them as text.
 *
 * Null for fewer than two values. The chart refuses to draw below three
 * (`renderArcgisDistributionChart`), so a caller with a key and no chart has
 * nothing to label anyway.
 */
export interface DistributionStats {
  mean: number;
  median: number;
  /** The middle half: a quarter of the reservoirs sit below each end. */
  p25: number;
  p75: number;
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
  /* Quantiles rather than a standard deviation.
   *
   * A standard deviation, and the normal curve drawn from it, describe a
   * sample from one homogeneous population. These reservoirs are not one:
   * they differ by size, purpose, hydrology, operating rules, flood-control
   * duty and water-supply obligation, and a flood-control reservoir held
   * deliberately low in spring sits in the same histogram as a supply
   * reservoir kept full. The curve fitted over that says the shape means
   * something it does not.
   *
   * Quantiles claim nothing about the shape. "A quarter of the reservoirs in
   * view are below 41%" is true whatever distribution they came from.
   */
  return { mean, median, p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75) };
}

/**
 * The value at a position in a sorted sample, interpolating between the two
 * either side -- the same rule the median above uses for an even count.
 */
function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const at = (sorted.length - 1) * fraction;
  const below = Math.floor(at);
  const above = Math.ceil(at);
  if (below === above) return sorted[below]!;
  return sorted[below]! + (sorted[above]! - sorted[below]!) * (at - below);
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
  key: "mean" | "median" | "middle-half";
  label: string;
  /** Absent for a line the chart states rather than draws. */
  style: OverlayKeyStyle | null;
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
      /* Stated, not drawn: the SDK's histogram offers a mean, a median, a
       * standard-deviation band and a fitted normal curve, and no quantile
       * overlay. The two it does not offer are the two worth having here, so
       * this line carries the numbers without a mark on the plot. */
      key: "middle-half",
      label: stats
        ? `Middle half ${formatPercent(stats.p25)} to ${formatPercent(stats.p75)}`
        : "Middle half",
      style: null
    }
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
  /** How full the reservoir is against its own full level, where known. */
  percentOfCapacity: number | null;
  countyState?: string;
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
      percentOfCapacity: reservoir.pct_of_capacity,
      ...(reservoir.county_name && reservoir.state
        ? { countyState: `${reservoir.county_name}, ${reservoir.state}` }
        : {}),
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
    /* One group out of an already-scoped set. `asScoped` is the assertion
     * that says so, and `rollupOfScoped` cannot narrow it again -- a
     * hand-written option object here once dropped Lake Mead's storage out
     * of its own drainage area's total (ADR-062). */
    const rollup = rollupOfScoped(asScoped(group));
    const percent = Number((rollup.percentFull ?? 0).toFixed(1));
    return {
      id: index + 1,
      label,
      percent,
      storageAf: rollup.storageAf,
      capacityAf: rollup.capacityAf,
      ...classOf(percent),
      /* A rollup has no rank, county or movement of its own; what it can
       * say is how many reservoirs its numbers answer for. */
      detail: { fullLevel: `${formatAcreFeet(rollup.capacityAf)} acre-feet`,
                reservoirCount: group.length }
    };
  }).sort((a, b) => b.capacityAf - a.capacityAf)
    .map((record, index) => ({ ...record, id: index + 1 }));
}
