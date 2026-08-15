/*
 * A continuous red-yellow-blue gradient for marks that vary by value rather
 * than by storage class -- a histogram bin or a drainage area is not "40-60%
 * full," so it has no `STORAGE_CLASSES` colour to draw from, but it should
 * still read as part of the same warm-to-cool family the rest of the page
 * uses (ADR-008).
 *
 * Generated once with poline (https://meodai.github.io/poline/), anchored on
 * this app's own five ColorBrewer stops (`STORAGE_CLASSES`) so the two ends
 * and the middle land on colours already in use elsewhere on the page.
 * Poline interpolates hue by angle, and pale yellow to pale blue is a short
 * hue sweep straight through green -- a colour `STORAGE_CLASSES` deliberately
 * never uses -- so three low-saturation anchors were added between them to
 * pull the path across the grey axis instead, the way a diverging
 * ColorBrewer scale desaturates through near-white rather than rotating hue.
 * Not the same curve ColorBrewer draws; the same family.
 *
 * Fixed rather than computed at runtime: the point of choosing this from
 * poline was to pick one sweep and hold it steady, not to regenerate a
 * slightly different one on every page load.
 */
const GRADIENT_STOPS: readonly string[] = [
  "#d7191c", "#ea3317", "#f05926", "#f57936", "#f99147", "#fba155", "#fdab5e",
  "#fdae61", "#fdb162", "#fdb965", "#fec76b", "#fed777", "#fee889", "#fff6a1",
  "#ffffbf", "#f9f7c9", "#f4f2d2", "#f1efda", "#efede0", "#eeece5", "#edece7",
  "#edece8", "#e7e6e1", "#d6d5cb", "#bcbdae", "#9fa693", "#919f8e", "#abb7ae",
  "#e4e7e6", "#c5cdcb", "#b5c1c1", "#b5bfc2", "#c0c7cc", "#ced2d8", "#d9dce1",
  "#dddfe4", "#dbdee4", "#d7dbe2", "#d0d7e1", "#c7d3e0", "#bdd1e1", "#b3d3e4",
  "#abd9e9", "#8bc9e1", "#6cb8da", "#50a7d3", "#3a97ce", "#3088c3", "#2d7eb9",
  "#2c7bb6"
];

/**
 * `count` colours sampled evenly along the gradient, low to high.
 *
 * Nearest-stop sampling rather than interpolating between them: fifty fixed
 * stops is already finer than any count this page asks for, so the two are
 * visually indistinguishable and there is no colour-space blend to get
 * wrong for a difference nobody would see.
 */
export function gradientColors(count: number): string[] {
  const last = GRADIENT_STOPS.length - 1;
  if (count <= 1) return [GRADIENT_STOPS[last] ?? "#2c7bb6"];
  return Array.from({ length: count }, (_, index) => {
    const stop = Math.round((index / (count - 1)) * last);
    return GRADIENT_STOPS[stop] ?? GRADIENT_STOPS[last] ?? "#2c7bb6";
  });
}
