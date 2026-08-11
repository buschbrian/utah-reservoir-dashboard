/* Held character for character against `shared/reservoir-viz.js`. A link is
 * the one part of a view a reader can hand to somebody else, so a link that
 * opens Deer Creek on the production overview has to open Deer Creek here.
 * The awkward inputs are the point: a space, an apostrophe, a "+", a
 * truncated percent escape, and a parameter belonging to another page. */
import { describe, expect, it } from "vitest";
import { loadLegacyApi } from "../data/legacy-harness";
import { readPayload } from "../data/payload-fixture";
import { DEFAULT_URL_STATE, searchWithState, selectionFromSearch, stateFromSearch } from "./url";

const legacy = loadLegacyApi();

/* Names that have broken a link before, plus every published name, so a
 * reservoir added upstream cannot quietly stop being linkable. */
const AWKWARD = [
  "Ken's Lake",
  "Smith and Morehouse",
  "Deer Creek",
  "  deer creek  ",
  "100% Full",
  "a&b=c",
  "Lago Español"
];
const NAMES = [...AWKWARD, ...readPayload().reservoirs.map((reservoir) => reservoir.name)];

describe("reading a selection out of a link", () => {
  it("matches the shared parser on every name", () => {
    for (const name of NAMES) {
      const search = `?reservoir=${encodeURIComponent(name)}`;
      expect(selectionFromSearch(search)).toBe(legacy.selectionFromSearch(search).reservoir);
    }
  });

  it.each([
    ["?reservoir=Deer+Creek", "a plus is a legal space"],
    ["?reservoir=Deer%20Creek", "and so is an escape"],
    ["reservoir=Deer Creek", "a missing question mark"],
    ["?basemap=streets&reservoir=Deer+Creek", "after another page's parameter"],
    ["?reservoir=", "an empty value is no selection"],
    ["?reservoir=%20%20", "and so is a blank one"],
    ["", "nothing at all"],
    ["?reservoir=%E0%A4", "a truncated escape reads as no selection"]
  ])("agrees with the shared parser on %s (%s)", (search) => {
    expect(selectionFromSearch(search)).toBe(legacy.selectionFromSearch(search).reservoir);
  });

  it("reads no selection out of nothing", () => {
    expect(selectionFromSearch(null)).toBeNull();
    expect(selectionFromSearch(undefined)).toBeNull();
  });
});

describe("writing a selection into a link", () => {
  /* Parity is asserted on a reservoir-only state, which is the state the
   * shared module can express. That is exactly the interchangeability
   * promise: a link this page produces with nothing else set is the link
   * the production pages produce. */
  it("matches the shared writer on every name", () => {
    for (const name of NAMES) {
      expect(searchWithState({ reservoir: name }))
        .toBe(legacy.searchWithSelection({ reservoir: name }));
    }
  });

  it("keeps a parameter that belongs to another page", () => {
    const search = searchWithState({ reservoir: "Deer Creek" }, "?basemap=streets");
    expect(search).toBe(legacy.searchWithSelection({ reservoir: "Deer Creek" }, "?basemap=streets"));
    expect(search).toContain("basemap=streets");
  });

  it("replaces a selection already in the link rather than repeating it", () => {
    const search = searchWithState({ reservoir: "Bear Lake" }, "?reservoir=Deer+Creek");
    expect(search).toBe(legacy.searchWithSelection({ reservoir: "Bear Lake" }, "?reservoir=Deer+Creek"));
    expect(search).toBe("?reservoir=Bear%20Lake");
  });

  it("clears the parameter when nothing is selected", () => {
    expect(searchWithState({ reservoir: null }, "?reservoir=Deer+Creek"))
      .toBe(legacy.searchWithSelection({ reservoir: null }, "?reservoir=Deer+Creek"));
    expect(searchWithState({ reservoir: null }, "?reservoir=Deer+Creek&basemap=streets"))
      .toBe("?basemap=streets");
  });

  it("writes a space as an escape, not a plus, the way the overview does", () => {
    expect(searchWithState({ reservoir: "Deer Creek" })).toBe("?reservoir=Deer%20Creek");
  });
});

describe("a link survives a round trip", () => {
  it("returns the same reservoir it was given", () => {
    for (const name of NAMES) {
      expect(selectionFromSearch(searchWithState({ reservoir: name }))).toBe(name.trim());
    }
  });
});

describe("the rest of the view in the link", () => {
  it("writes nothing at all for a dashboard nobody has touched", () => {
    expect(searchWithState(DEFAULT_URL_STATE)).toBe("");
    expect(searchWithState({})).toBe("");
  });

  it("carries the filters and the scope", () => {
    expect(searchWithState({ storageClass: 0, reporting: "late", lakePowell: "include" }))
      .toBe("?storage=0&reporting=late&powell=include");
  });

  it("puts the reservoir first, so the readable part of a link leads", () => {
    const search = searchWithState({ reservoir: "Deer Creek", reporting: "late" });
    expect(search.indexOf("reservoir=")).toBeLessThan(search.indexOf("reporting="));
  });

  it("survives a round trip in every combination the controls can reach", () => {
    for (const storageClass of [null, 0, 3]) {
      for (const reporting of ["all", "late", "current"] as const) {
        for (const lakePowell of ["exclude", "include"] as const) {
          const state = { reservoir: "Deer Creek", storageClass, reporting, lakePowell };
          expect(stateFromSearch(searchWithState(state))).toEqual(state);
        }
      }
    }
  });

  it("opens the dashboard rather than breaking on a hand-edited link", () => {
    expect(stateFromSearch("?storage=banana&reporting=sideways&powell=maybe"))
      .toEqual(DEFAULT_URL_STATE);
    expect(stateFromSearch("?storage=-1")).toEqual(DEFAULT_URL_STATE);
  });

  it("still keeps another page's parameter when the filters are set", () => {
    expect(searchWithState({ reporting: "late" }, "?basemap=streets"))
      .toBe("?reporting=late&basemap=streets");
  });
});
