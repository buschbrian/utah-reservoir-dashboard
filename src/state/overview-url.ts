/*
 * The overview page's view, as a link.
 *
 * The page had no URL state at all: every filter, every chart control and
 * the cross-filter selection lived only in the DOM, so a reader who found
 * something could not hand it to anybody. Six charts made that worse rather
 * than better -- the more a view can say, the more it is worth sending.
 *
 * Five filter concepts are shared with the map, so a link carries between
 * the two pages. The overview retains its original `area`, `storage` and
 * `reporting` names and also reads the map's documented `drainage`, `class`
 * and `late` names. Both pages are filtering the same reservoirs by the same
 * questions, and each writer canonicalises the aliases it reads.
 *
 * `reporting` is the one whose value sets differ: this page offers daily and
 * monthly as well as late, the map offers current. Each page validates what
 * it understands and falls back to "all" for the rest, which is what makes
 * sharing a name safe -- a link is honoured as far as the receiving page can
 * honour it, and never rejected.
 *
 * The remaining five belong to this page alone. They are written here rather
 * than added to `SELECTION_PARAMS` in url.ts because that table is the set
 * the map *strips and rewrites*: a chart measure listed there would be
 * deleted from any link that passed through the map, and `searchWithState`
 * is held byte-for-byte against the shared module besides.
 *
 * No browser API in the parsing half, for the same reason url.ts has none:
 * the awkward cases are a name with a space in it and a hand-edited link,
 * and both are only testable if the functions take a string and return one.
 */

import { HUC_CODE } from "../data/huc";
import type { ReservoirGeography, LakePowellChoice } from "../data/rollup";
import type { ChartMeasure, ChartRank, OverviewCadence, OverviewSort } from "../overview-model";
import { STORAGE_CLASSES } from "../viz/classes";

/** Field -> query parameter. The map owns the first five names (see url.ts). */
const OVERVIEW_PARAMS = {
  query: "q",
  drainageArea: "area",
  state: "state",
  subregion: "huc4",
  county: "county",
  reporting: "reporting",
  geography: "reservoirs",
  lakePowell: "powell",
  lakeMead: "mead",
  storageClass: "storage",
  sort: "sort",
  measure: "measure",
  limit: "top",
  rank: "rank"
} as const;

/* The map's documented names. The overview keeps its older names when it
 * writes because reporting has more than the map's late/current choices,
 * but it accepts and canonicalises every map link it can represent. */
const MAP_FILTER_PARAMS = {
  drainageArea: "drainage",
  reporting: "late",
  storageClass: "class"
} as const;

type OverviewField = keyof typeof OVERVIEW_PARAMS;
const OVERVIEW_FIELDS = Object.keys(OVERVIEW_PARAMS) as OverviewField[];
const OVERVIEW_OWNED_PARAMS = new Set<string>([
  ...OVERVIEW_FIELDS.map((field) => OVERVIEW_PARAMS[field]),
  ...Object.values(MAP_FILTER_PARAMS)
]);

export interface OverviewUrlState {
  query: string;
  /** A drainage-area code the payload carries, or "all". */
  drainageArea: string;
  /** A two-letter state code, or "all". Every state the water touches. */
  state: string;
  /** A four-digit subregion code, or "all". */
  subregion: string;
  /** A five-digit county FIPS code, or "all". Never a county name. */
  county: string;
  reporting: OverviewCadence;
  geography: ReservoirGeography;
  lakePowell: LakePowellChoice;
  /** Lake Mead's own control (ADR-062). Excluded by default, like Powell. */
  lakeMead: LakePowellChoice;
  /** An index into the storage class table, or null for every class. */
  storageClass: number | null;
  sort: OverviewSort;
  measure: ChartMeasure;
  /** How many reservoirs the ranked chart shows. Zero means all of them. */
  limit: number;
  rank: ChartRank;
}

export const DEFAULT_OVERVIEW_STATE: OverviewUrlState = {
  query: "",
  drainageArea: "all",
  state: "all",
  subregion: "all",
  county: "all",
  reporting: "all",
  geography: "utah",
  lakePowell: "exclude",
  lakeMead: "exclude",
  storageClass: null,
  sort: "capacity",
  measure: "percent",
  limit: 15,
  rank: "capacity"
};

/**
 * `URLSearchParams` is deliberately not used, matching url.ts: it writes a
 * space as `+` where the overview page's own links write `%20`, so a round
 * trip through it would quietly change the shape of every link the site
 * produces. Reading accepts both.
 */
function decodeQueryPart(text: string): string | null {
  try {
    return decodeURIComponent(text.replace(/\+/g, "%20"));
  } catch {
    // A truncated escape throws rather than returning something wrong. A
    // broken link reads as "no filter", it does not take the page down.
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

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

/**
 * A query string to the view it describes.
 *
 * Every value is validated and falls back to its default rather than
 * throwing. A hand-edited link, or one from the map carrying a `reporting`
 * value this page does not offer, opens the page -- it does not break it.
 */
export function overviewStateFromSearch(search: string | null | undefined): OverviewUrlState {
  const state: OverviewUrlState = { ...DEFAULT_OVERVIEW_STATE };
  for (const [key, value] of parseQuery(search)) {
    if (key === OVERVIEW_PARAMS.query) state.query = value.trim();
    else if (key === OVERVIEW_PARAMS.state) {
      /* Two upper-case letters, or nothing. Anything else is not a state code
       * and must not narrow the view to an empty list. */
      state.state = /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : "all";
    }
    else if (key === OVERVIEW_PARAMS.subregion) {
      /* The shared code shape, at the subregion's width: the level is the
       * digit count, and HUC_CODE is the one pattern for the shape. */
      state.subregion = HUC_CODE.test(value) && value.length === 4 ? value : "all";
    }
    else if (key === OVERVIEW_PARAMS.county) {
      /* Exactly five digits, or nothing. A FIPS code is fixed-width and
       * zero-padded, so the digit count is the whole validation -- and a
       * leading zero is real (Arizona is 04), which is why this stays a
       * string and is never parsed as a number. */
      state.county = /^[0-9]{5}$/.test(value) ? value : "all";
    }
    else if (key === OVERVIEW_PARAMS.drainageArea || key === MAP_FILTER_PARAMS.drainageArea) {
      /* Shape only, as the map does: whether this area is in the current
       * scope is the page's business, and it falls back to every area. */
      state.drainageArea = /^[0-9]{1,12}$/.test(value) ? value : "all";
    } else if (key === OVERVIEW_PARAMS.reporting) {
      state.reporting = oneOf(value, ["all", "daily", "monthly", "late"] as const, "all");
    } else if (key === MAP_FILTER_PARAMS.reporting) {
      state.reporting = value === "true" ? "late" : "all";
    } else if (key === OVERVIEW_PARAMS.geography) {
      state.geography = oneOf(value, ["utah", "connected"] as const, "utah");
    } else if (key === OVERVIEW_PARAMS.lakePowell) {
      state.lakePowell = oneOf(value, ["include", "exclude"] as const, "exclude");
    } else if (key === OVERVIEW_PARAMS.lakeMead) {
      state.lakeMead = oneOf(value, ["include", "exclude"] as const, "exclude");
    } else if (key === OVERVIEW_PARAMS.storageClass || key === MAP_FILTER_PARAMS.storageClass) {
      const index = /^\d+$/.test(value) ? Number(value) : -1;
      state.storageClass = index >= 0 && index < STORAGE_CLASSES.length ? index : null;
    } else if (key === OVERVIEW_PARAMS.sort) {
      state.sort = oneOf(value,
        ["capacity", "name", "storage", "percent", "updated"] as const, "capacity");
    } else if (key === OVERVIEW_PARAMS.measure) {
      state.measure = oneOf(value, ["percent", "storage"] as const, "percent");
    } else if (key === OVERVIEW_PARAMS.limit) {
      const limit = Number.parseInt(value, 10);
      /* Zero is "all of them" and is a real choice, so it is kept. A
       * negative or unparseable value is not, and falls back. */
      state.limit = Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_OVERVIEW_STATE.limit;
    } else if (key === OVERVIEW_PARAMS.rank) {
      state.rank = oneOf(value, ["capacity", "storage", "percent", "name"] as const, "capacity");
    }
  }
  return state;
}

/**
 * The view back to a query string, keeping every parameter this page does
 * not own.
 *
 * Defaults are written as absence, so an untouched page has a clean address
 * and a link says exactly what was changed to produce it. The query goes
 * first, because it is the readable part of a shared link.
 */
export function searchWithOverviewState(
  state: Partial<OverviewUrlState>,
  currentSearch?: string | null
): string {
  const full: OverviewUrlState = { ...DEFAULT_OVERVIEW_STATE, ...state };
  const parts: string[] = [];
  const write = (field: OverviewField, value: string): void => {
    parts.push(`${OVERVIEW_PARAMS[field]}=${encodeURIComponent(value)}`);
  };

  if (full.query.trim() !== "") write("query", full.query.trim());
  if (full.drainageArea !== "all") write("drainageArea", full.drainageArea);
  if (full.state !== "all") write("state", full.state);
  if (full.subregion !== "all") write("subregion", full.subregion);
  if (full.county !== "all") write("county", full.county);
  if (full.reporting !== "all") write("reporting", full.reporting);
  if (full.geography !== "utah") write("geography", full.geography);
  if (full.lakePowell !== "exclude") write("lakePowell", full.lakePowell);
  if (full.lakeMead !== "exclude") write("lakeMead", full.lakeMead);
  if (full.storageClass !== null) write("storageClass", String(full.storageClass));
  if (full.sort !== DEFAULT_OVERVIEW_STATE.sort) write("sort", full.sort);
  if (full.measure !== DEFAULT_OVERVIEW_STATE.measure) write("measure", full.measure);
  if (full.limit !== DEFAULT_OVERVIEW_STATE.limit) write("limit", String(full.limit));
  if (full.rank !== DEFAULT_OVERVIEW_STATE.rank) write("rank", full.rank);

  /* Anything this page does not own is carried through untouched -- the
   * map's `month` and the legacy pages' `basemap` among them. Both writers
   * on this site keep what they do not own, which is what lets a link
   * survive being opened on one page and copied from another. */
  for (const [key, existing] of parseQuery(currentSearch)) {
    if (OVERVIEW_OWNED_PARAMS.has(key)) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(existing)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * Keeps the address bar showing what the reader is looking at.
 *
 * `replaceState`, never `pushState`, for the reason url.ts gives: comparing
 * five drainage areas means five clicks, and the back button should leave
 * the page rather than walk back through all of them.
 */
export function writeOverviewUrl(state: Partial<OverviewUrlState>): void {
  const search = searchWithOverviewState(state, window.location.search);
  if (search === window.location.search) return;
  window.history.replaceState(
    null, "", `${window.location.pathname}${search}${window.location.hash}`);
}
