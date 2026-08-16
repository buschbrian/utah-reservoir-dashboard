import { describe, expect, it } from "vitest";
import { readDroughtCoverage } from "./data/payload-fixture";
import {
  areasAtOrWorse,
  bySeverity,
  coverageSegments,
  daysOld,
  isLateRelease,
  regionWorst,
  storageByArea,
  worstClass
} from "./drought-model";
import type { DroughtUnit } from "./types";

function unit(
  huc6: string, name: string,
  shares: [number, number, number, number, number, number]
): DroughtUnit {
  const [none, d0, d1, d2, d3, d4] = shares;
  return {
    huc6,
    huc6_name: name,
    percent_of_area: { none, d0, d1, d2, d3, d4 },
    percent_of_area_at_least: {
      d0: d0 + d1 + d2 + d3 + d4,
      d1: d1 + d2 + d3 + d4,
      d2: d2 + d3 + d4,
      d3: d3 + d4,
      d4
    }
  };
}

describe("freshness", () => {
  it("counts whole days since the release", () => {
    expect(daysOld("2026-08-13", new Date("2026-08-15T23:00:00Z"))).toBe(2);
    expect(daysOld("2026-08-13", new Date("2026-08-13T01:00:00Z"))).toBe(0);
  });

  it("is late only after a release has been missed", () => {
    // The monitor is weekly; nine days is one missed Thursday plus margin.
    expect(isLateRelease("2026-08-13", new Date("2026-08-22T00:00:00Z"))).toBe(false);
    expect(isLateRelease("2026-08-13", new Date("2026-08-23T00:00:00Z"))).toBe(true);
  });
});

describe("severity", () => {
  const clear = unit("160201", "Weber", [100, 0, 0, 0, 0, 0]);
  const mild = unit("160102", "Lower Bear", [0, 60, 40, 0, 0, 0]);
  const exceptional = unit("140100", "Colorado Headwaters", [0, 0, 0, 1.2, 39.1, 59.7]);
  const severe = unit("140300", "Upper Colorado-Dolores", [0, 0, 0, 84.9, 15.1, 0]);

  it("finds the worst class with any land in it", () => {
    expect(worstClass(clear)).toBeNull();
    expect(worstClass(mild)?.code).toBe("D1");
    expect(worstClass(exceptional)?.code).toBe("D4");
  });

  it("orders by the worst class before the total", () => {
    // The mild unit has more D1-or-worse land than the severe unit has
    // D3-or-worse land, but a worse class outranks a bigger total.
    const ordered = bySeverity([clear, mild, severe, exceptional]);
    expect(ordered.map((entry) => entry.huc6))
      .toEqual(["140100", "140300", "160102", "160201"]);
  });

  it("counts areas touching a class or worse", () => {
    const all = [clear, mild, severe, exceptional];
    expect(areasAtOrWorse(all, "d3")).toBe(2);
    expect(areasAtOrWorse(all, "d0")).toBe(3);
    expect(regionWorst(all)?.code).toBe("D4");
    expect(regionWorst([clear])).toBeNull();
  });
});

describe("the storage join", () => {
  it("combines storage over combined full level per drainage area", () => {
    const contexts = storageByArea([
      { huc6: "160201", current_storage_af: 30, capacity_af: 100, record_max_af: 90 },
      { huc6: "160201", current_storage_af: 20, capacity_af: null, record_max_af: 100 },
      { huc6: "140100", current_storage_af: 5, capacity_af: 10, record_max_af: 8 },
      { huc6: null, current_storage_af: 999, capacity_af: 999, record_max_af: 999 }
    ]);
    // 50 of 200: the second reservoir falls back to its recorded maximum.
    expect(contexts.get("160201")).toEqual({ percent: 25, reservoirCount: 2 });
    expect(contexts.get("140100")).toEqual({ percent: 50, reservoirCount: 1 });
    expect(contexts.has("null")).toBe(false);
    expect(contexts.size).toBe(2);
  });
});

describe("coverage segments", () => {
  it("draws only the classes with land in them, in class order", () => {
    const segments = coverageSegments(
      unit("140100", "Colorado Headwaters", [0, 0, 0, 1.2, 39.1, 59.7]));
    expect(segments.map((segment) => segment.label)).toEqual([
      "Severe drought (D2)", "Extreme drought (D3)", "Exceptional drought (D4)"
    ]);
    expect(segments.reduce((sum, segment) => sum + segment.percent, 0))
      .toBeCloseTo(100, 5);
  });

  it("keeps the clear share first with no monitor colour", () => {
    const segments = coverageSegments(unit("160201", "Weber", [70, 30, 0, 0, 0, 0]));
    expect(segments[0]).toEqual({ label: "No drought", color: null, percent: 70 });
    expect(segments[1]?.color).toBe("#ffff00");
  });
});

describe("the committed coverage through the model", () => {
  it("orders every unit and reads a worst class for the region", () => {
    const payload = readDroughtCoverage();
    const ordered = bySeverity(payload.units);
    expect(ordered.length).toBe(payload.units.length);
    // Data-independent: whatever the week looks like, the ordering must not
    // lose or invent a unit, and a region with any drought has a worst class.
    const anyDrought = payload.units.some(
      (entry) => entry.percent_of_area_at_least.d0 > 0);
    expect(regionWorst(payload.units) !== null).toBe(anyDrought);
  });
});
