export interface HoverPoint { x: number; y: number }
export interface HoverSize { width: number; height: number }

const GAP = 8;
const POINTER_OFFSET = 12;

/** Positions a pointer card inside its map stage, including at every edge. */
export function hoverPosition(
  point: HoverPoint,
  stage: HoverSize,
  card: HoverSize
): { left: number; top: number } {
  return {
    left: Math.max(GAP, Math.min(point.x + POINTER_OFFSET, stage.width - card.width - GAP)),
    top: Math.max(GAP, Math.min(point.y + POINTER_OFFSET, stage.height - card.height - GAP))
  };
}
