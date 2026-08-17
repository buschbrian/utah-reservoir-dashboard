/*
 * The stored divider position.
 *
 * Everything here is about refusing a bad value. What comes out of storage is
 * a string anybody can edit, and it may have been measured against a window
 * that no longer exists. The failure it guards is a page opening with the map
 * or the table invisible and no obvious way back.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_SPLIT, MIN_SPLIT, formatSplit, parseSplit, splitHeight
} from "./split";

describe("reading a stored split", () => {
  it("takes a fraction inside the range", () => {
    expect(parseSplit("0.45")).toBe(0.45);
    expect(parseSplit(String(MIN_SPLIT))).toBe(MIN_SPLIT);
    expect(parseSplit(String(MAX_SPLIT))).toBe(MAX_SPLIT);
    expect(parseSplit(" 0.5 ")).toBe(0.5);
  });

  it("refuses anything that would hide a pane", () => {
    expect(parseSplit("0.01")).toBeNull();
    expect(parseSplit("0.95")).toBeNull();
    expect(parseSplit("1")).toBeNull();
    expect(parseSplit("0")).toBeNull();
    expect(parseSplit("-0.5")).toBeNull();
  });

  it("refuses anything that is not a plain number", () => {
    expect(parseSplit(null)).toBeNull();
    expect(parseSplit(undefined)).toBeNull();
    expect(parseSplit("")).toBeNull();
    expect(parseSplit("   ")).toBeNull();
    expect(parseSplit("half")).toBeNull();
    expect(parseSplit("NaN")).toBeNull();
    expect(parseSplit("Infinity")).toBeNull();
  });

  /* Pixels are exactly what this does not keep, and `Number("420px")` is NaN
   * only because of the suffix -- a looser check would read "0.42px" as a
   * fraction and a stricter reading of "420" as pixels would be worse. */
  it("refuses a length that was stored as pixels", () => {
    expect(parseSplit("420px")).toBeNull();
    expect(parseSplit("0.42px")).toBeNull();
    expect(parseSplit("42%")).toBeNull();
    expect(parseSplit("45vh")).toBeNull();
  });
});

describe("writing a split back", () => {
  it("keeps a position the reader chose, to a thousandth", () => {
    expect(formatSplit(0.42)).toBe("0.420");
    expect(parseSplit(formatSplit(0.4237) as string)).toBeCloseTo(0.424, 3);
  });

  /* Null rather than a clamped value: a fraction outside the range is a
   * window resize or a corrupt entry, not a preference worth rescuing, and
   * storing a clamped version would open the next visit somewhere nobody
   * chose. The caller removes the entry instead. */
  it("refuses a position outside the range rather than clamping it", () => {
    expect(formatSplit(0.99)).toBeNull();
    expect(formatSplit(0.01)).toBeNull();
    expect(formatSplit(Number.NaN)).toBeNull();
    expect(formatSplit(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("round trips every position it agrees to keep", () => {
    for (const fraction of [MIN_SPLIT, 0.25, 0.5, 0.664, MAX_SPLIT]) {
      const stored = formatSplit(fraction);
      expect(stored, `${fraction} should be storable`).not.toBeNull();
      expect(parseSplit(stored)).toBeCloseTo(fraction, 3);
    }
  });
});

describe("applying a split", () => {
  /* A viewport unit, not pixels: the fraction is stored against the window it
   * was set in and has to mean the same share of a different one. */
  it("is a share of the viewport", () => {
    expect(splitHeight(0.42)).toBe("42.0vh");
    expect(splitHeight(0.5)).toBe("50.0vh");
  });
});
