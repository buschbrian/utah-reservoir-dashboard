/**
 * ArcGIS CIM marker dimensions are points, while this application's symbol
 * arithmetic is deliberately expressed in CSS pixels. At the CSS reference
 * density, 96 pixels occupy 72 points.
 */
export const POINTS_PER_CSS_PIXEL = 72 / 96;

export function cssPixelsToPoints(pixels: number): number {
  return pixels * POINTS_PER_CSS_PIXEL;
}
