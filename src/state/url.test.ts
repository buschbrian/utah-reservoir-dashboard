/* Held character for character against `shared/reservoir-viz.js`. A link is
 * the one part of a view a reader can hand to somebody else, so a link that
 * opens Deer Creek on the production overview has to open Deer Creek here.
 * The awkward inputs are the point: a space, an apostrophe, a "+", a
 * truncated percent escape, and a parameter belonging to another page. */
import { describe, expect, it } from "vitest";
import { loadLegacyApi } from "../data/legacy-harness";
import { readPayload } from "../data/payload-fixture";
import { DEFAULT_SORT, SORT_KEYS } from "./table";
import { DEFAULT_URL_STATE, searchWithState, selectionFromSearch, stateFromSearch } from "./url";
import { STORAGE_CLASSES } from "../viz/classes";

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
const PAYLOAD = readPayload();
const AREAS = [null, ...new Set(PAYLOAD.reservoirs.map((reservoir) => reservoir.huc6)
  .filter((value): value is string => typeof value === "string"))];
const MONTHS = [null, ...new Set(PAYLOAD.reservoirs.flatMap((reservoir) =>
  reservoir.monthly.map((month) => month.month)))];
const CLASSES = [null, ...STORAGE_CLASSES.map((_, index) => index)];

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

  it("carries the filters, both scope dimensions and the month", () => {
    /* Powell is written as `exclude` now: the opening view has it in, so the
     * choice a link has to state is the one that takes it back out. */
    expect(searchWithState({
      storageClass: 0, reporting: "late", drainageArea: "140600", lakePowell: "exclude",
      geography: "utah", month: "2026-02"
    })).toBe("?class=0&late=true&drainage=140600&powell=exclude" +
      "&reservoirs=utah&month=2026-02");
  });

  it("uses false to distinguish current data from no reporting filter", () => {
    expect(searchWithState({ reporting: "current" })).toBe("?late=false");
    expect(stateFromSearch("?late=false").reporting).toBe("current");
    expect(stateFromSearch("").reporting).toBe("all");
  });

  it("writes nothing for the geography the dashboard opens on", () => {
    /* The dashboard opens on every reservoir it publishes. It opened on
     * Utah's until the roster went west, at which point the default was
     * hiding two thirds of the site's own subject -- so the narrower reading
     * is the one a link has to state now. */
    expect(searchWithState({ geography: "connected" })).toBe("");
    expect(searchWithState({ geography: "utah" })).toBe("?reservoirs=utah");
    expect(stateFromSearch("?reservoirs=nonsense").geography).toBe("connected");
  });

  it("takes a month only in the shape the payload writes them", () => {
    expect(stateFromSearch("?month=2026-02").month).toBe("2026-02");
    expect(stateFromSearch("?month=February").month).toBeNull();
    expect(stateFromSearch("?month=2026-2").month).toBeNull();
  });

  it("puts the reservoir first, so the readable part of a link leads", () => {
    const search = searchWithState({ reservoir: "Deer Creek", reporting: "late" });
    expect(search.indexOf("reservoir=")).toBeLessThan(search.indexOf("late="));
  });

  it("carries a chosen period, and writes nothing when none was chosen", () => {
    /* The parameter is the reader's choice, not the page's default. Writing
     * it unconditionally would freeze today's default into every shared link,
     * so a link made now would keep meaning "recent years" after the site
     * moved on -- which is the opposite of what the sharer intended. */
    expect(searchWithState({ baseline: null })).toBe("");
    expect(searchWithState({ baseline: "climate" })).toContain("baseline=climate");
    expect(stateFromSearch("?baseline=climate").baseline).toBe("climate");
    expect(stateFromSearch("?baseline=recent").baseline).toBe("recent");
    // A period this page does not know opens on the payload's default rather
    // than breaking the link.
    expect(stateFromSearch("?baseline=1991").baseline).toBeNull();
    expect(stateFromSearch("").baseline).toBeNull();
  });

  it("keeps Lake Mead's own answer, and defaults it to included", () => {
    /* Absent means included, exactly as it does for Powell: the map's
     * subject is western water and the two largest reservoirs in the west
     * are in the view it opens on. Both are still controls rather than
     * filters (ADR-011, ADR-062) -- what moved is which way they start, so
     * the answer a link now has to spell is the narrow one. */
    expect(stateFromSearch("").lakeMead).toBe("include");
    expect(stateFromSearch("?mead=exclude").lakeMead).toBe("exclude");
    expect(stateFromSearch("?mead=yes").lakeMead).toBe("include");
    expect(searchWithState({ lakeMead: "include" })).toBe("");
    expect(searchWithState({ lakeMead: "exclude" })).toContain("mead=exclude");

    /* Two questions, two parameters: a link may include one lake and not the
     * other, and the four answers are four different totals. */
    const both = searchWithState({ lakePowell: "exclude", lakeMead: "exclude" });
    expect(both).toContain("powell=exclude");
    expect(both).toContain("mead=exclude");
    expect(stateFromSearch("?powell=exclude").lakeMead).toBe("include");
    expect(stateFromSearch("?mead=exclude").lakePowell).toBe("include");
    /* The storage charts spell it the same way, so a scope carries between
     * the two pages rather than being dropped at the link. */
    expect(searchWithState({ lakeMead: "exclude" })).toContain("mead=");
  });

  it("survives a round trip in every combination the controls can reach", () => {
    const broken: string[] = [];
    for (const storageClass of CLASSES) {
      for (const reporting of ["all", "late", "current"] as const) {
        for (const drainageArea of AREAS) {
          for (const lakePowell of ["exclude", "include"] as const) {
            /* Mead's own dimension, not folded into Powell's: the four
             * combinations are four different totals (ADR-062). */
            for (const lakeMead of ["exclude", "include"] as const) {
            for (const geography of ["utah", "connected"] as const) {
              for (const month of MONTHS) {
                const state = {
                  reservoir: "Deer Creek", storageClass, reporting, drainageArea,
                  lakePowell, lakeMead, geography, month,
                  /* The bottom row has its own round trip below. Held at its
                   * default here so this loop keeps testing the controls it
                   * was written for rather than multiplying by two more. */
                  tableOpen: false, tableSort: DEFAULT_SORT,
                  /* Null is "whichever period the payload opens on", which is
                   * the state an untouched page is in and the one that writes
                   * no parameter. The two real values round trip below. */
                  baseline: null
                };
                /* Compared as text and asserted once at the end, for the
                 * reason `state/filters.test.ts` explains: this loop runs a
                 * six-figure number of round trips, and a deep `toEqual` on
                 * every one of them spends the whole cost of describing a
                 * failure on the passes. */
                const back = stateFromSearch(searchWithState(state));
                if (JSON.stringify(back) !== JSON.stringify(state)) {
                  broken.push(`${JSON.stringify(state)} came back as ` +
                    JSON.stringify(back));
                }
              }
            }
            }
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("carries the table's open state and its order as separate facts", () => {
    for (const tableOpen of [false, true]) {
      for (const key of SORT_KEYS) {
        for (const direction of ["asc", "desc"] as const) {
          const tableSort = { key, direction };
          const round = stateFromSearch(searchWithState({ tableOpen, tableSort }));
          expect(round.tableOpen).toBe(tableOpen);
          expect(round.tableSort).toEqual(tableSort);
        }
      }
    }
    // Defaults stay out of the address bar, like every other control here.
    expect(searchWithState({ tableOpen: false, tableSort: DEFAULT_SORT })).toBe("");
    expect(searchWithState({ tableOpen: true })).toBe("?table=open");
    // A sort is shareable without the row being open: two facts, two answers.
    expect(searchWithState({ tableSort: { key: "storage", direction: "desc" } }))
      .toBe("?sort=storage-desc");
  });

  it("takes a drainage area only in the shape the payload writes them", () => {
    expect(stateFromSearch("?drainage=140600").drainageArea).toBe("140600");
    expect(stateFromSearch("?drainage=Lower%20Green").drainageArea).toBeNull();
    expect(stateFromSearch("?drainage=").drainageArea).toBeNull();
    expect(stateFromSearch("?area=140600").drainageArea).toBe("140600");
  });

  it("opens the dashboard rather than breaking on a hand-edited link", () => {
    expect(stateFromSearch("?class=banana&late=perhaps&drainage=sideways&powell=maybe"))
      .toEqual(DEFAULT_URL_STATE);
    expect(stateFromSearch(`?class=${STORAGE_CLASSES.length}`)).toEqual(DEFAULT_URL_STATE);
    expect(stateFromSearch("?class=-1")).toEqual(DEFAULT_URL_STATE);
    expect(searchWithState({ storageClass: STORAGE_CLASSES.length })).toBe("");
    expect(searchWithState({ drainageArea: "Lower Green" })).toBe("");
  });

  it("ignores one malformed value while restoring the rest", () => {
    expect(stateFromSearch("?drainage=Lower%20Green&class=1&month=2026-02"))
      .toMatchObject({ drainageArea: null, storageClass: 1, month: "2026-02" });
  });

  it("still keeps another page's parameter when the filters are set", () => {
    expect(searchWithState({ reporting: "late" }, "?basemap=streets"))
      .toBe("?late=true&basemap=streets");
  });

  it("accepts old filter links and rewrites them with the public names", () => {
    const state = stateFromSearch("?storage=1&reporting=late&area=140600");
    expect(state).toMatchObject({ storageClass: 1, reporting: "late", drainageArea: "140600" });
    expect(searchWithState(state, "?storage=1&reporting=late&area=140600"))
      .toBe("?class=1&late=true&drainage=140600");
  });

});
