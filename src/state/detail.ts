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

import { isLateForCadence } from "../data/rollup";
import type { Reservoir, SourceKey } from "../types";
import { formatAcreFeet, formatDate, formatPercent } from "../viz/format";
import { headlineBasis, headlinePercent } from "../viz/symbols";

export interface DetailRow {
  label: string;
  value: string;
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
}

const PROVIDER_NAMES: Record<SourceKey, string> = {
  rise: "Bureau of Reclamation",
  awdb: "Natural Resources Conservation Service"
};

export function providerName(reservoir: Reservoir): string {
  return PROVIDER_NAMES[reservoir.source_key];
}

export function lateMessage(reservoir: Reservoir): string | null {
  if (!isLateForCadence(reservoir)) return null;
  const days = Math.max(1, Math.round(reservoir.days_stale));
  return days === 1
    ? "This reading is late by one day."
    : `This reading is late by ${days} days.`;
}

export function describeReservoir(reservoir: Reservoir, color: string): DetailView {
  const percent = headlinePercent(reservoir);
  const basis = headlineBasis(reservoir);
  return {
    name: reservoir.name,
    percent: formatPercent(percent),
    basis: percent === null
      ? "No recent storage reading."
      : `Full, measured against ${basis === "capacity"
        ? "the reservoir's capacity" : "its highest recorded storage"}.`,
    rows: [
      { label: "Stored now", value: `${formatAcreFeet(reservoir.current_storage_af)} acre-feet` },
      {
        label: basis === "capacity" ? "Capacity" : "Highest recorded storage",
        value: `${formatAcreFeet(reservoir.capacity_af ?? reservoir.record_max_af)} acre-feet`
      },
      { label: "Reading date", value: formatDate(reservoir.as_of) },
      { label: "Measured by", value: providerName(reservoir) },
      ...(reservoir.huc6_name
        ? [{ label: "Drainage area", value: reservoir.huc6_name }]
        : [])
    ],
    late: lateMessage(reservoir),
    color
  };
}
