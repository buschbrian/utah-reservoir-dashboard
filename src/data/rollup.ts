import { readBaseline } from "../state/baseline";
import type { BaselineId, Reservoir } from "../types";
import { STORAGE_CLASSES, storageClass } from "../viz/classes";

export interface ClassCount {
  label: string;
  color: string;
  count: number;
}

/**
 * What a combined figure was added up from, in time.
 *
 * A regional total is the newest reading from each reservoir, and those
 * readings were not taken on the same day: a daily provider answers for
 * yesterday and a month-end one answers for the last day of last month. Both
 * belong in the total -- the alternative is a total that omits 78 reservoirs
 * for three weeks of every month -- but a figure presented without this is a
 * figure a reader will take for one moment's measurement.
 *
 * The freshness split is published by combined full level as well as by count,
 * because ten small late reservoirs and one enormous late reservoir are not
 * the same warning and a count cannot tell them apart.
 */
export interface RollupCoverage {
  /** The oldest and newest reading behind the total, or null with no rows. */
  earliestDate: string | null;
  latestDate: string | null;
  /** Reservoirs read inside their own update schedule, and those not. */
  currentCount: number;
  lateCount: number;
  /** The same division by combined full level rather than by count. */
  currentCapacityAf: number;
  lateCapacityAf: number;
  /** Share of the combined full level read inside its own schedule. */
  percentCapacityCurrent: number | null;
  /** How the reservoirs divide by how often their provider publishes. */
  dailyCount: number;
  monthlyCount: number;
}

/**
 * One kind of full level, and how much of the denominator it is.
 *
 * "Percent full" adds three different definitions of full together, and a
 * reservoir measured against a maximum level reads lower than the same
 * reservoir measured against a normal one. ADR-046 forbids subtracting shares
 * with different denominators; this is the milder relative, a single share
 * whose denominator is not one thing. It stays a valid ratio, and the way to
 * keep it honest is to say what it divides by.
 */
export interface BasisShare {
  basis: string;
  label: string;
  count: number;
  capacityAf: number;
}

/**
 * The words for each `capacity_basis` the pipeline publishes, plus the one it
 * cannot publish: a reservoir with no traceable capacity falls back to its
 * highest recorded storage, which is a floor rather than a capacity, and
 * `sizeBasis` has always made that substitution silently.
 */
const BASIS_LABELS: Record<string, string> = {
  normal_storage: "Normal full level",
  max_storage: "Maximum level",
  reclamation_project_record: "Full level published by the reservoir operator",
  awdb_reservoir_metadata: "Level published with the readings",
  cdec_reservoir_report: "Full level published by the reservoir operator"
};
/** The key `basisShares` reports the fallback under. */
export const RECORD_MAX_BASIS = "record_max";

export function basisOf(reservoir: Reservoir): string {
  return reservoir.capacity_af === null ? RECORD_MAX_BASIS
    : reservoir.capacity_basis ?? RECORD_MAX_BASIS;
}

export function basisLabel(basis: string): string {
  return BASIS_LABELS[basis] ?? "Highest recorded storage";
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
  /** The share of the combined full level the normal comparison covers. */
  normalCoversCapacityAf: number;
  /** The period `percentOfNormal` was measured against. */
  normalBaseline: BaselineId;
  stale: number;
  belowHalf: number;
  classes: ClassCount[];
  coverage: RollupCoverage;
  /** Largest share of the denominator first. */
  basisShares: BasisShare[];
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
  /**
   * Which period the combined normal comparison is measured against.
   *
   * This used to be no choice at all: the total read `seasonal_normal_af`,
   * which is the recent period, whatever the reader had selected. So a page
   * whose map opened on 1991-2020 printed a headline measured against
   * 2015-2025 and labelled it "of the usual storage for this date". Both
   * figures were right and they were not the same claim (ADR-041).
   *
   * Defaults to "recent" so a caller that has not been given the reader's
   * choice keeps the answer it had rather than silently changing period.
   */
  baseline?: BaselineId;
  /**
   * Fewest earlier years a reservoir must have before its requested baseline
   * belongs in the combined comparison. Defaults to zero for payloads that
   * predate the declared minimum.
   */
  minimumBaselineYears?: number;
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
const LAKE_POWELL = { key: "lakePowell", riseItemId: 509, name: "lake powell" } as const;
const LAKE_MEAD = { key: "lakeMead", riseItemId: 6124, name: "lake mead" } as const;
const DOMINANT_RESERVOIRS = [LAKE_POWELL, LAKE_MEAD] as const;

/**
 * The scope with every control open: all connected reservoirs and no
 * dominant reservoir filtered out. For callers whose rows are already the
 * scope the reader chose, where "include" means "do not filter again" and
 * never "add them back". `Required` is the point: admitting the next
 * dominant reservoir makes this line refuse to compile until it is named
 * here, instead of every call site silently reverting to excluding it
 * (ADR-062).
 */
export const WIDEST_SCOPE: Required<Pick<
  StatewideRollupOptions, "geography" | "lakePowell" | "lakeMead"
>> = {
  geography: "connected", lakePowell: "include", lakeMead: "include"
};

function matches(reservoir: Reservoir, entry: (typeof DOMINANT_RESERVOIRS)[number]): boolean {
  return reservoir.rise_item_id === entry.riseItemId
    || reservoir.name.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ") === entry.name;
}

/** RISE item 509 is Lake Powell's stable provider identity (ADR-003). */
export function isLakePowell(reservoir: Reservoir): boolean {
  return matches(reservoir, LAKE_POWELL);
}

/** RISE item 6124 is Lake Mead's, reached through catalog record 4370. */
export function isLakeMead(reservoir: Reservoir): boolean {
  return matches(reservoir, LAKE_MEAD);
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

/** When each reading was taken, and how much of the total was read recently. */
function coverageOf(
  reservoirs: readonly Reservoir[], capacityAf: number
): RollupCoverage {
  const dates = reservoirs.map((reservoir) => reservoir.as_of).filter(Boolean).sort();
  const late = reservoirs.filter(isLate);
  const lateCapacityAf = late.reduce((total, row) => total + sizeBasis(row), 0);
  return {
    earliestDate: dates[0] ?? null,
    latestDate: dates[dates.length - 1] ?? null,
    currentCount: reservoirs.length - late.length,
    lateCount: late.length,
    currentCapacityAf: capacityAf - lateCapacityAf,
    lateCapacityAf,
    percentCapacityCurrent: capacityAf > 0
      ? (capacityAf - lateCapacityAf) / capacityAf * 100 : null,
    dailyCount: reservoirs.filter((row) => row.data_frequency === "daily").length,
    monthlyCount: reservoirs.filter((row) => row.data_frequency === "monthly").length
  };
}

/** What the combined full level divides into, largest share first. */
/*
 * Grouped by the label rather than by the key, which are not the same list.
 *
 * Two providers publish their own full level and this project prefers it over
 * the dam inventory's for both (ADR-070), so `reclamation_project_record` and
 * `cdec_reservoir_report` are two keys for one fact about a denominator.
 * Keyed by basis, the sentence this feeds read "...published by the reservoir
 * operator 4, ...published by the reservoir operator 33" -- the same words
 * twice with two counts, which reads as a fault rather than a distinction.
 * What a reader is being told here is what the number divides by, and that is
 * exactly what the label says; `basis` keeps the first key in the group so
 * nothing downstream loses the ability to look one up.
 */
function basisShares(reservoirs: readonly Reservoir[]): BasisShare[] {
  const shares = new Map<string, BasisShare>();
  for (const reservoir of reservoirs) {
    const basis = basisOf(reservoir);
    const label = basisLabel(basis);
    const found = shares.get(label)
      ?? { basis, label, count: 0, capacityAf: 0 };
    found.count += 1;
    found.capacityAf += sizeBasis(reservoir);
    shares.set(label, found);
  }
  return [...shares.values()].sort((a, b) => b.capacityAf - a.capacityAf);
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
  /* The reader's period, not whichever one the payload happened to write into
   * the flat `seasonal_*` fields. `readBaseline` is the same reader every
   * other surface uses, so the total and the reservoir it is made of can no
   * longer disagree about which years "normal" means. */
  const baseline = options.baseline ?? "recent";
  const minimumBaselineYears = options.minimumBaselineYears ?? 0;
  const normals = new Map(reservoirs
    .map((reservoir) => [reservoir, readBaseline(reservoir, baseline)] as const)
    .filter(([, found]) =>
      found !== null && found.sample_years >= minimumBaselineYears));
  const withNormal = [...normals.keys()];
  const normalAf = withNormal.reduce((total, reservoir) =>
    total + (normals.get(reservoir)?.normal_af ?? 0), 0);
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
    normalCoversCapacityAf: withNormal.reduce((total, row) => total + sizeBasis(row), 0),
    normalBaseline: baseline,
    coverage: coverageOf(reservoirs, capacityAf),
    basisShares: basisShares(reservoirs),
    stale: reservoirs.filter(isLate).length,
    belowHalf: reservoirs.filter((reservoir) => {
      const percent = percentFull(reservoir);
      return percent !== null && percent < 50;
    }).length,
    classes
  };
}
