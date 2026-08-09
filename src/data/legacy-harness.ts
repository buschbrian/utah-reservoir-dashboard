/* Loads the frozen `shared/reservoir-viz.js` into a sandbox so the ported
 * modules can be tested against it directly.
 *
 * The legacy file is an IIFE that hangs one object off `window`, which is
 * unimportable but perfectly evaluable: give it a bare object for `window`
 * and it hands back the same API the pages use. That is the whole point --
 * the alternative is snapshotting today's numbers as literals, and
 * `reservoirs.json` is rewritten every morning by the refresh workflow, so
 * a snapshot is a test that fails on a schedule.
 */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

export interface LegacyClassCount {
  label: string;
  color: string;
  count: number;
}

export interface LegacySummary {
  count: number;
  storage_af: number;
  capacity_af: number;
  pct_full: number | null;
  change_30d_af: number;
  change_365d_af: number;
  normal_af: number;
  pct_of_normal: number | null;
  normal_covers: number;
  stale: number;
  below_half: number;
  without_lake_powell: {
    count: number;
    storage_af: number;
    capacity_af: number;
    pct_full: number | null;
  };
  classes: LegacyClassCount[];
}

export interface LegacyApi {
  CLASSES: readonly { min: number; label: string; color: string }[];
  headlinePct(reservoir: unknown): number | null;
  sizeBasis(reservoir: unknown): number;
  colorFor(percent: number | null): string;
  statewideSummary(reservoirs: readonly unknown[]): LegacySummary;
}

export function loadLegacyApi(): LegacyApi {
  const source = readFileSync(
    new URL("../../shared/reservoir-viz.js", import.meta.url), "utf8"
  );
  const sandbox: { window: Record<string, unknown> } = { window: {} };
  runInContext(source, createContext(sandbox), { filename: "reservoir-viz.js" });
  const api = sandbox.window.ReservoirViz;
  if (!api) throw new Error("shared/reservoir-viz.js did not export ReservoirViz");
  return api as LegacyApi;
}
