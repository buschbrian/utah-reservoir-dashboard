import { describe, expect, it } from "vitest";
import { readSnowpack } from "./payload-fixture";
import { validateSnowpackPayload } from "./snow-validate";

function validPayload(): Record<string, unknown> {
  return {
    schema_version: 2,
    generated_at: "2026-08-15T12:00:00Z",
    as_of: "2026-08-15",
    water_year: 2026,
    normal_period: { start_year: 1991, end_year: 2020 },
    units: "inches",
    site_series_fields: ["series_days", "series_values", "series_normals"],
    series_dates: ["2026-08-13", "2026-08-14"],
    source: "https://example.com/awdb",
    site_count: 1,
    late_site_count: 0,
    rollups: [{
      huc6: "160201",
      huc6_name: "Weber",
      site_count: 1,
      minimum_reporting_sites: 2,
      series: [{
        date: "2026-08-14",
        reporting_site_count: 1,
        mean_percent_of_normal_median: null
      }]
    }],
    sites: [{
      station: "1000:UT:SNTL",
      name: "Testsnow",
      state: "UT",
      county: "Summit",
      lat: 40.5,
      lon: -111.0,
      elevation_feet: 9000,
      begins: "2002-08-01",
      huc6: "160201",
      huc6_name: "Weber",
      provider_huc6: "160201",
      latest_date: "2026-08-14",
      late: false,
      normal_timing: {
        peak: { month: 4, day: 8, value: 20.1 },
        onset: { month: 10, day: 15 },
        meltout: { month: 6, day: 1 }
      },
      /* The second day of the shared calendar, and nothing on the first --
       * the encoding's whole job is that this stays different from a site
       * that reported null on both. */
      series_days: [1],
      series_values: [0.0],
      series_normals: [0.0]
    }]
  };
}

describe("snowpack payload validation", () => {
  it("rejects a missing sites array with a useful message", () => {
    expect(() => validateSnowpackPayload({ generated_at: "2026-08-15" }))
      .toThrow("sites array");
  });

  it("accepts a complete payload", () => {
    const payload = validateSnowpackPayload(validPayload());
    expect(payload.site_count).toBe(1);
    expect(payload.normal_period).toEqual({ start_year: 1991, end_year: 2020 });
    expect(payload.water_year).toBe(2026);
  });

  it("rejects a malformed site instead of allowing a blank page", () => {
    const payload = validPayload();
    delete (payload.sites as Record<string, unknown>[])[0]?.latest_date;
    expect(() => validateSnowpackPayload(payload))
      .toThrow("Invalid snow site record at index 0 (Testsnow)");
  });

  it("rejects columns of different lengths", () => {
    /* Three parallel arrays that do not line up cannot be rebuilt into rows,
     * and the wrong answer here is not an error -- it is a shorter series
     * that draws a complete, plausible, wrong curve. */
    const payload = validPayload();
    const site = (payload.sites as Record<string, unknown>[])[0]!;
    site.series_values = [0.0, 1.0];
    expect(() => validateSnowpackPayload(payload))
      .toThrow("Invalid snow site record at index 0 (Testsnow)");
  });

  it("rejects a day outside the shared calendar", () => {
    const payload = validPayload();
    const site = (payload.sites as Record<string, unknown>[])[0]!;
    site.series_days = [99];
    expect(() => validateSnowpackPayload(payload))
      .toThrow("Invalid snow site record at index 0 (Testsnow)");
  });

  it("rejects renamed series columns before a chart reads the wrong one", () => {
    const payload = validPayload();
    payload.site_series_fields = ["series_days", "series_values", "median"];
    expect(() => validateSnowpackPayload(payload))
      .toThrow("unexpected series columns");
  });

  /* The dates are written once and every site indexes into them, so their
   * order is load-bearing in a way no single row's order ever was: dates out
   * of order rebuild every site against the wrong days. */
  it("rejects series dates that are not ascending", () => {
    const payload = validPayload();
    payload.series_dates = ["2026-08-14", "2026-08-13"];
    expect(() => validateSnowpackPayload(payload))
      .toThrow("ascending order");
  });

  it("rejects a payload with no shared calendar at all", () => {
    const payload = validPayload();
    delete payload.series_dates;
    expect(() => validateSnowpackPayload(payload))
      .toThrow("shared series dates");
  });

  it("rebuilds the rows every reader downstream expects", () => {
    const payload = validateSnowpackPayload(validPayload());
    expect(payload.sites[0]?.series).toEqual([["2026-08-14", 0.0, 0.0]]);
  });

  it("rejects a unit change before a label lies about it", () => {
    const payload = validPayload();
    payload.units = "cm";
    expect(() => validateSnowpackPayload(payload)).toThrow("inches");
  });

  it("rejects a missing normal period; the baseline must be disclosed", () => {
    const payload = validPayload();
    delete payload.normal_period;
    expect(() => validateSnowpackPayload(payload))
      .toThrow("normal period metadata");
  });

  it("rejects site and late counts that disagree with the sites", () => {
    const payload = validPayload();
    payload.site_count = 2;
    expect(() => validateSnowpackPayload(payload))
      .toThrow("site_count does not match");

    const other = validPayload();
    (other.sites as Record<string, unknown>[])[0]!.late = true;
    expect(() => validateSnowpackPayload(other))
      .toThrow("late_site_count does not match");
  });

  it("rejects a site whose drainage area has no rollup", () => {
    const payload = validPayload();
    (payload.sites as Record<string, unknown>[])[0]!.huc6 = "140100";
    expect(() => validateSnowpackPayload(payload))
      .toThrow("has no drainage area rollup");
  });

  it("accepts absent normal timing entries; the provider omits some", () => {
    const payload = validPayload();
    (payload.sites as Record<string, unknown>[])[0]!.normal_timing = {
      peak: null,
      onset: null,
      meltout: null
    };
    expect(validateSnowpackPayload(payload).site_count).toBe(1);
  });
});

/*
 * Same loop-closer as the reservoir suite: the strict validator plus the
 * payload the pipeline actually wrote. Assertions stay data-independent --
 * shape and self-consistency only, never a snow value, so tomorrow's refresh
 * cannot turn the build red.
 */
describe("the committed snow payload", () => {
  it("passes the validator that guards the fetch boundary", () => {
    const payload = readSnowpack();
    expect(payload.sites.length).toBe(payload.site_count);
    expect(payload.sites.length).toBeGreaterThan(0);
    expect(payload.rollups.length).toBeGreaterThan(0);
  });

  it("covers every site with a drainage area rollup that counts it", () => {
    const payload = readSnowpack();
    const sitesPerUnit = new Map<string, number>();
    for (const site of payload.sites) {
      sitesPerUnit.set(site.huc6, (sitesPerUnit.get(site.huc6) ?? 0) + 1);
    }
    for (const rollup of payload.rollups) {
      expect(rollup.site_count).toBe(sitesPerUnit.get(rollup.huc6));
    }
    const rollupTotal = payload.rollups
      .reduce((sum, rollup) => sum + rollup.site_count, 0);
    expect(rollupTotal).toBe(payload.site_count);
  });

  it("publishes the normal period the methods text will name", () => {
    const payload = readSnowpack();
    expect(payload.normal_period.start_year)
      .toBeLessThan(payload.normal_period.end_year);
  });
});
