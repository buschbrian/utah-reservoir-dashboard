/*
 * Which reservoir the reader is looking at.
 *
 * The typed port of the store the three production pages share: the map and
 * the reservoir list both set it, the details panel, the map highlight and
 * the address bar all read it. The name matching is the same forgiving rule
 * `shared/reservoir-viz.js` uses -- trimmed and case-insensitive -- so a link
 * handed between the four pages resolves to one reservoir on all of them.
 *
 * It parts company with the frozen module in one case, and only one: a bare
 * name that two reservoirs share resolves to neither here, where the oracle
 * would take the first. The oracle predates a roster that can hold two
 * (ADR-066), and every name on the published roster is still unique, so the
 * two agree on every input either has ever been given.
 *
 * The address bar itself lives in `url.ts`, which subscribes here. Keeping
 * it out of the store is what lets the store stay browser-free.
 */

import { FORMER_NAMES } from "../data/former-names";

export interface SelectionListenerMeta {
  source: string;
}

export type SelectionListener = (reservoir: string | null, meta: SelectionListenerMeta) => void;

export function normalizeSelectionValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** What a reservoir is identified by, as opposed to what it is called. */
export interface Identified {
  name: string;
  /** The provider's own id, which is the identity (ADR-003, ADR-066). */
  source_station_id?: string | null;
  /** Where the published point is, which settles a shared name (ADR-060). */
  state?: string | null;
}

/**
 * What to call a reservoir on screen, in a list, or in a link.
 *
 * Its name, and its state as well when another reservoir in the same set
 * shares that name -- "Lost Creek, UT" beside "Lost Creek, OR" (ADR-066).
 * Only where it is needed: most reservoirs have the name to themselves, and a
 * state on every label is noise rather than precision. This is the rule
 * `countyOptions` already applies to the two Summit Counties.
 */
export function reservoirLabel<T extends Identified>(
  reservoir: T, among: readonly T[]
): string {
  const shared = among.filter((other) =>
    other.name === reservoir.name).length > 1;
  return shared && reservoir.state ? `${reservoir.name}, ${reservoir.state}` : reservoir.name;
}

/**
 * The reservoir a stored selection or a shared link names.
 *
 * Four ways, most precise first. A station id is the identity and cannot be
 * ambiguous. A qualified label -- "Lost Creek, OR" -- is what the reader can
 * see on screen and what a link carries where a name is shared. A bare name
 * is what every link written before ADR-066 carries, and it resolves when
 * exactly one reservoir has it. A former name -- the provider spelling this
 * roster normalized (ADR-079) -- resolves through the committed table, so
 * every link written before the rename keeps working.
 *
 * A bare name shared by two reservoirs resolves to **neither**. Picking the
 * first would answer a question the link did not ask, and the whole reason
 * this project stopped keying on names is that one silently standing for
 * another is a wrong number nothing fails on.
 */
export function findReservoir<T extends Identified>(
  reservoirs: readonly T[],
  name: string | null | undefined
): T | null {
  const wanted = normalizeSelectionValue(name)?.toLowerCase();
  if (!wanted) return null;
  const byStation = reservoirs.find((reservoir) =>
    normalizeSelectionValue(reservoir.source_station_id)?.toLowerCase() === wanted);
  if (byStation) return byStation;
  const byLabel = reservoirs.find((reservoir) =>
    reservoirLabel(reservoir, reservoirs).toLowerCase() === wanted);
  if (byLabel) return byLabel;
  const named = reservoirs.filter((reservoir) =>
    normalizeSelectionValue(reservoir.name)?.toLowerCase() === wanted);
  if (named.length === 1) return named[0]!;
  /* Fourth and last: the former-name table. Only reached when nothing on the
   * current roster answers, so it can never shadow a live name that happens
   * to collide with an old spelling. */
  const station = FORMER_NAMES[wanted];
  if (!station) return null;
  return reservoirs.find((reservoir) =>
    normalizeSelectionValue(reservoir.source_station_id)?.toLowerCase()
    === station.toLowerCase()) ?? null;
}

export interface SelectionStore {
  get(): string | null;
  /** True when the selection actually changed. */
  set(name: string | null, meta?: SelectionListenerMeta): boolean;
  clear(meta?: SelectionListenerMeta): boolean;
  subscribe(listener: SelectionListener): () => void;
}

export function createSelectionStore(): SelectionStore {
  let selected: string | null = null;
  const listeners: SelectionListener[] = [];

  function set(name: string | null, meta: SelectionListenerMeta = { source: "app" }): boolean {
    const next = normalizeSelectionValue(name);
    // Clicking the same point twice, and the map echoing back what the list
    // just set, both have to end here or the two ends call each other.
    if (next === selected) return false;
    selected = next;
    for (const listener of listeners.slice()) {
      /* The map highlight and the details panel are both subscribers.
       * Losing the details because a layer was not ready yet is a worse
       * bug than the one that caused it. */
      try {
        listener(selected, meta);
      } catch (error) {
        console.error("A selection listener failed:", error);
      }
    }
    return true;
  }

  return {
    get: () => selected,
    set,
    clear: (meta) => set(null, meta),
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    }
  };
}
