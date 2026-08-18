import { describe, expect, it } from "vitest";
import { readDroughtCoverage } from "./data/payload-fixture";
import {
  areasAtOrWorse,
  bySeverity,
  coverageSegments,
  daysOld,
  isLateRelease,
  DRYNESS_CLASS,
  orderUnits,
  regionWorst,
  shareAtOrWorse,
  byStorageGap,
  storageAgainstDrought,
  storageByArea,
  worstClassCounts,
  unitsAtOrWorse,
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
      (entry) => shareAtOrWorse(entry, "d0") > 0);
    expect(regionWorst(payload.units) !== null).toBe(anyDrought);
  });
});

/* ------------------------------------------------------------------ */
/* Filtering, ordering, and the join                                   */
/* ------------------------------------------------------------------ */

const dry = unit("140100", "Colorado Headwaters", [0, 5, 10, 15, 10, 60]);
const middling = unit("160202", "Jordan", [10, 30, 40, 20, 0, 0]);
const clear = unit("160300", "Escalante Desert", [100, 0, 0, 0, 0, 0]);
const areas = [middling, dry, clear];

describe("narrowing the areas by severity", () => {
  it("keeps every area when no class is chosen", () => {
    expect(unitsAtOrWorse(areas, null)).toHaveLength(3);
  });

  it("keeps the areas with any land at that class or worse", () => {
    expect(unitsAtOrWorse(areas, "d4").map((entry) => entry.huc6)).toEqual(["140100"]);
    expect(unitsAtOrWorse(areas, "d2").map((entry) => entry.huc6))
      .toEqual(["160202", "140100"]);
  });

  /* "Any land at this class or worse" is the monitor's own severity
   * judgment. An area entirely free of drought has no D0 land, so it drops
   * out of the D0 filter -- which is why "every area" is a separate state
   * rather than the same thing as choosing the mildest class. */
  it("drops an area with no drought at all from even the mildest class", () => {
    expect(unitsAtOrWorse(areas, "d0").map((entry) => entry.huc6))
      .not.toContain("160300");
    expect(unitsAtOrWorse(areas, null).map((entry) => entry.huc6))
      .toContain("160300");
  });

  it("reads the published cumulative share rather than re-summing it", () => {
    expect(shareAtOrWorse(dry, "d2")).toBe(dry.percent_of_area_at_least?.d2);
  });
});

describe("ordering the areas", () => {
  const storage = new Map([
    ["140100", { percent: 80, reservoirCount: 4 }],
    ["160202", { percent: 20, reservoirCount: 2 }]
  ]);

  it("defaults to the severity order the page already published", () => {
    expect(orderUnits(areas, storage, "severity")).toEqual(bySeverity(areas));
  });

  it("orders by name", () => {
    expect(orderUnits(areas, storage, "name").map((entry) => entry.huc6_name))
      .toEqual(["Colorado Headwaters", "Escalante Desert", "Jordan"]);
  });

  /* Emptiest first, because the question this ordering answers is "where is
   * the water running out". An area with no reading sorts last rather than
   * as zero: "no reading" is not "empty", and putting it at the top would
   * make the page open on the least informative row. */
  it("orders by storage, emptiest first, with unknown readings last", () => {
    expect(orderUnits(areas, storage, "storage").map((entry) => entry.huc6))
      .toEqual(["160202", "140100", "160300"]);
  });

  it("orders by name when no storage is available at all", () => {
    expect(orderUnits(areas, null, "storage").map((entry) => entry.huc6_name))
      .toEqual(["Colorado Headwaters", "Escalante Desert", "Jordan"]);
  });
});

describe("land conditions against banked water", () => {
  const storage = new Map([
    ["140100", { percent: 80, reservoirCount: 4 }],
    ["160202", { percent: 20, reservoirCount: 2 }],
    ["160300", { percent: null, reservoirCount: 0 }]
  ]);

  it("plots one point per area with a reading, on the two published figures", () => {
    const points = storageAgainstDrought(areas, storage);

    expect(points.map((point) => point.huc6)).toEqual(["160202", "140100"]);
    const headwaters = points.find((point) => point.huc6 === "140100")!;
    expect(headwaters.storagePercent).toBe(80);
    expect(headwaters.dryPercent).toBe(shareAtOrWorse(dry, DRYNESS_CLASS));
    expect(headwaters.worst?.key).toBe("d4");
  });

  /* Left out, never drawn at zero: an area with no reservoirs in it is not
   * an area whose reservoirs are empty, and a point on the floor of the
   * chart would state the second. */
  it("leaves out an area with no reservoir reading rather than plotting zero", () => {
    const points = storageAgainstDrought(areas, storage);

    expect(points.map((point) => point.huc6)).not.toContain("160300");
    expect(points.every((point) => point.storagePercent !== null)).toBe(true);
  });

  it("plots nothing at all when the reservoir payload could not be read", () => {
    expect(storageAgainstDrought(areas, null)).toEqual([]);
  });
});

describe("how the areas are divided by severity", () => {
  const areas = [
    unit("A", "Clear", [100, 0, 0, 0, 0, 0]),
    unit("B", "Abnormal", [60, 40, 0, 0, 0, 0]),
    unit("C", "Also abnormal", [70, 30, 0, 0, 0, 0]),
    unit("D", "Exceptional", [0, 20, 20, 20, 20, 20])
  ];

  it("counts each area once, at the worst class with land in it", () => {
    const counts = worstClassCounts(areas, "No drought");
    const at = (label: string): number =>
      counts.find((entry) => entry.label.startsWith(label))?.count ?? -1;

    expect(at("No drought")).toBe(1);
    expect(at("Abnormally dry")).toBe(2);
    expect(at("Exceptional")).toBe(1);
    /* Once each, so the bars account for every area exactly. An area with
     * land at four classes belongs to its worst one only. */
    expect(counts.reduce((sum, entry) => sum + entry.count, 0)).toBe(areas.length);
  });

  it("keeps the levels nothing is at, so two weeks can be compared", () => {
    const counts = worstClassCounts(areas, "No drought");
    // One bucket for no drought, plus every published class.
    expect(counts).toHaveLength(6);
    expect(counts.some((entry) => entry.count === 0)).toBe(true);
  });

  it("takes its colours from the class table and leaves 'none' without one", () => {
    const counts = worstClassCounts(areas, "No drought");
    expect(counts[0]?.color).toBeNull();
    expect(counts.slice(1).every((entry) => typeof entry.color === "string")).toBe(true);
  });

  it("counts nothing when there are no areas, and still offers every level", () => {
    const counts = worstClassCounts([], "No drought");
    expect(counts.every((entry) => entry.count === 0)).toBe(true);
    expect(counts).toHaveLength(6);
  });
});

describe("ranking dry land against banked water", () => {
  const points = [
    { huc6: "A", name: "Cushioned", dryPercent: 20, storagePercent: 90,
      reservoirCount: 3, worst: null },
    { huc6: "B", name: "Squeezed", dryPercent: 95, storagePercent: 15,
      reservoirCount: 2, worst: null },
    { huc6: "C", name: "Level", dryPercent: 50, storagePercent: 50,
      reservoirCount: 1, worst: null }
  ];

  it("puts the areas with the least water against the most dry land first", () => {
    expect(byStorageGap(points).map((row) => row.name))
      .toEqual(["Squeezed", "Level", "Cushioned"]);
  });

  it("keeps both published figures beside the distance", () => {
    const worst = byStorageGap(points)[0]!;
    /* The distance ranks the rows and sets the length of the line drawn
     * between them. Both real values survive, because the difference of two
     * shares with different denominators is not a quantity and the chart
     * never prints it. */
    expect(worst.dryPercent).toBe(95);
    expect(worst.storagePercent).toBe(15);
    expect(worst.gap).toBe(-80);
  });

  it("settles an exact tie by name rather than by input order", () => {
    const tied = [
      { huc6: "Z", name: "Zebra", dryPercent: 40, storagePercent: 40,
        reservoirCount: 1, worst: null },
      { huc6: "A", name: "Antelope", dryPercent: 10, storagePercent: 10,
        reservoirCount: 1, worst: null }
    ];
    expect(byStorageGap(tied).map((row) => row.name)).toEqual(["Antelope", "Zebra"]);
  });

  it("ranks nothing when nothing could be joined", () => {
    expect(byStorageGap([])).toEqual([]);
  });
});
