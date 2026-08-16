import { describe, expect, it } from "vitest";
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
    expect(snowClassIndex(49.9)).toBe(0);
    expect(snowClassIndex(50)).toBe(1);
    expect(snowClassIndex(89.9)).toBe(2);
    expect(snowClassIndex(90)).toBe(3);
    expect(snowClassIndex(110)).toBe(4);
    expect(snowClassIndex(400)).toBe(4);
  });

  it("returns null for a missing value, never a colour", () => {
    expect(snowClassIndex(null)).toBeNull();
    expect(snowClassIndex(Number.NaN)).toBeNull();
    expect(snowClassIndex(-1)).toBeNull();
  });
});
