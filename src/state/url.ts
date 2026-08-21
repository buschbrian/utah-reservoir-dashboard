/*
 * The selection as a link, and a link as a selection.
 *
 * A port of `selectionFromSearch` / `searchWithSelection` from
 * `shared/reservoir-viz.js`, held against it character for character in
 * `url.test.ts`. That parity protects saved links while the retired routes
 * translate them to the current map or chart workspace.
 *
 * No browser API in the parsing half. The reading and writing are the parts
 * most likely to be wrong about a name with a space or an apostrophe in it
 * -- "Ken's Lake", "Smith and Morehouse" -- and they are only testable at
 * all if they take a string and return one. The DOM half is
 * `connectSelectionToUrl`, at the bottom, and it is four lines.
 */

import type { LakePowellChoice, ReservoirGeography } from "../data/rollup";
import { isBaselineId } from "./baseline";
import type { BaselineId } from "../types";
import type { Reporting } from "./filters";
import { normalizeSelectionValue, type SelectionStore } from "./selection";
import { DEFAULT_SORT, sortFromToken, sortToken, type TableSort } from "./table";
import { STORAGE_CLASSES } from "../viz/classes";

/**
 * Field -> query parameter. The table is what the shared module's own
 * comment promised would make the second entry a line rather than a
 * refactor, and this is that second entry -- and the third and fourth.
 *
 * `reservoir` keeps its spelling because it is the public map contract and
 * the redirect pages carry it forward (`url.test.ts` holds that against the
 * shared module). Older overview spellings remain accepted below, so a saved
 * link does not expire.
 */
const SELECTION_PARAMS = {
  reservoir: "reservoir",
  storageClass: "class",
  reporting: "late",
  drainageArea: "drainage",
  lakePowell: "powell",
  /* Lake Mead's own parameter, spelled the way the storage charts already
   * spell it so a reader can carry a scope between the two pages (ADR-062).
   * Absent means included, exactly like Powell's. */
  lakeMead: "mead",
  geography: "reservoirs",
  month: "month",
  /* The bottom row's two facts, one parameter each. `table=open` is the row
   * being open, `sort` is the order inside it -- a reader who sends a link
   * to a table sorted by storage means both, and one parameter carrying two
   * answers is how the second one goes missing. */
  tableOpen: "table",
  tableSort: "sort",
  /* Which period "normal" means. Absent is not "recent" -- it is "whichever
   * the payload opens on", so a link written today still means what it said
   * if that default ever changes. */
  baseline: "baseline"
} as const;

/* Links written before the public URL contract used the overview page's
 * parameter names. Keep reading them indefinitely; the canonical writer
 * below removes both spellings and emits only the documented one. */
const LEGACY_FILTER_PARAMS = {
  storageClass: "storage",
  reporting: "reporting",
  drainageArea: "area"
} as const;

type SelectionField = keyof typeof SELECTION_PARAMS;
const SELECTION_FIELDS = Object.keys(SELECTION_PARAMS) as SelectionField[];
const OWNED_PARAMS = new Set<string>([
  ...SELECTION_FIELDS.map((field) => SELECTION_PARAMS[field]),
  ...Object.values(LEGACY_FILTER_PARAMS)
]);

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
  /** Lake Mead's own choice, for the reason Powell has one (ADR-062). */
  lakeMead: LakePowellChoice;
  /** Utah waterbodies, or every connected reservoir (ADR-011). */
  geography: ReservoirGeography;
  /** A month key the payload carries, or null for the newest reading. */
  month: string | null;
  /** True when the reader has opened the table under the map. */
  tableOpen: boolean;
  /** The table's order. A separate fact from whether the table is open --
   * a link can carry a sort the reader has to open the row to see. */
  tableSort: TableSort;
  /**
   * The period the reader chose to measure against, or null for the one the
   * payload opens on. Null rather than "recent" on purpose: the page's
   * default is data, not a constant, and a shared link should carry a choice
   * only when a choice was made.
   */
  baseline: BaselineId | null;
}

export const DEFAULT_URL_STATE: DashboardUrlState = {
  reservoir: null,
  storageClass: null,
  reporting: "all",
  drainageArea: null,
  /* Both large reservoirs are in the opening view, and absence means so.
   *
   * ADR-011 and ADR-062 made these controls rather than filters because
   * either one is most of any total it enters, and that reasoning is
   * untouched: the reader still has two switches and the page still says
   * which way each is set. What changed is which way they start. A map whose
   * subject is western water opening with the two largest reservoirs in the
   * west taken out of it is answering a narrower question than the one it
   * appears to be answering, and the reader who most needs the distinction
   * is the one least likely to find a switch that is already off.
   *
   * This is the move `geography` made below, for the same reason and with
   * the same consequence: a link written before this carried no parameter
   * and now reads as "include". The alternative -- keeping the old meaning
   * for absence -- costs every reader the opening view to spare a link the
   * change, so the writer below states the narrow choice out loud instead,
   * and `powell=exclude` is now a thing a link can say. */
  lakePowell: "include",
  lakeMead: "include",
  /* The whole west, not Utah's waterbodies.
   *
   * This defaulted to `utah` when the roster was Utah's, and stayed there
   * when the roster went west -- so the site published 198 reservoirs and
   * opened showing 60 of them, behind a control most readers never touch.
   * A dashboard that hides two thirds of its own subject by default is
   * answering a question nobody asked.
   *
   * The narrower reading is still one choice away, and `?state=UT` now says
   * the same thing more precisely (ADR-060: "Utah waterbodies" is exactly
   * what `waterbody_states` contains). */
  geography: "connected",
  month: null,
  tableOpen: false,
  tableSort: DEFAULT_SORT,
  baseline: null
};

/**
 * `URLSearchParams` is deliberately not used. It writes a space as `+`,
 * while earlier shared links used `%20` through `encodeURIComponent`.
 * Reading accepts both spellings: `+` is a legal space in a query string,
 * and a hand-typed link is likely to use it.
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

function lastValue(pairs: readonly [string, string][], key: string): string | undefined {
  let found: string | undefined;
  for (const [candidate, value] of pairs) if (candidate === key) found = value;
  return found;
}

function classIndex(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const index = Number(value);
  return index < STORAGE_CLASSES.length ? index : null;
}

/**
 * A query string to the reservoir it names. Unknown parameters are ignored
 * rather than read: an older saved link can carry its own `basemap`, and a
 * selection must not be confused by it.
 */
export function selectionFromSearch(search: string | null | undefined): string | null {
  return normalizeSelectionValue(lastValue(parseQuery(search), SELECTION_PARAMS.reservoir));
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
  const pairs = parseQuery(search);
  state.reservoir = normalizeSelectionValue(lastValue(pairs, SELECTION_PARAMS.reservoir));

  const canonicalClass = lastValue(pairs, SELECTION_PARAMS.storageClass);
  state.storageClass = classIndex(canonicalClass ??
    lastValue(pairs, LEGACY_FILTER_PARAMS.storageClass));

  const canonicalLate = lastValue(pairs, SELECTION_PARAMS.reporting);
  const oldReporting = lastValue(pairs, LEGACY_FILTER_PARAMS.reporting);
  state.reporting = canonicalLate !== undefined
    ? canonicalLate === "true" ? "late" : canonicalLate === "false" ? "current" : "all"
    : oldReporting === "late" || oldReporting === "current" ? oldReporting : "all";

  const drainage = lastValue(pairs, SELECTION_PARAMS.drainageArea) ??
    lastValue(pairs, LEGACY_FILTER_PARAMS.drainageArea);
  /* Only the shape is checked, as with the month: whether the map currently
   * has this area is the page's business, and it falls back to every area
   * when the scope does not contain it. */
  state.drainageArea = drainage !== undefined && /^[0-9]{1,12}$/.test(drainage)
    ? drainage : null;

  /* Only the narrow reading is spelled, which is the rule `geography` two
   * lines down has always followed: anything but "exclude" -- absent,
   * misspelt, hand-edited -- is the reservoir in the view. */
  state.lakePowell = lastValue(pairs, SELECTION_PARAMS.lakePowell) === "exclude"
    ? "exclude" : "include";
  state.lakeMead = lastValue(pairs, SELECTION_PARAMS.lakeMead) === "exclude"
    ? "exclude" : "include";
  /* Only the narrow reading is spelled; anything else -- absent, misspelt,
   * hand-edited -- is every reservoir, which is what the dashboard opens on. */
  state.geography = lastValue(pairs, SELECTION_PARAMS.geography) === "utah"
    ? "utah" : "connected";
  const month = lastValue(pairs, SELECTION_PARAMS.month);
  /* Whether the payload actually has this month is the page's business. A
   * link to a month that has aged out opens on the newest reading. */
  state.month = month !== undefined && /^\d{4}-\d{2}$/.test(month) ? month : null;

  state.tableOpen = lastValue(pairs, SELECTION_PARAMS.tableOpen) === "open";
  /* An unrecognised sort opens the table in its default order rather than
   * refusing the link -- the same rule every other parameter here follows. */
  state.tableSort = sortFromToken(lastValue(pairs, SELECTION_PARAMS.tableSort) ?? null);
  const baseline = lastValue(pairs, SELECTION_PARAMS.baseline);
  state.baseline = isBaselineId(baseline) ? baseline : null;
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
  const storageClass = full.storageClass === null ? null : classIndex(String(full.storageClass));
  if (storageClass !== null) {
    parts.push(`${SELECTION_PARAMS.storageClass}=${storageClass}`);
  }
  if (full.reporting !== "all") {
    parts.push(`${SELECTION_PARAMS.reporting}=${full.reporting === "late" ? "true" : "false"}`);
  }
  if (full.drainageArea !== null && /^[0-9]{1,12}$/.test(full.drainageArea)) {
    parts.push(`${SELECTION_PARAMS.drainageArea}=${encodeURIComponent(full.drainageArea)}`);
  }
  if (full.lakePowell !== "include") {
    parts.push(`${SELECTION_PARAMS.lakePowell}=${full.lakePowell}`);
  }
  if (full.lakeMead !== "include") {
    parts.push(`${SELECTION_PARAMS.lakeMead}=${full.lakeMead}`);
  }
  if (full.geography !== "connected") {
    parts.push(`${SELECTION_PARAMS.geography}=${full.geography}`);
  }
  if (full.month !== null) {
    parts.push(`${SELECTION_PARAMS.month}=${encodeURIComponent(full.month)}`);
  }
  if (full.tableOpen) parts.push(`${SELECTION_PARAMS.tableOpen}=open`);
  const sort = sortToken(full.tableSort);
  if (sort !== null) parts.push(`${SELECTION_PARAMS.tableSort}=${sort}`);
  if (full.baseline !== null && isBaselineId(full.baseline)) {
    parts.push(`${SELECTION_PARAMS.baseline}=${full.baseline}`);
  }

  for (const [key, existing] of parseQuery(currentSearch)) {
    if (OWNED_PARAMS.has(key)) continue;
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
