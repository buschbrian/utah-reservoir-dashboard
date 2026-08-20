/*
 * The pure half of the where control (S4,
 * docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md): what each of its four
 * selects offers, what it shows as chosen, and what a reader's raw pick
 * turns into. Kept apart from `where-control.ts`, which imports this module
 * and does the actual DOM building, because nothing in this codebase can
 * exercise a custom element outside a browser (no `jsdom` here -- the same
 * split `ui/hover-content.ts`/`ui/hover.ts` already use, and importing a
 * component's side-effecting module -- `@esri/calcite-components/...` --
 * from a plain Node test fails before a single assertion runs). The
 * narrowing, the preserved-choice-on-repopulate rule and the fallback-to-
 * all rule this feature owes tests for all live in functions a Node test
 * can call directly, here.
 *
 * The narrowing itself is not re-derived. `data/opening-scope.ts`'s
 * `resolveOpeningScope` already narrows the published rosters coarsest
 * first -- state first, then region, then subregion, then basin -- and
 * already keeps a surviving choice while dropping a dead one to "all".
 * `whereControlView` and the four `nextSelectionFor*` functions below are a
 * thin layer over that resolver: they turn its answer into what four
 * `<calcite-select>`s need (an offered list and a selected value apiece) and
 * turn a reader's raw pick back into the `OpeningSelection` shape the
 * resolver reads.
 */
import { areaAtLevel, resolveOpeningScope, type OpeningRosters, type OpeningSelection } from "../data/opening-scope";
import { offeredStates } from "../data/state-vocabulary";

/**
 * The three prefix widths the drill-down offers, named again rather than
 * imported: `data/opening-scope.ts` deliberately keeps `REGION_WIDTH`,
 * `SUBREGION_WIDTH` and `AREA_WIDTH` private (`drought.ts`'s own
 * `REGION_CODE_WIDTH`/`SUBREGION_CODE_WIDTH` made the same choice), so a
 * reader of this file sees what each width means without cross-referencing
 * another module's source.
 */
const REGION_WIDTH = 2;
const SUBREGION_WIDTH = 4;
const AREA_WIDTH = 6;

/**
 * The value every "not narrowed at this level" option carries, on all four
 * selects. Never written into the address bar as `?state=all` -- that
 * sentinel is S5's, and deliberately not this slice's to add
 * (docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md, S4: "Do not persist
 * anything and do not add `?state=all`"). Here it means only "the reader
 * picked the option that means nothing is chosen at this level", which the
 * `next selection` functions below turn into `"all"` or `null`, never into
 * this string.
 */
export const ALL_VALUE = "all";

/** One row a `<calcite-select>` can offer. */
export interface WhereOption {
  value: string;
  label: string;
}

/** One select's worth of state: what to offer, and which one is chosen. */
export interface WhereAxis {
  value: string;
  options: readonly WhereOption[];
}

/** The four axes `createWhereControl` builds a select for. */
export interface WhereControlView {
  state: WhereAxis;
  region: WhereAxis;
  subregion: WhereAxis;
  area: WhereAxis;
}

/**
 * A subregion's label, disambiguated the way the landed coarse-area work
 * already does (`main.ts`'s `coarseAreaLabel`): nineteen of the drawn
 * basins carry their subregion's name exactly, so a bare "Bear" would be
 * two rows in one list meaning different things. Region needs no such
 * suffix -- the published `west-huc2` names already say so ("Upper Colorado
 * Region"), and `parseDrainageUnits` already falls a missing name back to
 * the code itself, so there is nothing this function would add. Basin needs
 * none either: it is the finest level offered, so nothing narrower could
 * ever repeat its name back at a reader.
 */
function subregionOptionLabel(name: string): string {
  return `${name} subregion`;
}

/**
 * The four axes' offered lists and selected values, built from
 * `resolveOpeningScope`'s own narrowing rather than re-derived.
 *
 * `state`'s options are the one list not read from `resolveOpeningScope`'s
 * answer: which states exist to choose is a property of the whole roster,
 * unaffected by anything a reader has already narrowed to, so it is built
 * from `rosters.areas` -- always the full, unnarrowed roster
 * (`OpeningRosters`'s own doc) -- every time.
 *
 * `region`, `subregion` and `area` read `scope.regions`, `scope.subregions`
 * and `scope.areas`: each already narrowed by everything coarser than
 * itself and by nothing at its own level (`resolveOpeningScope`'s own
 * comment: "a subregion list narrowed down to the one subregion already
 * chosen would give a reader nothing to switch to"). That is what makes a
 * reader's surviving choice show up as one of the offered rows rather than
 * as a selected value with no matching option -- the preserved-choice-on-
 * repopulate rule this function owes a test for.
 *
 * The three selected values come from `scope.selection.area`, the resolved
 * and aliveness-checked selection -- not the raw `selection` passed in. A
 * selection whose area does not survive the state it was narrowed against
 * has already fallen to `null` there, so all three read as `ALL_VALUE`
 * without this function repeating that check -- the fallback-to-all rule.
 */
export function whereControlView(rosters: OpeningRosters, selection: OpeningSelection): WhereControlView {
  const scope = resolveOpeningScope(selection, rosters);
  const resolvedArea = scope.selection.area;

  const stateOptions = offeredStates({ drainageAreaStates: rosters.areas.map((area) => area.states) });

  return {
    state: {
      value: scope.selection.state,
      options: [
        { value: ALL_VALUE, label: "All states" },
        ...stateOptions.map((option) => ({ value: option.code, label: option.label }))
      ]
    },
    region: {
      value: resolvedArea !== null ? resolvedArea.slice(0, REGION_WIDTH) : ALL_VALUE,
      options: [
        { value: ALL_VALUE, label: "All regions" },
        ...scope.regions.map((region) => ({ value: region.huc6, label: region.name }))
      ]
    },
    subregion: {
      value: resolvedArea !== null && resolvedArea.length >= SUBREGION_WIDTH
        ? resolvedArea.slice(0, SUBREGION_WIDTH)
        : ALL_VALUE,
      options: [
        { value: ALL_VALUE, label: "All subregions" },
        ...scope.subregions.map((subregion) =>
          ({ value: subregion.huc6, label: subregionOptionLabel(subregion.name) }))
      ]
    },
    area: {
      value: resolvedArea !== null && resolvedArea.length === AREA_WIDTH ? resolvedArea : ALL_VALUE,
      options: [
        { value: ALL_VALUE, label: "All drainage areas" },
        ...scope.areas.map((area) => ({ value: area.huc6, label: area.name }))
      ]
    }
  };
}

/**
 * A reader's new state pick, resolved rather than assumed alive.
 *
 * Reuses `resolveOpeningScope` for the one thing a state change can break: a
 * region, subregion or basin narrowed under the old state may reach nowhere
 * under the new one (`?state=WY` after a Great Basin subregion choice, say).
 * `resolveOpeningScope` already answers that -- a dead area falls to `null`,
 * a live one is kept exactly -- so this function does not repeat the check,
 * it only builds the tentative selection the resolver is asked about.
 */
export function nextSelectionForState(
  current: OpeningSelection, rosters: OpeningRosters, chosen: string
): OpeningSelection {
  const state = chosen === ALL_VALUE ? "all" : chosen;
  return resolveOpeningScope({ state, area: current.area }, rosters).selection;
}

/**
 * A reader's new region pick. Picking a specific region replaces the whole
 * area choice with it -- a fresh region carries no subregion or basin of its
 * own yet. Picking "All regions" clears the area choice entirely: there is
 * no coarser level than region for it to fall back to.
 */
export function nextSelectionForRegion(current: OpeningSelection, chosen: string): OpeningSelection {
  return { state: current.state, area: chosen === ALL_VALUE ? null : chosen };
}

/**
 * A reader's new subregion pick. "All subregions" does not clear the whole
 * area choice -- it falls back one level, to whichever region the reader had
 * already narrowed to (`areaAtLevel` truncates a longer code to the region
 * width; a `null` area stays `null`), the same "coarsen, never empty" rule
 * `data/opening-scope.ts#areaAtLevel` documents for a surface reading the
 * selection at its own drawn level.
 */
export function nextSelectionForSubregion(current: OpeningSelection, chosen: string): OpeningSelection {
  const area = chosen === ALL_VALUE ? areaAtLevel(current.area, REGION_WIDTH) : chosen;
  return { state: current.state, area };
}

/**
 * A reader's new basin ("drainage area") pick. "All drainage areas" falls
 * back to the subregion level, the same shape as the subregion function
 * above, one level finer.
 */
export function nextSelectionForArea(current: OpeningSelection, chosen: string): OpeningSelection {
  const area = chosen === ALL_VALUE ? areaAtLevel(current.area, SUBREGION_WIDTH) : chosen;
  return { state: current.state, area };
}
