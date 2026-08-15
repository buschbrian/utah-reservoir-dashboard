import { describe, expect, it } from "vitest";
import type { MonthlyRecord } from "../types";
import { loadLegacyApi } from "./legacy-harness";
import {
  assignHuc, coverageReport, drainageLabelPoint, monthlyRollupByHuc, rollupByHuc,
  type HucMember, type HucUnit
} from "./huc";

/** A unit square with its lower-left corner at (x, y). */
function square(huc6: string, name: string, x: number, y: number): HucUnit {
  return {
    huc6, name, states: "UT",
    polygons: [[[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]]]
  };
}

function month(name: string, mean: number | null, normal: number | null = null): MonthlyRecord {
  return { month: name, mean_af: mean, min_af: null, max_af: null, end_af: null, days: 30, normal_af: normal };
}

function member(over: Partial<HucMember> & { name: string }): HucMember {
  return { current_storage_af: 0, record_max_af: 0, ...over };
}

describe("assignHuc", () => {
  const units = [square("140100", "Colorado Headwaters", 0, 0), square("160202", "Great Salt Lake", 1, 0)];

  it("finds the unit containing the point", () => {
    expect(assignHuc([0.5, 0.5], units)?.huc6).toBe("140100");
    expect(assignHuc([1.5, 0.5], units)?.huc6).toBe("160202");
  });

  it("returns null outside every unit rather than guessing the nearest", () => {
    expect(assignHuc([9, 9], units)).toBeNull();
  });

  it("excludes a point inside a hole", () => {
    const donut: HucUnit = {
      huc6: "140300", name: "Donut", states: "UT",
      polygons: [[
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]
      ]]
    };
    expect(assignHuc([0.5, 0.5], [donut])?.huc6).toBe("140300");
    expect(assignHuc([2, 2], [donut])).toBeNull();
  });

  it("handles a unit made of several polygons", () => {
    const split: HucUnit = {
      huc6: "140801", name: "Split", states: "UT,CO",
      polygons: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]]
      ]
    };
    expect(assignHuc([5.5, 5.5], [split])?.huc6).toBe("140801");
  });

  /* The reason the assignment uses the dam point and not the water polygon's
   * centre: a reservoir straddling a boundary would otherwise land in
   * whichever unit holds more of its surface, which is not where its water
   * leaves. */
  it("assigns a cross-border reservoir by its outlet, not its extent", () => {
    const outletInSecondUnit = 1.01;
    expect(assignHuc([outletInSecondUnit, 0.5], units)?.name).toBe("Great Salt Lake");
  });
});

describe("drainageLabelPoint", () => {
  it("keeps the label inside a concave area when its centroid falls outside", () => {
    const area: HucUnit = {
      huc6: "140100", name: "L shape", states: "UT",
      polygons: [[[[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]]]]
    };
    const point = drainageLabelPoint(area.polygons);
    expect(point).not.toBeNull();
    expect(assignHuc(point as [number, number], [area])).toBe(area);
  });

  it("does not put the label inside a polygon hole", () => {
    const area: HucUnit = {
      huc6: "140300", name: "Donut", states: "UT",
      polygons: [[
        [[0, 0], [6, 0], [6, 6], [0, 6], [0, 0]],
        [[1, 1], [5, 1], [5, 5], [1, 5], [1, 1]]
      ]]
    };
    const point = drainageLabelPoint(area.polygons);
    expect(point).not.toBeNull();
    expect(assignHuc(point as [number, number], [area])).toBe(area);
  });

  it("uses the largest part of a multipart area", () => {
    const polygons: HucUnit["polygons"] = [
      [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      [[[10, 0], [14, 0], [14, 4], [10, 4], [10, 0]]]
    ];
    expect(drainageLabelPoint(polygons)?.[0]).toBeGreaterThan(10);
  });
});

describe("published HUC6 scope", () => {
  it("excludes the Pacific Northwest region from legacy live-service queries", () => {
    expect(loadLegacyApi().HUC6_WHERE).toContain("huc6 NOT LIKE '17%'");
  });
});

describe("rollupByHuc", () => {
  it("weights by capacity, not by reservoir count", () => {
    const [unit] = rollupByHuc([
      member({ name: "Big", huc6: "140100", huc6_name: "Colorado Headwaters", current_storage_af: 500_000, capacity_af: 1_000_000 }),
      member({ name: "Small", huc6: "140100", current_storage_af: 100, capacity_af: 100 })
    ]);
    // Naive averaging of 50% and 100% would say 75%.
    expect(unit?.percentFull).toBeCloseTo(500_100 / 1_000_100 * 100, 10);
    expect(unit?.count).toBe(2);
    expect(unit?.name).toBe("Colorado Headwaters");
  });

  it("falls back to the highest recorded storage when capacity is missing", () => {
    const [unit] = rollupByHuc([
      member({ name: "No capacity", huc6: "160202", current_storage_af: 40, capacity_af: null, record_max_af: 100 })
    ]);
    expect(unit?.capacityAf).toBe(100);
    expect(unit?.percentFull).toBe(40);
    expect(unit?.withoutCapacity).toBe(0);
  });

  it("counts a site with no denominator at all instead of dividing by zero", () => {
    const [unit] = rollupByHuc([
      member({ name: "Unknown", huc6: "160202", current_storage_af: 0, capacity_af: null, record_max_af: 0 })
    ]);
    expect(unit?.percentFull).toBeNull();
    expect(unit?.withoutCapacity).toBe(1);
    expect(unit?.count).toBe(1);
  });

  it("removes a duplicate site rather than counting its water twice", () => {
    const [unit] = rollupByHuc([
      member({ name: "Flaming Gorge", huc6: "140401", current_storage_af: 100, capacity_af: 200 }),
      member({ name: " flaming gorge ", huc6: "140401", current_storage_af: 100, capacity_af: 200 })
    ]);
    expect(unit?.count).toBe(1);
    expect(unit?.storageAf).toBe(100);
    expect(unit?.capacityAf).toBe(200);
  });

  it("leaves unassigned sites out of every unit", () => {
    const units = rollupByHuc([
      member({ name: "Assigned", huc6: "140100", current_storage_af: 1, capacity_af: 2 }),
      member({ name: "Unassigned", huc6: null, current_storage_af: 9, capacity_af: 9 }),
      member({ name: "Blank", current_storage_af: 9, capacity_af: 9 })
    ]);
    expect(units).toHaveLength(1);
    expect(units[0]?.storageAf).toBe(1);
  });

  it("orders units by combined capacity, largest first", () => {
    const units = rollupByHuc([
      member({ name: "Little", huc6: "160202", current_storage_af: 1, capacity_af: 10 }),
      member({ name: "Large", huc6: "140700", current_storage_af: 1, capacity_af: 1000 })
    ]);
    expect(units.map((unit) => unit.huc6)).toEqual(["140700", "160202"]);
  });
});

describe("monthlyRollupByHuc", () => {
  it("sums a month every reservoir reported", () => {
    const points = monthlyRollupByHuc([
      member({ name: "A", huc6: "140100", monthly: [month("2026-07", 100, 120)] }),
      member({ name: "B", huc6: "140100", monthly: [month("2026-07", 50, 60)] })
    ]).get("140100");
    expect(points?.[0]).toMatchObject({ month: "2026-07", meanAf: 150, normalAf: 180, covered: 2, count: 2 });
  });

  /* The rule this module exists to enforce. Two of three reservoirs
   * reporting is a two-thirds total, and drawn on a chart it is a drought
   * that did not happen. */
  it("shows a gap rather than a partial total", () => {
    const points = monthlyRollupByHuc([
      member({ name: "A", huc6: "140100", monthly: [month("2026-06", 100), month("2026-07", 100)] }),
      member({ name: "B", huc6: "140100", monthly: [month("2026-06", 50), month("2026-07", null)] })
    ]).get("140100");
    expect(points?.map((point) => [point.month, point.meanAf, point.covered]))
      .toEqual([["2026-06", 150, 2], ["2026-07", null, 1]]);
  });

  it("treats a month one reservoir never published as uncovered", () => {
    const points = monthlyRollupByHuc([
      member({ name: "Long record", huc6: "140100", monthly: [month("2026-05", 10), month("2026-06", 10)] }),
      member({ name: "Short record", huc6: "140100", monthly: [month("2026-06", 10)] })
    ]).get("140100");
    expect(points?.[0]).toMatchObject({ month: "2026-05", meanAf: null, covered: 1, count: 2 });
    expect(points?.[1]?.meanAf).toBe(20);
  });

  it("keeps the normal separate: full storage coverage, partial normals", () => {
    const points = monthlyRollupByHuc([
      member({ name: "A", huc6: "140100", monthly: [month("2026-07", 100, 120)] }),
      member({ name: "B", huc6: "140100", monthly: [month("2026-07", 50, null)] })
    ]).get("140100");
    expect(points?.[0]?.meanAf).toBe(150);
    expect(points?.[0]?.normalAf).toBeNull();
  });
});

describe("coverageReport", () => {
  it("says why each site landed where it did", () => {
    expect(coverageReport([
      member({ name: "In", huc6: "140100", current_storage_af: 1, capacity_af: 2 }),
      member({ name: "Out", huc6: null }),
      member({ name: "No capacity", huc6: "140100" })
    ])).toEqual([
      { name: "In", huc6: "140100", result: "assigned", reason: "assigned by its dam or outlet point" },
      { name: "Out", huc6: null, result: "unassigned", reason: "no dam or outlet point fell inside a published unit" },
      { name: "No capacity", huc6: "140100", result: "assigned", reason: "assigned, but it adds no capacity to the unit total" }
    ]);
  });
});
