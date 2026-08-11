/*
 * The point symbol both map engines already draw, expressed as arithmetic.
 *
 * The legacy ArcGIS page builds this as a string-concatenated Arcade
 * expression that exists twice, once per renderer, so a typo in either copy
 * shows up as slightly-wrong circles and never as an error. Every reservoir
 * is already in memory here, so the radii are plain numbers computed once
 * and asserted against `shared/reservoir-viz.js` in symbols.test.ts.
 *
 * Two radii per reservoir, and they mean different things:
 *
 *   - The ring is sized by the reservoir's own size basis -- real capacity
 *     where the National Inventory of Dams gives one, otherwise the highest
 *     storage ever recorded -- square-rooted so Lake Powell at ~25 million
 *     acre-feet and Meeks Cabin at a few thousand land on a legible spread.
 *     That is physical scale.
 *   - The fill is a fraction of *that reservoir's own ring*, not an
 *     independent size on the same domain. Sizing the fill absolutely was
 *     the first approach and it failed for small reservoirs: two reservoirs
 *     both at 15% clamp to nearly the same minimum size, so the gap between
 *     ring and fill stops meaning "depleted" for anything but the largest
 *     handful. Square root of the fraction, because circle *area* has to
 *     carry the percentage for the fill to read proportionally.
 */

import { isLate, sizeBasis } from "../data/rollup";
import type { NullableNumber, Reservoir } from "../types";
import { STALE_ACCENT, storageColor } from "./classes";

export const RING_MIN_PX = 8;
export const RING_MAX_PX = 46;

export interface ReservoirSymbol {
  ringPx: number;
  fillPx: number;
  color: string;
  /** The dashed ring the maps draw around a reservoir with old data. */
  accent: string | null;
}

/**
 * The number the map is about: percent of real capacity where we have one,
 * percent of the highest recorded storage where we do not. Close for most
 * reservoirs, but not the same claim -- so the details always say which.
 */
export function headlinePercent(reservoir: Reservoir): NullableNumber {
  return reservoir.pct_of_capacity ?? reservoir.pct_of_record_max;
}

export type HeadlineBasis = "capacity" | "highest recorded storage";

export function headlineBasis(reservoir: Reservoir): HeadlineBasis {
  return reservoir.pct_of_capacity === null ? "highest recorded storage" : "capacity";
}

/**
 * The square-root domain the ring size is scaled against: one number for
 * the whole drawn set, so the circles stay comparable between reservoirs.
 */
export function sizeDomain(reservoirs: readonly Reservoir[]): number {
  const largest = reservoirs.reduce(
    (max, reservoir) => Math.max(max, sizeBasis(reservoir)), 0);
  return Math.sqrt(largest);
}

export function ringSize(reservoir: Reservoir, domain: number): number {
  if (!(domain > 0)) return RING_MIN_PX;
  const share = Math.min(1, Math.sqrt(Math.max(0, sizeBasis(reservoir))) / domain);
  return RING_MIN_PX + share * (RING_MAX_PX - RING_MIN_PX);
}

/**
 * A reservoir with no readable percentage draws no fill at all rather than
 * an empty-looking one: "we do not know" and "it is empty" are different
 * facts and the grey ring already carries the first.
 */
export function fillSize(ringPx: number, percent: NullableNumber): number {
  if (percent === null || !Number.isFinite(percent)) return 0;
  return ringPx * Math.sqrt(Math.min(100, Math.max(0, percent)) / 100);
}

/**
 * The symbol for a reservoir at a given percentage.
 *
 * The ring is not a parameter: it is sized from the reservoir's own size
 * basis, which does not change with the month. Only the fill and the colour
 * move, so the twelve-month slider animates the water rather than resizing
 * the reservoirs underneath it.
 */
export function reservoirSymbolFor(
  reservoir: Reservoir, domain: number, percent: NullableNumber
): ReservoirSymbol {
  const ringPx = ringSize(reservoir, domain);
  return {
    ringPx,
    fillPx: fillSize(ringPx, percent),
    color: storageColor(percent),
    // The same rule the list badge, the filter and the summary count use.
    accent: isLate(reservoir) ? STALE_ACCENT : null
  };
}

export function reservoirSymbol(reservoir: Reservoir, domain: number): ReservoirSymbol {
  return reservoirSymbolFor(reservoir, domain, headlinePercent(reservoir));
}
