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

/** The worst class with any land in it, or null when the area is clear. */
export function worstClass(unit: DroughtUnit): DroughtClass | null {
  for (let index = DROUGHT_CLASSES.length - 1; index >= 0; index -= 1) {
    const entry = DROUGHT_CLASSES[index]!;
    if (unit.percent_of_area[entry.key] > 0) return entry;
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
        b.percent_of_area_at_least[key] - a.percent_of_area_at_least[key];
      if (difference !== 0) return difference;
    }
    return a.huc6_name.localeCompare(b.huc6_name);
  });
}

/** How many drainage areas have any land at this class or worse. */
export function areasAtOrWorse(
  units: readonly DroughtUnit[], key: DroughtClass["key"]
): number {
  return units.filter((unit) => unit.percent_of_area_at_least[key] > 0).length;
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
  reservoirs: readonly StorageSource[]
): Map<string, StorageContext> {
  const groups = new Map<string, { storage: number; capacity: number; count: number }>();
  for (const reservoir of reservoirs) {
    if (!reservoir.huc6) continue;
    const group = groups.get(reservoir.huc6) ?? { storage: 0, capacity: 0, count: 0 };
    group.storage += reservoir.current_storage_af;
    group.capacity += reservoir.capacity_af ?? reservoir.record_max_af;
    group.count += 1;
    groups.set(reservoir.huc6, group);
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
  const segments: CoverageSegment[] = [{
    label: "No drought",
    color: null,
    percent: unit.percent_of_area.none
  }];
  for (const entry of DROUGHT_CLASSES) {
    segments.push({
      label: `${entry.label} (${entry.code})`,
      color: entry.color,
      percent: unit.percent_of_area[entry.key]
    });
  }
  return segments.filter((segment) => segment.percent > 0);
}
