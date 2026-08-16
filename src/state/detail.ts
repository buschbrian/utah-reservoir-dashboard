/*
 * What the details panel says about one reservoir.
 *
 * Kept apart from the DOM so the wording is testable, because the wording is
 * a rule and not a detail (ADR-006): the panel is where the words most
 * likely to leak are -- the provider names in the data are written as
 * "Bureau of Reclamation RISE" and "USDA NRCS AWDB", and neither acronym may
 * reach a reader. The provider name is therefore derived from the source
 * key, never from the label the payload carries.
 */

import { monthLabel } from "../data/months";
import { isLate, sizeBasis } from "../data/rollup";
import type { Reservoir, SourceKey } from "../types";
import { storageColor } from "../viz/classes";
import { formatAcreFeet, formatDate, formatPercent } from "../viz/format";
import { headlineBasis, headlinePercent } from "../viz/symbols";

export interface DetailRow {
  label: string;
  value: string;
  /** Marks a fall, so the panel can colour it without re-reading the number. */
  negative?: boolean;
}

/** One month of the twelve the payload carries, ready to draw and to tabulate. */
export interface DetailMonth {
  key: string;
  label: string;
  storageAf: number | null;
  /** Share of the reservoir's own size basis, the same denominator the map uses. */
  percent: number | null;
  normalAf: number | null;
  /** Difference from the normal value, as a percentage of it. */
  changeFromNormal: number | null;
  color: string;
}

export interface DetailView {
  name: string;
  percent: string;
  /** The one-line reading under the headline number. */
  basis: string;
  rows: DetailRow[];
  /** Present only when the reading is older than this reservoir's schedule. */
  late: string | null;
  color: string;
  /** Oldest first, so the chart reads left to right as time moves forward. */
  months: DetailMonth[];
  /** Where the numbers came from, and what the history rank means. */
  note: string;
}

const PROVIDER_NAMES: Record<SourceKey, string> = {
  rise: "Bureau of Reclamation",
  awdb: "Natural Resources Conservation Service"
};

export function providerName(reservoir: Reservoir): string {
  return PROVIDER_NAMES[reservoir.source_key];
}

export function lateMessage(reservoir: Reservoir): string | null {
  if (!isLate(reservoir)) return null;
  const days = Math.max(1, Math.round(reservoir.days_stale));
  return days === 1
    ? "This reading is late by one day."
    : `This reading is late by ${days} days.`;
}

/** Acre-feet with a sign, because a change of zero and a fall of zero differ. */
function formatSignedAcreFeet(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("en-US")} acre-feet`;
}

/** A movement in both absolute and relative terms, so small and large reservoirs compare. */
function formatChange(amount: number | null, percent: number | null): string {
  const acreFeet = formatSignedAcreFeet(amount);
  if (acreFeet === "—" || percent === null || !Number.isFinite(percent)) return acreFeet;
  return `${acreFeet} (${percent > 0 ? "+" : ""}${formatPercent(percent)})`;
}

/**
 * A reference value, and where the reservoir sits against it.
 *
 * "(now at 80.0%)" rather than the legacy popup's "(80.0% of it)": the row
 * already names what the number is normal *for*, and "of it" left the reader
 * to work out which of the two numbers on the line the percentage divided.
 */
function withShare(value: number | null, share: number | null): string {
  const amount = value === null || !Number.isFinite(value)
    ? "—" : `${formatAcreFeet(value)} acre-feet`;
  if (amount === "—" || share === null || !Number.isFinite(share)) return amount;
  return `${amount} (now at ${formatPercent(share)})`;
}

function withComparisonYears(value: number | null, share: number | null, years: number): string {
  const reading = withShare(value, share);
  if (!Number.isFinite(years) || years <= 0) return reading;
  const rounded = Math.floor(years);
  return `${reading}; compared with ${rounded} earlier ${rounded === 1 ? "year" : "years"}`;
}

/**
 * What a reservoir's full level actually measures.
 *
 * Three different quantities are published as "capacity" across the two
 * providers, and until now the details panel called all three of them the
 * same thing. They are not the same thing: a normal full level is the pool a
 * reservoir is operated to hold, and a maximum level includes storage above
 * it that exists to catch a flood and is not meant to be occupied. A
 * reservoir at 60% of one is not at 60% of the other.
 *
 * It matters more than the count of each suggests. Four of the sixty-nine
 * reservoirs are measured against a maximum level, and those four are 71% of
 * the combined denominator every regional percentage is divided by -- Lake
 * Powell alone is most of it. So a reader comparing two reservoirs, or
 * reading a combined figure, is comparing against mixed bases unless the
 * panel says which.
 */
const CAPACITY_BASIS_NAMES: Record<string, string> = {
  normal_storage: "the normal full level",
  max_storage: "the maximum level, which includes storage kept for floods",
  awdb_reservoir_metadata: "the full level published with the readings"
};

/** The words for a basis, or null when the provider named none. */
export function capacityBasisName(basis: string | null): string | null {
  if (!basis) return null;
  return CAPACITY_BASIS_NAMES[basis] ?? null;
}

/**
 * The history rank, with the number of years behind it.
 *
 * A rank is a position in a list, and a position in a list of eight is a
 * different claim from a position in a list of thirty. The record starts in
 * 2015, so every rank here rests on eight to eleven values; saying so beside
 * the number is the difference between a reader treating it as a measurement
 * and treating it as an indication.
 */
export function rankWithYears(percentile: number | null, years: number): string {
  const rank = formatPercent(percentile);
  if (percentile === null || !Number.isFinite(years) || years <= 0) return rank;
  const rounded = Math.floor(years);
  return `${rank}, out of ${rounded} earlier ${rounded === 1 ? "year" : "years"}`;
}

const SCHEDULE_NAMES: Record<string, string> = {
  daily: "Every day",
  monthly: "Once a month"
};

/**
 * The twelve months, with the same denominator the map colours by.
 *
 * `sizeBasis` rather than `record_max_af` directly: the map sizes and colours
 * a reservoir against its capacity where one is known, and a chart under a
 * circle that used a different denominator would be a second answer to the
 * question the circle already answered.
 */
export function monthlyDetail(reservoir: Reservoir): DetailMonth[] {
  const basis = sizeBasis(reservoir);
  return reservoir.monthly.map((entry) => {
    const storage = entry.mean_af !== null && Number.isFinite(entry.mean_af)
      ? entry.mean_af : null;
    const percent = storage !== null && basis ? (storage / basis) * 100 : null;
    const normal = entry.normal_af !== null && Number.isFinite(entry.normal_af)
      ? entry.normal_af : null;
    return {
      key: entry.month,
      label: monthLabel(entry.month),
      storageAf: storage,
      percent,
      normalAf: normal,
      changeFromNormal: storage !== null && normal ? ((storage - normal) / normal) * 100 : null,
      color: storageColor(percent)
    };
  });
}

export function describeReservoir(reservoir: Reservoir, color: string): DetailView {
  const percent = headlinePercent(reservoir);
  const basis = headlineBasis(reservoir);
  const capacityLabel = basis === "capacity" ? "Capacity" : "Highest recorded storage";
  return {
    name: reservoir.name,
    percent: formatPercent(percent),
    basis: percent === null
      ? "No recent storage reading."
      : `Full, measured against ${basis === "capacity"
        ? "the reservoir's capacity" : "its highest recorded storage"}.`,
    /* The order the legacy popup used, which is not the order the fields sit
     * in the payload: what is stored now, what that is measured against, how
     * it compares with a normal year, then how it has moved, then the
     * bookkeeping. A reader stops as soon as they have their answer, so the
     * answer goes first. */
    rows: [
      { label: "Stored now", value: `${formatAcreFeet(reservoir.current_storage_af)} acre-feet` },
      {
        label: capacityLabel,
        /* Which full level this is, not just how much it is. */
        value: `${formatAcreFeet(reservoir.capacity_af ?? reservoir.record_max_af)} acre-feet${
          basis === "capacity" && capacityBasisName(reservoir.capacity_basis)
            ? `, measured as ${capacityBasisName(reservoir.capacity_basis)}`
            : ""}`
      },
      {
        label: "Normal for this week",
        value: withComparisonYears(
          reservoir.seasonal_normal_af,
          reservoir.pct_of_seasonal_normal,
          reservoir.seasonal_sample_years
        )
      },
      {
        label: "Change in 30 days",
        value: formatChange(reservoir.change_30d_af, reservoir.change_30d_pct),
        negative: (reservoir.change_30d_af ?? 0) < 0
      },
      {
        label: "Change in 1 year",
        value: formatChange(reservoir.change_365d_af, reservoir.change_365d_pct),
        negative: (reservoir.change_365d_af ?? 0) < 0
      },
      {
        label: "Highest value this year",
        value: reservoir.peak_this_year_af === null
          ? "—"
          : `${formatAcreFeet(reservoir.peak_this_year_af)} acre-feet${
            reservoir.peak_this_year_date ? ` (${formatDate(reservoir.peak_this_year_date)})` : ""}`
      },
      {
        label: "History rank",
        value: rankWithYears(
          reservoir.seasonal_percentile, reservoir.seasonal_sample_years)
      },
      { label: "Reading date", value: formatDate(reservoir.as_of) },
      {
        label: "Update schedule",
        value: SCHEDULE_NAMES[reservoir.data_frequency] ?? "Every day"
      },
      { label: "Measured by", value: providerName(reservoir) },
      ...(reservoir.huc6_name
        ? [{ label: "Drainage area", value: reservoir.huc6_name }]
        : [])
    ],
    late: lateMessage(reservoir),
    color,
    months: monthlyDetail(reservoir),
    /* The history rank is the one number here a reader cannot work out from
     * the others, and the legacy popup explained it every time rather than
     * once somewhere else. */
    note: `History rank compares this value with values near the same date in earlier ` +
      `years: 90% means it is higher than 90% of them. The record starts in 2015, so ` +
      `a rank rests on a small number of years and is an indication rather than a ` +
      `measurement. Storage data from the ${providerName(reservoir)}, which can ` +
      `revise these values later.`
  };
}
