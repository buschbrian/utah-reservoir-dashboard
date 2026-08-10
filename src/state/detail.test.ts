import { describe, expect, it, vi } from "vitest";
import { readPayload } from "../data/payload-fixture";
import { storageColor } from "../viz/classes";
import { headlinePercent } from "../viz/symbols";
import { describeReservoir, lateMessage, providerName } from "./detail";
import { createSelectionStore, findReservoir, normalizeSelectionValue } from "./selection";
import { loadLegacyApi } from "../data/legacy-harness";

const legacy = loadLegacyApi();
const reservoirs = readPayload().reservoirs;
const views = reservoirs.map((reservoir) =>
  describeReservoir(reservoir, storageColor(headlinePercent(reservoir))));

/* The acronyms in the payload's own `source_label`, and the rest of the
 * retired vocabulary. The smoke test reads the rendered page; this reads the
 * strings before they reach it, so a bad word fails in milliseconds and
 * names the reservoir it came from.
 *
 * Whole words, and the acronyms case-sensitively: two of the reservoirs are
 * called Upper and Lower Enterprise, and a loose substring search reads the
 * provider's name out of the middle of them. */
const RETIRED = [/\bRISE\b/, /\bAWDB\b/, /\baf\b/i, /period-of-record/i, /\bstale\b/i,
  /\bcadence\b/i, /seasonal percentile/i];

describe("the details a reader sees", () => {
  it("never shows a retired term for any published reservoir", () => {
    const offenders: string[] = [];
    for (const view of views) {
      const text = [view.name, view.percent, view.basis, view.late ?? "",
        ...view.rows.flatMap((row) => [row.label, row.value])].join(" | ");
      for (const term of RETIRED) {
        if (term.test(text)) offenders.push(`${view.name}: ${String(term)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names the measuring agency in full, not the payload's own label", () => {
    for (const reservoir of reservoirs) {
      expect(providerName(reservoir)).toBe(reservoir.source_key === "rise"
        ? "Bureau of Reclamation"
        : "Natural Resources Conservation Service");
    }
  });

  it("gives the name, percentage, reading date and agency for every reservoir", () => {
    for (const view of views) {
      expect(view.name).not.toBe("");
      expect(view.rows.map((row) => row.label)).toEqual(
        expect.arrayContaining(["Stored now", "Reading date", "Measured by"]));
      expect(view.rows.find((row) => row.label === "Reading date")?.value).not.toBe("");
    }
  });

  it("says which number the percentage is measured against", () => {
    const reservoir = reservoirs.find((candidate) => candidate.capacity_af !== null);
    const withoutCapacity = reservoirs.find((candidate) => candidate.capacity_af === null);
    expect(reservoir).toBeDefined();
    if (reservoir) {
      expect(describeReservoir(reservoir, "#000").basis).toContain("capacity");
    }
    if (withoutCapacity) {
      expect(describeReservoir(withoutCapacity, "#000").basis)
        .toContain("highest recorded storage");
    }
  });

  it("marks late data in plain words and leaves current data unmarked", () => {
    const late = { ...reservoirs[0], days_stale: 40, stale_after_days: 2, fetch_ok: true };
    expect(lateMessage(late as never)).toBe("This reading is late by 40 days.");
    expect(lateMessage({ ...late, days_stale: 1, fetch_ok: true } as never)).toBeNull();
    expect(lateMessage({ ...late, days_stale: 3, stale_after_days: 2 } as never))
      .toBe("This reading is late by 3 days.");
  });

  it("takes the headline colour from the shared class table", () => {
    for (const [index, view] of views.entries()) {
      expect(view.color).toBe(legacy.colorFor(legacy.headlinePct(reservoirs[index])));
    }
  });
});

describe("selecting a reservoir", () => {
  it("finds a reservoir the way the production pages do", () => {
    const rows = reservoirs.map((reservoir) => ({ name: reservoir.name }));
    for (const name of ["Deer Creek", "  deer creek ", "LAKE POWELL"]) {
      expect(findReservoir(rows, name)?.name).toBe(legacy.findReservoir(rows, name)?.name);
    }
    expect(findReservoir(rows, "Lake Wobegon")).toBeNull();
    expect(findReservoir(rows, null)).toBeNull();
  });

  it("reads a blank name as nothing selected", () => {
    expect(normalizeSelectionValue("   ")).toBeNull();
    const store = createSelectionStore();
    store.set("   ");
    expect(store.get()).toBeNull();
  });

  it("tells subscribers only about real changes", () => {
    const store = createSelectionStore();
    const seen = vi.fn();
    store.subscribe(seen);
    expect(store.set("Deer Creek", { source: "map" })).toBe(true);
    expect(store.set("Deer Creek", { source: "list" })).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith("Deer Creek", { source: "map" });
  });

  it("keeps calling the other subscribers after one throws", () => {
    const store = createSelectionStore();
    const second = vi.fn();
    store.subscribe(() => { throw new Error("layer not ready"); });
    store.subscribe(second);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.set("Deer Creek");
    expect(second).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("stops calling a subscriber that unsubscribed", () => {
    const store = createSelectionStore();
    const seen = vi.fn();
    const off = store.subscribe(seen);
    store.set("Deer Creek");
    off();
    store.clear();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
