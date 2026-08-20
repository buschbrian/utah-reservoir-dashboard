/*
 * The table's rules, held against the committed payload rather than against
 * today's numbers: every assertion here is about ordering, membership and
 * agreement between two surfaces, so a morning's refresh cannot turn the
 * build red without a real defect behind it.
 */
import { describe, expect, it } from "vitest";
import { readPayload } from "../data/payload-fixture";
import { reservoirLabel } from "./selection";
import { headlinePercent } from "../viz/symbols";
import { ALL_RESERVOIRS, matchesFilter, type FilterState } from "./filters";
import {
  DEFAULT_SORT,
  SORT_KEYS,
  compareRows,
  describeTable,
  nextSort,
  sortFromToken,
  sortToken,
  tableRows,
  type SortKey,
  type TableRow
} from "./table";
import type { NullableNumber, Reservoir } from "../types";

const payload = readPayload();
const reservoirs = payload.reservoirs;

function rowsFor(filter: FilterState = ALL_RESERVOIRS, sort = DEFAULT_SORT): TableRow[] {
  return tableRows({ reservoirs, filter, sort, month: null, percentOf: headlinePercent });
}

describe("the table's rows", () => {
  it("lists exactly the reservoirs the filter matches", () => {
    const filter: FilterState = { ...ALL_RESERVOIRS, reporting: "late" };
    const rows = rowsFor(filter);
    const expected = reservoirs.filter((reservoir) => matchesFilter(reservoir, filter));

    expect(rows).toHaveLength(expected.length);
    expect([...rows.map((row) => row.name)].sort())
      .toEqual([...expected.map((reservoir) => reservoir.name)].sort());
  });

  it("takes its percentage from the same function the map draws from", () => {
    for (const row of rowsFor()) {
      /* By the label the row actually carries, not by the raw name. The
       * western roster holds two Lost Creeks and two Clear Lakes, and the
       * table qualifies a shared name with its state (ADR-066) -- so a raw
       * name matches neither of them and this looked up `undefined`. */
      const reservoir = reservoirs.find(
        (candidate) => reservoirLabel(candidate, reservoirs) === row.name);
      expect(row.percent).toBe(headlinePercent(reservoir as Reservoir));
    }
  });

  /* The month slider moves the map, the list and the headline together. A
   * table left on today's reading would be the one surface disagreeing. */
  it("follows the month slider for the values a month has", () => {
    const month = reservoirs.flatMap((reservoir) => reservoir.monthly).at(-1)?.month;
    expect(month).toBeTruthy();
    const percentOf = (): NullableNumber => 42;
    const rows = tableRows({
      reservoirs, filter: ALL_RESERVOIRS, sort: DEFAULT_SORT,
      month: month as string, percentOf
    });

    expect(rows.every((row) => row.percent === 42)).toBe(true);
    expect(rows.every((row) => row.reading === month)).toBe(true);
    for (const row of rows) {
      const reservoir = reservoirs.find(
        (candidate) => reservoirLabel(candidate, reservoirs) === row.name) as Reservoir;
      const record = reservoir.monthly.find((entry) => entry.month === month);
      expect(row.storageAf).toBe(record?.mean_af ?? null);
    }
  });

  it("reports the newest reading's own date when no month is chosen", () => {
    for (const row of rowsFor()) {
      const reservoir = reservoirs.find(
        (candidate) => reservoirLabel(candidate, reservoirs) === row.name) as Reservoir;
      expect(row.reading).toBe(reservoir.as_of);
      expect(row.storageAf).toBe(reservoir.current_storage_af);
    }
  });
});

describe("the table's order", () => {
  it("sorts alphabetically by default", () => {
    const names = rowsFor().map((row) => row.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("reverses every column without changing which rows are in it", () => {
    for (const key of SORT_KEYS) {
      const up = rowsFor(ALL_RESERVOIRS, { key, direction: "asc" });
      const down = rowsFor(ALL_RESERVOIRS, { key, direction: "desc" });

      expect(down).toHaveLength(up.length);
      expect([...down.map((row) => row.name)].sort())
        .toEqual([...up.map((row) => row.name)].sort());
    }
  });

  /**
   * A reservoir with no reading is not the emptiest reservoir. Sorting nulls
   * to the top of an ascending column claims it is, and flipping to
   * descending would then move them to the bottom -- so one click would
   * change which rows the reader is looking at for a reason that has nothing
   * to do with storage.
   */
  it("keeps rows with no value last in both directions", () => {
    const row = (name: string, percent: NullableNumber): TableRow => ({
      name, percent, storageAf: percent, capacityAf: null,
      areaName: "", late: false, reading: "2026-08-14"
    });
    const source = [row("A", null), row("B", 10), row("C", 90)];

    for (const direction of ["asc", "desc"] as const) {
      const sorted = [...source].sort((a, b) => compareRows(a, b, { key: "percent", direction }));
      expect(sorted.at(-1)?.name).toBe("A");
    }
  });

  it("breaks ties by name so an order is stable across refreshes", () => {
    const tie = (name: string): TableRow => ({
      name, percent: 50, storageAf: 50, capacityAf: 100,
      areaName: "Jordan", late: false, reading: "2026-08-14"
    });
    const sorted = [tie("Zebra"), tie("Alpha"), tie("Middle")]
      .sort((a, b) => compareRows(a, b, { key: "percent", direction: "desc" }));

    expect(sorted.map((row) => row.name)).toEqual(["Alpha", "Middle", "Zebra"]);
  });
});

describe("the sort control", () => {
  it("starts a new column ascending and flips the current one", () => {
    expect(nextSort(DEFAULT_SORT, "percent")).toEqual({ key: "percent", direction: "asc" });
    expect(nextSort({ key: "percent", direction: "asc" }, "percent"))
      .toEqual({ key: "percent", direction: "desc" });
    expect(nextSort({ key: "percent", direction: "desc" }, "percent"))
      .toEqual({ key: "percent", direction: "asc" });
  });

  it("writes the default as absence and round-trips every other sort", () => {
    expect(sortToken(DEFAULT_SORT)).toBeNull();
    for (const key of SORT_KEYS) {
      for (const direction of ["asc", "desc"] as const) {
        const sort = { key, direction };
        const token = sortToken(sort);
        expect(sortFromToken(token)).toEqual(token === null ? DEFAULT_SORT : sort);
      }
    }
  });

  /* A hand-edited or truncated link opens the table, it does not break it. */
  it("falls back to the default for anything it does not recognise", () => {
    for (const token of [null, undefined, "", "nonsense", "percent", "-asc", "storage-sideways"]) {
      const sort = sortFromToken(token);
      expect(SORT_KEYS).toContain(sort.key as SortKey);
      if (token === "percent") expect(sort).toEqual({ key: "percent", direction: "asc" });
      else if (token === "storage-sideways") expect(sort).toEqual({ key: "storage", direction: "asc" });
      else expect(sort).toEqual(DEFAULT_SORT);
    }
  });
});

describe("what the table says it is showing", () => {
  it("names both numbers whenever the filter is holding rows back", () => {
    expect(describeTable(12, 51, null, "")).toContain("12 of 51");
    expect(describeTable(51, 51, null, "")).toContain("All 51");
  });

  it("says which reading the values describe", () => {
    expect(describeTable(51, 51, null, "")).toContain("newest reading");
    expect(describeTable(51, 51, "2025-11", "November 2025")).toContain("November 2025");
  });
});
