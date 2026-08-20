/*
 * The place a returning reader last chose, and which answer wins.
 *
 * Every surface reads `?state=` and `?area=` and a control writes them (S4).
 * This remembers the choice between visits, and that is a smaller feature
 * than it sounds -- almost all of it is deciding what beats what, because a
 * remembered choice and a shared link are two people's intentions arriving
 * at the same page.
 *
 * The order is fixed and there is only one defensible one:
 *
 *   1. The address bar, when it answered. A link is someone showing someone
 *      else a thing, and it must show them that thing. This includes
 *      `state=all` -- see `EVERYWHERE` -- which is how a reader who has Utah
 *      stored can still be sent the whole west.
 *   2. The stored choice, when there is one.
 *   3. Everywhere.
 *
 * What this deliberately does not do is write the reader's stored choice
 * back into the address bar. A silent parameter appearing in a URL the
 * reader is about to copy is how a private preference leaks into a public
 * link; the page narrows to the stored place and the address bar stays as
 * they found it, so what they copy is what they see rather than what they
 * prefer. `?state=all` exists precisely so that "what they see" can be
 * everywhere without being silence.
 */
import {
  EVERYWHERE,
  openingSearchAnswered,
  openingSelectionFromSearch,
  type OpeningSelection
} from "../data/opening-scope";
import { isUsStateCode } from "../data/state-vocabulary";
import { HUC_CODE } from "../data/huc";

/* Prefixed like the two keys already in use -- `THEME_STORAGE_KEY` and
 * `SPLIT_STORAGE_KEY` -- because a browser profile holds every site's keys
 * in one namespace. Renaming one throws away what a reader chose and shows
 * them nothing in return, so it does not get renamed. */
const PLACE_STORAGE_KEY = "utah-reservoir-dashboard-place";

/** The widths `?area=` is offered at: region, subregion, drainage area. */
const AREA_WIDTHS = new Set([2, 4, 6]);

/**
 * A stored value is not a trusted one.
 *
 * It was written by an older version of this site, or by a reader editing
 * their own storage, and it is read straight into a filter. Validated with
 * the same rules the address bar gets, because "it came from us" is not a
 * property of anything that survives a deploy.
 */
function parseStoredPlace(raw: string | null): OpeningSelection | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const state = typeof record.state === "string" ? record.state : null;
  const area = typeof record.area === "string" ? record.area : null;
  const validState = state !== null && (state === EVERYWHERE || isUsStateCode(state))
    ? state : EVERYWHERE;
  const validArea = area !== null && HUC_CODE.test(area) && AREA_WIDTHS.has(area.length)
    ? area : null;
  if (validState === EVERYWHERE && validArea === null) return null;
  return { state: validState, area: validArea };
}

/* Storage can throw rather than answer -- cookies blocked, a private window
 * at quota, a browser that refuses it in an iframe. A page that cannot
 * remember a place still has to draw one. */
export function readStoredPlace(): OpeningSelection | null {
  try {
    return parseStoredPlace(localStorage.getItem(PLACE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Remembers a place, or forgets one.
 *
 * "Everywhere with no area" is stored as nothing rather than as a value: a
 * reader who clears their choice is saying they have no preference, and a
 * stored "no preference" and an absent key have to mean the same thing or
 * the next visit depends on which one happens to be there.
 */
export function writeStoredPlace(selection: OpeningSelection): void {
  try {
    if (selection.state === EVERYWHERE && selection.area === null) {
      localStorage.removeItem(PLACE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(PLACE_STORAGE_KEY, JSON.stringify({
      state: selection.state, area: selection.area
    }));
  } catch {
    // A reader who cannot store a preference keeps the one on screen.
  }
}

export interface OpeningPlace {
  selection: OpeningSelection;
  /** Where the answer came from, for a page that needs to say so and for the
   * splash, which appears only when nothing has answered. One fact each. */
  source: "link" | "stored" | "default";
}

/**
 * Which answer wins, given a search string and whatever is stored.
 *
 * Takes both rather than reading storage itself, so the rule can be tested
 * without a browser and so a caller can pass a stored value it read once.
 */
export function resolveOpeningPlace(
  search: string | null | undefined, stored: OpeningSelection | null
): OpeningPlace {
  if (openingSearchAnswered(search)) {
    return { selection: openingSelectionFromSearch(search), source: "link" };
  }
  if (stored) return { selection: stored, source: "stored" };
  return { selection: { state: EVERYWHERE, area: null }, source: "default" };
}

/**
 * Whether a stored place still has anything in it, given what a surface
 * found when it applied it.
 *
 * A reader's saved choice can stop matching what the site publishes -- a
 * reservoir roster moves, a snow basin drops below its reporting floor
 * (`areaCanReport`), a drainage area stops being drawn. Opening on a place
 * that is now empty shows a returning reader a blank page and no reason for
 * it, which is worse than opening wide, so the surface falls back and the
 * stored choice is cleared rather than left to fail again tomorrow.
 *
 * The check is the caller's, because "empty" is a different measurement on
 * each surface -- no reservoirs, no snow sites, no measured drainage areas --
 * and this module is not the place that knows which.
 */
export function forgetPlaceIfEmpty(place: OpeningPlace, holdsAnything: boolean): boolean {
  if (place.source !== "stored" || holdsAnything) return false;
  writeStoredPlace({ state: EVERYWHERE, area: null });
  return true;
}

/**
 * The address bar after a reader picks a place, with the choice remembered.
 *
 * One function because all three surfaces wrote the same body, and because
 * the one rule in it is easy to get wrong in a way nothing notices: "the
 * whole west" is written as `state=all` rather than by deleting the
 * parameter. Deleting it would produce a link that means "no answer", which
 * on the recipient's machine defers to *their* stored place -- so a reader
 * clearing their filter and sending the result would be sending everyone a
 * different page. `EVERYWHERE` says it out loud instead.
 *
 * `?area=` keeps the ordinary rule and is deleted when cleared: an area is
 * never a default, so its absence has only ever meant one thing.
 *
 * Returns the query alone. Where to send it is the caller's -- the splash
 * sends a reader to another page, a control keeps them on this one.
 */
export function searchWithPlace(
  search: string | null | undefined, selection: OpeningSelection
): string {
  writeStoredPlace(selection);
  const params = new URLSearchParams(String(search ?? "").replace(/^\?+/, ""));
  params.set("state", selection.state);
  if (selection.area === null) params.delete("area");
  else params.set("area", selection.area);
  const query = params.toString();
  return query ? `?${query}` : "";
}
