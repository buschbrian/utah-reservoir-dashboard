import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statewideRollup, percentFull, isLateForCadence } from "./rollup";
import { validateReservoirPayload } from "./validate";

const payload = validateReservoirPayload(JSON.parse(
  readFileSync(new URL("../../reservoirs.json", import.meta.url), "utf8")
) as unknown);

describe("statewide rollup", () => {
  it("matches the legacy all-reservoir rollup on the published data", () => {
    const result = statewideRollup(payload.reservoirs);
    expect(result.count).toBe(53);
    expect(result.percentFull).toBeCloseTo(31.650341807851355, 10);
    expect(result.classes.reduce((total, entry) => total + entry.count, 0)).toBe(53);
  });

  it("makes excluding Lake Powell an explicit aggregation option", () => {
    const result = statewideRollup(payload.reservoirs, { excludeLakePowell: true });
    expect(result.count).toBe(52);
    expect(result.percentFull).toBeCloseTo(59.419257921469146, 10);
  });

  it("uses capacity and falls back to record max", () => {
    const reservoir = payload.reservoirs.find((entry) => entry.name === "Utah Lake");
    expect(reservoir).toBeDefined();
    if (!reservoir) return;
    expect(percentFull(reservoir)).toBeCloseTo(
      reservoir.current_storage_af / (reservoir.capacity_af ?? reservoir.record_max_af) * 100
    );
    expect(percentFull({ ...reservoir, capacity_af: null })).toBeCloseTo(
      reservoir.current_storage_af / reservoir.record_max_af * 100
    );
  });

  it("applies each record's daily or monthly freshness contract", () => {
    const monthly = payload.reservoirs.find((entry) => entry.data_frequency === "monthly");
    const daily = payload.reservoirs.find((entry) => entry.data_frequency === "daily");
    expect(monthly).toBeDefined();
    expect(daily).toBeDefined();
    if (!monthly || !daily) return;
    expect(isLateForCadence({ ...monthly, days_stale: 44, fetch_ok: true })).toBe(false);
    expect(isLateForCadence({ ...monthly, days_stale: 46, fetch_ok: true })).toBe(true);
    expect(isLateForCadence({ ...daily, days_stale: 2, fetch_ok: true })).toBe(false);
    expect(isLateForCadence({ ...daily, days_stale: 3, fetch_ok: true })).toBe(true);
  });
});
