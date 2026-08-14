/*
 * The Arcade a CIM symbol reads each feature's attributes with.
 *
 * Every expression here is GENERATED from the same constants the TypeScript
 * arithmetic uses -- `RING_MIN_PX`, `RING_MAX_PX`, and the storage class
 * table. None of the numbers or colours is typed into a string by hand.
 *
 * That generation is the whole point. The legacy ArcGIS page built its
 * renderer from a string-concatenated Arcade expression that existed twice,
 * once per renderer, so a typo in either copy showed up as slightly-wrong
 * circles and never as an error -- which is why `symbols.ts` was written as
 * plain arithmetic in the first place. Bringing Arcade back is a deliberate
 * trade: the SDK re-symbolises 51 features from attributes in about 4ms and
 * needs 35ms to recompile 51 per-feature symbols, and a month slider that
 * re-symbolises on every frame cannot afford the second. The mitigation is
 * that no human writes the numbers, and `arcade.test.ts` asserts every
 * break and every colour in the generated text came from the table.
 */

import { STALE_COLOR, STORAGE_CLASSES } from "./classes";
import { hexToRgb } from "./color";
import { RING_MAX_PX, RING_MIN_PX } from "./symbols";

/** The attribute names the expressions read. Kept beside the expressions so
 * a field rename breaks here rather than silently drawing nothing. */
export const SIZE_BASIS_FIELD = "size_basis";
export const FILL_PERCENT_FIELD = "fill_percent";

function colorLiteral(hex: string, alpha = 255): string {
  const [red, green, blue] = hexToRgb(hex);
  return `[${red}, ${green}, ${blue}, ${alpha}]`;
}

/**
 * The zoom term.
 *
 * Every size below is multiplied by this. Without it the circles are a fixed
 * pixel size at every zoom, which is what made close reservoirs unreadable:
 * at the opening extent Trial Lake's centre is 0px from Washington Lake's,
 * and Lost Lake's is 1px away, so two reservoirs were drawn entirely inside
 * a third and no draw order could reveal them. Zooming in did not help,
 * because zooming in did not make the circles any bigger relative to the
 * ground -- it only moved identical circles further apart in a slower way
 * than the map itself was scaling.
 *
 * Square root rather than a straight ratio, so the circles grow noticeably
 * without doubling every time the reader zooms one level.
 *
 * The floor is 1, not a fraction: this term may enlarge a circle and may
 * never shrink one. The opening scale is not a constant -- the extent is
 * fixed but the scale that shows it depends on the viewport, measured at
 * 8.4 million on a 1280px window and 23.6 million on a 360px phone. Any
 * floor below 1 therefore shrinks the symbols on exactly the screens where
 * they are hardest to hit, to solve a crowding problem that is worst on the
 * screens where they are easiest to hit. The ceiling stops Lake Powell
 * covering a county at street level.
 *
 * `REFERENCE_SCALE` is the measured desktop opening scale, so a 1280px
 * window opens at a factor of exactly 1 and every narrower one is held there
 * by the floor. Every view therefore starts with the circles it has always
 * had, and `symbols.ts` -- which the legacy parity tests hold to
 * `reservoir-viz.js` -- stays the arithmetic for all of them. The two
 * comparison maps have no zoom term and are not getting one; see ADR-022.
 */
export const REFERENCE_SCALE = 8_400_000;
export const MIN_ZOOM_FACTOR = 1;
export const MAX_ZOOM_FACTOR = 3;

function zoomFactorLines(): string[] {
  return [
    "var vs = $view.scale;",
    "var k = 1;",
    `if (!IsEmpty(vs) && vs > 0) { k = Sqrt(${REFERENCE_SCALE} / vs); }`,
    `if (k < ${MIN_ZOOM_FACTOR}) { k = ${MIN_ZOOM_FACTOR}; }`,
    `if (k > ${MAX_ZOOM_FACTOR}) { k = ${MAX_ZOOM_FACTOR}; }`
  ];
}

/**
 * The factor the expressions apply, in TypeScript, so a test can hold the
 * two to the same rule rather than reading the generated Arcade back.
 */
export function zoomFactor(viewScale: number): number {
  if (!Number.isFinite(viewScale) || viewScale <= 0) return 1;
  return Math.min(MAX_ZOOM_FACTOR,
    Math.max(MIN_ZOOM_FACTOR, Math.sqrt(REFERENCE_SCALE / viewScale)));
}

/**
 * The ring diameter, in the same square-root domain `ringSize` uses.
 *
 * `domain` is baked in as a literal because it is one number for the whole
 * drawn set -- it changes only when the set does, and the renderer is
 * rebuilt then anyway.
 */
export function ringSizeExpression(domain: number): string {
  const span = RING_MAX_PX - RING_MIN_PX;
  return [
    ...zoomFactorLines(),
    `var basis = $feature.${SIZE_BASIS_FIELD};`,
    `if (IsEmpty(basis) || basis <= 0) { return ${RING_MIN_PX} * k; }`,
    `var share = Min(1, Sqrt(basis) / ${domain});`,
    `return (${RING_MIN_PX} + share * ${span}) * k;`
  ].join("\n");
}

/**
 * The fill diameter: a fraction of *this* reservoir's ring, square-rooted so
 * the circle's area carries the percentage. Zero when the percentage cannot
 * be read, because an empty circle would claim the reservoir is empty rather
 * than unreported.
 */
export function fillSizeExpression(domain: number): string {
  const span = RING_MAX_PX - RING_MIN_PX;
  return [
    ...zoomFactorLines(),
    `var pct = $feature.${FILL_PERCENT_FIELD};`,
    "if (IsEmpty(pct)) { return 0; }",
    `var basis = $feature.${SIZE_BASIS_FIELD};`,
    `var ring = ${RING_MIN_PX};`,
    `if (!IsEmpty(basis) && basis > 0) {`,
    `  ring = ${RING_MIN_PX} + Min(1, Sqrt(basis) / ${domain}) * ${span};`,
    "}",
    "return ring * k * Sqrt(Min(100, Max(0, pct)) / 100);"
  ].join("\n");
}

/**
 * The shadow sits just outside the ring, so it follows the same size.
 *
 * The spread is scaled with everything else rather than added afterwards: a
 * constant 2px halo around a circle three times its opening size reads as a
 * hairline, and around a circle at the floor it reads as a second ring.
 */
export function shadowSizeExpression(domain: number, spread: number): string {
  return ringSizeExpression(domain).replace(
    `return (${RING_MIN_PX} + share * ${RING_MAX_PX - RING_MIN_PX}) * k;`,
    `return (${RING_MIN_PX} + share * ${RING_MAX_PX - RING_MIN_PX} + ${spread}) * k;`
  );
}

/**
 * The storage class colour, written from the table in descending order so
 * the first matching break wins -- the same order `storageClass` walks it.
 */
export function storageColorExpression(alpha = 255): string {
  const lines = [`var pct = $feature.${FILL_PERCENT_FIELD};`,
    `if (IsEmpty(pct)) { return ${colorLiteral(STALE_COLOR, alpha)}; }`];
  for (let index = STORAGE_CLASSES.length - 1; index >= 0; index -= 1) {
    const entry = STORAGE_CLASSES[index];
    if (!entry) continue;
    lines.push(index === 0
      ? `return ${colorLiteral(entry.color, alpha)};`
      : `if (pct >= ${entry.min}) { return ${colorLiteral(entry.color, alpha)}; }`);
  }
  return lines.join("\n");
}
