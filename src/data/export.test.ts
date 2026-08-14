import { describe, expect, it } from "vitest";
import { readPayload } from "./payload-fixture";
import { ALL_RESERVOIRS } from "../state/filters";
import { DEFAULT_SORT, tableRows } from "../state/table";
import { headlinePercent } from "../viz/symbols";
import {
  OVERVIEW_COLUMNS,
  TABLE_COLUMNS,
  overviewCsv,
  overviewCsvFilename,
  reservoirCsvFilename,
  reservoirHistoryCsv,
  serializeCsv,
  tableCsv
} from "./export";

describe("CSV serialization", () => {
  it("keeps the declared header order and raw numeric values", () => {
    const reservoir = readPayload().reservoirs[0];
    expect(reservoir).toBeDefined();
    if (!reservoir) return;
    const [header, row] = overviewCsv([reservoir]).trim().split("\r\n");
    expect(header).toBe(OVERVIEW_COLUMNS.map((column) => column.header).join(","));
    expect(row).toContain(String(reservoir.current_storage_af));
    expect(row).not.toContain(reservoir.current_storage_af.toLocaleString("en-US"));
  });

  /**
   * The promise the export button makes: the file is the rows on screen.
   * Both are built from one `TableRow[]`, so this holds the count, the order
   * and the reading against the array the renderer was handed rather than
   * against a second query written to look the same.
   */
  it("writes the map table's rows in the order the reader put them in", () => {
    const reservoirs = readPayload().reservoirs;
    const rows = tableRows({
      reservoirs, filter: ALL_RESERVOIRS, month: null, percentOf: headlinePercent,
      sort: { key: "percent", direction: "desc" }
    });
    const lines = tableCsv(rows).trim().split("\r\n");

    expect(lines[0]).toBe(TABLE_COLUMNS.map((column) => column.header).join(","));
    expect(lines.slice(1)).toHaveLength(rows.length);
    expect(lines.slice(1).map((line) => line.split(",")[0]?.replace(/^"|"$/g, "")))
      .toEqual(rows.map((row) => row.name));
    // Raw numbers, not the formatted ones the cells show.
    const first = rows[0];
    if (first?.storageAf !== null && first?.storageAf !== undefined) {
      expect(lines[1]).toContain(String(first.storageAf));
    }
  });

  it("quotes commas, quotes and newlines and leaves empty values empty", () => {
    const csv = serializeCsv([
      { value: "One, two" },
      { value: 'He said "yes"' },
      { value: "Two\nlines" },
      { value: null },
      { value: undefined }
    ], [{ header: "Value", value: (row) => row.value }]);
    expect(csv).toBe(
      'Value\r\n"One, two"\r\n"He said ""yes"""\r\n"Two\nlines"\r\n\r\n\r\n');
  });

  it("serializes only the filtered rows handed to it", () => {
    const reservoirs = readPayload().reservoirs;
    const filtered = reservoirs.filter((reservoir) => reservoir.huc6 === reservoirs[0]?.huc6);
    const csv = overviewCsv(filtered);
    const body = csv.trim().split("\r\n").slice(1);
    expect(body).toHaveLength(filtered.length);
    expect(body.every((line) => filtered.some((reservoir) => line.includes(reservoir.name))))
      .toBe(true);
  });

  it("exports the current record with each available history month", () => {
    const reservoir = readPayload().reservoirs.find((row) => row.monthly.length > 0);
    expect(reservoir).toBeDefined();
    if (!reservoir) return;
    const lines = reservoirHistoryCsv(reservoir).trim().split("\r\n");
    expect(lines).toHaveLength(reservoir.monthly.length + 1);
    expect(lines[0]).toContain("Station or item identifier");
    expect(lines[0]).toContain("History month");
  });

  it("constructs stable, readable filenames", () => {
    expect(overviewCsvFilename("2026-08-14T12:00:00Z"))
      .toBe("utah-reservoirs-2026-08-14.csv");
    expect(reservoirCsvFilename("Ken's Lake", "2026-08-14"))
      .toBe("ken-s-lake-2026-08-14.csv");
  });
});
