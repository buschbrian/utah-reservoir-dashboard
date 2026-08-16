import { describe, expect, it } from "vitest";
import { STORAGE_CLASSES } from "./classes";
import { DROUGHT_CLASSES } from "./drought-classes";
import { SNOW_CLASSES, snowClassIndex } from "./snow-classes";

describe("the snow class table", () => {
  it("covers zero upward with no gaps and one open top", () => {
    expect(SNOW_CLASSES[0]!.min).toBe(0);
    for (let index = 1; index < SNOW_CLASSES.length; index += 1) {
      expect(SNOW_CLASSES[index]!.min).toBe(SNOW_CLASSES[index - 1]!.max);
    }
    expect(SNOW_CLASSES[SNOW_CLASSES.length - 1]!.max).toBeNull();
  });

  it("uses a distinct colour per class", () => {
    const colors = SNOW_CLASSES.map((entry) => entry.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("classes a percent by inclusive lower bound", () => {
    expect(snowClassIndex(0)).toBe(0);
    expect(snowClassIndex(24.9)).toBe(0);
    expect(snowClassIndex(25)).toBe(1);
    expect(snowClassIndex(49.9)).toBe(1);
    expect(snowClassIndex(50)).toBe(2);
    expect(snowClassIndex(74.9)).toBe(2);
    expect(snowClassIndex(75)).toBe(3);
    expect(snowClassIndex(89.9)).toBe(3);
    expect(snowClassIndex(90)).toBe(4);
    expect(snowClassIndex(110)).toBe(5);
    expect(snowClassIndex(400)).toBe(5);
  });

  /* The four thresholds the measuring service reports against are kept
   * exactly; the fifth exists only to split a bottom class that held 62% of
   * every published basin-day. Losing one of the four would make this map
   * incomparable with the agency's own. */
  it("keeps the four thresholds the measuring service publishes", () => {
    const breaks = SNOW_CLASSES.map((entry) => entry.min);
    for (const conventional of [50, 75, 90, 110]) {
      expect(breaks, `${conventional}% is a published threshold`)
        .toContain(conventional);
    }
  });

  it("returns null for a missing value, never a colour", () => {
    expect(snowClassIndex(null)).toBeNull();
    expect(snowClassIndex(Number.NaN)).toBeNull();
    expect(snowClassIndex(-1)).toBeNull();
  });

  /* One colour language per map, enforced across pages rather than only
   * within one. This is a regression test for a real overlap: snow used to
   * draw a hand-picked five-class RdYlBu while storage drew Esri's Blue and
   * Red 9, and `#fdae61` and `#abd9e9` were byte-identical in both tables --
   * so two maps of two unrelated quantities coloured them the same. Nothing
   * caught it, because each table was internally consistent.
   */
  it("shares no colour with the storage or drought tables", () => {
    const snow = new Set(SNOW_CLASSES.map((entry) => entry.color.toLowerCase()));
    for (const entry of STORAGE_CLASSES) {
      expect(snow, `storage ${entry.color} is also a snow class`)
        .not.toContain(entry.color.toLowerCase());
    }
    for (const entry of DROUGHT_CLASSES) {
      expect(snow, `drought ${entry.color} is also a snow class`)
        .not.toContain(entry.color.toLowerCase());
    }
  });

  /* These are translucent fills over a shaded-relief basemap. A class that is
   * nearly white cannot be told from the grey that means "no value for this
   * day", and one that is nearly black reads as the most extreme reading
   * whatever it actually says. */
  it("keeps every class visible as a translucent fill", () => {
    const luminance = (hex: string): number => {
      const channel = (offset: number): number => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    for (const entry of SNOW_CLASSES) {
      const value = luminance(entry.color);
      expect(value, `${entry.label} (${entry.color}) is washed out`).toBeLessThan(0.8);
      expect(value, `${entry.label} (${entry.color}) is nearly black`).toBeGreaterThan(0.05);
    }
  });
});
