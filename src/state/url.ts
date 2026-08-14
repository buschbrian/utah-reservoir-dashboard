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

import type { LakePowellChoice, ReservoirGeography } from "../data/rollup";
import type { Reporting } from "./filters";
import { normalizeSelectionValue, type SelectionStore } from "./selection";

/**
 * Field -> query parameter. The table is what the shared module's own
 * comment promised would make the second entry a line rather than a
 * refactor, and this is that second entry -- and the third and fourth.
 *
 * `reservoir` keeps its spelling because links are interchangeable with the
 * three production pages (`url.test.ts` holds that against the shared
 * module). The others are this shell's own: the legacy pages have their own
 * filter controls and do not read these, but they *preserve* them, because
 * both writers keep parameters they do not own.
 */
const SELECTION_PARAMS = {
  reservoir: "reservoir",
  storageClass: "storage",
  reporting: "reporting",
  drainageArea: "area",
  lakePowell: "powell",
  geography: "reservoirs",
  month: "month"
} as const;
type SelectionField = keyof typeof SELECTION_PARAMS;
const SELECTION_FIELDS = Object.keys(SELECTION_PARAMS) as SelectionField[];

/**
 * Everything a shared link carries.
 *
 * Only what a reader has actually chosen reaches the address bar: a default
 * is written as absence, so an untouched dashboard has a clean URL and a
 * link says exactly what was changed to produce it.
 */
export interface DashboardUrlState {
  reservoir: string | null;
  /** An index into the storage class table, or null for every class. */
  storageClass: number | null;
  reporting: Reporting;
  /** A drainage-area code the payload carries, or null for every area. */
  drainageArea: string | null;
  lakePowell: LakePowellChoice;
  /** Utah waterbodies, or every connected reservoir (ADR-011). */
  geography: ReservoirGeography;
  /** A month key the payload carries, or null for the newest reading. */
  month: string | null;
}

export const DEFAULT_URL_STATE: DashboardUrlState = {
  reservoir: null,
  storageClass: null,
  reporting: "all",
  drainageArea: null,
  lakePowell: "exclude",
  geography: "utah",
  month: null
};

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
 * A query string to the view it describes.
 *
 * A value this page does not recognise falls back to the default rather
 * than throwing: a hand-edited or truncated link should open the dashboard,
 * not break it.
 */
export function stateFromSearch(search: string | null | undefined): DashboardUrlState {
  const state: DashboardUrlState = { ...DEFAULT_URL_STATE };
  for (const [key, value] of parseQuery(search)) {
    if (key === SELECTION_PARAMS.reservoir) {
      state.reservoir = normalizeSelectionValue(value);
    } else if (key === SELECTION_PARAMS.storageClass) {
      const index = Number.parseInt(value, 10);
      state.storageClass = Number.isInteger(index) && index >= 0 ? index : null;
    } else if (key === SELECTION_PARAMS.reporting) {
      state.reporting = value === "late" || value === "current" ? value : "all";
    } else if (key === SELECTION_PARAMS.drainageArea) {
      /* Only the shape is checked, as with the month: whether the map
       * currently has this area is the page's business, and it falls back
       * to every area when the scope does not contain it. */
      state.drainageArea = /^[0-9]{1,12}$/.test(value) ? value : null;
    } else if (key === SELECTION_PARAMS.lakePowell) {
      state.lakePowell = value === "include" ? "include" : "exclude";
    } else if (key === SELECTION_PARAMS.geography) {
      state.geography = value === "connected" ? "connected" : "utah";
    } else if (key === SELECTION_PARAMS.month) {
      /* Only the shape is checked here. Whether the payload actually has
       * this month is the page's business, and it falls back to the newest
       * reading if not -- a link to a month that has aged out of the
       * twelve should still open. */
      state.month = /^\d{4}-\d{2}$/.test(value) ? value : null;
    }
  }
  return state;
}

/**
 * The view back to a query string, keeping every parameter this page does
 * not own and putting the selection first, so the interesting part of a
 * shared link is the readable part.
 *
 * Defaults are written as absence. A dashboard nobody has touched produces
 * no query string at all.
 */
export function searchWithState(
  state: Partial<DashboardUrlState>,
  currentSearch?: string | null
): string {
  const full: DashboardUrlState = { ...DEFAULT_URL_STATE, ...state };
  const parts: string[] = [];

  const reservoir = normalizeSelectionValue(full.reservoir);
  if (reservoir !== null) {
    parts.push(`${SELECTION_PARAMS.reservoir}=${encodeURIComponent(reservoir)}`);
  }
  if (full.storageClass !== null) {
    parts.push(`${SELECTION_PARAMS.storageClass}=${full.storageClass}`);
  }
  if (full.reporting !== "all") {
    parts.push(`${SELECTION_PARAMS.reporting}=${full.reporting}`);
  }
  if (full.drainageArea !== null) {
    parts.push(`${SELECTION_PARAMS.drainageArea}=${encodeURIComponent(full.drainageArea)}`);
  }
  if (full.lakePowell !== "exclude") {
    parts.push(`${SELECTION_PARAMS.lakePowell}=${full.lakePowell}`);
  }
  if (full.geography !== "utah") {
    parts.push(`${SELECTION_PARAMS.geography}=${full.geography}`);
  }
  if (full.month !== null) {
    parts.push(`${SELECTION_PARAMS.month}=${encodeURIComponent(full.month)}`);
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
export function writeUrlState(state: Partial<DashboardUrlState>): void {
  const search = searchWithState(state, window.location.search);
  if (search === window.location.search) return;
  window.history.replaceState(
    null, "", `${window.location.pathname}${search}${window.location.hash}`);
}

/**
 * Keeps the address bar current as the selection changes.
 *
 * `read` supplies the rest of the view, because the address bar carries one
 * state and the selection is only part of it -- writing from the selection
 * alone would clear a filter the reader had set.
 */
export function connectSelectionToUrl(
  store: SelectionStore,
  read: () => Omit<DashboardUrlState, "reservoir">
): () => void {
  return store.subscribe((reservoir) => {
    writeUrlState({ ...read(), reservoir });
  });
}
