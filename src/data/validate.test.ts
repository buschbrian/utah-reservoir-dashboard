import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPayloadWithoutNormalMetadata } from "./payload-fixture";
import { validateReservoirPayload } from "./validate";

function validPayload(): Record<string, unknown> {
  return {
    schema_version: 1,
    generated_at: "2026-08-09T12:00:00Z",
    start_date: "2015-01-01",
    normal_period: { start_year: 2015, end_year: 2025 },
    normal_window_days: 7,
    stale_after_days: 2,
    stale_after_days_by_cadence: { daily: 2, monthly: 45 },
    source: "Official reservoir storage sources",
    sources: [{ key: "rise", label: "Reclamation", url: "https://example.com", cadence: "daily" }],
    source_counts: { rise: 1, awdb: 0, cdec: 0, cdss: 0 },
    reservoir_count: 1,
    stale_count: 0,
    capacity_count: 1,
    reservoirs: [{
      name: "Testwater",
      rise_item_id: 1,
      source_key: "rise",
      source_label: "Reclamation",
      source_url: "https://example.com",
      source_station_id: "1",
      data_frequency: "daily",
      stale_after_days: 2,
      lat: 40,
      lon: -111,
      as_of: "2026-08-09",
      days_stale: 1,
      is_stale: false,
      fetch_ok: true,
      current_storage_af: 50,
      record_max_af: 100,
      record_min_af: 10,
      pct_of_record_max: 50,
      capacity_af: 100,
      capacity_basis: "normal_storage",
      pct_of_capacity: 50,
      seasonal_percentile: 25,
      seasonal_normal_af: 60,
      pct_of_seasonal_normal: 83.3,
      seasonal_sample_years: 10,
      change_7d_af: 1,
      change_7d_pct: 2,
      change_30d_af: -3,
      change_30d_pct: -5,
      change_365d_af: 4,
      change_365d_pct: 8,
      peak_this_year_af: 70,
      peak_this_year_date: "2026-06-01",
      pct_of_peak_this_year: 71.4,
      monthly: [{
        month: "2026-08",
        mean_af: 50,
        min_af: 45,
        max_af: 55,
        end_af: 50,
        days: 9,
        normal_af: 60
      }],
      first_obs: "2015-01-01",
      n_obs: 4000,
      years_of_record: 11.6,
      in_utah: true,
      intersects_utah: true
    }]
  };
}

describe("reservoir payload validation", () => {
  it("rejects a missing reservoirs array with a useful message", () => {
    expect(() => validateReservoirPayload({ generated_at: "2026-08-09" }))
      .toThrow("reservoirs array");
  });

  it("rejects a malformed record instead of allowing a blank dashboard", () => {
    expect(() => validateReservoirPayload({
      generated_at: "2026-08-09",
      start_date: "2015-01-01",
      reservoir_count: 1,
      reservoirs: [{ name: "Broken" }]
    })).toThrow("Invalid reservoir record at index 0 (Broken)");
  });

  it("accepts a complete payload", () => {
    const payload = validateReservoirPayload(validPayload());
    expect(payload.reservoir_count).toBe(1);
    expect(payload.schema_version).toBe(1);
    expect(payload.normal_period).toEqual({ start_year: 2015, end_year: 2025 });
    expect(payload.normal_window_days).toBe(7);
  });

  it("accepts a payload generated before comparison metadata was added", () => {
    const payload = validPayload();
    delete payload.normal_period;
    delete payload.normal_window_days;
    expect(validateReservoirPayload(payload).reservoir_count).toBe(1);
    expect(readPayloadWithoutNormalMetadata().reservoirs.length).toBeGreaterThan(0);
  });

  it("rejects malformed optional comparison metadata", () => {
    const payload = validPayload();
    payload.normal_period = { start_year: 2025, end_year: 2015 };
    expect(() => validateReservoirPayload(payload)).toThrow("normal period metadata");

    const other = validPayload();
    other.normal_window_days = 7.5;
    expect(() => validateReservoirPayload(other)).toThrow("normal window metadata");
  });

  /* The details panel formats these into a sentence, and `formatDate` echoes
   * back anything it cannot parse -- so a number here reaches a reader as
   * ", since 20250810" rather than being refused at load. Absent still
   * passes: they arrive with the pipeline, and a payload written before they
   * did is a valid payload. */
  it("rejects a change reference date that is not a date", () => {
    for (const field of ["change_7d_reference_date", "change_30d_reference_date",
      "change_365d_reference_date"]) {
      const payload = validPayload();
      const record = (payload.reservoirs as Record<string, unknown>[])[0]!;
      record[field] = 20_250_810;
      expect(() => validateReservoirPayload(payload), field)
        .toThrow("Invalid reservoir record at index 0 (Testwater)");
    }
  });

  it("accepts a payload generated before the change reference dates existed", () => {
    const payload = validPayload();
    const record = (payload.reservoirs as Record<string, unknown>[])[0]!;
    for (const field of ["change_7d_reference_date", "change_30d_reference_date",
      "change_365d_reference_date"]) {
      delete record[field];
    }
    expect(validateReservoirPayload(payload).reservoir_count).toBe(1);
  });

  it("rejects a non-integer structure version", () => {
    const payload = validPayload();
    payload.schema_version = 1.5;
    expect(() => validateReservoirPayload(payload)).toThrow("invalid schema version");
  });

  it("rejects a reservoir missing a field used by statewide totals", () => {
    const payload = validPayload();
    delete (payload.reservoirs as Record<string, unknown>[])[0]?.days_stale;

    expect(() => validateReservoirPayload(payload))
      .toThrow("Invalid reservoir record at index 0 (Testwater)");
  });

  it("rejects missing Utah membership before a scoped total is calculated", () => {
    const payload = validPayload();
    delete (payload.reservoirs as Record<string, unknown>[])[0]?.intersects_utah;

    expect(() => validateReservoirPayload(payload))
      .toThrow("Invalid reservoir record at index 0 (Testwater)");
  });

  it("rejects an incomplete monthly record", () => {
    const payload = validPayload();
    const reservoir = (payload.reservoirs as Record<string, unknown>[])[0];
    delete (reservoir?.monthly as Record<string, unknown>[])[0]?.normal_af;

    expect(() => validateReservoirPayload(payload))
      .toThrow("Invalid reservoir record at index 0 (Testwater)");
  });

  it("rejects missing source counts before the UI renders undefined", () => {
    const payload = validPayload();
    delete payload.source_counts;

    expect(() => validateReservoirPayload(payload)).toThrow("source metadata");
  });
});

/*
 * The validator is strict, and every fixture above is synthetic. That leaves
 * the one case that actually ships untested: the payload the pipeline wrote
 * this morning. Its only call site is `load.ts`, reached from `modern.html`,
 * which the browser smoke test does not open -- so a pipeline field that the
 * validator rejects would surface as a blank page for a reader rather than
 * as a failed build.
 *
 * Reading the committed file closes that loop. It stays data-independent:
 * it asserts shape and the envelope's own self-consistency, never a
 * storage value, so tomorrow's refresh cannot turn it red.
 */
describe("the committed payload", () => {
  const raw = JSON.parse(
    readFileSync(new URL("../../reservoirs.json", import.meta.url), "utf8")
  ) as unknown;

  it("passes the validator that guards the fetch boundary", () => {
    const payload = validateReservoirPayload(raw);
    expect(payload.reservoirs.length).toBe(payload.reservoir_count);
    expect(payload.reservoirs.length).toBeGreaterThan(0);
  });

  it("carries a drainage area for every reservoir", () => {
    const payload = validateReservoirPayload(raw);
    const missing = payload.reservoirs.filter((r) => !r.huc6).map((r) => r.name);
    expect(missing).toEqual([]);
  });
});
