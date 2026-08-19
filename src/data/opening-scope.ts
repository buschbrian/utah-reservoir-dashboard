/*
 * The reader's opening scope: which state and which drainage area they
 * asked for, narrowed against each other and against what the reference
 * export actually publishes, and the box a map opens on once that
 * narrowing is done.
 *
 * docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md calls this slice S2. It sits
 * between two things that already exist and stays out of both of them:
 *
 *   - `?state=` and `?area=` already travel across the navigation
 *     (`state/portable-url.ts`) and already mean the right things. This
 *     module only reads them; it does not write them, and it does not touch
 *     `state/url.ts`, which S5 owns and holds byte-for-byte parity with the
 *     frozen `shared/reservoir-viz.js`.
 *   - The published unit boxes (`DrainageArea.box`, `unionOfAreaBoxes`) came
 *     from S1. This module is their first caller: it narrows the published
 *     roster down to what a reader's choice actually means and hands the
 *     narrowed set to `unionOfAreaBoxes` for the box a map opens on.
 *
 * No page imports this yet. `main.ts`, `snow.ts`, `drought.ts` and
 * `overview.ts` are slice S3a-d, built in parallel against the API here.
 *
 * A region is a filter, not a drawn level (D2). `?area=14` narrows the same
 * roster `?area=140100` does, at a coarser prefix -- it is never `?level=`,
 * which is a different axis entirely (ADR-064: how finely the ground is
 * *drawn*, always 4 or 6, because every drawn area needs a figure behind
 * it). Region and subregion have no figures of their own; they are entry
 * vocabulary over the same basin-level figures every level narrows down to.
 *
 * The honesty constraint (docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md,
 * "What a state selection is allowed to claim") is the reason this module
 * stops where it does. A state means three different exact things depending
 * on what is being asked about it -- `waterbody_states` for a reservoir,
 * `state` for a snow site, `states` ("the water reaches this state") for a
 * drainage area -- and only the third of those is a question about the
 * *areas* this module narrows. This module resolves `state` and `area` to
 * one small, precise answer and stops; it does not offer a "matches state"
 * function generic enough to be reached for on a reservoir or a snow site,
 * because that is exactly how the wrong exact rule ends up applied to the
 * wrong surface. A caller reads `OpeningScope.selection` and hands it to
 * whichever rule its own surface already has (`reservoirInState` in
 * `overview-model.ts`, `payloadForState` in `snow-model.ts`,
 * `areaReachesState` below, for drainage areas and nothing else).
 */

import { HUC_CODE } from "./huc";
import { areaReachesState, isUsStateCode } from "./state-vocabulary";
import {
  loadReference,
  parseDrainageUnits,
  referenceGeography,
  REFERENCE_SCHEMA_VERSION,
  type DrainageArea,
  type DrainageAreaBox
} from "./boundaries";
import { MAP_BOUNDS, unionOfAreaBoxes } from "../viz/extent";

/**
 * The three prefix widths this module narrows between: a region (two
 * digits), a subregion (four) and a basin (six). Deliberately not
 * `JOINABLE_LEVELS` from `boundaries.ts` -- that list is which levels the
 * ground is *drawn* at (4 and 6, ADR-064), a different axis from this one.
 * Region is on this list and never on that one; a basin is on both, for
 * unrelated reasons -- it is where every figure on this site is keyed, and
 * separately it is the finest level this hierarchy narrows to.
 */
const REGION_WIDTH = 2;
const SUBREGION_WIDTH = 4;
const AREA_WIDTH = 6;
const OPENING_AREA_WIDTHS: ReadonlySet<number> = new Set([REGION_WIDTH, SUBREGION_WIDTH, AREA_WIDTH]);

/**
 * A code shaped like something this hierarchy can narrow with.
 *
 * `HUC_CODE` accepts any even width to twelve (`src/data/huc.ts`), which is
 * right for a payload's own `huc6` field but wrong for a reader's choice
 * here: an eight-digit code would silently narrow to zero areas at every
 * level this module knows, since nothing in this hierarchy is that fine
 * (region, subregion, basin -- 2, 4 and 6 only, the same three widths the
 * predicate and the `where` clause in `state/filters.ts` have agreed at
 * since `ada826a`).
 */
function isOpeningAreaCode(value: string): boolean {
  return HUC_CODE.test(value) && OPENING_AREA_WIDTHS.has(value.length);
}

/**
 * The reader's raw choice, read from `?state=` and `?area=`.
 *
 * Two independent axes read together, because `resolveOpeningScope` is
 * where they narrow each other -- reading them apart would let a caller
 * apply one without ever checking whether the other survives it.
 */
export interface OpeningSelection {
  /** A USPS two-letter code, or "all". */
  state: string;
  /** A region (2-digit), subregion (4-digit) or basin (6-digit) code, or
   * `null` for "all". */
  area: string | null;
}

export const DEFAULT_OPENING_SELECTION: OpeningSelection = { state: "all", area: null };

/**
 * `?state=` and `?area=` from a query string, tolerant the way every other
 * reader of this address bar is (`state/url.ts`'s `stateFromSearch`): a
 * value this module does not recognise reads as "all" rather than failing
 * the page.
 *
 * `isUsStateCode` is what keeps `?state=MX` and `?state=CN` from ever being
 * honoured -- the same guarantee `offeredStates` gives the splash. Eight
 * drawn areas extend into Mexico and four into Canada, and a hand-edited or
 * malicious link naming either is not a place a reader can be handed.
 *
 * Reads `?area=` only. The storage map's own filter additionally accepts
 * `?drainage=` as that page's canonical spelling with `?area=` as the older
 * one (`state/url.ts`); this module is the one every page shares, and the
 * shared spelling across the navigation is `area=`
 * (`state/portable-url.ts`). A caller wiring the storage page's own filter
 * state from a `?drainage=`-only link keeps using `state/url.ts` for that,
 * same as today.
 */
export function openingSelectionFromSearch(search: string | null | undefined): OpeningSelection {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const state = params.get("state");
  const area = params.get("area");
  return {
    state: state !== null && isUsStateCode(state) ? state : "all",
    area: area !== null && isOpeningAreaCode(area) ? area : null
  };
}

/**
 * The registered name of the five-region scope (D3, `watershed_scopes.py`).
 *
 * Every other named scope this codebase reads travels through an
 * indirection published for the purpose -- `default_scope`, `roster_scope`
 * -- specifically so no client names a boundary file directly
 * (`src/data/payload-fixture.ts#readScopeGeoJson` states the rule in full:
 * "which file holds which geography has moved once and will move again").
 * Region has no such indirection, on purpose: it is deliberately not one of
 * `drawn_scopes` (D2, ADR-064), so there is nothing for a
 * `default_scope`-shaped pointer to mean.
 *
 * `west-huc2` is the one name D3 itself commits to -- "a registered
 * `west-huc2` scope in `watershed_scopes.py`, published in
 * `reference.json`" -- so reading `scopes["west-huc2"]` directly is the one
 * place this module does what the rule above forbids everywhere else, for
 * the reason the rule does not apply here: this name is the entry
 * vocabulary itself, not a pointer to whichever geography happens to be
 * accepted today, so there is nothing about it that moves the way
 * `DEFAULT_SCOPE` and `ROSTER_SCOPE` already have.
 */
const REGION_SCOPE_NAME = "west-huc2";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The region roster straight out of a parsed reference export.
 *
 * Cannot go through `referenceGeography`: that function's `wanted`
 * parameter only resolves names published in `drawn_scopes`, and region is
 * deliberately absent from it (see `REGION_SCOPE_NAME`). This walks the
 * same `geography.watersheds.scopes` structure by the one name this module
 * is allowed to know, and returns no regions rather than throwing for a
 * payload at an unrecognised schema version or missing the scope entirely
 * -- the same soft-failure rule `referenceGeography` follows, so a reader
 * loses the region tier of the chooser rather than the whole page.
 */
export function regionRosterFromReference(value: unknown): readonly DrainageArea[] {
  if (!isRecord(value) || value.schema_version !== REFERENCE_SCHEMA_VERSION) return [];
  const geography = isRecord(value.geography) ? value.geography : null;
  const watersheds = geography && isRecord(geography.watersheds) ? geography.watersheds : null;
  const scopes = watersheds && isRecord(watersheds.scopes) ? watersheds.scopes : null;
  const region = scopes && isRecord(scopes[REGION_SCOPE_NAME]) ? scopes[REGION_SCOPE_NAME] : null;
  const level = region && typeof region.level === "number" ? region.level : REGION_WIDTH;
  return parseDrainageUnits(region?.units, level);
}

/**
 * The three rosters `resolveOpeningScope` narrows between: the five
 * regions, the published subregions and the published basins.
 *
 * `areas` is whatever `default_scope` names today -- 75 basins across the
 * west since ADR-063 -- not a literal `west-huc6`. The opening box this
 * module answers with is always built from `chosenAreas`, a narrowing of
 * this list; `regions` and `subregions` are option lists for a drill-down
 * control (S4) and are never unioned directly, so which scope name backs
 * them can move without this module's callers noticing.
 */
export interface OpeningRosters {
  regions: readonly DrainageArea[];
  subregions: readonly DrainageArea[];
  areas: readonly DrainageArea[];
}

/**
 * `OpeningRosters`, fetched from the reference export in one request
 * (`loadReference` already shares it across callers, keyed by URL).
 *
 * Subregions and areas go through `referenceGeography`'s own indirection
 * (`wanted: 4`, and the default for whatever `default_scope` publishes) --
 * the same discipline `loadDrainageScope` already keeps, so this module
 * never assumes `west-huc4` or `west-huc6` are the names either. Only the
 * region roster is read by its literal name, for the reason
 * `REGION_SCOPE_NAME` documents.
 */
export async function loadOpeningRosters(url?: string): Promise<OpeningRosters> {
  const value = await loadReference(url);
  const subregionGeography = referenceGeography(value, SUBREGION_WIDTH);
  const areaGeography = referenceGeography(value);
  return {
    regions: regionRosterFromReference(value),
    subregions: parseDrainageUnits(subregionGeography?.drainage, subregionGeography?.level ?? 0),
    areas: parseDrainageUnits(areaGeography?.drainage, areaGeography?.level ?? 0)
  };
}

/**
 * The resolved opening scope: what a reader's choice actually means once it
 * has narrowed the published rosters and been narrowed by them in turn.
 */
export interface OpeningScope {
  /**
   * The selection actually honoured. `state` never resets -- it is the
   * coarsest axis narrowed here, so nothing above it can make it dead.
   * `area` has already fallen back to `null` when the chosen state leaves
   * nothing under it, so a caller never repeats that check.
   */
  selection: OpeningSelection;
  /**
   * What is left to choose from at each level, coarsest first, once the
   * levels above it have narrowed the roster -- built for a drill-down
   * control (S4). Each list is narrowed by `state` and by whichever coarser
   * part of `selection.area` applies, but never by its own level's part of
   * it: a subregion list narrowed down to the one subregion already chosen
   * would give a reader nothing to switch to.
   */
  regions: readonly DrainageArea[];
  subregions: readonly DrainageArea[];
  areas: readonly DrainageArea[];
  /**
   * The basins the whole selection actually means -- `state` and every
   * digit of `selection.area`, both applied. This is what a caller narrows
   * reservoirs, snow sites and drought rows against (`withinOpeningArea`),
   * and what `box` is built from. Never `regions` or `subregions` above,
   * which stop one level short of this on purpose.
   */
  chosenAreas: readonly DrainageArea[];
  /**
   * The union of `chosenAreas`' published boxes
   * (`src/viz/extent.ts#unionOfAreaBoxes`), or `MAP_BOUNDS` -- the same box
   * every map already opens on before a reader has chosen anything -- when
   * none of them published one.
   *
   * `unionOfAreaBoxes` returns `null` in exactly two cases this module
   * cannot tell apart and does not need to: every chosen area lost its box,
   * or there are no chosen areas at all (an empty union has nothing to be a
   * fallback *from*). Either way, refusing to open the map would cost a
   * reader the one thing a chooser exists to give them, so the fallback is
   * the wide, honest default this site already uses rather than a crash, a
   * stale box, or a narrower one this module would have to invent.
   */
  box: DrainageAreaBox;
}

/**
 * Narrows `rosters` by `selection`, coarsest first, and answers with the
 * box a map opens on.
 *
 * State narrows first, because it is the axis every one of the three
 * visitors this feature exists for arrives with or without, independently
 * of the others -- "Idaho snowpack" and "the upper Colorado River basin"
 * are not naming the same kind of place, and nothing about a chosen region
 * invalidates a chosen state. So a dead `area` always yields to a live
 * `state`, never the reverse: `state` is applied to every roster first, and
 * `area`'s survival is checked against what state narrowing has left.
 *
 * Below `state`, region narrows subregion narrows basin -- the order
 * `?area=` itself already expresses through its own width, since a shorter
 * code is a prefix of every longer code nested inside it (`HUC_CODE`'s
 * codes are fixed-width and nest). A four-digit selection is at once "this
 * subregion" for the subregion list and "this subregion" as the narrowing
 * that produces the basin list below it; there is no separate region or
 * subregion field to keep synchronised with it.
 */
export function resolveOpeningScope(
  selection: OpeningSelection, rosters: OpeningRosters
): OpeningScope {
  const state = selection.state;
  const stateRegions = rosters.regions.filter((region) => areaReachesState(region, state));
  const stateSubregions = rosters.subregions.filter((subregion) => areaReachesState(subregion, state));
  const stateAreas = rosters.areas.filter((candidate) => areaReachesState(candidate, state));

  /* Aliveness is checked against the finest roster regardless of the chosen
   * code's own width: a region or subregion prefix is alive exactly when
   * some basin beneath it survived the state narrowing, which is also the
   * right answer for a full six-digit code checked against itself. A code
   * that fails this is not narrowed to the nearest surviving ancestor --
   * it is dropped to "all", per the rule this module owes a test for. */
  const rawArea = selection.area;
  const area = rawArea !== null && stateAreas.some((candidate) => candidate.huc6.startsWith(rawArea))
    ? rawArea
    : null;

  const regionPrefix = area !== null ? area.slice(0, REGION_WIDTH) : null;
  const subregionPrefix = area !== null ? area.slice(0, Math.min(SUBREGION_WIDTH, area.length)) : null;

  const subregions = regionPrefix === null
    ? stateSubregions
    : stateSubregions.filter((subregion) => subregion.huc6.startsWith(regionPrefix));
  const areas = subregionPrefix === null
    ? stateAreas
    : stateAreas.filter((candidate) => candidate.huc6.startsWith(subregionPrefix));
  const chosenAreas = area === null
    ? stateAreas
    : stateAreas.filter((candidate) => candidate.huc6.startsWith(area));

  return {
    selection: { state, area },
    regions: stateRegions,
    subregions,
    areas,
    chosenAreas,
    box: unionOfAreaBoxes(chosenAreas) ?? MAP_BOUNDS
  };
}

/**
 * Does a record's own drainage-area code fall inside the areas
 * `OpeningScope.selection.area` narrows to?
 *
 * Prefix matching, the rule `matchesFilter` in `state/filters.ts` already
 * applies to a reservoir's own filter: codes nest, so a four-digit
 * selection matches every six-digit code inside it. Takes the *resolved*
 * `area` -- already fallen back to `null` when dead -- so a caller never
 * repeats `resolveOpeningScope`'s aliveness check.
 *
 * Only the drainage-area axis. Whether a record's *state* matches is a
 * different question with a different exact answer on every surface (see
 * the module doc), and is never this function's business.
 */
export function withinOpeningArea(
  huc6: string | null | undefined, area: string | null
): boolean {
  if (area === null) return true;
  return typeof huc6 === "string" && huc6.startsWith(area);
}
