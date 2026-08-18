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

/* ADR-059. The monitor stops at both borders, so a drainage area crossing one
 * is partly unmeasured and says so. Nothing published today carries this, and
 * the validator has to accept both shapes -- the payload is fetched at
 * runtime, so the page reading it is older than the file more often than not. */
describe("the measured-extent block", () => {
  const unit = () => ({
    huc6: "170101",
    huc6_name: "Kootenai",
    percent_of_area: { none: 0, d0: 0, d1: 0, d2: 100, d3: 0, d4: 0 },
    percent_of_area_at_least: { d0: 100, d1: 100, d2: 100, d3: 0, d4: 0 }
  });
  const payload = (units: unknown[]) => ({
    schema_version: 1,
    map_date: "2026-08-11",
    release_date: "2026-08-13",
    source: "https://example.com/usdm",
    attribution: "U.S. Drought Monitor",
    level: 6,
    unit_count: units.length,
    units
  });

  it("accepts a unit with no block, which is every unit published today", () => {
    expect(() => validateDroughtCoverage(payload([unit()]))).not.toThrow();
  });

  it("accepts a partly measured unit", () => {
    const partial = {
      ...unit(),
      measured: { percent_of_area: 24.8, basis: "land the drought monitor maps" }
    };
    const result = validateDroughtCoverage(payload([partial]));
    expect(result.units[0]!.measured?.percent_of_area).toBe(24.8);
  });

  it("refuses a block claiming the whole area is measured", () => {
    /* The writer omits the block at 100, so one that says 100 is a file
     * disagreeing with itself rather than a redundant statement. */
    const full = {
      ...unit(),
      measured: { percent_of_area: 100, basis: "land the drought monitor maps" }
    };
    expect(() => validateDroughtCoverage(payload([full]))).toThrow();
  });

  it("refuses a share with no basis to read it against", () => {
    const bare = { ...unit(), measured: { percent_of_area: 24.8 } };
    expect(() => validateDroughtCoverage(payload([bare]))).toThrow();
  });

  it("refuses a share outside nought to a hundred", () => {
    for (const percent of [-1, 101, Number.NaN]) {
      const bad = {
        ...unit(),
        measured: { percent_of_area: percent, basis: "land the monitor maps" }
      };
      expect(() => validateDroughtCoverage(payload([bad]))).toThrow();
    }
  });
});
