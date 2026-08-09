import { describe, expect, it } from "vitest";
import { validateReservoirPayload } from "./validate";

describe("reservoir payload validation", () => {
  it("rejects a missing reservoirs array with a useful message", () => {
    expect(() => validateReservoirPayload({ generated_at: "2026-08-09" }))
      .toThrow("reservoirs array");
  });

  it("rejects a malformed record instead of allowing a blank dashboard", () => {
    expect(() => validateReservoirPayload({
      generated_at: "2026-08-09",
      start_date: "2015-01-01",
      reservoir_count: 1,
      reservoirs: [{ name: "Broken" }]
    })).toThrow("Invalid reservoir record at index 0 (Broken)");
  });
});
