/*
 * Where the reader put the divider between the map and the table row.
 *
 * ## Why this is not in the address bar
 *
 * Every other piece of view state on this site is a URL parameter, because
 * the address bar describes the view and a link should open what the sender
 * was looking at. This one is deliberately not, for two reasons.
 *
 * It is not part of the view. A selection, a filter, a month and a comparison
 * period all change *what the reader is being shown*; a divider changes how
 * much room two panes get. Sending someone a link to Deer Creek should not
 * also impose the sender's pane sizes on them.
 *
 * And it does not travel. A split is only meaningful against the height it
 * was set in, so a position from a 27-inch screen means something else on a
 * laptop and nothing at all on a phone, where the two panes do not share a
 * screen in the first place.
 *
 * So it is a preference, kept the way the theme is. It is held as a
 * **fraction of the available height** rather than as pixels, so it survives
 * moving between screens.
 *
 * No browser API here, which is the same division `state/url.ts` draws: the
 * parsing is the part most likely to be wrong about a hand-edited or
 * left-over value, and it is only testable at all if it takes a string and
 * returns a number. The storage half is four lines in `ui/shell.ts`.
 */

/**
 * The range a stored split may claim.
 *
 * These are not the drag limits -- the shell panel enforces those from its
 * own computed minimum and maximum. They are a sanity range for a value
 * coming back out of storage, which anyone can edit and which may have been
 * measured against a window that no longer exists. They keep a corrupt entry
 * from opening the page with the map or the table invisible.
 */
export const MIN_SPLIT = 0.1;
export const MAX_SPLIT = 0.8;

/** A stored value to a usable fraction, or null when there is nothing usable. */
export function parseSplit(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  /* `Number("")` is 0 and `Number("420px")` is NaN, but neither is a
   * fraction anybody stored on purpose, so the shape is checked before the
   * value. Pixels are exactly what this does not keep, and a stored "420px"
   * must never become 420. */
  if (!/^-?\d*\.?\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_SPLIT || value > MAX_SPLIT) return null;
  return value;
}

/**
 * A fraction to the string that gets stored, or null when it should not be.
 *
 * Null rather than a clamped value: a fraction outside the range is a window
 * resize or a corrupt entry, not a preference worth rescuing, and storing a
 * clamped version of it would open the next visit somewhere nobody chose.
 * The caller removes the entry when this answers null.
 */
export function formatSplit(fraction: number): string | null {
  if (!Number.isFinite(fraction)) return null;
  if (fraction < MIN_SPLIT || fraction > MAX_SPLIT) return null;
  return fraction.toFixed(3);
}

/** The split as a CSS length the shell panel's height property understands. */
export function splitHeight(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}vh`;
}
