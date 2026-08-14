/*
 * One hex reader, because three renderers need the same colours in three
 * different shapes and none of them takes `#rrggbb`.
 *
 * The class table writes colours as hex (ADR-008), and a CIM symbol wants
 * `[r, g, b, alpha 0-100]`. Parsing the same string in two files is how a
 * symbol ends up a shade off the table it is drawn from.
 */

/** `#rrggbb` to its three channels. Throws rather than guessing: a colour
 * that cannot be read is a bug in the table, not something to paint black. */
export function hexToRgb(hex: string): [number, number, number] {
  const digits = hex.replace("#", "");
  const value = Number.parseInt(digits, 16);
  if (digits.length !== 6 || !Number.isFinite(value)) {
    throw new Error(`A symbol colour must be #rrggbb, received "${hex}"`);
  }
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Black or white text, whichever has the stronger WCAG contrast with a fill. */
export function contrastingTextColor(hex: string): "#1c1c1c" | "#ffffff" {
  const luminance = hexToRgb(hex)
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
  /* 0.179 is the point where black and white have equal contrast. Choosing
   * the stronger of the two also gives every colour in the pinned ramp at
   * least 4.5:1 for the counts placed on the overview's class strip. */
  return luminance > 0.179 ? "#1c1c1c" : "#ffffff";
}
