import { describe, expect, it } from "vitest";
import { readDrainageGeoJson, readDroughtCoverage } from "./payload-fixture";
import { validateDroughtCoverage } from "./drought-validate";

function validUnit(): Record<string, unknown> {
  return {
    huc6: "160201",
    huc6_name: "Weber",
    percent_of_area: { none: 10, d0: 20, d1: 30, d2: 25, d3: 10, d4: 5 },
    percent_of_area_at_least: { d0: 90, d1: 70, d2: 40, d3: 15, d4: 5 }
  };
}

function validPayload(): Record<string, unknown> {
  return {
    schema_version: 1,
    map_date: "2026-08-11",
    release_date: "2026-08-13",
    source: "https://example.com/usdm",
    attribution: "U.S. Drought Monitor",
    method: { grid_step_degrees: 0.01 },
    unit_count: 1,
    units: [validUnit()]
  };
}

describe("drought coverage validation", () => {
  it("accepts a complete payload", () => {
    const payload = validateDroughtCoverage(validPayload());
    expect(payload.unit_count).toBe(1);
    expect(payload.map_date).toBe("2026-08-11");
  });

  it("rejects a missing units array with a useful message", () => {
    expect(() => validateDroughtCoverage({ map_date: "2026-08-11" }))
      .toThrow("units array");
  });

  it("rejects shares that do not cover the whole area", () => {
    const payload = validPayload();
    (payload.units as Record<string, unknown>[])[0]!.percent_of_area =
      { none: 10, d0: 20, d1: 30, d2: 25, d3: 10, d4: 0 };
    expect(() => validateDroughtCoverage(payload))
      .toThrow("Invalid drought coverage record at index 0 (Weber)");
  });

  it("rejects cumulative figures that grow as the class worsens", () => {
    const payload = validPayload();
    (payload.units as Record<string, unknown>[])[0]!.percent_of_area_at_least =
      { d0: 90, d1: 70, d2: 40, d3: 45, d4: 5 };
    expect(() => validateDroughtCoverage(payload))
      .toThrow("Invalid drought coverage record at index 0 (Weber)");
  });

  it("rejects a share outside zero to one hundred", () => {
    const payload = validPayload();
    const unit = (payload.units as Record<string, unknown>[])[0]!;
    (unit.percent_of_area as Record<string, number>).d4 = 105;
    expect(() => validateDroughtCoverage(payload)).toThrow("index 0");
  });

  it("rejects a repeated drainage area", () => {
    const payload = validPayload();
    payload.units = [validUnit(), validUnit()];
    payload.unit_count = 2;
    expect(() => validateDroughtCoverage(payload))
      .toThrow("repeats a drainage area");
  });

  it("rejects a unit count that disagrees with the units", () => {
    const payload = validPayload();
    payload.unit_count = 3;
    expect(() => validateDroughtCoverage(payload)).toThrow("unit_count");
  });

  it("rejects missing source metadata", () => {
    const payload = validPayload();
    delete payload.attribution;
    expect(() => validateDroughtCoverage(payload)).toThrow("source metadata");
  });
});

/* The loop-closer: the file the analysis tool actually wrote, through the
 * validator that guards the fetch boundary. Shape and self-consistency only,
 * never this week's drought. */
describe("the committed drought coverage", () => {
  it("passes the validator and covers every published drainage area", () => {
    const payload = readDroughtCoverage();
    expect(payload.units.length).toBe(payload.unit_count);
    expect(payload.units.length).toBeGreaterThan(0);
  });

  it("names the same drainage areas as the committed boundaries", () => {
    const payload = readDroughtCoverage();
    const boundaries = readDrainageGeoJson() as {
      features: { properties: { huc6: string } }[];
    };
    const expected = boundaries.features
      .map((feature) => feature.properties.huc6).sort();
    expect(payload.units.map((unit) => unit.huc6).sort()).toEqual(expected);
  });
});
