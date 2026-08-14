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
 * same node environment as `symbols.ts` -- and the diameters it is built from
 * are the ones `symbols.test.ts` already holds against
 * `shared/reservoir-viz.js`. This file must not re-derive a size; it only
 * arranges the sizes it is given and converts their CSS pixels to the points
 * CIM requires.
 *
 * Circles are polygons, not curves. A CIM curve ring is exact and a ring of
 * points is not, but the difference at these radii is under a tenth of a
 * pixel, and a plain coordinate list is something a test can read.
 */

import {
  fillSizeExpression,
  ringSizeExpression,
  shadowSizeExpression
} from "./arcade";
import { hexToRgb } from "./color";
import { STALE_ACCENT } from "./classes";
import type { ReservoirSymbol } from "./symbols";
import { cssPixelsToPoints } from "./units";

/* The size every overridden marker is authored at. The value never reaches
 * the screen -- an override replaces it per feature -- but it has to be a
 * sane number so the symbol is valid before the first expression runs. */
const RING_PLACEHOLDER_PX = 20;

/** Points around each circle. 64 keeps the widest ring smooth at 36px. */
const CIRCLE_POINTS = 64;

/** The frame every marker graphic is drawn in; CIM `size` scales it in points. */
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
  /** Names the stroke so a Color override can target it. */
  primitiveName?: string;
  enable: true;
  width: number;
  color: CIMColor;
  effects?: { type: "CIMGeometricEffectDashes"; dashTemplate: number[]; lineDashEnding: "NoConstraint" }[];
}

interface CIMFill {
  type: "CIMSolidFill";
  /** Names the fill so a Color override can target it. */
  primitiveName?: string;
  enable: true;
  color: CIMColor;
}

export interface CIMVectorMarker {
  type: "CIMVectorMarker";
  /** Names the layer so a primitive override can target it. */
  primitiveName?: string;
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
 * One circle, sized in points. CIM numeric sizes do not accept CSS pixels;
 * callers convert the pixel-based application dimensions at this boundary.
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
  const ring: CIMVectorMarker = circleLayer(cssPixelsToPoints(symbol.ringPx), [{
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
    cssPixelsToPoints(symbol.ringPx + SHADOW_SPREAD),
    [{ type: "CIMSolidFill", enable: true, color: cimColor("#000000", SHADOW_ALPHA) }],
    {
      x: cssPixelsToPoints(SHADOW_OFFSET),
      y: -cssPixelsToPoints(SHADOW_OFFSET)
    }
  );

  /* No fill at all when the percentage cannot be read. `fillSize` already
   * returns 0 there, and an empty circle would claim the reservoir is empty
   * rather than unreported. */
  const fill: CIMVectorMarker[] = symbol.fillPx > 0
    ? [circleLayer(cssPixelsToPoints(symbol.fillPx), [
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


/* ------------------------------------------------------------------ */
/* The data-driven symbol                                             */
/* ------------------------------------------------------------------ */

interface PrimitiveOverride {
  type: "CIMPrimitiveOverride";
  primitiveName: string;
  propertyName: string;
  valueExpressionInfo: {
    type: "CIMExpressionInfo";
    title: string;
    expression: string;
    returnType: "Default";
  };
}

export interface CIMTemplateSymbol {
  type: "cim";
  data: {
    type: "CIMSymbolReference";
    symbol: {
      type: "CIMPointSymbol";
      symbolLayers: CIMVectorMarker[];
      scaleSymbolsProportionally: false;
      respectFrame: true;
    };
    primitiveOverrides: PrimitiveOverride[];
  };
}

function override(
  primitiveName: string, propertyName: string, title: string, expression: string
): PrimitiveOverride {
  return {
    type: "CIMPrimitiveOverride",
    primitiveName,
    propertyName,
    valueExpressionInfo: { type: "CIMExpressionInfo", title, expression, returnType: "Default" }
  };
}

function named(layer: CIMVectorMarker, primitiveName: string): CIMVectorMarker {
  return { ...layer, primitiveName };
}

/**
 * One symbol for every reservoir, with the per-feature parts expressed as
 * Arcade over the layer's own fields.
 *
 * This replaces a `UniqueValueRenderer` that held one composed symbol per
 * feature. That renderer drew correctly but cost ~35ms to assign, because
 * the SDK compiles every symbol -- and the month slider re-symbolises on
 * every frame, so it could not afford that. Here the renderer is assigned
 * once and the SDK re-reads attributes, which measures at about 4ms for the
 * same 51 features.
 *
 * `late` stays a renderer-level distinction rather than an override: the
 * dashed ring is a geometric effect on the stroke, not a scalar property,
 * and there is no primitive override for "has a dash". Two symbols is still
 * two, not fifty-one.
 */
export function reservoirCIMTemplate(
  domain: number, late: boolean, color: string
): CIMTemplateSymbol {
  const strokeColor = late ? cimColor(STALE_ACCENT) : cimColor(color);
  const ring = named(circleLayer(cssPixelsToPoints(RING_PLACEHOLDER_PX), [{
    type: "CIMSolidStroke",
    /* The colour is on the stroke, not on the marker around it. An override
     * naming the marker for "Color" does not merely miss -- it invalidates
     * the whole symbol, and the SDK then draws nothing at all rather than
     * complaining. That is how this first shipped as an empty map. */
    primitiveName: "ringStroke",
    enable: true,
    width: late ? 1.5 : 1,
    color: strokeColor,
    ...(late ? {
      effects: [{
        type: "CIMGeometricEffectDashes" as const,
        dashTemplate: [...LATE_DASH],
        lineDashEnding: "NoConstraint" as const
      }]
    } : {})
  }]), "ring");

  const shadow = named(circleLayer(
    cssPixelsToPoints(RING_PLACEHOLDER_PX + SHADOW_SPREAD),
    [{ type: "CIMSolidFill", enable: true, color: cimColor("#000000", SHADOW_ALPHA) }],
    {
      x: cssPixelsToPoints(SHADOW_OFFSET),
      y: -cssPixelsToPoints(SHADOW_OFFSET)
    }
  ), "shadow");

  const fill = named(circleLayer(cssPixelsToPoints(RING_PLACEHOLDER_PX), [
    { type: "CIMSolidFill", enable: true, color: cimColor(color) },
    { type: "CIMSolidStroke", enable: true, width: 0.75, color: cimColor("#000000", 102) }
  ]), "fill");

  /* Size only. A `Color` override was tried here and does not work: pointed
   * at the marker it invalidates the symbol, and pointed at the fill inside
   * the marker graphic it still does -- either way the SDK draws nothing at
   * all rather than reporting a problem, which is how this first shipped as
   * an empty map. Colour is a renderer key instead, which is why this
   * function takes one. */
  const overrides: PrimitiveOverride[] = [
    override("ring", "Size", "Capacity ring", ringSizeExpression(domain)),
    override("shadow", "Size", "Shadow", shadowSizeExpression(domain, SHADOW_SPREAD)),
    override("fill", "Size", "Storage fill", fillSizeExpression(domain))
  ];

  return {
    type: "cim",
    data: {
      type: "CIMSymbolReference",
      symbol: {
        type: "CIMPointSymbol",
        symbolLayers: [fill, ring, shadow],
        scaleSymbolsProportionally: false,
        respectFrame: true
      },
      primitiveOverrides: overrides
    }
  };
}
