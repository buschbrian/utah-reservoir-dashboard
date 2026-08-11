/*
 * The selection as a link, and a link as a selection.
 *
 * A port of `selectionFromSearch` / `searchWithSelection` from
 * `shared/reservoir-viz.js`, held against it character for character in
 * `url.test.ts`. That parity is the whole point: `?reservoir=Deer+Creek`
 * opens Deer Creek on `explore.html`, on both production maps, and now
 * here, or "share this view" is a promise the dashboard keeps on three
 * pages out of four.
 *
 * No browser API in the parsing half. The reading and writing are the parts
 * most likely to be wrong about a name with a space or an apostrophe in it
 * -- "Ken's Lake", "Smith and Morehouse" -- and they are only testable at
 * all if they take a string and return one. The DOM half is
 * `connectSelectionToUrl`, at the bottom, and it is four lines.
 */

import { normalizeSelectionValue, type SelectionStore } from "./selection";

/** Field name -> query parameter. One entry; the table is what makes the
 * second one a line rather than a refactor. */
const SELECTION_PARAMS = { reservoir: "reservoir" } as const;
type SelectionField = keyof typeof SELECTION_PARAMS;
const SELECTION_FIELDS = Object.keys(SELECTION_PARAMS) as SelectionField[];

/**
 * `URLSearchParams` is deliberately not used. It writes a space as `+`
 * where `explore.html` writes `%20` through `encodeURIComponent`, so
 * round-tripping through it would quietly change the shape of every link
 * the overview page produces. Reading accepts both spellings: `+` is a
 * legal space in a query string, and a hand-typed link is likely to use it.
 */
function decodeQueryPart(text: string): string | null {
  try {
    return decodeURIComponent(text.replace(/\+/g, "%20"));
  } catch {
    // A truncated escape ("%E0%A4") throws rather than returning something
    // wrong. A broken link reads as "no selection", it does not take the
    // page down.
    return null;
  }
}

function parseQuery(search: string | null | undefined): [string, string][] {
  const pairs: [string, string][] = [];
  for (const chunk of String(search ?? "").replace(/^\?/, "").split("&")) {
    if (!chunk) continue;
    const equals = chunk.indexOf("=");
    const key = decodeQueryPart(equals < 0 ? chunk : chunk.slice(0, equals));
    const value = equals < 0 ? "" : decodeQueryPart(chunk.slice(equals + 1));
    if (key === null || value === null) continue;
    pairs.push([key, value]);
  }
  return pairs;
}

/**
 * A query string to the reservoir it names. Unknown parameters are ignored
 * rather than read: `maplibre/index.html` carries its own `basemap`, and a
 * selection must not be confused by it.
 */
export function selectionFromSearch(search: string | null | undefined): string | null {
  let found: string | null = null;
  for (const [key, value] of parseQuery(search)) {
    if (key === SELECTION_PARAMS.reservoir) found = normalizeSelectionValue(value);
  }
  return found;
}

/**
 * The selection back to a query string, keeping every other parameter that
 * was already there and putting the selection first, so the interesting
 * part of a shared link is the readable part.
 */
export function searchWithSelection(
  reservoir: string | null,
  currentSearch?: string | null
): string {
  const parts: string[] = [];
  const value = normalizeSelectionValue(reservoir);
  if (value !== null) {
    parts.push(`${SELECTION_PARAMS.reservoir}=${encodeURIComponent(value)}`);
  }
  for (const [key, existing] of parseQuery(currentSearch)) {
    const owned = SELECTION_FIELDS.some((field) => key === SELECTION_PARAMS[field]);
    if (owned) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(existing)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * Keeps the address bar showing what the reader is looking at.
 *
 * `replaceState`, never `pushState`, and this is the one decision here that
 * a reader would notice: comparing five reservoirs means clicking five
 * dots, and with `pushState` the back button would then walk back through
 * all five instead of leaving the page. The address bar is a description of
 * the current view, not a history of how it was reached.
 */
export function connectSelectionToUrl(store: SelectionStore): () => void {
  return store.subscribe((reservoir) => {
    const search = searchWithSelection(reservoir, window.location.search);
    if (search === window.location.search) return;
    window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  });
}
