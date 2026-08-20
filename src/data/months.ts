/*
 * The twelve months already in the payload, which the modern map has never
 * drawn.
 *
 * Every reservoir carries a `monthly` array; the map has only ever shown the
 * newest reading. The percentage for a past month is *recomputed* from that
 * month's mean storage against the reservoir's own size basis, rather than
 * read off a field -- the payload carries percentages for today only, and
 * using a different denominator for the past would make the slider's colours
 * mean something subtly different from the colours it starts on. Ported from
 * `monthPct` in `shared/reservoir-viz.js` and held against it in
 * `months.test.ts`, so the three engines animate the same drawdown.
 */

import { sizeBasis } from "./rollup";
import type { NullableNumber, Reservoir } from "../types";

/** A month key as the payload writes it. */
export type MonthKey = string;

/**
 * Every month any reservoir reports, oldest first.
 *
 * Taken across the whole set rather than from one reservoir: a reservoir
 * that came online mid-year has a shorter array, and a slider built from it
 * would be missing positions the rest of the data has.
 */
export function monthKeys(reservoirs: readonly Reservoir[]): MonthKey[] {
  const keys = new Set<MonthKey>();
  for (const reservoir of reservoirs) {
    for (const entry of reservoir.monthly) {
      if (typeof entry.month === "string" && entry.month) keys.add(entry.month);
    }
  }
  return [...keys].sort();
}

/**
 * A reservoir's percent full for one month, or null when it did not report.
 *
 * Null is the honest answer and is not the same as zero: the maps draw a
 * small grey circle for a month a reservoir never reported, rather than an
 * empty one, because "we do not know" and "it was empty" are different
 * facts.
 */
export function monthPercent(reservoir: Reservoir, month: MonthKey): NullableNumber {
  const entry = reservoir.monthly.find((record) => record.month === month);
  if (!entry || entry.mean_af === null || !Number.isFinite(entry.mean_af)) return null;
  const basis = sizeBasis(reservoir);
  if (!basis) return null;
  return (entry.mean_af / basis) * 100;
}

export interface MonthlyRollup {
  /** Reservoirs that reported anything for this month. */
  reporting: number;
  storageAf: number;
  capacityAf: number;
  percentFull: number | null;
  /**
   * The population the month was drawn from, and what share of it answered.
   *
   * A twelve-month series built this way can change population between one
   * month and the next, so a rise in the line can be a rise in storage, a
   * change in who reported, or both. The ratio itself stays honest -- only
   * reporting reservoirs are on either side of it -- but a reader comparing
   * two months is comparing two populations unless this is published beside
   * it. Reported by combined full level as well as by count, because a month
   * missing thirty small reservoirs and a month missing Lake Powell give very
   * different counts and very different totals.
   */
  scopeCount: number;
  scopeCapacityAf: number;
  /** Share of the scope's combined full level that reported this month. */
  percentCapacityReporting: number | null;
}

/**
 * The combined figure for one month, over the reservoirs handed in.
 *
 * Only reservoirs that reported the month contribute to either side of the
 * ratio. Counting a silent reservoir's capacity without its storage would
 * report the state as emptier than the data says, which is the one direction
 * a drought dashboard must not be wrong in by accident.
 */
export function monthlyRollup(
  reservoirs: readonly Reservoir[], month: MonthKey
): MonthlyRollup {
  let storageAf = 0;
  let capacityAf = 0;
  let reporting = 0;
  let scopeCapacityAf = 0;
  for (const reservoir of reservoirs) {
    scopeCapacityAf += sizeBasis(reservoir);
    const entry = reservoir.monthly.find((record) => record.month === month);
    const mean = entry?.mean_af;
    if (mean === null || mean === undefined || !Number.isFinite(mean)) continue;
    const basis = sizeBasis(reservoir);
    if (!basis) continue;
    storageAf += mean;
    capacityAf += basis;
    reporting += 1;
  }
  return {
    reporting,
    storageAf,
    capacityAf,
    percentFull: capacityAf > 0 ? (storageAf / capacityAf) * 100 : null,
    scopeCount: reservoirs.length,
    scopeCapacityAf,
    percentCapacityReporting: scopeCapacityAf > 0
      ? (capacityAf / scopeCapacityAf) * 100 : null
  };
}

/** How a month reads to a person. "2026-08" is not a label. */
export function monthLabel(month: MonthKey): string {
  const [year, index] = month.split("-");
  const at = Number(index);
  if (!year || !Number.isInteger(at) || at < 1 || at > 12) return month;
  const names = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return `${names[at - 1]} ${year}`;
}
