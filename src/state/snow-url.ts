/*
 * The snowpack view's address-bar contract. Same vocabulary as the storage
 * map: `?area=` names a six-digit drainage area, absent means the whole
 * region -- so a link can cross between the storage and snow views without
 * translating its filter. `?day=` names the water-year day the map is
 * showing, absent for the default. Same mechanics as the other pages:
 * `replaceState`, never `pushState`, so the back button leaves the site
 * rather than unwinding every filter change.
 */

export interface SnowUrlState {
  area: string | null;
  /** The map's day as YYYY-MM-DD, or null for the page's default day. */
  day: string | null;
}

export function snowStateFromSearch(search: string): SnowUrlState {
  const params = new URLSearchParams(search);
  const area = params.get("area");
  const day = params.get("day");
  return {
    area: area && /^\d{6}$/.test(area) ? area : null,
    day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
  };
}

export function snowSearchFromState(state: SnowUrlState, search: string): string {
  const params = new URLSearchParams(search);
  if (state.area) params.set("area", state.area);
  else params.delete("area");
  if (state.day) params.set("day", state.day);
  else params.delete("day");
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function writeSnowUrl(state: SnowUrlState): void {
  const search = snowSearchFromState(state, window.location.search);
  const next = `${window.location.pathname}${search}${window.location.hash}`;
  history.replaceState(null, "", next);
}
