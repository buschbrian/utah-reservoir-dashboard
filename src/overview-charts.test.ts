import { describe, expect, it } from "vitest";
import { readPayload } from "./data/payload-fixture";
import { largestReservoirRecords, watershedRecords } from "./overview-model";

const reservoirs = readPayload().reservoirs.filter((reservoir) => reservoir.name !== "Lake Powell");

describe("overview chart records", () => {
  it("limits the reservoir chart and orders it by capacity", () => {
    const records = largestReservoirRecords(reservoirs, 5);
    expect(records).toHaveLength(5);
    expect(records.every((record, index) => index === 0
      || (records[index - 1]?.capacityAf ?? 0) >= record.capacityAf)).toBe(true);
  });

  it("uses stored acre-feet for the bar length when that measure is selected", () => {
    const records = largestReservoirRecords(reservoirs, {
      limit: 5,
      measure: "storage",
      rank: "name"
    });

    expect(records.every((record) => record.percent === record.storageAf)).toBe(true);
    expect(records.map((record) => record.label))
      .toEqual([...records.map((record) => record.label)].sort());
  });

  it("aggregates each drainage area without losing storage", () => {
    const records = watershedRecords(reservoirs);
    expect(records.length).toBeGreaterThan(1);
    expect(records.reduce((sum, record) => sum + record.storageAf, 0))
      .toBeCloseTo(reservoirs.reduce((sum, reservoir) => sum + reservoir.current_storage_af, 0));
  });

  /*
   * The hover rows are a contract between two surfaces: the chart tooltip
   * shows what the details panel would say, phrased by the same helpers.
   * These assertions read each row against the payload's own fields rather
   * than any number, so a morning refresh cannot fail them -- only a change
   * that severs a row from its fact can.
   */
  it("carries per-reservoir hover detail beside the reservoir's own facts", () => {
    const byName = new Map(reservoirs.map((r) => [r.name, r]));
    for (const record of largestReservoirRecords(reservoirs, { limit: 20 })) {
      const source = byName.get(record.label);
      expect(source, `${record.label} must trace to a payload record`).toBeDefined();
      expect(record.detail?.fullLevel).toMatch(/acre-feet/);
      // Present exactly when the fact is; absent means "no such row", never "".
      if (source!.seasonal_percentile !== null) {
        expect(record.detail?.historyRank).toBeTruthy();
      } else {
        expect(record.detail?.historyRank).toBeUndefined();
      }
      if (source!.change_30d_af !== null) {
        expect(record.detail?.change30d?.value).toBeTruthy();
        expect(record.detail?.change30d?.label).toContain("Change in");
      } else {
        expect(record.detail?.change30d).toBeUndefined();
      }
    }
  });

  it("gives a drainage area a count and none of one reservoir's private facts", () => {
    const records = watershedRecords(reservoirs);
    // Every reservoir answers in exactly one group, so the counts sum.
    expect(records.reduce((sum, record) => sum + (record.detail?.reservoirCount ?? 0), 0))
      .toBe(reservoirs.length);
    for (const record of records) {
      expect(record.detail?.reservoirCount).toBeGreaterThan(0);
      expect(record.detail?.historyRank).toBeUndefined();
      expect(record.detail?.change30d).toBeUndefined();
      expect(record.detail?.countyState).toBeUndefined();
    }
  });
});
