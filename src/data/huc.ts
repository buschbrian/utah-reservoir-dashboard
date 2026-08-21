/*
 * Watershed (HUC6) assignment and capacity-weighted rollups.
 *
 * Phase 1.5 of docs/history/modernization-2026.md. Pure arithmetic and geometry with no
 * DOM, no network and no SDK in it, so all of it is unit-testable -- which
 * is the point: the map pages already draw the HUC6 boundaries live from the
 * USGS service, but nothing yet says which unit a reservoir belongs to, and
 * a wrong assignment is invisible on a map.
 *
 * Two rules from the plan are load-bearing and are enforced here rather than
 * left to callers:
 *
 *   1. A reservoir is assigned by its dam or outlet point. A large reservoir
 *      can span two units; the assignment answers "where does the stored
 *      water leave?", which is one place.
 *   2. A twelve-month HUC value is valid only when *every* tracked reservoir
 *      in that unit has a value for that month. Otherwise the series shows a
 *      gap. This deliberately differs from `statewideMonthly` in
 *      shared/reservoir-viz.js, which sums whatever is present: across 53
 *      reservoirs one missing month barely moves the total, but a unit with
 *      three reservoirs would show a cliff and read as a drought.
 */

import type { MonthlyRecord, NullableNumber } from "../types";

/** Longitude, latitude -- GeoJSON order, not lat/lon. */
/**
 * The shape of a hydrologic unit code, at any level this project reads.
 *
 * Codes are fixed-width and zero-padded, and the levels are the even numbers
 * from 2 to 12 -- a region is two digits, a subregion four, a basin six, and
 * so on down. So the test is "an even count of digits, at most twelve", which
 * also rejects the five- and seven-digit strings that are not a level at all
 * and would otherwise be waved through by a looser `\d+`.
 *
 * One constant because four places were each carrying their own `/^\d{6}$/`,
 * and every one of them would have had to be found again the first time a
 * payload arrived at another level.
 */
export const HUC_CODE = /^(?:\d{2}){1,6}$/;

export type Point = readonly [number, number];

/** A linear ring: the outer ring first, then any holes. */
export type Ring = readonly Point[];

export interface HucUnit {
  huc6: string;
  name: string;
  /** Comma-separated state codes as the USGS service publishes them. */
  states: string;
  /** One polygon is one ring list; a multipolygon is several. */
  polygons: readonly (readonly Ring[])[];
}

/**
 * The fields a rollup needs. Declared structurally rather than as
 * `Reservoir` so tests can build three-line fixtures, and so a future
 * candidate site that is not yet a published reservoir can be rolled up too.
 */
export interface HucMember {
  name: string;
  huc6?: string | null;
  huc6_name?: string | null;
  current_storage_af: number;
  capacity_af?: NullableNumber;
  record_max_af: number;
  monthly?: readonly MonthlyRecord[];
}

export interface HucRollup {
  huc6: string;
  name: string;
  /** Reservoirs counted, after removing duplicates. */
  count: number;
  storageAf: number;
  capacityAf: number;
  /** Capacity-weighted: sum(storage) / sum(capacity). Null with no denominator. */
  percentFull: number | null;
  /** Reservoirs with no capacity and no observed maximum to stand in for one. */
  withoutCapacity: number;
  members: readonly string[];
}

export interface HucMonthlyPoint {
  month: string;
  /** Null when the unit is not fully covered for this month. */
  meanAf: number | null;
  normalAf: number | null;
  /** How many of the unit's reservoirs reported this month. */
  covered: number;
  count: number;
}

export interface CoverageRow {
  name: string;
  huc6: string | null;
  result: "assigned" | "unassigned";
  reason: string;
}

const normalizeName = (name: string): string => name.trim().toLowerCase();

/**
 * Ray casting, counting a crossing on the half-open edge [y0, y1) so a
 * vertex is not counted twice. A point on the boundary is not specified
 * either way and is not worth defining: dam points do not land on watershed
 * boundaries, and pretending otherwise would invent a rule nothing tests.
 */
function inRing(point: Point, ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const from = ring[j];
    const to = ring[i];
    if (from === undefined || to === undefined) continue;
    const [xi, yi] = to;
    const [xj, yj] = from;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inPolygon(point: Point, rings: readonly Ring[]): boolean {
  const [outer, ...holes] = rings;
  if (outer === undefined || !inRing(point, outer)) return false;
  return !holes.some((hole) => inRing(point, hole));
}

/**
 * The unit containing this point, or null. Units are tested in order and the
 * first hit wins: HUC6 units tile the country without overlapping, so a
 * point in two of them means the boundary data is wrong, and picking the
 * first is no worse than any other arbitrary choice.
 */
export function assignHuc(point: Point, units: readonly HucUnit[]): HucUnit | null {
  return units.find((unit) =>
    unit.polygons.some((polygon) => inPolygon(point, polygon))) ?? null;
}

/**
 * The same capacity fallback the rest of the app uses: real capacity where
 * we have it, otherwise the highest storage observed since 2015. A unit
 * whose reservoirs have neither contributes nothing to the denominator, and
 * says so through `withoutCapacity`.
 */
export function capacityBasis(member: HucMember): number {
  return member.capacity_af ?? member.record_max_af;
}

/**
 * Removes duplicate sites by name. A reservoir can arrive twice when a
 * candidate list from the Reclamation facility service is merged with the
 * published inventory; counting it twice would inflate both the storage and
 * the capacity of its unit.
 */
function dedupe(members: readonly HucMember[]): HucMember[] {
  const seen = new Set<string>();
  return members.filter((member) => {
    const key = normalizeName(member.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Members grouped by unit, in first-seen order, skipping the unassigned. */
function groupByHuc(members: readonly HucMember[]): Map<string, HucMember[]> {
  const groups = new Map<string, HucMember[]>();
  for (const member of dedupe(members)) {
    const huc6 = member.huc6;
    if (huc6 === null || huc6 === undefined || huc6 === "") continue;
    const group = groups.get(huc6);
    if (group === undefined) groups.set(huc6, [member]);
    else group.push(member);
  }
  return groups;
}

/**
 * One capacity-weighted total per unit. Label the result "tracked reservoir
 * storage in this drainage area" -- it is not the percentage of all water in
 * the watershed, which is why every row carries its reservoir count and
 * combined capacity.
 */
export function rollupByHuc(members: readonly HucMember[]): HucRollup[] {
  return [...groupByHuc(members)].map(([huc6, group]) => {
    const storageAf = group.reduce((total, member) =>
      total + member.current_storage_af, 0);
    const capacityAf = group.reduce((total, member) =>
      total + Math.max(capacityBasis(member), 0), 0);
    return {
      huc6,
      name: group.find((member) => member.huc6_name)?.huc6_name ?? huc6,
      count: group.length,
      storageAf,
      capacityAf,
      percentFull: capacityAf > 0 ? storageAf / capacityAf * 100 : null,
      withoutCapacity: group.filter((member) => capacityBasis(member) <= 0).length,
      members: group.map((member) => member.name)
    };
  }).sort((a, b) => b.capacityAf - a.capacityAf);
}

/**
 * Twelve months per unit, gated on full coverage. Months are the union of
 * every member's months, so a unit whose reservoirs report different spans
 * shows the gaps rather than silently shortening its own history.
 */
export function monthlyRollupByHuc(
  members: readonly HucMember[]
): Map<string, HucMonthlyPoint[]> {
  const out = new Map<string, HucMonthlyPoint[]>();
  for (const [huc6, group] of groupByHuc(members)) {
    const months = [...new Set(group.flatMap((member) =>
      (member.monthly ?? []).map((record) => record.month)))].sort();
    out.set(huc6, months.map((month) => {
      const values = group.map((member) =>
        (member.monthly ?? []).find((record) => record.month === month));
      const present = values.filter((record) =>
        record !== undefined && record.mean_af !== null);
      const covered = present.length;
      const complete = covered === group.length;
      const normals = present.map((record) => record?.normal_af ?? null);
      return {
        month,
        meanAf: complete
          ? present.reduce((total, record) => total + (record?.mean_af ?? 0), 0)
          : null,
        normalAf: complete && normals.every((value) => value !== null)
          ? normals.reduce((total: number, value) => total + (value ?? 0), 0)
          : null,
        covered,
        count: group.length
      };
    }));
  }
  return out;
}

/**
 * One row per site, saying what happened to it and why. The plan asks for a
 * published coverage report; this is the data behind it. An unassigned site
 * is not a failure to hide -- it is the thing a reviewer needs to see.
 */
export function coverageReport(members: readonly HucMember[]): CoverageRow[] {
  return dedupe(members).map((member) => {
    const huc6 = member.huc6 ?? null;
    if (huc6 === null || huc6 === "") {
      return {
        name: member.name,
        huc6: null,
        result: "unassigned" as const,
        reason: "no dam or outlet point fell inside a published unit"
      };
    }
    return {
      name: member.name,
      huc6,
      result: "assigned" as const,
      reason: capacityBasis(member) > 0
        ? "assigned by its dam or outlet point"
        : "assigned, but it adds no capacity to the unit total"
    };
  });
}
