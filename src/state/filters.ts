/*
 * What the reader has chosen to look at, and the two forms that choice has
 * to take.
 *
 * The map dims what is excluded rather than removing it, so the filter is
 * expressed twice: once as a predicate the list and the summary count use,
 * and once as a `where` clause the layer view's `featureEffect` uses. Two
 * expressions of one rule is how a map ends up disagreeing with the list
 * beside it, so both are built here from the same bounds and both are held
 * against each other in `filters.test.ts` -- over the committed payload, so
 * the assertion is "these two agree", never "today's data looks like this".
 *
 * The storage bounds are not written down here. They are read from
 * `STORAGE_CLASSES` (ADR-008): the class a reservoir is filtered into is the
 * class it is coloured by, or the legend is describing a different map than
 * the one on screen.
 */

import { isLate } from "../data/rollup";
import { HUC_CODE } from "../data/huc";
import { STORAGE_CLASSES, storageClass } from "../viz/classes";
import { headlinePercent } from "../viz/symbols";
import type { Reservoir } from "../types";

/** How a reservoir's reading age is reported. */
export type Reporting = "all" | "late" | "current";

export interface FilterState {
  /** An index into `STORAGE_CLASSES`, or null for every class. */
  storageClass: number | null;
  reporting: Reporting;
  /** A drainage-area code the payload carries, or null for every area. */
  drainageArea: string | null;
}

export const ALL_RESERVOIRS: FilterState = {
  storageClass: null, reporting: "all", drainageArea: null
};

/** The index of a reservoir's storage class, or null when it has none. */
export function classIndexOf(reservoir: Reservoir): number | null {
  const found = storageClass(headlinePercent(reservoir));
  if (!found) return null;
  const index = STORAGE_CLASSES.indexOf(found);
  return index < 0 ? null : index;
}

export function isFiltered(state: FilterState): boolean {
  return state.storageClass !== null
    || state.reporting !== "all"
    /* The validated code, so a refused one reads as "nothing is filtered"
     * here too -- otherwise `filterWhere` returns null for a filter this
     * reports as active, and the caller hands the layer no clause while the
     * summary says a drainage area is chosen. */
    || drainageAreaCode(state) !== null;
}

export function matchesFilter(reservoir: Reservoir, state: FilterState): boolean {
  if (state.reporting === "late" && !isLate(reservoir)) return false;
  if (state.reporting === "current" && isLate(reservoir)) return false;
  /* Matched by prefix rather than by equality, which is exact at every level
   * a reader may choose: hydrologic codes are fixed-width and nest, so a
   * four-digit choice is the subregion a six-digit code sits inside and a
   * six-digit choice still matches only itself (ADR-064).
   *
   * Through `drainageAreaCode`, so this reads the same validated code the
   * clause does. Reading `state.drainageArea` raw is what made the two forms
   * disagree on a code of an odd width: the clause dropped it and greyed
   * nothing, while this prefix-matched five characters and dimmed the list. */
  const code = drainageAreaCode(state);
  if (code !== null && !coversDrainageArea(code, reservoir.huc6 ?? "")) {
    return false;
  }
  if (state.storageClass === null) return true;
  return classIndexOf(reservoir) === state.storageClass;
}

/**
 * The filter as bounds on the layer's own fields, which is the form the
 * `where` clause is rendered from.
 *
 * This exists so the clause is not a second, hand-written statement of the
 * rule: the test applies these bounds to the attributes the features
 * actually carry and holds the result against `matchesFilter`.
 *
 * The lowest class gets no lower bound on purpose. `storageClass` returns it
 * for any readable percentage below the next break, including a negative
 * one, and `fill_percent >= 0` would quietly grey out exactly those features
 * while the list still listed them.
 */
export interface FilterBounds {
  /** 1 or 0 to require that late state, null to accept either. */
  late: 1 | 0 | null;
  /** Inclusive lower bound on `fill_percent`, null for none. */
  minPercent: number | null;
  /** Exclusive upper bound on `fill_percent`, null for none. */
  maxPercent: number | null;
  /** A `drainage_area` code to match by prefix, null to accept every area.
   * Matched by prefix rather than equality for the reason `matchesFilter`
   * is: a shorter code is a region or subregion a full-width code sits
   * inside. */
  drainageArea: string | null;
}

/**
 * Drainage-area codes are digits in the payload and in the committed
 * boundaries, and this is the only value in the clause that comes from data
 * rather than from a bounded set. A code of any other shape is dropped rather
 * than quoted: a clause is a small language, and the one thing never worth
 * doing is passing a string through into it because it looked fine today.
 *
 * `HUC_CODE` is the shared pattern (`src/data/huc.ts`) rather than a second
 * hand-rolled one: codes are fixed-width and come in even lengths from 2 to
 * 12, so this refuses a 5-digit typo the same way it refuses a letter.
 */
const DRAINAGE_AREA_CODE = HUC_CODE;

/**
 * The drainage area a filter actually asks for, or null when it asks for
 * every area.
 *
 * One reading of the reader's choice, used by both the predicate and the
 * bounds the clause is rendered from. A code this refuses is not a narrower
 * filter, it is no filter -- and the important part is that it is no filter
 * to *both* of them. Two validations of one value is how a map and the list
 * beside it come to disagree about what was asked for, which is the whole
 * failure this module exists to prevent.
 */
function drainageAreaCode(state: FilterState): string | null {
  return state.drainageArea !== null && DRAINAGE_AREA_CODE.test(state.drainageArea)
    ? state.drainageArea
    : null;
}

/**
 * Whether a full-width drainage-area code sits inside the one the reader
 * chose.
 *
 * The single prefix test, exported because three surfaces need the same
 * answer and had begun to write it out separately: this module's predicate,
 * the storage map's "is this choice still on the map" check, and the list of
 * areas its control offers. `applyScope` was comparing for equality against a
 * list of six-digit basins, so a shared link carrying a region or a subregion
 * (`?area=14`, `?area=1401`) was widened back to the whole roster before it
 * ever reached `matchesFilter`, which prefix-matches perfectly well.
 *
 * Validated here rather than by the caller, for the reason `drainageAreaCode`
 * is: a code of an odd width is not a narrower filter, it is no filter, and it
 * has to be no filter to every reading of it. A five-digit typo prefix-matches
 * a six-digit basin quite happily and would otherwise pass this.
 */
export function coversDrainageArea(chosen: string, code: string): boolean {
  return DRAINAGE_AREA_CODE.test(chosen) && code.slice(0, chosen.length) === chosen;
}

/** The layer field the clause reads. Exported so `layers.ts` builds the
 * attribute from the same name the filter asks for. */
export const DRAINAGE_AREA_FIELD = "drainage_area";

export function filterBounds(state: FilterState): FilterBounds {
  const index = state.storageClass;
  const lower = index === null ? undefined : STORAGE_CLASSES[index];
  const upper = index === null ? undefined : STORAGE_CLASSES[index + 1];
  return {
    late: state.reporting === "all" ? null : state.reporting === "late" ? 1 : 0,
    minPercent: index === null || index === 0 || !lower ? null : lower.min,
    maxPercent: index === null ? null : upper?.min ?? null,
    drainageArea: drainageAreaCode(state)
  };
}

/**
 * The same rule as a `where` clause over the layer's own fields.
 *
 * Returns null when nothing is filtered, which is the layer view's own way
 * of saying "no effect", not a clause that happens to match everything.
 * A reservoir with no readable percentage is in no class, and a null fails
 * every comparison, so it is excluded without a clause of its own.
 */
export function filterWhere(state: FilterState): string | null {
  if (!isFiltered(state)) return null;
  const bounds = filterBounds(state);
  const clauses: string[] = [];
  if (bounds.drainageArea !== null) {
    /* A prefix match, not an equality, because `matchesFilter` is one: codes
     * nest, so a four-digit choice has to match every six-digit code sitting
     * inside it, not just a four-digit field value that never occurs. The
     * layer's own field always holds a full-width code or the empty string
     * (`layers.ts`), so `LIKE '<code>%'` lands on exactly the same rows as
     * equality when the code is already full width -- one clause covers both
     * cases rather than branching on length. `bounds.drainageArea` is
     * digits-only by construction (`DRAINAGE_AREA_CODE` above), so there is
     * no wildcard character a reader's choice could smuggle into the pattern. */
    clauses.push(`${DRAINAGE_AREA_FIELD} LIKE '${bounds.drainageArea}%'`);
  }
  if (bounds.late !== null) clauses.push(`late = ${bounds.late}`);
  if (bounds.minPercent !== null) clauses.push(`fill_percent >= ${bounds.minPercent}`);
  if (bounds.maxPercent !== null) clauses.push(`fill_percent < ${bounds.maxPercent}`);
  // The lowest class has neither bound rendered above when it is also the
  // only class, which would leave a reporting-only clause -- correct, since
  // that class then covers every readable percentage.
  //
  // No clause at all means no effect, which is the same answer as "nothing is
  // filtered". It is reachable when a drainage area is the only thing chosen
  // and its code is refused above -- an empty string is not a where clause,
  // and handing one to the layer view is how a filter greys everything.
  return clauses.length ? clauses.join(" AND ") : null;
}

/** Plain-language label for a storage choice, taken from the class table. */
export function storageLabel(index: number | null): string {
  return index === null ? "All storage levels" : STORAGE_CLASSES[index]?.label ?? "All storage levels";
}

export function reportingLabel(reporting: Reporting): string {
  if (reporting === "late") return "Late data only";
  if (reporting === "current") return "Current data only";
  return "All reporting status";
}

/**
 * The drainage-area choice as the reader sees it.
 *
 * The name comes from the caller because the code is what the state carries
 * and the name is what the payload carries. A chosen area with no name left
 * -- possible for a moment after the scope changes -- reads as every area
 * rather than as a code the reader never typed.
 */
export function drainageAreaLabel(name: string | null): string {
  return name === null || name === "" ? "All drainage areas" : name;
}

/**
 * What the panel says the filter is doing. The map dims rather than hides,
 * so this has to say how many of how many, not just how many.
 */
export function describeFilter(
  state: FilterState, shown: number, total: number, drainageAreaName: string | null = null
): string {
  if (!isFiltered(state)) return `Showing all ${total} reservoirs.`;
  /* The area is part of the noun -- "reservoirs in Jordan" -- and the other
   * two are what is said about them. Keeping the area out of the list after
   * the colon is what makes the sentence read when it is the only choice. */
  const where = state.drainageArea === null
    ? ""
    : ` in ${drainageAreaName === null || drainageAreaName === ""
      ? "one drainage area" : drainageAreaName}`;
  const parts = [
    state.storageClass === null ? null : storageLabel(state.storageClass).toLowerCase(),
    state.reporting === "all" ? null : reportingLabel(state.reporting).toLowerCase()
  ].filter((part): part is string => part !== null);
  const about = parts.length ? `: ${parts.join(", ")}` : "";
  return `Showing ${shown} of ${total} reservoirs${where}${about}. ` +
    "The other reservoirs stay on the map in grey.";
}
