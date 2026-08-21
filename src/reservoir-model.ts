/*
 * One reservoir as a page of its own.
 *
 * The rules live here so they are testable; the entry point is wiring. Two
 * questions the module answers, both settled before this page was built
 * (docs/OPEN-BACKLOG-SCOPING.md, decision 4):
 *
 * **Which reservoir does a link name?** The same three-way rule the storage
 * map applies (`findReservoir`): the station identifier first, because it is
 * the identity and cannot be ambiguous (ADR-066); then the qualified label
 * the reader can see on screen -- "Lost Creek, OR"; then a bare name, which
 * resolves only when exactly one reservoir holds it. A bare name shared by
 * two resolves to neither: picking one would answer a question the link did
 * not ask.
 *
 * **What does a withdrawn reservoir's page say?** A page for a withdrawn
 * reservoir must still load -- that is the argument for one static shell over
 * sixty-eight generated ones. The payload's withdrawal notices carry no
 * measurement (ADR-056), so the page can say the reading was withdrawn and
 * when it was last real, and nothing more. Matching is by bare name against
 * the notice, which is all a notice carries.
 */

import { findReservoir, reservoirLabel } from "./state/selection";
import type {
  Baseline, Reservoir, ReservoirPayload
} from "./types";
import { capacitySource } from "./data/export";
import { providerName } from "./state/detail";

/** The parameter this page reads. One word, one meaning. */
export const RESERVOIR_PAGE_PARAM = "name";

/** Reads `?name=` from a query string. No browser API, so tests drive it. */
export function requestedName(search: string): string | null {
  const value = new URLSearchParams(search).get(RESERVOIR_PAGE_PARAM);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** What the page can be about, decided once, rendered per case. */
export type ReservoirPageState =
  | { status: "none" }
  | { status: "found"; reservoir: Reservoir; label: string }
  | { status: "withdrawn"; name: string; lastRead: string | null;
      sourceLabel: string | null }
  | { status: "unknown"; requested: string };

export function resolveReservoirPage(
  payload: ReservoirPayload, search: string
): ReservoirPageState {
  const requested = requestedName(search);
  if (requested === null) return { status: "none" };

  const found = findReservoir(payload.reservoirs, requested);
  if (found) {
    return {
      status: "found",
      reservoir: found,
      label: reservoirLabel(found, payload.reservoirs)
    };
  }

  // Not published this morning. Before saying "unknown", ask whether the
  // roster withdrew it: a permanent URL for a quiet feed has to land on an
  // explanation rather than an error, or the permanence was never real.
  const lowered = requested.toLowerCase();
  const notice = (payload.withdrawn ?? []).find(
    (entry) => entry.name.toLowerCase() === lowered);
  if (notice) {
    return {
      status: "withdrawn",
      name: notice.name,
      lastRead: notice.as_of,
      sourceLabel: notice.source_label
    };
  }

  return { status: "unknown", requested };
}

/**
 * One row for each comparison this reservoir can answer for, and one line
 * where it cannot.
 *
 * Both periods are shown rather than the chosen one: on its own page there is
 * no control beside the reader to explain a substitution, so each period says
 * plainly whether it exists, how many years stand behind it, and where it
 * starts. A median over three years and one over thirty are both on offer,
 * each labelled as what it is.
 */
export interface BaselineRow {
  /** The period's published name, e.g. "Standard climate period". */
  label: string;
  periodLabel: string;
  normalAf: number | null;
  percentOfNormal: number | null;
  sampleYears: number;
  coversFullPeriod: boolean;
}

export function baselineRows(reservoir: Reservoir): BaselineRow[] {
  const baselines = reservoir.baselines;
  if (!baselines) return [];
  const rows: BaselineRow[] = [];
  for (const [id, label] of [
    ["recent", "Recent years"],
    ["climate", "Standard climate period"]
  ] as const) {
    const found: Baseline | null = baselines[id];
    rows.push({
      label,
      periodLabel: "",
      normalAf: found?.normal_af ?? null,
      percentOfNormal: found?.pct_of_normal ?? null,
      sampleYears: found?.sample_years ?? 0,
      coversFullPeriod: found?.covers_full_period ?? false
    });
  }
  return rows;
}

export interface ProvenanceRow {
  label: string;
  value: string;
}

/**
 * Where these numbers come from, named so a reader can check them.
 *
 * The agency, never the system label the payload carries; the station
 * identifier, which is what the data API answers for; and which figure the
 * percentage divides by, with whoever published it.
 */
export function provenanceRows(reservoir: Reservoir): ProvenanceRow[] {
  const rows: ProvenanceRow[] = [
    { label: "Measured by", value: providerName(reservoir) }
  ];
  if (reservoir.source_station_id) {
    rows.push({ label: "Station identifier", value: reservoir.source_station_id });
  }
  if (reservoir.county_name) {
    const state = reservoir.state ? `, ${reservoir.state}` : "";
    rows.push({ label: "County", value: `${reservoir.county_name}${state}` });
  }
  if (reservoir.huc6_name) {
    const code = reservoir.huc6 ? ` (${reservoir.huc6})` : "";
    rows.push({ label: "Drainage area", value: `${reservoir.huc6_name}${code}` });
  }
  rows.push({
    label: "Full level",
    value: capacitySource(reservoir)
  });
  return rows;
}
