/* Arcade is back in the renderer, and the reason it was removed is on
 * record: the legacy page kept the same expression twice as concatenated
 * strings, so a typo drew slightly-wrong circles and never raised an error.
 * These tests exist to make that failure mode impossible -- every number and
 * every colour in the generated text is checked against the table or the
 * constant it must have come from, so an expression cannot quietly stop
 * agreeing with the arithmetic in `symbols.ts`. */
import { describe, expect, it } from "vitest";
import {
  FILL_PERCENT_FIELD,
  MAX_ZOOM_FACTOR,
  MIN_ZOOM_FACTOR,
  REFERENCE_SCALE,
  SIZE_BASIS_FIELD,
  fillSizeExpression,
  ringSizeExpression,
  shadowSizeExpression,
  storageColorExpression,
  zoomFactor
} from "./arcade";
import { STALE_COLOR, STORAGE_CLASSES } from "./classes";
import { hexToRgb } from "./color";
import { RING_MAX_PX, RING_MIN_PX } from "./symbols";

const DOMAIN = 5000;
const rgb = (hex: string): string => {
  const [red, green, blue] = hexToRgb(hex);
  return `[${red}, ${green}, ${blue}, 255]`;
};

describe("the colour expression", () => {
  const expression = storageColorExpression();

  it("writes every class colour from the table, and no other colour", () => {
    for (const entry of STORAGE_CLASSES) {
      expect(expression, entry.label).toContain(rgb(entry.color));
    }
    expect(expression).toContain(rgb(STALE_COLOR));
    // Every colour literal in the text must be one the table put there.
    const allowed = new Set([...STORAGE_CLASSES.map((e) => rgb(e.color)), rgb(STALE_COLOR)]);
    const found = expression.match(/\[\d+, \d+, \d+, \d+\]/g) ?? [];
    expect(found.length).toBeGreaterThan(0);
    for (const literal of found) expect(allowed, literal).toContain(literal);
  });

  it("tests the breaks highest first, so the first match is the right class", () => {
    // Table order is ascending by `min`; the text must be the reverse of it,
    // because Arcade returns on the first branch that matches.
    const positions = STORAGE_CLASSES.slice(1)
      .map((entry) => expression.indexOf(`pct >= ${entry.min}`));
    for (const position of positions) expect(position).toBeGreaterThan(-1);
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index] ?? 0, `break ${STORAGE_CLASSES[index + 1]?.min} is out of order`)
        .toBeLessThan(positions[index - 1] ?? 0);
    }
  });

  it("answers grey for a reservoir with no readable percentage", () => {
    expect(expression).toMatch(new RegExp(
      `IsEmpty\\(pct\\)[^\\n]*return \\[${hexToRgb(STALE_COLOR).join(", ")}, 255\\]`));
  });

  it("reads the field the layer actually carries", () => {
    expect(expression).toContain(`$feature.${FILL_PERCENT_FIELD}`);
  });
});

describe("the size expressions", () => {
  it("carry the tested ring bounds rather than numbers of their own", () => {
    const ring = ringSizeExpression(DOMAIN);
    expect(ring).toContain(String(RING_MIN_PX));
    expect(ring).toContain(String(RING_MAX_PX - RING_MIN_PX));
    expect(ring).toContain(`$feature.${SIZE_BASIS_FIELD}`);
    expect(ring).toContain(String(DOMAIN));
  });

  it("float the domain in, because it belongs to the drawn set", () => {
    expect(ringSizeExpression(1234)).toContain("1234");
    expect(ringSizeExpression(1234)).not.toContain(String(DOMAIN));
  });

  it("give a reservoir with no size basis the smallest ring, not nothing", () => {
    expect(ringSizeExpression(DOMAIN)).toMatch(
      new RegExp(`IsEmpty\\(basis\\)[^\\n]*return ${RING_MIN_PX}`));
  });

  it("draw no fill at all when the percentage cannot be read", () => {
    expect(fillSizeExpression(DOMAIN)).toMatch(/IsEmpty\(pct\)[^\n]*return 0/);
  });

  it("square-root the fraction, so area carries the percentage", () => {
    // The same rule `fillSize` implements: ring * sqrt(clamped / 100).
    expect(fillSizeExpression(DOMAIN))
      .toContain("Sqrt(Min(100, Max(0, pct)) / 100)");
  });

  it("put the shadow outside the ring by the spread it is given", () => {
    const shadow = shadowSizeExpression(DOMAIN, 2);
    expect(shadow).toContain(`* ${RING_MAX_PX - RING_MIN_PX} + 2`);
    expect(shadow).not.toBe(ringSizeExpression(DOMAIN));
  });

  /* The zoom term. Every size expression has to carry it, or the parts of
   * one symbol scale against each other -- a ring that grows around a fill
   * that does not is a reservoir that appears to empty as the reader zooms
   * in. */
  it("scale every size with the view, ring, fill and shadow alike", () => {
    for (const expression of [ringSizeExpression(DOMAIN), fillSizeExpression(DOMAIN),
      shadowSizeExpression(DOMAIN, 2)]) {
      expect(expression).toContain("$view.scale");
      expect(expression).toContain(String(REFERENCE_SCALE));
      expect(expression).toMatch(/\* k\b/);
    }
  });

  it("leave the opening scale exactly as the shared module draws it", () => {
    /* The factor is 1 at the reference scale, which is why the parity tests
     * in symbols.test.ts still hold `symbols.ts` to `reservoir-viz.js`:
     * the arithmetic there is this map at that scale (ADR-022). */
    expect(zoomFactor(REFERENCE_SCALE)).toBe(1);
  });

  it("clamp at both ends, so a circle is never smaller than today or a county wide", () => {
    expect(zoomFactor(1)).toBe(MAX_ZOOM_FACTOR);
    // A view that has not settled yet reports no usable scale.
    expect(zoomFactor(0)).toBe(1);
    expect(zoomFactor(Number.NaN)).toBe(1);
  });

  it("grows the circles when zooming in and never shrinks them going out", () => {
    expect(zoomFactor(REFERENCE_SCALE / 4)).toBeCloseTo(2, 6);
    /* The measured opening scales: 1280px opens at the reference, and the
     * two phone widths open wider than it. None of them may come out below
     * 1 -- this term is allowed to enlarge a symbol and never to shrink one,
     * which is what keeps a circle tappable on the smallest screen. */
    expect(MIN_ZOOM_FACTOR).toBe(1);
    for (const openingScale of [8_416_703, 21_746_566, 23_558_780]) {
      expect(zoomFactor(openingScale), `opening scale ${openingScale}`).toBe(1);
    }
  });
});
