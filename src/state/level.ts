/*
 * The `?level=` parameter, shared by all three maps.
 *
 * One parameter across the storage, snow and drought views, the same way
 * `?area=` is one: the three maps exist to be compared by flipping between
 * them (ADR-007), and a reader who has chosen subregions on one and lands on
 * another drawn in basins has been given two answers to one question.
 *
 * It carries the digit count -- `?level=4` -- rather than a word, because
 * that is the number every published payload states in its own `level` field
 * and the one `data.html` documents. A reader who sees it in the address bar
 * can look it up.
 *
 * The default is the absence of the parameter, never `level=6`: a shared link
 * should carry what the reader changed and nothing else.
 */
import { DEFAULT_LEVEL, JOINABLE_LEVELS } from "../data/boundaries";

/**
 * The level a search string asks for, or the default.
 *
 * `offered` is what the export actually publishes a roster for, so a link to
 * a level this site has stopped offering opens the map it has rather than an
 * empty one. Absent, the levels the figures exist at are the test -- which is
 * what a caller has before the reference export has loaded.
 */
export function levelFromSearch(
  search: string, offered: readonly number[] = JOINABLE_LEVELS
): number {
  const value = new URLSearchParams(search).get("level");
  if (value === null) return DEFAULT_LEVEL;
  const level = Number(value);
  return Number.isInteger(level) && offered.includes(level) ? level : DEFAULT_LEVEL;
}

/** Write the level into a parameter set, or clear it when it is the default. */
export function writeLevel(params: URLSearchParams, level: number): void {
  if (level === DEFAULT_LEVEL) params.delete("level");
  else params.set("level", String(level));
}

/** What the control calls each level. Never the code: "HUC-4" is the kind of
 * vocabulary ADR-006 keeps off the page, and "subregion" is the word this
 * site already uses for the same thing in the storage filters. */
export const LEVEL_LABELS: Readonly<Record<number, string>> = {
  2: "Regions",
  4: "Subregions",
  6: "Basins"
};

export function levelLabel(level: number): string {
  return LEVEL_LABELS[level] ?? `Areas of ${level} digits`;
}
