import { describe, expect, it } from "vitest";
import { gradientColors } from "./gradient";

const HEX = /^#[0-9a-f]{6}$/;

describe("gradient sampling", () => {
  it("starts red and ends blue, matching the storage class ramp's ends", () => {
    const colors = gradientColors(10);
    expect(colors).toHaveLength(10);
    expect(colors[0]).toBe("#d7191c");
    expect(colors.at(-1)).toBe("#2c7bb6");
  });

  it("returns every colour as a valid #rrggbb string", () => {
    for (const color of gradientColors(14)) expect(color).toMatch(HEX);
  });

  it("returns distinct colours for a small count", () => {
    const colors = gradientColors(5);
    expect(new Set(colors).size).toBe(5);
  });

  it("falls back to the last stop for a degenerate count", () => {
    expect(gradientColors(1)).toEqual(["#2c7bb6"]);
    expect(gradientColors(0)).toEqual(["#2c7bb6"]);
  });
});
