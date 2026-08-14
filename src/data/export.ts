import type { TableRow } from "../state/table";
import type { MonthlyRecord, Reservoir, SourceKey } from "../types";

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => CsvValue;
}

function quoteCsv(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC-4180 rows with a fixed, caller-owned column order. */
export function serializeCsv<Row>(
  rows: readonly Row[], columns: readonly CsvColumn<Row>[]
): string {
  const lines = [
    columns.map((column) => quoteCsv(column.header)),
    ...rows.map((row) => columns.map((column) => quoteCsv(column.value(row))))
  ];
  return `${lines.map((line) => line.join(",")).join("\r\n")}\r\n`;
}

const PROVIDERS: Record<SourceKey, string> = {
  rise: "Bureau of Reclamation",
  awdb: "Natural Resources Conservation Service"
};

export function reservoirProvider(reservoir: Reservoir): string {
  return PROVIDERS[reservoir.source_key];
}

export function reservoirIdentifier(reservoir: Reservoir): string | number | null {
  return reservoir.source_station_id ?? reservoir.rise_item_id;
}

export function capacitySource(reservoir: Reservoir): string {
  if (reservoir.capacity_basis === "awdb_reservoir_metadata") {
    return "Natural Resources Conservation Service";
  }
  if (reservoir.capacity_basis === null) return "Not available";
  return "U.S. Army Corps of Engineers National Inventory of Dams";
}

/** The visible table columns first, followed by the record's provenance. */
export const OVERVIEW_COLUMNS: readonly CsvColumn<Reservoir>[] = [
  { header: "Reservoir", value: (row) => row.name },
  { header: "Drainage area", value: (row) => row.huc6_name },
  { header: "Full (percent)", value: (row) => row.pct_of_capacity },
  { header: "Storage (acre-feet)", value: (row) => row.current_storage_af },
  { header: "Capacity (acre-feet)", value: (row) => row.capacity_af },
  { header: "Observation date", value: (row) => row.as_of },
  { header: "Measured by", value: reservoirProvider },
  { header: "Station or item identifier", value: reservoirIdentifier },
  { header: "Full-level source", value: capacitySource }
];

export function overviewCsv(reservoirs: readonly Reservoir[]): string {
  return serializeCsv(reservoirs, OVERVIEW_COLUMNS);
}

/**
 * The map's table, exported as it stands.
 *
 * Written from the same `TableRow[]` the renderer is handed, so the file
 * cannot contain a different set of reservoirs, a different order or a
 * different month from the rows the reader is looking at -- there is no
 * second query here to get subtly wrong. `Reading` carries the date or the
 * month the two storage columns describe, so a file exported from a past
 * month is not mistaken for today's.
 */
export const TABLE_COLUMNS: readonly CsvColumn<TableRow>[] = [
  { header: "Reservoir", value: (row) => row.name },
  { header: "Drainage area", value: (row) => row.areaName },
  { header: "Full (percent)", value: (row) => row.percent },
  { header: "Storage (acre-feet)", value: (row) => row.storageAf },
  { header: "Full level (acre-feet)", value: (row) => row.capacityAf },
  { header: "Reading", value: (row) => row.reading },
  { header: "Late data", value: (row) => (row.late ? "yes" : "no") }
];

export function tableCsv(rows: readonly TableRow[]): string {
  return serializeCsv(rows, TABLE_COLUMNS);
}

interface HistoryRow {
  reservoir: Reservoir;
  month: MonthlyRecord | null;
}

const HISTORY_COLUMNS: readonly CsvColumn<HistoryRow>[] = [
  { header: "Reservoir", value: ({ reservoir }) => reservoir.name },
  { header: "Drainage area", value: ({ reservoir }) => reservoir.huc6_name },
  { header: "Measured by", value: ({ reservoir }) => reservoirProvider(reservoir) },
  {
    header: "Station or item identifier",
    value: ({ reservoir }) => reservoirIdentifier(reservoir)
  },
  { header: "Observation date", value: ({ reservoir }) => reservoir.as_of },
  { header: "Storage (acre-feet)", value: ({ reservoir }) => reservoir.current_storage_af },
  { header: "Capacity (acre-feet)", value: ({ reservoir }) => reservoir.capacity_af },
  { header: "Full (percent)", value: ({ reservoir }) => reservoir.pct_of_capacity },
  { header: "Full-level source", value: ({ reservoir }) => capacitySource(reservoir) },
  { header: "History month", value: ({ month }) => month?.month },
  { header: "Average storage (acre-feet)", value: ({ month }) => month?.mean_af },
  { header: "Lowest storage (acre-feet)", value: ({ month }) => month?.min_af },
  { header: "Highest storage (acre-feet)", value: ({ month }) => month?.max_af },
  { header: "Closing storage (acre-feet)", value: ({ month }) => month?.end_af },
  { header: "Normal (acre-feet)", value: ({ month }) => month?.normal_af },
  { header: "Days with readings", value: ({ month }) => month?.days }
];

export function reservoirHistoryCsv(reservoir: Reservoir): string {
  const months: readonly (MonthlyRecord | null)[] = reservoir.monthly.length
    ? reservoir.monthly : [null];
  return serializeCsv(months.map((month) => ({ reservoir, month })), HISTORY_COLUMNS);
}

function safeFilenamePart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function overviewCsvFilename(date: string): string {
  return `utah-reservoirs-${date.slice(0, 10)}.csv`;
}

export function reservoirCsvFilename(name: string, date: string): string {
  return `${safeFilenamePart(name) || "reservoir"}-${date.slice(0, 10)}.csv`;
}
