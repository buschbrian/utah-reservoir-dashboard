import { describe, expect, it } from "vitest";
import { POINTS_PER_CSS_PIXEL, cssPixelsToPoints } from "./units";

describe("ArcGIS symbol units", () => {
  it("converts the CSS reference density to typographic points", () => {
    expect(POINTS_PER_CSS_PIXEL).toBe(0.75);
    expect(cssPixelsToPoints(36)).toBe(27);
  });
});
