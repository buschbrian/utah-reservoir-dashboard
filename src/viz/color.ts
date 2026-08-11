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
