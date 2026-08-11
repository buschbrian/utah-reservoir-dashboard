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
 * The ring diameter, in the same square-root domain `ringSize` uses.
 *
 * `domain` is baked in as a literal because it is one number for the whole
 * drawn set -- it changes only when the set does, and the renderer is
 * rebuilt then anyway.
 */
export function ringSizeExpression(domain: number): string {
  const span = RING_MAX_PX - RING_MIN_PX;
  return [
    `var basis = $feature.${SIZE_BASIS_FIELD};`,
    `if (IsEmpty(basis) || basis <= 0) { return ${RING_MIN_PX}; }`,
    `var share = Min(1, Sqrt(basis) / ${domain});`,
    `return ${RING_MIN_PX} + share * ${span};`
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
    `var pct = $feature.${FILL_PERCENT_FIELD};`,
    "if (IsEmpty(pct)) { return 0; }",
    `var basis = $feature.${SIZE_BASIS_FIELD};`,
    `var ring = ${RING_MIN_PX};`,
    `if (!IsEmpty(basis) && basis > 0) {`,
    `  ring = ${RING_MIN_PX} + Min(1, Sqrt(basis) / ${domain}) * ${span};`,
    "}",
    "return ring * Sqrt(Min(100, Max(0, pct)) / 100);"
  ].join("\n");
}

/** The shadow sits just outside the ring, so it follows the same size. */
export function shadowSizeExpression(domain: number, spread: number): string {
  return `${ringSizeExpression(domain)}`.replace(
    `return ${RING_MIN_PX} + share * ${RING_MAX_PX - RING_MIN_PX};`,
    `return ${RING_MIN_PX} + share * ${RING_MAX_PX - RING_MIN_PX} + ${spread};`
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
