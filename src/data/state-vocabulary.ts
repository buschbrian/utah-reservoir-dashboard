/*
 * The state axis: what a reader may pick on the splash screen, and how each
 * surface's own state-shaped field is read.
 *
 * Three surfaces carry a state, in three different attributes, and each is
 * exact for a different reason (docs/INITIAL-SCOPE-SELECTION.md, "The state
 * axis is exact where it matters"):
 *
 *   - `Reservoir.waterbody_states` -- already read by `reservoirInState` in
 *     `overview-model.ts`. Not duplicated here.
 *   - `SnowSite.state` -- one site, one state, read directly by callers.
 *   - `DrainageArea.states` -- a comma-joined string, because a drainage
 *     area's water can reach more than one state. Parsed here.
 *
 * This module does not decide what a reader's chosen state *does* to any of
 * the three surfaces; it only answers what states exist to choose and how to
 * read the one field (`states`) that is not already a plain string or array.
 * Nothing here is a `Scope` -- that name is already taken twice in this tree
 * (`watershed_scopes.py`'s `west-huc6`, `overview-model.ts`'s
 * `{geography, lakePowell}`), and a reader's chosen state is not a third one:
 * it stays a plain two-letter code (or the sentinel `"all"`), exactly the
 * type `reservoirInState`'s `state` parameter already has.
 */

/**
 * The chooser's explicit vocabulary: USPS two-letter codes for the fifty
 * states plus the District of Columbia.
 *
 * `DrainageArea.states` comes from the national Watershed Boundary Dataset,
 * and that attribute's own vocabulary is wider than "state a reader can
 * pick" -- it also carries `MX` and `CN` on the handful of drawn areas whose
 * water crosses a national border (8 into Mexico, 4 into Canada in the
 * committed `west-huc6.geojson`). Those are border markers, not states, and
 * they carry no reservoirs and no snow sites.
 *
 * `offeredStates` below intersects this list against what the data actually
 * holds, rather than trusting "whatever code the attribute contains" -- so a
 * border marker can never reach the chooser no matter what a future payload
 * publishes.
 */
export const US_STATE_CODES: readonly string[] = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC"
];

const US_STATE_CODE_SET = new Set(US_STATE_CODES);

/** Full names, for a splash tile or a chooser label. Two-letter codes are
 * fine as a filter-chip label (`overview-model.ts`'s `stateOptions` already
 * does that), but a first-visit splash is naming a place for someone who has
 * not yet chosen anything, so it gets the word. */
export const US_STATE_NAMES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia"
};

/** True for a code in the explicit fifty-plus-DC vocabulary above -- false
 * for `MX`, `CN`, an empty string, or anything malformed. */
export function isUsStateCode(code: string): boolean {
  return US_STATE_CODE_SET.has(code);
}

/** The full name for a valid code, or the code itself if it is not one of
 * the fifty-plus-DC -- the same "label falls back to the code" rule
 * `payloadAtLevel` already uses for an unnamed drainage area. */
export function stateName(code: string): string {
  return US_STATE_NAMES[code] ?? code;
}

/**
 * A drainage area's `states` attribute, split into codes.
 *
 * Tolerant of the shapes the two committed sources actually produce: an
 * empty string (no comma to split on), stray whitespace around a code
 * (`"CO, UT"`), and a trailing comma. Case is preserved rather than forced,
 * because every source publishes upper case already and forcing it would
 * hide a payload that stopped.
 */
export function parseStateList(states: string): string[] {
  return states
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

/** The shape `areaReachesState` needs -- structural, like `HucMember` in
 * `data/huc.ts`, so a `DrainageArea` from `data/boundaries.ts` or a raw
 * GeoJSON feature's properties both satisfy it without a cast. */
export interface StatesBearing {
  states: string;
}

/**
 * Does this drainage area's water reach this state?
 *
 * Inexact in the way ADR-060 already accepts for Hyrum -- "wholly in Utah
 * and fed from Idaho" -- carried onto every drawn area: an area whose water
 * reaches two states answers true for both, because clipping the polygon to
 * the state line would need geometry in the browser, which ADR-048 and
 * ADR-049 refuse.
 *
 * `state === "all"` always answers true, the same sentinel
 * `reservoirInState` reads.
 */
export function areaReachesState(area: StatesBearing, state: string): boolean {
  if (state === "all") return true;
  return parseStateList(area.states).includes(state);
}

/** One state the splash may offer. */
export interface StateOption {
  code: string;
  label: string;
}

/**
 * The states a reader may pick, derived from what the three surfaces'
 * payloads actually hold rather than written down as a literal.
 *
 * Each source is optional so a caller can ask with whichever payloads it has
 * loaded -- the splash is explicit that the counts for one surface may
 * arrive after the others (docs/INITIAL-SCOPE-SELECTION.md, "What it must
 * do"). A code is offered only when it is also in `US_STATE_CODES`, which is
 * what keeps `MX` and `CN` off the list no matter which source mentions
 * them.
 */
export function offeredStates(sources: {
  reservoirStates?: Iterable<readonly string[] | string | null | undefined>;
  snowSiteStates?: Iterable<string>;
  drainageAreaStates?: Iterable<string>;
}): StateOption[] {
  const codes = new Set<string>();
  for (const value of sources.reservoirStates ?? []) {
    const states = Array.isArray(value) ? value : value ? [value] : [];
    for (const code of states) if (isUsStateCode(code)) codes.add(code);
  }
  for (const code of sources.snowSiteStates ?? []) {
    if (isUsStateCode(code)) codes.add(code);
  }
  for (const states of sources.drainageAreaStates ?? []) {
    for (const code of parseStateList(states)) {
      if (isUsStateCode(code)) codes.add(code);
    }
  }
  return [...codes].sort()
    .map((code) => ({ code, label: stateName(code) }));
}
