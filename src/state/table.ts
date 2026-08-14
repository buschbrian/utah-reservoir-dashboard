/*
 * The rows under the map, and the order the reader put them in.
 *
 * Pure: reservoirs and a sort go in, rows come out. The renderer in
 * `ui/table.ts` and the CSV writer in `data/export.ts` are both handed the
 * same array, which is what makes "the file contains exactly the rows on
 * screen" a property rather than a promise -- there is no second query for
 * the export to get subtly wrong.
 *
 * WHY THE TABLE NARROWS WHERE THE MAP DIMS
 *
 * The map greys excluded reservoirs and keeps them (see `filters.ts`),
 * because removing a circle from a map removes the geography around it too.
 * A table has no geography to lose, and a sorted table with excluded rows
 * left in it interleaves them through the order the reader just asked for.
 * So the table lists what the filter matches, says how many of how many, and
 * the panel list beside it keeps every reservoir in scope operable -- which
 * is where the keyboard path and ADR-020's reachability actually live.
 * Recorded as ADR-029.
 */

import { isLate } from "../data/rollup";
import { matchesFilter, type FilterState } from "./filters";
import type { MonthKey } from "../data/months";
import type { NullableNumber, Reservoir } from "../types";

/** What a column can be ordered by. The reader's choice, not the data's. */
export type SortKey = "name" | "percent" | "storage" | "capacity" | "area";
export type SortDirection = "asc" | "desc";

export interface TableSort {
  key: SortKey;
  direction: SortDirection;
}

/* Alphabetical, ascending. The lowest-storage ranking is a real question but
 * it is the ranking chart's question; a table that reorders itself on every
 * refresh is a poor place to look a reservoir up. */
export const DEFAULT_SORT: TableSort = { key: "name", direction: "asc" };

export const SORT_KEYS: readonly SortKey[] = ["name", "percent", "storage", "capacity", "area"];

/** The column headings, in the order the table renders them. */
export const COLUMN_LABELS: Record<SortKey, string> = {
  name: "Reservoir",
  percent: "Full",
  storage: "Storage",
  capacity: "Full level",
  area: "Drainage area"
};

/**
 * One reservoir as the table shows it.
 *
 * `percent` and `storage` follow the month slider, because the map, the list
 * and the headline all do: a table reporting today while the map draws last
 * November is the page saying two things at once. `capacity` and `area` do
 * not -- neither is a per-month fact.
 */
export interface TableRow {
  name: string;
  percent: NullableNumber;
  storageAf: NullableNumber;
  capacityAf: NullableNumber;
  areaName: string;
  late: boolean;
  /** The date or month the two values above describe. */
  reading: string;
}

export interface TableInput {
  reservoirs: readonly Reservoir[];
  filter: FilterState;
  sort: TableSort;
  /** The month on the slider, or null while the newest reading is shown. */
  month: MonthKey | null;
  /** What a reservoir's percentage is right now -- the same function the map
   * and the list draw from, passed in rather than re-derived here. */
  percentOf: (reservoir: Reservoir) => NullableNumber;
}

function monthlyMean(reservoir: Reservoir, month: MonthKey): NullableNumber {
  return reservoir.monthly.find((record) => record.month === month)?.mean_af ?? null;
}

/**
 * Nulls last, in both directions.
 *
 * A reservoir with no reading is not the smallest reservoir, and sorting it
 * to the top of an ascending column says it is. Descending would then hide
 * it at the bottom, so the reader would see a different set of rows at the
 * top depending on which way the arrow points, from one click.
 */
function compareNumbers(a: NullableNumber, b: NullableNumber, direction: SortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function compareText(a: string, b: string, direction: SortDirection): number {
  const order = a.localeCompare(b, "en");
  return direction === "asc" ? order : -order;
}

export function compareRows(a: TableRow, b: TableRow, sort: TableSort): number {
  switch (sort.key) {
    case "percent":
      return compareNumbers(a.percent, b.percent, sort.direction) || compareText(a.name, b.name, "asc");
    case "storage":
      return compareNumbers(a.storageAf, b.storageAf, sort.direction) || compareText(a.name, b.name, "asc");
    case "capacity":
      return compareNumbers(a.capacityAf, b.capacityAf, sort.direction) || compareText(a.name, b.name, "asc");
    case "area":
      /* An unassigned reservoir sorts with the named areas rather than after
       * them: the empty string is what the layer carries for "no area" and
       * the reader sees the same blank cell either way. The name breaks the
       * tie, so an area's own reservoirs stay alphabetical inside it. */
      return compareText(a.areaName, b.areaName, sort.direction) || compareText(a.name, b.name, "asc");
    default:
      return compareText(a.name, b.name, sort.direction);
  }
}

/** The rows the filter matches, in the reader's order. */
export function tableRows(input: TableInput): TableRow[] {
  const { reservoirs, filter, sort, month, percentOf } = input;
  return reservoirs
    .filter((reservoir) => matchesFilter(reservoir, filter))
    .map((reservoir) => ({
      name: reservoir.name,
      percent: percentOf(reservoir),
      storageAf: month === null ? reservoir.current_storage_af : monthlyMean(reservoir, month),
      capacityAf: reservoir.capacity_af,
      areaName: reservoir.huc6_name ?? "",
      late: isLate(reservoir),
      reading: month ?? reservoir.as_of
    }))
    .sort((a, b) => compareRows(a, b, sort));
}

/**
 * The next sort when a column heading is pressed.
 *
 * A new column starts ascending; the column already sorted flips. Text
 * columns read naturally ascending and the numeric ones are usually being
 * asked "which is lowest", so both start the same way and the reader gets
 * the other direction from a second press rather than from a rule they have
 * to know.
 */
export function nextSort(current: TableSort, key: SortKey): TableSort {
  if (current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

/** The sort as one URL-safe token, and back. Null for the default, which is
 * written as absence like every other unchanged control. */
export function sortToken(sort: TableSort): string | null {
  if (sort.key === DEFAULT_SORT.key && sort.direction === DEFAULT_SORT.direction) return null;
  return `${sort.key}-${sort.direction}`;
}

export function sortFromToken(token: string | null | undefined): TableSort {
  const [key, direction] = String(token ?? "").split("-");
  if (!SORT_KEYS.includes(key as SortKey)) return { ...DEFAULT_SORT };
  return {
    key: key as SortKey,
    direction: direction === "desc" ? "desc" : "asc"
  };
}

/**
 * What the table says it is showing.
 *
 * It has to name both numbers whenever they differ: a table that silently
 * holds 12 of 51 rows looks like a dashboard that lost 39 reservoirs.
 */
export function describeTable(shown: number, total: number, month: MonthKey | null,
  monthName: string): string {
  const scope = shown === total
    ? `All ${total} reservoirs.`
    : `${shown} of ${total} reservoirs, from the analysis controls.`;
  const values = month === null
    ? "Values are the newest reading from each reservoir."
    : `Values are the average through ${monthName}.`;
  return `${scope} ${values}`;
}
