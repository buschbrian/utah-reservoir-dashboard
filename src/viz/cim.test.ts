/* The composed CIM symbol has to carry exactly what the two simple markers
 * carried. These assertions are against `reservoirSymbol` -- which
 * symbols.test.ts holds against `shared/reservoir-viz.js` -- and never
 * against a literal radius, so a morning's data refresh cannot fail them. */
import { describe, expect, it } from "vitest";
import { readPayload } from "../data/payload-fixture";
import { STALE_ACCENT } from "./classes";
import { LATE_DASH, cimColor, circleRing, reservoirCIM } from "./cim";
import { reservoirSymbol, sizeDomain } from "./symbols";
import { cssPixelsToPoints } from "./units";

const reservoirs = readPayload().reservoirs;
const domain = sizeDomain(reservoirs);

function layersOf(symbol: ReturnType<typeof reservoirCIM>) {
  return symbol.data.symbol.symbolLayers;
}

describe("CIM colour", () => {
  /* A plain `[r, g, b, a]` array, every channel 0-255, which is the shape
   * the SDK's own documentation uses. This was written as the specification's
   * `{ type: "CIMRGBColor", values: [...] }` object first; the SDK accepts
   * only the array and silently falls back to grey rather than failing, so
   * every reservoir drew the same grey while every test passed. The shape is
   * pinned here because the thing that would show it -- a screenshot -- is
   * blank in headless Chromium. */
  it("is a four-number array, not the specification's colour object", () => {
    const color = cimColor("#a50026");
    expect(Array.isArray(color)).toBe(true);
    expect(color).toHaveLength(4);
    for (const channel of color) expect(typeof channel).toBe("number");
  });

  it("splits #rrggbb into channels, with alpha on the same 0-255 scale", () => {
    expect(cimColor("#a50026")).toEqual([165, 0, 38, 255]);
    expect(cimColor("#000000", 46)).toEqual([0, 0, 0, 46]);
  });

  it("refuses a colour it cannot read rather than drawing black", () => {
    expect(() => cimColor("red")).toThrow();
    expect(() => cimColor("#fff")).toThrow();
  });
});

describe("circle geometry", () => {
  it("closes the ring on its first point", () => {
    const ring = circleRing();
    expect(ring.at(-1)).toEqual(ring[0]);
  });

  it("stays on the frame radius", () => {
    for (const [x = 0, y = 0] of circleRing()) {
      expect(Math.hypot(x, y)).toBeCloseTo(5, 3);
    }
  });
});

describe("the composed reservoir symbol", () => {
  it("draws every published reservoir at its tested ring size", () => {
    for (const reservoir of reservoirs) {
      const symbol = reservoirSymbol(reservoir, domain);
      const layers = layersOf(reservoirCIM(symbol));
      const ring = layers.find((layer) => layer.markerGraphics[0]?.symbol
        .symbolLayers.some((part) => part.type === "CIMSolidStroke" && part.width >= 1));
      expect(ring?.size).toBe(cssPixelsToPoints(symbol.ringPx));
    }
  });

  it("gives every symbol layer a colour the SDK can read", () => {
    for (const reservoir of reservoirs) {
      const symbol = reservoirSymbol(reservoir, domain);
      for (const layer of layersOf(reservoirCIM(symbol))) {
        for (const part of layer.markerGraphics[0]?.symbol.symbolLayers ?? []) {
          expect(Array.isArray(part.color), `${reservoir.name} ${part.type}`).toBe(true);
          expect(part.color).toHaveLength(4);
        }
      }
    }
  });

  it("draws the storage fill at its tested size and class colour", () => {
    const withFill = reservoirs
      .map((reservoir) => reservoirSymbol(reservoir, domain))
      .filter((symbol) => symbol.fillPx > 0);
    expect(withFill.length).toBeGreaterThan(0);

    for (const symbol of withFill) {
      const [fill] = layersOf(reservoirCIM(symbol));
      expect(fill?.size).toBe(cssPixelsToPoints(symbol.fillPx));
      const solid = fill?.markerGraphics[0]?.symbol.symbolLayers[0];
      expect(solid).toEqual({
        type: "CIMSolidFill",
        enable: true,
        color: cimColor(symbol.color)
      });
    }
  });

  it("omits the fill entirely when the percentage cannot be read", () => {
    const symbol = { ringPx: 20, fillPx: 0, color: "#9e9e9e", accent: null };
    const layers = layersOf(reservoirCIM(symbol));
    expect(layers).toHaveLength(2);
    expect(layers.some((layer) => layer.size < cssPixelsToPoints(20))).toBe(false);
  });

  it("dashes the ring in the late-data accent, and only then", () => {
    const late = reservoirCIM({ ringPx: 20, fillPx: 10, color: "#1a9850", accent: STALE_ACCENT });
    const lateStroke = layersOf(late)[1]?.markerGraphics[0]?.symbol.symbolLayers[0];
    expect(lateStroke).toMatchObject({
      color: cimColor(STALE_ACCENT),
      effects: [{ type: "CIMGeometricEffectDashes", dashTemplate: [...LATE_DASH] }]
    });

    const current = reservoirCIM({ ringPx: 20, fillPx: 10, color: "#1a9850", accent: null });
    const stroke = layersOf(current)[1]?.markerGraphics[0]?.symbol.symbolLayers[0];
    expect(stroke).toMatchObject({ color: cimColor("#1a9850") });
    expect(stroke).not.toHaveProperty("effects");
  });

  it("puts the shadow under the ring, never over the fill", () => {
    const layers = layersOf(reservoirCIM(
      { ringPx: 20, fillPx: 14, color: "#1a9850", accent: null }));
    expect(layers).toHaveLength(3);
    expect(layers[2]?.size).toBeGreaterThan(layers[1]?.size ?? 0);
    expect(layers[2]?.offsetX).toBeDefined();
  });

  it("keeps the marker frame square so the circles are not ovals", () => {
    for (const layer of layersOf(reservoirCIM(
      { ringPx: 33, fillPx: 12, color: "#fdae61", accent: null }))) {
      const { xmin, xmax, ymin, ymax } = layer.frame;
      expect(xmax - xmin).toBe(ymax - ymin);
    }
  });
});
