/*
 * The rules the one-reservoir page decides by.
 *
 * The fetching is not tested here. What is tested is what a link names and
 * what a page may say about it: the three-way resolution rule shared with
 * the storage map, the refusal to pick between two reservoirs sharing a bare
 * name, and the withdrawn state that keeps a permanent link honest after its
 * reservoir goes quiet (ADR-056).
 */

import { describe, expect, it } from "vitest";

import type { Reservoir, ReservoirPayload } from "./types";
import {
  baselineRows, provenanceRows, requestedName,
  resolveReservoirPage
} from "./reservoir-model";

function reservoir(overrides: Partial<Reservoir>): Reservoir {
  return {
    name: "Test Reservoir",
    rise_item_id: null,
    source_key: "awdb",
    source_label: "USDA NRCS AWDB",
    source_url: "",
    source_station_id: "10UTTEST:UT:BOR",
    data_frequency: "daily",
    stale_after_days: 2,
    lat: 40,
    lon: -111,
    as_of: "2026-08-20",
    days_stale: 1,
    is_stale: false,
    fetch_ok: true,
    current_storage_af: 1000,
    record_max_af: 2000,
    record_min_af: 500,
    pct_of_record_max: 50,
    capacity_af: 2200,
    capacity_basis: "normal_storage",
    pct_of_capacity: 45.5,
    seasonal_percentile: null,
    seasonal_normal_af: null,
    pct_of_seasonal_normal: null,
    seasonal_sample_years: 0,
    change_7d_af: null,
    change_7d_pct: null,
    change_30d_af: null,
    change_30d_pct: null,
    change_365d_af: null,
    change_365d_pct: null,
    peak_this_year_af: null,
    peak_this_year_date: null,
    pct_of_peak_this_year: null,
    monthly: [],
    first_obs: "2020-01-01",
    n_obs: 100,
    years_of_record: 6.0,
    in_utah: true,
    intersects_utah: false,
    ...overrides
  } as Reservoir;
}

const UTAH = reservoir({ name: "Lost Creek", source_station_id: "544", state: "UT" });
const OREGON = reservoir({
  name: "Lost Creek", source_station_id: "14335040:OR:BOR", state: "OR"
});

function payloadWith(reservoirs: readonly Reservoir[],
  withdrawn?: NonNullable<ReservoirPayload["withdrawn"]>): ReservoirPayload {
  const payload: ReservoirPayload = {
    generated_at: "2026-08-21T12:00:00+00:00",
    start_date: "2015-01-01",
    stale_after_days: 2,
    stale_after_days_by_cadence: { daily: 2, monthly: 45 },
    source: "",
    sources: [],
    source_counts: { rise: 0, awdb: 0, cdec: 0, cdss: 0 },
    reservoir_count: reservoirs.length,
    stale_count: 0,
    capacity_count: 0,
    reservoirs: [...reservoirs]
  };
  if (withdrawn) payload.withdrawn = withdrawn;
  return payload;
}

describe("requestedName", () => {
  it("reads the name parameter and trims it", () => {
    expect(requestedName("?name=Pearl%20Lake")).toBe("Pearl Lake");
    expect(requestedName("?name=%20Pearl%20Lake%20")).toBe("Pearl Lake");
  });

  it("treats an absent or blank name as no request at all", () => {
    expect(requestedName("")).toBeNull();
    expect(requestedName("?name=")).toBeNull();
    expect(requestedName("?name=%20%20")).toBeNull();
    expect(requestedName("?other=1")).toBeNull();
  });
});

describe("resolveReservoirPage", () => {
  const payload = payloadWith([UTAH, OREGON]);

  it("resolves a station identifier before anything else", () => {
    // Both Lost Creeks answer to their bare name ambiguously; the identity
    // never does (ADR-066).
    const found = resolveReservoirPage(payload, "?name=544");
    expect(found.status).toBe("found");
  });

  it("resolves the qualified label a reader can see on screen", () => {
    const found = resolveReservoirPage(payload, "?name=Lost%20Creek%2C%20OR");
    expect(found).toMatchObject({ status: "found" });
    if (found.status === "found") expect(found.reservoir.state).toBe("OR");
  });

  it("resolves a unique bare name", () => {
    const pearl = reservoir({ name: "Pearl Lake", source_station_id: "PEARLACO" });
    const found = resolveReservoirPage(payloadWith([pearl]), "?name=Pearl%20Lake");
    expect(found).toMatchObject({ status: "found" });
  });

  it("refuses to choose between two reservoirs sharing a bare name", () => {
    // Picking one would answer a question the link did not ask.
    expect(resolveReservoirPage(payload, "?name=Lost%20Creek").status)
      .toBe("unknown");
  });

  it("says unknown for a name nothing publishes", () => {
    const state = resolveReservoirPage(payload, "?name=Nowhere%20Reservoir");
    expect(state).toMatchObject({ status: "unknown", requested: "Nowhere Reservoir" });
  });

  it("lands a withdrawn reservoir's permanent link on an explanation", () => {
    // The whole point of one static shell over sixty-eight generated ones:
    // a feed going quiet must not turn a published URL into a 404 (ADR-056).
    const withdrawn = payloadWith([], [{
      name: "Elkhead Reservoir", as_of: "2026-05-31", days_stale: 82,
      source_label: "Colorado Division of Water Resources",
      reason: "no reading inside the publication window"
    }]);
    const state = resolveReservoirPage(withdrawn, "?name=Elkhead%20Reservoir");
    expect(state).toMatchObject({
      status: "withdrawn",
      name: "Elkhead Reservoir",
      lastRead: "2026-05-31"
    });
  });

  it("answers a bare link with the landing state", () => {
    expect(resolveReservoirPage(payload, "").status).toBe("none");
    expect(resolveReservoirPage(payload, "?name=").status).toBe("none");
  });
});

describe("baselineRows", () => {
  it("shows both periods with their sample sizes, or neither", () => {
    const both = baselineRows(reservoir({
      baselines: {
        recent: { normal_af: 900, pct_of_normal: 111, sample_years: 11,
          covers_full_period: true, first_obs: "2015-01-01" },
        climate: { normal_af: 800, pct_of_normal: 125, sample_years: 30,
          covers_full_period: true, first_obs: "1991-01-01" },
        default: "climate"
      }
    }));
    expect(both.map((row) => row.sampleYears)).toEqual([11, 30]);
    expect(baselineRows(reservoir({}))).toEqual([]);
  });
});

describe("provenanceRows", () => {
  it("names the agency, the station, the place and the denominator", () => {
    const rows = provenanceRows(reservoir({
      county_name: "Grand County",
      huc6_name: "Lower Green"
    }));
    const values = Object.fromEntries(rows.map((row) => [row.label, row.value]));
    expect(values["Measured by"]).toBe("Natural Resources Conservation Service");
    expect(values["Station identifier"]).toBe("10UTTEST:UT:BOR");
    expect(values["County"]).toContain("Grand County");
    expect(values["Drainage area"]).toContain("Lower Green");
    expect(values["Full level"]).toContain("National Inventory of Dams");
  });

  it("credits the operator where the operator published the full level", () => {
    const rows = provenanceRows(reservoir({
      capacity_basis: "cdec_reservoir_report"
    }));
    expect(rows.find((row) => row.label === "Full level")?.value)
      .toContain("daily reservoir report");
  });
});
