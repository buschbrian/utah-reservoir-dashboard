/*
 * The ranking chart in the bottom row, as data.
 *
 * Pure: the table's own rows go in, chart records come out. The rows are the
 * filter's answer with the month already applied (`state/table.ts`), so the
 * chart cannot show a different set, month or values from the table beside
 * it -- the same one-array construction that makes the CSV export honest.
 *
 * The colour of every bar comes from the class table (ADR-008) through
 * `storageClass`, never from a copy of the breaks. The bar's length and its
 * colour are computed from the same rounded value, so the two claims a bar
 * makes cannot disagree at a class boundary.
 */

import type { OverviewChartRecord } from "../overview-model";
import { STALE_COLOR, storageClass } from "../viz/classes";
import type { TableRow } from "./table";

/**
 * Every reservoir the filter matches that has a readable percentage, lowest
 * first. A reservoir with no percentage is left out rather than ranked at
 * zero: a ranking is a claim about order, and "we do not know" has no place
 * in one -- the same rule the overview's histogram follows.
 */
export function rankingRecords(rows: readonly TableRow[]): OverviewChartRecord[] {
  return rows
    .filter((row): row is TableRow & { percent: number } =>
      row.percent !== null && Number.isFinite(row.percent))
    .sort((a, b) => (a.percent - b.percent) || a.name.localeCompare(b.name))
    .map((row, index) => {
      const percent = Number(row.percent.toFixed(1));
      const found = storageClass(percent);
      return {
        id: index + 1,
        label: row.name,
        percent,
        storageAf: row.storageAf ?? 0,
        capacityAf: row.capacityAf ?? 0,
        classLabel: found?.label ?? "Not reported",
        classColor: found?.color ?? STALE_COLOR
      };
    });
}

/**
 * What the chart says it is showing.
 *
 * It has to name both numbers whenever they differ, for the same reason the
 * table's caption does: a chart quietly ranking 48 of 51 reservoirs looks
 * like a dashboard that lost three.
 */
export function describeRanking(ranked: number, shown: number): string {
  const scope = ranked === shown
    ? `All ${shown} reservoirs the analysis controls match, lowest first.`
    : `${ranked} of ${shown} reservoirs, lowest first. ` +
      "A reservoir with no readable percentage is not ranked.";
  return `${scope} The bar colors are the storage levels in the map key.`;
}
