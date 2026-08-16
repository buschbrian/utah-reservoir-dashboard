import { describe, expect, it } from "vitest";
import { loadLegacyApi } from "../data/legacy-harness";
import {
  CAPACITY_RING_COLOR,
  STALE_COLOR,
  STORAGE_CLASSES,
  storageClass,
  storageColor
} from "./classes";
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

  it("pins the sequential palette and regular 20-point breaks", () => {
    expect(STORAGE_CLASSES).toEqual([
      { min: 0, label: "Under 20%", color: "#dde2b1" },
      { min: 20, label: "20–40%", color: "#95aa87" },
      { min: 40, label: "40–60%", color: "#698c94" },
      { min: 60, label: "60–80%", color: "#416e9d" },
      { min: 80, label: "80% and over", color: "#1b3e82" }
    ]);
    expect(STORAGE_CLASSES.map((entry) => contrastingTextColor(entry.color)))
      .toEqual(["#1c1c1c", "#1c1c1c", "#1c1c1c", "#ffffff", "#ffffff"]);
  });

  /*
   * Percent full is sequential data: one direction, nothing special in the
   * middle. It was drawn with a diverging red-to-blue ramp, which implies a
   * pivot at 50% that the quantity does not have.
   *
   * The rule that makes a sequential ramp work is monotonic luminance -- it
   * is what keeps the order readable in greyscale, and for a reader who
   * cannot separate the hues it is the only thing carrying the order at all.
   */
  it("darkens monotonically, so the order survives without colour", () => {
    const luminance = (hex: string): number => {
      const channel = (offset: number): number => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    const levels = STORAGE_CLASSES.map((entry) => luminance(entry.color));

    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]!, `${STORAGE_CLASSES[index]!.label} is not darker than the class below`)
        .toBeLessThan(levels[index - 1]!);
    }
    /* And the lightest class still has to read on a white legend card, which
     * the first sampling of this ramp did not: it came out at 0.90. */
    expect(levels[0]!).toBeLessThan(0.8);
  });

  /* The ring is the reservoir's capacity and the fill is its storage. Giving
   * the ring the storage colour conflated them, and with a pale low end it
   * made a near-empty reservoir vanish -- which is the reading this map
   * exists to show. */
  it("keeps the capacity ring out of the storage ramp", () => {
    expect(STORAGE_CLASSES.map((entry) => entry.color.toLowerCase()))
      .not.toContain(CAPACITY_RING_COLOR.toLowerCase());
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
