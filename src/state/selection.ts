/*
 * Which reservoir the reader is looking at.
 *
 * The typed port of the store the three production pages share: the map and
 * the reservoir list both set it, the details panel, the map highlight and
 * the address bar all read it. The name matching is the same forgiving rule
 * `shared/reservoir-viz.js` uses and is tested against it, so a link handed
 * between the four pages resolves to one reservoir on all of them.
 *
 * The address bar itself lives in `url.ts`, which subscribes here. Keeping
 * it out of the store is what lets the store stay browser-free.
 */

export interface SelectionListenerMeta {
  source: string;
}

export type SelectionListener = (reservoir: string | null, meta: SelectionListenerMeta) => void;

export function normalizeSelectionValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function findReservoir<T extends { name: string }>(
  reservoirs: readonly T[],
  name: string | null | undefined
): T | null {
  const wanted = normalizeSelectionValue(name)?.toLowerCase();
  if (!wanted) return null;
  return reservoirs.find((reservoir) =>
    normalizeSelectionValue(reservoir.name)?.toLowerCase() === wanted) ?? null;
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
