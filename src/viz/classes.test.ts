import { describe, expect, it } from "vitest";
import { loadLegacyApi } from "../data/legacy-harness";
import { STALE_COLOR, STORAGE_CLASSES, storageClass, storageColor } from "./classes";

const legacy = loadLegacyApi();

describe("storage classes", () => {
  it.each([
    [0, "Under 25%"], [24.99, "Under 25%"], [25, "25–50%"],
    [50, "50–75%"], [75, "75–90%"], [90, "Over 90%"]
  ])("classifies %s at the shared boundary", (percent, label) => {
    expect(storageClass(percent)?.label).toBe(label);
  });

  it("does not invent a class for missing data", () => {
    expect(storageClass(null)).toBeNull();
    expect(storageClass(Number.NaN)).toBeNull();
  });

  /* The single-source-of-truth guard. Breaks, colors and labels are read by
   * both map engines, the legend, the charts and the table; this is the
   * assertion that keeps the new dashboard drawing the same map as the
   * pages still in production.
   */
  it("is the legacy break table, value for value", () => {
    expect(STORAGE_CLASSES.map((entry) => ({ ...entry })))
      .toEqual(legacy.CLASSES.map((entry) => ({
        min: entry.min, label: entry.label, color: entry.color
      })));
  });

  it("falls back to the legacy grey when the percentage is unknown", () => {
    expect(storageColor(null)).toBe(STALE_COLOR);
    expect(storageColor(12)).toBe(legacy.colorFor(12));
    expect(storageColor(null)).toBe(legacy.colorFor(null));
  });
});
