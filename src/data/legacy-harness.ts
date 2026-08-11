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

type LegacyPoint = readonly [number, number];
type LegacyRing = readonly LegacyPoint[];
type LegacyBoundary = readonly (readonly LegacyRing[])[];

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

/* The selection the three pages share, and the URL it is carried in. Typed
 * here for the same reason the summary above is: the store is plain
 * browser-free logic living in a file the build cannot import, so the only
 * way to hold it to a contract is to describe that contract at the sandbox
 * boundary. */
export interface LegacySelectionState {
  reservoir: string | null;
  [field: string]: string | null;
}

export interface LegacySelectionMeta {
  changed: string[];
  source: string;
}

export interface LegacySelectionStore {
  fields: string[];
  get(): LegacySelectionState;
  set(patch: Record<string, unknown>, meta?: { source?: string }): boolean;
  clear(meta?: { source?: string }): boolean;
  subscribe(
    listener: (state: LegacySelectionState, meta: LegacySelectionMeta) => void
  ): () => void;
}

export interface LegacyApi {
  CLASSES: readonly { min: number; label: string; color: string }[];
  /** The region both production maps constrain navigation to. */
  MAP_BOUNDS: readonly (readonly [number, number])[];
  MAP_MIN_ZOOM: number;
  MAP_CENTER: readonly [number, number];
  MAP_MAX_ZOOM: number;
  /** The bounding box of the committed drainage-area polygons. */
  HUC6_BOUNDS: readonly (readonly [number, number])[];
  expandBounds(
    bounds: readonly (readonly [number, number])[],
    factor: number
  ): [[number, number], [number, number]];
  HUC6_WHERE: string;
  MASK_FILL: string;
  MASK_LINE: string;
  HUC_FILL: string;
  HUC_LINE: string;
  UTAH_RING: LegacyRing;
  utahMaskRings(boundary?: LegacyBoundary): LegacyRing[];
  utahReservoirs<T>(reservoirs: readonly T[], excludeLakePowell: boolean): T[];
  headlinePct(reservoir: unknown): number | null;
  sizeBasis(reservoir: unknown): number;
  colorFor(percent: number | null): string;
  statewideSummary(reservoirs: readonly unknown[]): LegacySummary;
  SELECTION_FIELDS: string[];
  selection: LegacySelectionStore;
  createSelectionStore(fields?: string[]): LegacySelectionStore;
  selectionFromSearch(search: string | null | undefined): LegacySelectionState;
  searchWithSelection(
    state: Partial<LegacySelectionState>,
    currentSearch?: string | null
  ): string;
  findReservoir<T extends { name?: unknown }>(
    reservoirs: readonly T[] | null | undefined,
    name: string | null | undefined
  ): T | null;
  unknownReservoirMessage(name: string): string;
  connectSelectionToUrl(
    store: LegacySelectionStore,
    options?: { window?: unknown }
  ): () => void;
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
