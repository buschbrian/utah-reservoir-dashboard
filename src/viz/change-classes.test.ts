import { describe, expect, it } from "vitest";

import { STORAGE_CLASSES, STALE_ACCENT, STALE_COLOR, CAPACITY_RING_COLOR } from "./classes";
import { DROUGHT_CLASSES } from "./drought-classes";
import { SNOW_CLASSES } from "./snow-classes";
import {
  CHANGE_CLASSES, CHANGE_EPSILON, LARGE_CHANGE_POINTS,
  changeClass, changeColor, changeLabel
} from "./change-classes";
import { CHANGE_EPSILON as MODEL_EPSILON } from "../drought-model";

function channels(hex: string): [number, number, number] {
  const digits = hex.replace("#", "");
  return [0, 2, 4].map((offset) =>
    parseInt(digits.slice(offset, offset + 2), 16)) as [number, number, number];
}

function distance(left: string, right: string): number {
  const [r1, g1, b1] = channels(left);
  const [r2, g2, b2] = channels(right);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function luminance(hex: string): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const [red, green, blue] = channels(hex);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/* Every colour this project publishes, so a new table cannot land on one.
 * The three class tables plus the storage map's three fixed inks: a grey for
 * no reading, an amber for a late ring, and the capacity outline. */
const PUBLISHED = [
  ...STORAGE_CLASSES.map((entry) => entry.color),
  ...DROUGHT_CLASSES.map((entry) => entry.color),
  ...SNOW_CLASSES.map((entry) => entry.color),
  STALE_COLOR, STALE_ACCENT, CAPACITY_RING_COLOR
];

describe("the week-over-week change table", () => {
  it("classes a signed change from the driest end down", () => {
    expect(changeClass(40)?.label).toBe("Much drier");
    expect(changeClass(LARGE_CHANGE_POINTS)?.label).toBe("Much drier");
    expect(changeClass(9.9)?.label).toBe("Drier");
    expect(changeClass(0.06)?.label).toBe("Drier");
    expect(changeClass(0)?.label).toBe("Little change");
    expect(changeClass(-0.05)?.label).toBe("Little change");
    expect(changeClass(-0.06)?.label).toBe("Wetter");
    expect(changeClass(-9.9)?.label).toBe("Wetter");
    expect(changeClass(-LARGE_CHANGE_POINTS - 0.1)?.label).toBe("Much wetter");
    expect(changeClass(-33.8)?.label).toBe("Much wetter");
  });

  /* "We did not measure this" and "this did not move" are two statements, and
   * answering the first with the middle class would draw an unmeasured area
   * as one that held steady (ADR-059). */
  it("answers a missing comparison with nothing, never with the middle", () => {
    expect(changeClass(null)).toBeNull();
    expect(changeClass(Number.NaN)).toBeNull();
    expect(changeColor(null)).toBeNull();
    expect(changeLabel(null)).toBe("No comparison");
  });

  it("says the direction in a word rather than a sign", () => {
    expect(changeLabel(3.2)).toBe("3.2 points drier");
    expect(changeLabel(-3.2)).toBe("3.2 points wetter");
    expect(changeLabel(0)).toBe("No change");
    expect(changeLabel(0.04)).toBe("No change");
  });

  /* One threshold, two modules. The map colours by this table and the counts
   * under the chart come from the model; a page whose map showed an area
   * moving while its sentence counted it as steady would be reporting two
   * different weeks. */
  it("rounds a move at the same point the model does", () => {
    expect(CHANGE_EPSILON).toBe(MODEL_EPSILON);
  });

  it("uses a distinct colour per class", () => {
    const colors = CHANGE_CLASSES.map((entry) => entry.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  /* One colour language per map, enforced across pages (ADR-032). Exact
   * matches are what caught the storage/snow overlap; a distance floor is
   * what would have caught it a shade earlier. The measured nearest is 48.7
   * -- this table's neutral grey against the storage table's palest
   * yellow-green -- so 45 is the floor with the measurement inside it. */
  it("keeps its distance from every other published colour", () => {
    for (const entry of CHANGE_CLASSES) {
      for (const other of PUBLISHED) {
        expect(distance(entry.color, other),
          `${entry.label} ${entry.color} is too near ${other}`)
          .toBeGreaterThan(45);
      }
    }
  });

  it("keeps its own classes apart", () => {
    for (let index = 0; index < CHANGE_CLASSES.length; index += 1) {
      for (let other = index + 1; other < CHANGE_CLASSES.length; other += 1) {
        expect(distance(CHANGE_CLASSES[index]!.color, CHANGE_CLASSES[other]!.color))
          .toBeGreaterThan(50);
      }
    }
  });

  /* Translucent fills over shaded relief, the same constraint the snow table
   * carries: a near-white class cannot be told from the ground and a
   * near-black one reads as the most extreme value whatever it says. */
  it("keeps every class visible as a translucent fill", () => {
    for (const entry of CHANGE_CLASSES) {
      const value = luminance(entry.color);
      expect(value, `${entry.label} is washed out`).toBeLessThan(0.8);
      expect(value, `${entry.label} is nearly black`).toBeGreaterThan(0.05);
    }
  });

  /* Diverging means symmetric: a reader comparing a 12-point rise with a
   * 12-point fall must find them the same distance from the middle. */
  it("breaks at the same distance either side of no change", () => {
    expect(CHANGE_CLASSES[0]!.min).toBe(LARGE_CHANGE_POINTS);
    expect(CHANGE_CLASSES[3]!.min).toBe(-LARGE_CHANGE_POINTS);
    expect(CHANGE_CLASSES[1]!.min).toBe(CHANGE_EPSILON);
    expect(CHANGE_CLASSES[2]!.min).toBe(-CHANGE_EPSILON);
  });
});
