import { describe, expect, it } from "vitest";
import { loadLegacyApi } from "../data/legacy-harness";
import { STALE_COLOR, STORAGE_CLASSES, storageClass, storageColor } from "./classes";
import { contrastingTextColor } from "./color";

const legacy = loadLegacyApi();

describe("storage classes", () => {
  it.each([
    [0, "Under 20%"], [19.99, "Under 20%"], [20, "20–40%"],
    [40, "40–60%"], [60, "60–80%"], [80, "80% and over"],
    [104, "80% and over"]
  ])("classifies %s at the shared boundary", (percent, label) => {
    expect(storageClass(percent)?.label).toBe(label);
  });

  it("pins the accessible palette and regular 20-point breaks", () => {
    expect(STORAGE_CLASSES).toEqual([
      { min: 0, label: "Under 20%", color: "#d7191c" },
      { min: 20, label: "20–40%", color: "#fdae61" },
      { min: 40, label: "40–60%", color: "#ffffbf" },
      { min: 60, label: "60–80%", color: "#abd9e9" },
      { min: 80, label: "80% and over", color: "#2c7bb6" }
    ]);
    expect(STORAGE_CLASSES.map((entry) => contrastingTextColor(entry.color)))
      .toEqual(["#ffffff", "#1c1c1c", "#1c1c1c", "#1c1c1c", "#1c1c1c"]);
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
