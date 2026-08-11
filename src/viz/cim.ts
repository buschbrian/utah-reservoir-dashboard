/*
 * The reservoir point symbol, composed as one CIM symbol instead of two
 * stacked simple markers.
 *
 * Phase 3.2 replaces two graphics per reservoir with one feature. That only
 * works if one symbol can still say all four things the pair said: physical
 * scale (the ring), how full it is (the fill), whether the reading is old
 * (a dashed accent ring), and enough separation from the basemap to be
 * readable over water and snow (a soft shadow).
 *
 * Nothing here imports the SDK. The symbol is a plain property object the
 * renderer autocasts, which keeps this file's arithmetic testable in the
 * same node environment as `symbols.ts` -- and the radii it is built from
 * are the ones `symbols.test.ts` already holds against
 * `shared/reservoir-viz.js`. This file must not re-derive a size; it only
 * arranges the sizes it is given.
 *
 * Circles are polygons, not curves. A CIM curve ring is exact and a ring of
 * points is not, but the difference at these radii is under a tenth of a
 * pixel, and a plain coordinate list is something a test can read.
 */

import { hexToRgb } from "./color";
import type { ReservoirSymbol } from "./symbols";

/** Points around each circle. 64 keeps the widest ring smooth at 46px. */
const CIRCLE_POINTS = 64;

/** The frame every marker graphic is drawn in; `size` scales it to pixels. */
const FRAME_RADIUS = 5;

/** Alpha for the shadow under the ring, and how far it is offset. */
const SHADOW_ALPHA = 46;
const SHADOW_OFFSET = 0.5;
const SHADOW_SPREAD = 2;

/** The dash template on a late reading, in points: mark, gap. */
export const LATE_DASH: readonly [number, number] = [4, 3];

/**
 * A CIM colour is a plain `[red, green, blue, alpha]` array, every channel
 * 0-255.
 *
 * Not a `{ type: "CIMRGBColor", values: [...] }` object, which is what the
 * CIM specification describes and what this file used to build. The SDK
 * accepts only the array: handed the object it does not fail, it silently
 * falls back to a default grey, so every reservoir on the map was drawn the
 * same grey while the list beside it showed the right classes. Nothing
 * caught it -- the class table was correct, the renderer held the correct
 * colours, and the one thing that would have shown it, a screenshot, is
 * blank in headless Chromium.
 */
export type CIMColor = [number, number, number, number];

/** `#rrggbb` to the CIM colour shape. Alpha is 0-255, like the channels. */
export function cimColor(hex: string, alpha = 255): CIMColor {
  const [red, green, blue] = hexToRgb(hex);
  return [red, green, blue, alpha];
}

/** A closed ring of `CIRCLE_POINTS` coordinates at the frame radius. */
export function circleRing(radius = FRAME_RADIUS): number[][] {
  const ring: number[][] = [];
  for (let index = 0; index < CIRCLE_POINTS; index += 1) {
    const angle = (index / CIRCLE_POINTS) * Math.PI * 2;
    ring.push([
      Number((Math.cos(angle) * radius).toFixed(4)),
      Number((Math.sin(angle) * radius).toFixed(4))
    ]);
  }
  const first = ring[0];
  if (first) ring.push([first[0] ?? 0, first[1] ?? 0]);
  return ring;
}

interface CIMStroke {
  type: "CIMSolidStroke";
  enable: true;
  width: number;
  color: CIMColor;
  effects?: { type: "CIMGeometricEffectDashes"; dashTemplate: number[]; lineDashEnding: "NoConstraint" }[];
}

interface CIMFill {
  type: "CIMSolidFill";
  enable: true;
  color: CIMColor;
}

export interface CIMVectorMarker {
  type: "CIMVectorMarker";
  enable: true;
  size: number;
  offsetX?: number;
  offsetY?: number;
  frame: { xmin: number; ymin: number; xmax: number; ymax: number };
  markerGraphics: {
    type: "CIMMarkerGraphic";
    geometry: { rings: number[][][] };
    symbol: { type: "CIMPolygonSymbol"; symbolLayers: (CIMStroke | CIMFill)[] };
  }[];
}

export interface CIMSymbolReference {
  type: "cim";
  data: {
    type: "CIMSymbolReference";
    symbol: {
      type: "CIMPointSymbol";
      symbolLayers: CIMVectorMarker[];
      scaleSymbolsProportionally: false;
      respectFrame: true;
    };
  };
}

/**
 * One circle, sized in pixels. `size` is the diameter, matching what
 * `simple-marker` meant by size, so the tested radii carry over unchanged.
 */
function circleLayer(
  size: number,
  layers: (CIMStroke | CIMFill)[],
  offset?: { x: number; y: number }
): CIMVectorMarker {
  return {
    type: "CIMVectorMarker",
    enable: true,
    size,
    ...(offset ? { offsetX: offset.x, offsetY: offset.y } : {}),
    frame: {
      xmin: -FRAME_RADIUS, ymin: -FRAME_RADIUS, xmax: FRAME_RADIUS, ymax: FRAME_RADIUS
    },
    markerGraphics: [{
      type: "CIMMarkerGraphic",
      geometry: { rings: [circleRing()] },
      symbol: { type: "CIMPolygonSymbol", symbolLayers: layers }
    }]
  };
}

/**
 * The composed symbol for one reservoir.
 *
 * CIM draws the first layer in the array on top, so the array reads from
 * the front of the symbol backwards: storage fill, capacity ring, shadow.
 */
export function reservoirCIM(symbol: ReservoirSymbol): CIMSymbolReference {
  const late = symbol.accent !== null;
  const ring: CIMVectorMarker = circleLayer(symbol.ringPx, [{
    type: "CIMSolidStroke",
    enable: true,
    width: late ? 1.5 : 1,
    color: cimColor(symbol.accent ?? symbol.color),
    // A dashed ring is how both production maps say "this reading is older
    // than this reservoir's own update schedule".
    ...(late ? {
      effects: [{
        type: "CIMGeometricEffectDashes" as const,
        dashTemplate: [...LATE_DASH],
        lineDashEnding: "NoConstraint" as const
      }]
    } : {})
  }]);

  const shadow = circleLayer(
    symbol.ringPx + SHADOW_SPREAD,
    [{ type: "CIMSolidFill", enable: true, color: cimColor("#000000", SHADOW_ALPHA) }],
    { x: SHADOW_OFFSET, y: -SHADOW_OFFSET }
  );

  /* No fill at all when the percentage cannot be read. `fillSize` already
   * returns 0 there, and an empty circle would claim the reservoir is empty
   * rather than unreported. */
  const fill: CIMVectorMarker[] = symbol.fillPx > 0
    ? [circleLayer(symbol.fillPx, [
      { type: "CIMSolidFill", enable: true, color: cimColor(symbol.color) },
      { type: "CIMSolidStroke", enable: true, width: 0.75, color: cimColor("#000000", 102) }
    ])]
    : [];

  return {
    type: "cim",
    data: {
      type: "CIMSymbolReference",
      symbol: {
        type: "CIMPointSymbol",
        symbolLayers: [...fill, ring, shadow],
        scaleSymbolsProportionally: false,
        respectFrame: true
      }
    }
  };
}
