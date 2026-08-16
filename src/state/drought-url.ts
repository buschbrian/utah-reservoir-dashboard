/*
 * The drought view's address-bar contract.
 *
 * Same mechanics as the storage and snow views: `replaceState`, never
 * `pushState`, so the back button leaves the site rather than unwinding every
 * filter change one at a time.
 *
 * `?worse=` names a drought class and means "areas with any land at this
 * class or worse". `?sort=` names the order. `?area=` is deliberately the
 * same parameter the storage and snow views use for a six-digit drainage
 * area, so a link can cross between the three without translation -- here it
 * opens that area's row rather than filtering to it, because fourteen rows
 * are the page and hiding thirteen of them would leave nothing to compare
 * against.
 */
import { DROUGHT_CLASSES } from "../viz/drought-classes";
import { isDroughtSort, type DroughtSort } from "../drought-model";

export interface DroughtUrlState {
  /** A drought class key, or null for every area. */
  worse: string | null;
  sort: DroughtSort;
  /** A six-digit drainage area to bring into view, or null. */
  area: string | null;
}

export const DEFAULT_DROUGHT_SORT: DroughtSort = "severity";

function isClassKey(value: string): boolean {
  return DROUGHT_CLASSES.some((entry) => entry.key === value);
}

export function droughtStateFromSearch(search: string): DroughtUrlState {
  const params = new URLSearchParams(search);
  const worse = params.get("worse");
  const sort = params.get("sort");
  const area = params.get("area");
  return {
    worse: worse && isClassKey(worse) ? worse : null,
    sort: sort && isDroughtSort(sort) ? sort : DEFAULT_DROUGHT_SORT,
    area: area && /^\d{6}$/.test(area) ? area : null
  };
}

export function droughtSearchFromState(
  state: DroughtUrlState, search: string
): string {
  const params = new URLSearchParams(search);
  if (state.worse) params.set("worse", state.worse);
  else params.delete("worse");
  /* The default order is the absence of the parameter, not `sort=severity`:
   * a shared link should carry what the reader changed, and nothing else. */
  if (state.sort !== DEFAULT_DROUGHT_SORT) params.set("sort", state.sort);
  else params.delete("sort");
  if (state.area) params.set("area", state.area);
  else params.delete("area");
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function writeDroughtUrl(state: DroughtUrlState): void {
  const search = droughtSearchFromState(state, window.location.search);
  history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
}
