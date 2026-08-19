/*
 * The drought view's data shaping, kept pure and tested.
 *
 * The join with storage is this page's reason to exist: the monitor says how
 * dry the land is, the reservoirs say how much water is banked, and where
 * the two disagree is the story -- a full reservoir in extreme drought is a
 * region living on savings. The join is by drainage area, the geography both
 * payloads already share.
 */
import type { DroughtUnit, Reservoir } from "./types";
import { DROUGHT_CLASSES, type DroughtClass } from "./viz/drought-classes";

/** The monitor releases on Thursdays. One missed release plus a margin. */
export const LATE_AFTER_DAYS = 9;

export function daysOld(releaseDate: string, today: Date): number {
  const released = Date.parse(`${releaseDate}T00:00:00Z`);
  const now = Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((now - released) / 86_400_000));
}

export function isLateRelease(releaseDate: string, today: Date): boolean {
  return daysOld(releaseDate, today) > LATE_AFTER_DAYS;
}

/**
 * Whether the monitor measured any of this area (ADR-059). A unit without
 * its share blocks has no figures at all, which is not the same fact as
 * being clear -- callers that would read "unknown" as "no drought" must
 * check this first.
 */
export function isMeasured(unit: DroughtUnit): unit is DroughtUnit &
    Required<Pick<DroughtUnit, "percent_of_area" | "percent_of_area_at_least">> {
  return unit.percent_of_area !== undefined
    && unit.percent_of_area_at_least !== undefined;
}

/** The worst class with any land in it, or null when the area is clear. */
export function worstClass(unit: DroughtUnit): DroughtClass | null {
  for (let index = DROUGHT_CLASSES.length - 1; index >= 0; index -= 1) {
    const entry = DROUGHT_CLASSES[index]!;
    if ((unit.percent_of_area?.[entry.key] ?? 0) > 0) return entry;
  }
  return null;
}

/**
 * Most severe first: compared from the worst class down, so an area with
 * any exceptional drought outranks one with more total drought but a
 * gentler worst case. Name order settles exact ties.
 */
export function bySeverity(units: readonly DroughtUnit[]): DroughtUnit[] {
  const keys = [...DROUGHT_CLASSES].reverse().map((entry) => entry.key);
  return [...units].sort((a, b) => {
    for (const key of keys) {
      const difference =
        shareAtOrWorse(b, key) - shareAtOrWorse(a, key);
      if (difference !== 0) return difference;
    }
    return a.huc6_name.localeCompare(b.huc6_name);
  });
}

/** How many drainage areas have any land at this class or worse. */
export function areasAtOrWorse(
  units: readonly DroughtUnit[], key: DroughtClass["key"]
): number {
  return units.filter((unit) => shareAtOrWorse(unit, key) > 0).length;
}

export function regionWorst(units: readonly DroughtUnit[]): DroughtClass | null {
  let worst: DroughtClass | null = null;
  for (const unit of units) {
    const candidate = worstClass(unit);
    if (candidate && (!worst || candidate.key > worst.key)) worst = candidate;
  }
  return worst;
}

/** The fields of a reservoir this page actually reads, so the tests can
 * build fixtures without fabricating forty unrelated fields. */
export type StorageSource = Pick<
  Reservoir, "huc6" | "current_storage_af" | "capacity_af" | "record_max_af"
>;

export interface StorageContext {
  /** Combined storage over combined full level, the ADR-011 arithmetic. */
  percent: number | null;
  reservoirCount: number;
}

/** Combined percent full per drainage area, every published reservoir
 * counted -- this is context for land conditions, not the map's scoped
 * headline, so nothing is excluded. */
export function storageByArea(
  reservoirs: readonly StorageSource[], level = 6
): Map<string, StorageContext> {
  const groups = new Map<string, { storage: number; capacity: number; count: number }>();
  for (const reservoir of reservoirs) {
    if (!reservoir.huc6) continue;
    /* Regrouping by a shorter code is exact rather than approximate:
     * hydrologic codes are fixed-width and nest by construction, so a basin's
     * first four digits *are* its subregion and every reservoir lands in
     * exactly one of them at either level (ADR-064). It is a sum of
     * acre-feet in both cases, not an average of percentages. */
    const key = reservoir.huc6.slice(0, level);
    const group = groups.get(key) ?? { storage: 0, capacity: 0, count: 0 };
    group.storage += reservoir.current_storage_af;
    group.capacity += reservoir.capacity_af ?? reservoir.record_max_af;
    group.count += 1;
    groups.set(key, group);
  }
  const contexts = new Map<string, StorageContext>();
  for (const [huc6, group] of groups) {
    contexts.set(huc6, {
      percent: group.capacity > 0 ? (group.storage / group.capacity) * 100 : null,
      reservoirCount: group.count
    });
  }
  return contexts;
}

/** The bar's segments in drawing order: no drought first, then D0 to D4. */
export interface CoverageSegment {
  label: string;
  color: string | null;
  percent: number;
}

export function coverageSegments(unit: DroughtUnit): CoverageSegment[] {
  // Nothing measured, nothing to draw: an unmeasured area must not render
  // as a full-width "No drought" bar (ADR-059).
  const shares = unit.percent_of_area;
  if (!shares) return [];
  const segments: CoverageSegment[] = [{
    label: "No drought",
    color: null,
    percent: shares.none
  }];
  for (const entry of DROUGHT_CLASSES) {
    segments.push({
      label: `${entry.label} (${entry.code})`,
      color: entry.color,
      percent: shares[entry.key]
    });
  }
  return segments.filter((segment) => segment.percent > 0);
}

/* ------------------------------------------------------------------ */
/* Filtering and ordering                                              */
/* ------------------------------------------------------------------ */

/** How the reader has asked for the areas to be ordered. */
export type DroughtSort = "severity" | "storage" | "name";

export const DROUGHT_SORTS: readonly DroughtSort[] = ["severity", "storage", "name"];

export function isDroughtSort(value: string): value is DroughtSort {
  return (DROUGHT_SORTS as readonly string[]).includes(value);
}

/**
 * The share of an area's land in a class or anything worse.
 *
 * Read straight from the published "at least" figures rather than summed
 * here. The pipeline computed them as sums of disjoint exclusive shares and
 * a unit test holds them to that arithmetic; adding the exclusive shares up
 * a second time in the client is how the two would drift.
 */
export function shareAtOrWorse(unit: DroughtUnit, key: DroughtClass["key"]): number {
  /* Zero for an unmeasured area, which is right for ranking and filtering
   * -- an unknown share cannot outrank a known one -- and wrong anywhere a
   * zero would be printed as a finding; those callers check `isMeasured`. */
  return unit.percent_of_area_at_least?.[key] ?? 0;
}

/**
 * The areas with any land at a given class or worse.
 *
 * "Any land" rather than a share threshold, deliberately: the monitor's
 * classes are already a severity judgment, and a second numeric threshold on
 * top of them would be this project inventing a rule the data does not carry.
 * Null means every area, which is not the same as passing "d0" -- an area
 * entirely free of drought has no D0 land and would drop out of that filter.
 */
export function unitsAtOrWorse(
  units: readonly DroughtUnit[], key: DroughtClass["key"] | null
): DroughtUnit[] {
  if (key === null) return [...units];
  return units.filter((unit) => shareAtOrWorse(unit, key) > 0);
}

/**
 * The areas in the order the reader asked for.
 *
 * Severity is the default and is the existing `bySeverity` order, unchanged.
 * Storage orders by how full the reservoirs in each area are, emptiest first,
 * because the question that ordering answers is "where is the water running
 * out" -- and an area with no reservoir reading sorts last rather than as
 * zero, since "no reading" is not "empty".
 */
export function orderUnits(
  units: readonly DroughtUnit[],
  storage: ReadonlyMap<string, StorageContext> | null,
  sort: DroughtSort
): DroughtUnit[] {
  if (sort === "severity") return bySeverity(units);
  const rows = [...units];
  if (sort === "name") {
    return rows.sort((a, b) => a.huc6_name.localeCompare(b.huc6_name));
  }
  return rows.sort((a, b) => {
    const left = storage?.get(a.huc6)?.percent ?? null;
    const right = storage?.get(b.huc6)?.percent ?? null;
    if (left === null && right === null) return a.huc6_name.localeCompare(b.huc6_name);
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  });
}

/* ------------------------------------------------------------------ */
/* The opening scope: which units a reader's `?state=` and `?area=`     */
/* selection means (slice S3c, docs/OPENING-SCOPE-AND-THE-WESTERN-      */
/* ROSTER.md, `src/data/opening-scope.ts`)                              */
/* ------------------------------------------------------------------ */

/**
 * The units an opening-scope selection actually means.
 *
 * `chosenCodes === null` reads as "no scope resolved" -- either the
 * reference export could not be read, or a reader chose nothing at all --
 * and returns every unit rather than guessing: a chooser that failed to
 * load, or an ordinary scope-free visit, must cost a reader nothing. An
 * empty set is a real, narrowed-to-nothing answer (a chosen state with no
 * drainage area on this roster) and stays exactly that empty.
 *
 * The caller builds `chosenCodes` at whichever digit width this page is
 * currently drawing (`?level=`, four or six) -- exact string membership
 * rather than a prefix relationship, because a caller that already knows
 * the page's own level owes this function codes at that level, not a
 * mismatched width for it to reconcile (`src/data/opening-scope.ts`'s
 * `areaAtLevel` is where that reconciliation belongs, once, rather than
 * silently inside every membership check here).
 *
 * This is the one join every other figure on the drought page is built
 * from once a reader has chosen a place -- the map, the bars, the table and
 * every chart narrow from this single call so none of them can describe a
 * different set of areas than the others. It only chooses which of the
 * pipeline's own rows exist on the page; every field on a returned unit is
 * untouched. There is deliberately nothing here that sums or averages a
 * share across areas -- ADR-046 refuses a state-wide drought share
 * anywhere on this site, and a selection function has nothing in it that
 * could quietly become one.
 */
export function unitsInOpeningScope(
  units: readonly DroughtUnit[],
  chosenCodes: ReadonlySet<string> | null
): DroughtUnit[] {
  if (chosenCodes === null) return [...units];
  return units.filter((unit) => chosenCodes.has(unit.huc6));
}

/* ------------------------------------------------------------------ */
/* Land conditions against banked water                                */
/* ------------------------------------------------------------------ */

/** The class the storage-against-drought chart measures dryness by. Severe
 * drought is where the monitor's own impact language turns from "developing"
 * to actual shortage, which is the point at which the comparison matters. */
export const DRYNESS_CLASS: DroughtClass["key"] = "d2";

/** One drainage area as a point: how dry its land is, how full its water is. */
export interface StorageAgainstDrought {
  huc6: string;
  name: string;
  /** Percent of land at the dryness class or worse. */
  dryPercent: number;
  /** Combined reservoir storage as a percent of combined full level. */
  storagePercent: number;
  reservoirCount: number;
  /** The most severe class with land in it, for the point's colour. */
  worst: DroughtClass | null;
}

/**
 * The join this whole view exists for, as plottable points.
 *
 * An area is left out when it has no reservoir reading, and the caller says
 * how many were left out rather than the chart drawing them at zero: a
 * drainage area with no reservoirs in it is not a drainage area whose
 * reservoirs are empty, and putting it on the floor of the chart would state
 * the second.
 */
export function storageAgainstDrought(
  units: readonly DroughtUnit[],
  storage: ReadonlyMap<string, StorageContext> | null
): StorageAgainstDrought[] {
  const points: StorageAgainstDrought[] = [];
  for (const unit of units) {
    /* An unmeasured area is left out like an area with no reservoir
     * reading, and for the same reason: a point at zero dryness would state
     * "no drought" about land the monitor never saw (ADR-059). */
    if (!isMeasured(unit)) continue;
    const context = storage?.get(unit.huc6);
    if (!context || context.percent === null) continue;
    points.push({
      huc6: unit.huc6,
      name: unit.huc6_name,
      dryPercent: shareAtOrWorse(unit, DRYNESS_CLASS),
      storagePercent: context.percent,
      reservoirCount: context.reservoirCount,
      worst: worstClass(unit)
    });
  }
  return points;
}

/* ------------------------------------------------------------------ */
/* How severe, across all of the areas at once                        */
/* ------------------------------------------------------------------ */

/** One severity level and how many drainage areas have it as their worst. */
export interface WorstClassCount {
  /** Null is the bucket for areas with no land in any class. */
  entry: DroughtClass | null;
  label: string;
  color: string | null;
  count: number;
}

/**
 * The whole distribution of severity, not one threshold from it.
 *
 * The page reported "areas in extreme drought or worse: N of 14", which is
 * one number and hides the shape behind it: whether the other areas are
 * clear, or all sitting one class below the threshold, are very different
 * weeks and both read as the same headline.
 *
 * Every class is returned whether or not any area is at it, including the
 * empty ones. A distribution with the empty levels dropped is a different
 * chart each week and cannot be compared with last week's by eye.
 */
export function worstClassCounts(
  units: readonly DroughtUnit[], noneLabel: string
): WorstClassCount[] {
  const counts: WorstClassCount[] = [
    { entry: null, label: noneLabel, color: null, count: 0 },
    ...DROUGHT_CLASSES.map((entry) => ({
      entry, label: `${entry.label} (${entry.code})`, color: entry.color, count: 0
    }))
  ];
  for (const unit of units) {
    /* Not counted anywhere rather than counted as clear: an unmeasured
     * area in the "no drought" bucket is the exact misreading ADR-059
     * removes. */
    if (!isMeasured(unit)) continue;
    const worst = worstClass(unit);
    const bucket = worst === null
      ? counts[0]
      : counts.find((candidate) => candidate.entry?.key === worst.key);
    if (bucket) bucket.count += 1;
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Dry land against banked water, as a ranked list                     */
/* ------------------------------------------------------------------ */

/**
 * One area's two figures with the distance between them.
 *
 * `gap` is `storagePercent - dryPercent`, and it is important to be clear
 * about what it is not. The two shares divide by different things -- one is
 * a share of land, the other a share of reservoir capacity -- so their
 * difference is not a quantity of anything. There is no such thing as
 * "fifteen points of cushion".
 *
 * It is used for two honest purposes and no others: to rank the areas, and
 * as the length of the line drawn between the two values. The chart shows
 * both figures separately and never prints the difference as a number,
 * because the difference is a comparison, not a measurement.
 */
export interface StorageGap extends StorageAgainstDrought {
  gap: number;
}

/**
 * The areas ordered by how far their banked water sits from their dry land.
 *
 * Worst first: the areas where the reservoirs are furthest below the share of
 * land in drought lead the list, because that combination -- dry ground and
 * no savings to draw on -- is the one a reader is looking for. The scatter
 * shows the same relationship as a cloud and leaves the reader to judge each
 * point's distance from a diagonal that is not even drawn; this states the
 * order.
 */
export function byStorageGap(
  points: readonly StorageAgainstDrought[]
): StorageGap[] {
  return points
    .map((point) => ({ ...point, gap: point.storagePercent - point.dryPercent }))
    .sort((a, b) => a.gap - b.gap || a.name.localeCompare(b.name));
}
