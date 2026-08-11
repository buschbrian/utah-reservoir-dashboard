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

  it("aggregates each drainage area without losing storage", () => {
    const records = watershedRecords(reservoirs);
    expect(records.length).toBeGreaterThan(1);
    expect(records.reduce((sum, record) => sum + record.storageAf, 0))
      .toBeCloseTo(reservoirs.reduce((sum, reservoir) => sum + reservoir.current_storage_af, 0));
  });
});
