/*
 * The snowpack view's address-bar contract. Same vocabulary as the storage
 * map: `?area=` names a six-digit drainage area, absent means the whole
 * region -- so a link can cross between the storage and snow views without
 * translating its filter. `?day=` names the water-year day the map is
 * showing, absent for the default. Same mechanics as the other pages:
 * `replaceState`, never `pushState`, so the back button leaves the site
 * rather than unwinding every filter change.
 *
 * `?q=`, `?elev=` and `?status=` narrow the site table. They are separate
 * from `?area=` on purpose: `?area=` is the shared cross-page vocabulary and
 * changes the whole page including the chart and the map, while these three
 * only narrow the table under it.
 */
import { isElevationBand, isSiteStatus, type ElevationBand, type SiteStatus }
  from "../snow-model";
import { HUC_CODE } from "../data/huc";

export interface SnowUrlState {
  area: string | null;
  /** The map's day as YYYY-MM-DD, or null for the page's default day. */
  day: string | null;
  /** A measurement site's station identifier, or null for none chosen. */
  site: string | null;
  /** The drainage area whose own season card is open, or null for none.
   * Separate from `area` on purpose: `area` is the shared cross-page filter
   * and narrows the whole page, while this names the one area the reader is
   * studying in its detail card -- the same relationship `site` has to the
   * table. */
  basin: string | null;
  /** A name or county search over the site table. Empty for no search. */
  query: string;
  band: ElevationBand;
  status: SiteStatus;
}

/** Station triplets look like "1030:CO:SNTL"; the page still checks the
 * value against the sites the payload actually carries. */
const STATION_PATTERN = /^[0-9A-Za-z]+:[A-Z]{2}:[A-Z]+$/;

export function snowStateFromSearch(search: string): SnowUrlState {
  const params = new URLSearchParams(search);
  const area = params.get("area");
  const day = params.get("day");
  const site = params.get("site");
  const basin = params.get("basin");
  const band = params.get("elev");
  const status = params.get("status");
  /* Trimmed and capped. A search box is the one field a link can carry an
   * arbitrary amount of text in, and the value is only ever used as a
   * case-insensitive substring test. */
  const query = (params.get("q") ?? "").trim().slice(0, 60);
  return {
    area: area && HUC_CODE.test(area) ? area : null,
    day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
    site: site && STATION_PATTERN.test(site) ? site : null,
    basin: basin && HUC_CODE.test(basin) ? basin : null,
    query,
    band: band && isElevationBand(band) ? band : "all",
    status: status && isSiteStatus(status) ? status : "all"
  };
}

export function snowSearchFromState(state: SnowUrlState, search: string): string {
  const params = new URLSearchParams(search);
  if (state.area) params.set("area", state.area);
  else params.delete("area");
  if (state.day) params.set("day", state.day);
  else params.delete("day");
  if (state.site) params.set("site", state.site);
  else params.delete("site");
  if (state.basin) params.set("basin", state.basin);
  else params.delete("basin");
  /* The default of each narrowing control is the absence of its parameter,
   * so a shared link carries what the reader changed and nothing else. */
  if (state.query.trim()) params.set("q", state.query.trim());
  else params.delete("q");
  if (state.band !== "all") params.set("elev", state.band);
  else params.delete("elev");
  if (state.status !== "all") params.set("status", state.status);
  else params.delete("status");
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function writeSnowUrl(state: SnowUrlState): void {
  const search = snowSearchFromState(state, window.location.search);
  const next = `${window.location.pathname}${search}${window.location.hash}`;
  history.replaceState(null, "", next);
}
