import { describe, expect, it } from "vitest";

import { describeRanking, rankingRecords } from "./ranking";
import type { TableRow } from "./table";
import { STORAGE_CLASSES, storageClass } from "../viz/classes";

function row(name: string, percent: number | null, overrides: Partial<TableRow> = {}): TableRow {
  return {
    name,
    percent,
    storageAf: 1000,
    capacityAf: 2000,
    areaName: "Great Salt Lake",
    late: false,
    reading: "2026-08-01",
    ...overrides
  };
}

describe("ranking chart records", () => {
  it("ranks lowest percentage first, with the name breaking ties", () => {
    const records = rankingRecords([
      row("Bravo", 55.2),
      row("Alpha", 12.4),
      row("Delta", 55.2),
      row("Charlie", 98)
    ]);

    expect(records.map((record) => record.label))
      .toEqual(["Alpha", "Bravo", "Delta", "Charlie"]);
    expect(records.map((record) => record.id)).toEqual([1, 2, 3, 4]);
  });

  it("leaves out a reservoir with no readable percentage instead of ranking it at zero", () => {
    const records = rankingRecords([
      row("Known", 40),
      row("Unknown", null),
      row("Broken", Number.NaN)
    ]);

    expect(records.map((record) => record.label)).toEqual(["Known"]);
  });

  it("colors every bar from the class table (ADR-008)", () => {
    const records = rankingRecords(
      STORAGE_CLASSES.map((entry, index) => row(`Reservoir ${index}`, entry.min + 5)));

    for (const record of records) {
      const expected = storageClass(record.percent);
      expect(record.classColor).toBe(expected?.color);
      expect(record.classLabel).toBe(expected?.label);
    }
    // Five records straddling the five classes exercise the whole table.
    expect(new Set(records.map((record) => record.classColor)).size)
      .toBe(STORAGE_CLASSES.length);
  });

  it("computes the class from the same rounded value the bar's length uses", () => {
    // 19.96 rounds to 20.0, which is the next class up. Length and colour
    // must make the same claim, so both come from the rounded value.
    const [record] = rankingRecords([row("Edge", 19.96)]);
    expect(record?.percent).toBe(20);
    expect(record?.classColor).toBe(storageClass(20)?.color);
  });

  it("says how many reservoirs are ranked whenever some are not", () => {
    expect(describeRanking(51, 51)).toContain("All 51 reservoirs");
    const partial = describeRanking(48, 51);
    expect(partial).toContain("48 of 51 reservoirs");
    expect(partial).toContain("not ranked");
  });
});
