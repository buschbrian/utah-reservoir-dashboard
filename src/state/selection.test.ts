/* The shared selection state, tested through the same sandbox the class
 * table is tested through (src/data/legacy-harness.ts).
 *
 * Worth testing rather than trusting to the browser smoke test: a link is
 * the one part of a view a reader hands to somebody else, and every way it
 * can break is quiet. A name with a space, an apostrophe or a "+" in it
 * either round-trips exactly or opens the wrong reservoir -- or, worse,
 * opens nothing and looks like the dashboard ignored the link. The three
 * names asserted below are the real ones the data carries: "Ken's Lake"
 * (apostrophe), "Smith and Morehouse" (spaces) and "Huntington North".
 */
import { describe, expect, it, vi } from "vitest";
import { loadLegacyApi } from "../data/legacy-harness";
import type { LegacySelectionState } from "../data/legacy-harness";
import { findReservoir, reservoirLabel } from "./selection";
import { readPayload } from "../data/payload-fixture";

const legacy = loadLegacyApi();

const AWKWARD_NAMES = ["Ken's Lake", "Smith and Morehouse", "Huntington North"];

describe("selection URL parsing", () => {
  it.each(AWKWARD_NAMES)("round-trips %s through the query string", (name) => {
    const search = legacy.searchWithSelection({ reservoir: name }, "");
    expect(legacy.selectionFromSearch(search).reservoir).toBe(name);
  });

  /* The interchangeability guarantee. explore.html writes exactly
   * "?reservoir=" + encodeURIComponent(name); if the map pages write
   * anything else, a link copied from one page can open the wrong thing on
   * another. */
  it.each(AWKWARD_NAMES)("uses the overview page's encoding for %s", (name) => {
    expect(legacy.searchWithSelection({ reservoir: name }, ""))
      .toBe("?reservoir=" + encodeURIComponent(name));
  });

  it("reads a plus sign as a space, the way a hand-typed link writes one", () => {
    expect(legacy.selectionFromSearch("?reservoir=Deer+Creek").reservoir).toBe("Deer Creek");
    expect(legacy.selectionFromSearch("?reservoir=Deer%20Creek").reservoir).toBe("Deer Creek");
    expect(legacy.selectionFromSearch("reservoir=Smith+and+Morehouse").reservoir)
      .toBe("Smith and Morehouse");
  });

  it("reads an apostrophe in either spelling", () => {
    expect(legacy.selectionFromSearch("?reservoir=Ken's%20Lake").reservoir).toBe("Ken's Lake");
    expect(legacy.selectionFromSearch("?reservoir=Ken%27s%20Lake").reservoir).toBe("Ken's Lake");
  });

  it.each([["", null], ["?", null], ["?reservoir=", null], ["?reservoir=%20%20", null],
           ["?basemap=voyager", null]] as const)(
    "reads %s as no selection", (search, expected) => {
      expect(legacy.selectionFromSearch(search).reservoir).toBe(expected);
    });

  it("survives a broken percent escape instead of throwing", () => {
    expect(legacy.selectionFromSearch("?reservoir=%E0%A4").reservoir).toBeNull();
  });

  /* The MapLibre page carries its own `basemap` parameter. Selecting a
   * reservoir must not throw it away, or choosing a background and then
   * clicking a dot would silently reset the background. */
  it("keeps the parameters it does not own", () => {
    expect(legacy.searchWithSelection({ reservoir: "Deer Creek" }, "?basemap=voyager"))
      .toBe("?reservoir=Deer%20Creek&basemap=voyager");
    expect(legacy.searchWithSelection({ reservoir: null }, "?basemap=voyager"))
      .toBe("?basemap=voyager");
  });

  it("writes no query string at all when nothing is selected", () => {
    expect(legacy.searchWithSelection({ reservoir: null }, "")).toBe("");
    expect(legacy.searchWithSelection({ reservoir: "   " }, "?reservoir=Deer%20Creek")).toBe("");
  });

  it("replaces the selection rather than repeating the parameter", () => {
    expect(legacy.searchWithSelection({ reservoir: "Ken's Lake" }, "?reservoir=Deer%20Creek"))
      .toBe("?reservoir=" + encodeURIComponent("Ken's Lake"));
  });
});

describe("reservoir lookup by name", () => {
  const rows = AWKWARD_NAMES.map((name) => ({ name }));

  it.each(AWKWARD_NAMES)("finds %s", (name) => {
    expect(legacy.findReservoir(rows, name)?.name).toBe(name);
  });

  it("matches the overview page's forgiving rule", () => {
    expect(legacy.findReservoir(rows, "  ken's lake ")?.name).toBe("Ken's Lake");
    expect(legacy.findReservoir(rows, "SMITH AND MOREHOUSE")?.name).toBe("Smith and Morehouse");
  });

  it("returns nothing for a name the dashboard does not carry", () => {
    expect(legacy.findReservoir(rows, "Lake Wobegon")).toBeNull();
    expect(legacy.findReservoir(rows, "")).toBeNull();
    expect(legacy.findReservoir(rows, null)).toBeNull();
  });
});

describe("selection store", () => {
  it("tells subscribers only about real changes", () => {
    const store = legacy.createSelectionStore();
    const seen = vi.fn();
    store.subscribe(seen);

    expect(store.set({ reservoir: "Deer Creek" }, { source: "map" })).toBe(true);
    // Clicking the same dot twice, or the URL writer echoing back what the
    // map just set: both have to end here, or the two ends of the round
    // trip call each other forever.
    expect(store.set({ reservoir: "Deer Creek" }, { source: "url" })).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[0]).toEqual({ reservoir: "Deer Creek" });
    expect(seen.mock.calls[0]?.[1]).toEqual({ changed: ["reservoir"], source: "map" });
  });

  it("treats a blank name as nothing selected", () => {
    const store = legacy.createSelectionStore();
    store.set({ reservoir: "   " });
    expect(store.get().reservoir).toBeNull();
  });

  it("hands out a copy, so a page cannot edit the state behind the store's back", () => {
    const store = legacy.createSelectionStore();
    store.set({ reservoir: "Deer Creek" });
    const snapshot = store.get();
    snapshot.reservoir = "Ken's Lake";
    expect(store.get().reservoir).toBe("Deer Creek");
  });

  it("stops calling a subscriber that unsubscribed", () => {
    const store = legacy.createSelectionStore();
    const seen = vi.fn();
    const off = store.subscribe(seen);
    store.set({ reservoir: "Deer Creek" });
    off();
    store.clear();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  /* The map and the URL writer are both subscribers. Losing the shareable
   * URL because a map layer was not ready is a worse bug than the one that
   * caused it. */
  it("keeps calling the other subscribers after one throws", () => {
    const store = legacy.createSelectionStore();
    const second = vi.fn();
    store.subscribe(() => { throw new Error("layer not ready"); });
    store.subscribe(second);
    store.set({ reservoir: "Deer Creek" });
    expect(second).toHaveBeenCalledTimes(1);
  });

  /* The store is built from a list of fields, so the filter and the
   * selected drainage area this project is heading toward can join without
   * touching the plumbing. */
  it("carries whatever fields it was built with", () => {
    const store = legacy.createSelectionStore(["reservoir", "huc6"]);
    expect(store.get()).toEqual({ reservoir: null, huc6: null });
    store.set({ huc6: "160202" });
    expect(store.get()).toEqual({ reservoir: null, huc6: "160202" });
    store.clear();
    expect(store.get()).toEqual({ reservoir: null, huc6: null });
  });
});

/* A stand-in for the browser, so the one function in the store that touches
 * the address bar is testable at all. Only the four things it uses. */
function fakeWindow(search: string) {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const written: string[] = [];
  const win = {
    location: { pathname: "/index.html", search, hash: "" },
    history: {
      replaceState(_state: unknown, _title: string, url: string) {
        written.push(url);
        const query = url.indexOf("?");
        win.location.search = query < 0 ? "" : url.slice(query);
      },
      pushState() { throw new Error("pushState fills the back button with clicks"); }
    },
    addEventListener(type: string, fn: (event: unknown) => void) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    removeEventListener(type: string, fn: (event: unknown) => void) {
      const at = (listeners[type] || []).indexOf(fn);
      if (at >= 0) listeners[type]?.splice(at, 1);
    },
    fire(type: string) { (listeners[type] || []).slice().forEach((fn) => fn({})); },
    written
  };
  return win;
}

describe("selection connected to the address bar", () => {
  it("reads the reservoir out of the address bar when it connects", () => {
    const store = legacy.createSelectionStore();
    const seen: LegacySelectionState[] = [];
    const sources: string[] = [];
    store.subscribe((state, meta) => { seen.push(state); sources.push(meta.source); });

    const win = fakeWindow("?reservoir=Smith+and+Morehouse");
    legacy.connectSelectionToUrl(store, { window: win });

    expect(store.get().reservoir).toBe("Smith and Morehouse");
    expect(seen).toHaveLength(1);
    expect(sources).toEqual(["url"]);
    // The address bar already said this, so it must not be rewritten.
    expect(win.written).toEqual([]);
  });

  it("writes the selection back with replaceState, never pushState", () => {
    const store = legacy.createSelectionStore();
    const win = fakeWindow("");
    legacy.connectSelectionToUrl(store, { window: win });

    store.set({ reservoir: "Ken's Lake" }, { source: "map" });
    expect(win.written).toEqual(["/index.html?reservoir=" + encodeURIComponent("Ken's Lake")]);

    // Closing the popup clears the parameter and leaves a clean address.
    store.clear({ source: "map" });
    expect(win.written[1]).toBe("/index.html");
  });

  it("keeps the rest of the address, parameters and all", () => {
    const store = legacy.createSelectionStore();
    const win = fakeWindow("?basemap=voyager");
    win.location.hash = "#terms";
    legacy.connectSelectionToUrl(store, { window: win });

    store.set({ reservoir: "Huntington North" }, { source: "map" });
    expect(win.written[0]).toBe("/index.html?reservoir=Huntington%20North&basemap=voyager#terms");
  });

  /* Requirement 4: somebody who arrived by a link can use the back button. */
  it("follows the back and forward buttons", () => {
    const store = legacy.createSelectionStore();
    const sources: string[] = [];
    store.subscribe((_state, meta) => sources.push(meta.source));
    const win = fakeWindow("?reservoir=Deer%20Creek");
    legacy.connectSelectionToUrl(store, { window: win });

    win.location.search = "?reservoir=Ken%27s%20Lake";
    win.fire("popstate");
    expect(store.get().reservoir).toBe("Ken's Lake");
    expect(sources).toEqual(["url", "popstate"]);
    // The browser's own address is already right; rewriting it during a
    // popstate is how a back button starts fighting the page.
    expect(win.written).toEqual([]);
  });

  it("stops listening when it is detached", () => {
    const store = legacy.createSelectionStore();
    const win = fakeWindow("");
    const detach = legacy.connectSelectionToUrl(store, { window: win });
    detach();

    win.location.search = "?reservoir=Deer%20Creek";
    win.fire("popstate");
    expect(store.get().reservoir).toBeNull();
    store.set({ reservoir: "Deer Creek" });
    expect(win.written).toEqual([]);
  });
});

describe("the message for a link nobody can follow", () => {
  it("names the reservoir the link asked for", () => {
    const message = legacy.unknownReservoirMessage("Lake Wobegon");
    expect(message).toContain("Lake Wobegon");
    expect(message).toContain("The map shows all reservoirs.");
  });
});


describe("telling two reservoirs with one name apart", () => {
  /* The west holds a Lost Creek in Utah and another in Oregon, 946 km apart
   * and differing by a factor of twenty in what they hold (ADR-066). */
  const lostCreekUt = { name: "Lost Creek", source_station_id: "544", state: "UT" };
  const lostCreekOr = {
    name: "Lost Creek", source_station_id: "14335040:OR:BOR", state: "OR"
  };
  const deerCreek = { name: "Deer Creek", source_station_id: "290", state: "UT" };
  const all = [lostCreekUt, lostCreekOr, deerCreek];

  it("labels a shared name with its state, and leaves a unique one alone", () => {
    expect(reservoirLabel(lostCreekUt, all)).toBe("Lost Creek, UT");
    expect(reservoirLabel(lostCreekOr, all)).toBe("Lost Creek, OR");
    /* Most reservoirs have their name to themselves, and a state on every
     * label is noise rather than precision. */
    expect(reservoirLabel(deerCreek, all)).toBe("Deer Creek");
  });

  it("finds a reservoir by the station that identifies it", () => {
    expect(findReservoir(all, "14335040:OR:BOR")).toBe(lostCreekOr);
    expect(findReservoir(all, "544")).toBe(lostCreekUt);
  });

  it("finds one by the qualified label a reader can see", () => {
    expect(findReservoir(all, "Lost Creek, OR")).toBe(lostCreekOr);
    expect(findReservoir(all, "lost creek, ut")).toBe(lostCreekUt);
  });

  it("still resolves a bare name that only one reservoir has", () => {
    // Every link written before ADR-066 carries one of these.
    expect(findReservoir(all, "Deer Creek")).toBe(deerCreek);
    expect(findReservoir([lostCreekUt, deerCreek], "Lost Creek")).toBe(lostCreekUt);
  });

  it("resolves a shared bare name to neither reservoir", () => {
    /* Picking the first would answer a question the link did not ask, and one
     * reservoir silently standing for another is the wrong number nothing
     * fails on -- which is why this project stopped keying on names. */
    expect(findReservoir(all, "Lost Creek")).toBeNull();
  });
});

describe("the labels the published roster produces", () => {
  /* Every label has to be unique, because the list, the table and the address
   * bar all carry it as the selection. Where a qualified label would still
   * collide -- two reservoirs with one name in one state -- this fails, and a
   * person decides what to call them rather than the site showing two
   * identical rows (ADR-066). */
  it("gives every published reservoir a label of its own", () => {
    const reservoirs = readPayload().reservoirs;
    const labels = reservoirs.map((reservoir) => reservoirLabel(reservoir, reservoirs));

    expect(new Set(labels).size).toBe(reservoirs.length);
  });

  it("resolves every one of those labels back to its own reservoir", () => {
    const reservoirs = readPayload().reservoirs;
    for (const reservoir of reservoirs) {
      const label = reservoirLabel(reservoir, reservoirs);
      expect(findReservoir(reservoirs, label)?.source_station_id)
        .toBe(reservoir.source_station_id);
      // And by the station, which is what identifies it.
      expect(findReservoir(reservoirs, reservoir.source_station_id ?? "")?.name)
        .toBe(reservoir.name);
    }
  });
});
