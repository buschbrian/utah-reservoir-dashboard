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
import type { BaselineChoice, BaselineId, Reservoir, SourceKey } from "../types";
import {
  activeBaseline, baselineRowLabel, describeBaseline, FALLBACK_CHOICES
} from "./baseline";
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

/** Which period the chart's normal line is drawn from. */
export interface DetailBaseline {
  /** The row's own heading, which names the period rather than saying "normal". */
  label: string;
  value: string;
  /** True when this reservoir has no figures for the period the reader chose. */
  substituted: boolean;
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
  /** The period the comparison used, and whether it is the one asked for. */
  baseline: DetailBaseline;
}

const PROVIDER_NAMES: Record<SourceKey, string> = {
  rise: "Bureau of Reclamation",
  awdb: "Natural Resources Conservation Service",
  cdec: "California Department of Water Resources",
  cdss: "Colorado Division of Water Resources"
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
function formatChange(
  amount: number | null, percent: number | null, since: string | null = null
): string {
  const acreFeet = formatSignedAcreFeet(amount);
  if (acreFeet === "—") return acreFeet;
  const relative = percent === null || !Number.isFinite(percent)
    ? "" : ` (${percent > 0 ? "+" : ""}${formatPercent(percent)})`;
  /* The reading it is a change *from*. Without it the row is a difference
   * between one named date and one the reader has to assume. */
  const from = since ? `, since ${formatDate(since)}` : "";
  return `${acreFeet}${relative}${from}`;
}

/**
 * The interval a change actually covers, where it is not the one in its name.
 *
 * "30 days" is the date the pipeline asks for, not the one it gets. The
 * nearest usable reading is taken within a tolerance of ten days for a daily
 * feed and forty-five for a month-end one, so a row headed "Change in 1 year"
 * has covered anything from 320 days to 410. Where the elapsed days differ
 * from the name, the name gives way to the measurement.
 *
 * Optional: a payload written before the pipeline published the elapsed days
 * keeps the plain label rather than losing the row.
 */
export function changeLabel(base: string, elapsed: number | null | undefined): string {
  if (elapsed === null || elapsed === undefined || !Number.isFinite(elapsed)) {
    return base;
  }
  const named = base === "Change in 1 year" ? 365 : 30;
  if (elapsed === named) return base;
  return `Change in ${Math.round(elapsed)} days`;
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
 * It matters more than the count of each suggests. Fifteen of the 198
 * reservoirs are measured against a maximum level, and those fifteen are a
 * quarter of the combined denominator every regional percentage is divided by
 * -- Lake Powell alone is most of it. So a reader comparing two reservoirs, or
 * reading a combined figure, is comparing against mixed bases unless the
 * panel says which. (It read "four of the sixty-nine" and "71%" for as long
 * as the roster had been western: a count in a comment goes stale the same
 * way a count in a sentence does, and `statewideRollup` publishes these as
 * `basisShares` so no surface has to state them.)
 */
const CAPACITY_BASIS_NAMES: Record<string, string> = {
  normal_storage: "the normal full level",
  max_storage: "the maximum level, which includes storage kept for floods",
  /* The dam inventory's headline figure, reached only where neither pool
     above contains water this reservoir has actually been seen holding
     (ADR-072). One reservoir today. */
  nid_storage: "the largest level the dam inventory publishes",
  reclamation_project_record: "the full level published by the reservoir operator",
  awdb_reservoir_metadata: "the full level published with the readings",
  cdec_reservoir_report: "the full level published by the reservoir operator"
};

/** The words for a basis, or null when the provider named none. */
export function capacityBasisName(basis: string | null): string | null {
  if (!basis) return null;
  return CAPACITY_BASIS_NAMES[basis] ?? null;
}

/**
 * The history rank, said as a position first and a percentage second.
 *
 * A rank is a position in a list, and a position in a list of eight is a
 * different claim from a position in a list of thirty. The record starts in
 * 2015, so every rank here rests on eight to eleven values.
 *
 * "18.2%" invites a reader to take two ranks four points apart as different,
 * which with eleven years behind them they are not -- one year moving past
 * another moves the figure about nine points, so every value in between is
 * unreachable. "Third-lowest of eleven" says the same thing and cannot be
 * over-read, so it leads. The percentage stays because it is comparable
 * across reservoirs with different record lengths, which the ordinal is not.
 *
 * `rank` and `rankOf` are optional: they arrive from the pipeline, and a
 * payload written before they did still answers with the percentage alone
 * rather than losing the row.
 */
export function rankWithYears(
  percentile: number | null, years: number,
  rank: number | null = null, rankOf: number | null = null
): string {
  const share = formatPercent(percentile);
  if (percentile === null) return share;
  if (rank !== null && rankOf !== null && rankOf > 1) {
    return `${ordinal(rank)}-lowest of ${rankOf}, ${share}`;
  }
  if (!Number.isFinite(years) || years <= 0) return share;
  const rounded = Math.floor(years);
  return `${share}, out of ${rounded} earlier ${rounded === 1 ? "year" : "years"}`;
}

/**
 * "3rd", "11th", "21st". Written out rather than reached for from a library:
 * this is the only place the site needs one, and the rule is four lines.
 */
function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
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
export function monthlyDetail(
  reservoir: Reservoir, baseline: BaselineId = "recent"
): DetailMonth[] {
  const basis = sizeBasis(reservoir);
  return reservoir.monthly.map((entry) => {
    const storage = entry.mean_af !== null && Number.isFinite(entry.mean_af)
      ? entry.mean_af : null;
    const percent = storage !== null && basis ? (storage / basis) * 100 : null;
    /* The climate line falls back to the recent one rather than vanishing:
     * a chart that loses its reference line when the reader changes period
     * reads as a broken chart, and the panel's own row says which period the
     * reservoir could actually answer for. */
    const chosen = baseline === "climate" && entry.climate_normal_af !== undefined
      && entry.climate_normal_af !== null
      ? entry.climate_normal_af
      : entry.normal_af;
    const normal = chosen !== null && chosen !== undefined && Number.isFinite(chosen)
      ? chosen : null;
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

export function describeReservoir(
  reservoir: Reservoir,
  color: string,
  baseline: BaselineId = "recent",
  choices: readonly BaselineChoice[] = FALLBACK_CHOICES,
  minimumYears = 0
): DetailView {
  const active = activeBaseline(reservoir, baseline, minimumYears);
  const comparison = {
    label: baselineRowLabel(active, choices),
    value: describeBaseline(active, choices),
    substituted: active.substituted
  };
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
      { label: comparison.label, value: comparison.value },
      {
        label: changeLabel("Change in 30 days", reservoir.change_30d_elapsed_days),
        value: formatChange(reservoir.change_30d_af, reservoir.change_30d_pct,
          reservoir.change_30d_reference_date),
        negative: (reservoir.change_30d_af ?? 0) < 0
      },
      {
        label: changeLabel("Change in 1 year", reservoir.change_365d_elapsed_days),
        value: formatChange(reservoir.change_365d_af, reservoir.change_365d_pct,
          reservoir.change_365d_reference_date),
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
          reservoir.seasonal_percentile, reservoir.seasonal_sample_years,
          reservoir.seasonal_rank ?? null, reservoir.seasonal_rank_of ?? null)
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
    months: monthlyDetail(reservoir, active.shown ?? "recent"),
    baseline: comparison,
    /* The history rank is the one number here a reader cannot work out from
     * the others, and the legacy popup explained it every time rather than
     * once somewhere else. */
    note: `History rank compares this value with one value from each earlier year ` +
      `near the same date. "Third-lowest of eleven" places it among those years and ` +
      `this one. 90% means it is higher than 90% of them. The rank always uses the ` +
      `years this site collects, which start in 2015, so it rests on a small number ` +
      `of years and is an indication rather than a measurement. The normal value ` +
      `above uses the period named beside it. Storage data from the ` +
      `${providerName(reservoir)}, which can revise these values later.`
  };
}
