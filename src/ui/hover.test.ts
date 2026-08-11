import { describe, expect, it } from "vitest";
import { hoverPosition } from "./hover";

describe("hoverPosition", () => {
  it("keeps the card inside the map at every edge", () => {
    expect(hoverPosition({ x: 500, y: 300 }, { width: 480, height: 260 },
      { width: 180, height: 56 })).toEqual({ left: 292, top: 196 });
    expect(hoverPosition({ x: -20, y: -30 }, { width: 480, height: 260 },
      { width: 180, height: 56 })).toEqual({ left: 8, top: 8 });
  });
});
