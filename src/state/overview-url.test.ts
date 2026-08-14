/* The overview page's link. The awkward inputs are the point: a hand-edited
 * value, a parameter belonging to another page, and a link arriving from the
 * map with a value this page's controls do not offer. */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERVIEW_STATE,
  overviewStateFromSearch,
  searchWithOverviewState
} from "./overview-url";
import { stateFromSearch } from "./url";

describe("reading the overview view out of a link", () => {
  it("opens the default view for a link that says nothing", () => {
    for (const search of ["", "?", null, undefined, "?unrelated=1"]) {
      expect(overviewStateFromSearch(search)).toEqual(DEFAULT_OVERVIEW_STATE);
    }
  });

  it("reads every field it owns", () => {
    const state = overviewStateFromSearch(
      "?q=Deer&area=140600&reporting=late&reservoirs=connected&powell=include" +
      "&storage=2&sort=percent&measure=storage&top=25&rank=name");
    expect(state).toEqual({
      query: "Deer",
      drainageArea: "140600",
      reporting: "late",
      geography: "connected",
      lakePowell: "include",
      storageClass: 2,
      sort: "percent",
      measure: "storage",
      limit: 25,
      rank: "name"
    });
  });

  it("opens the page rather than breaking on a hand-edited link", () => {
    expect(overviewStateFromSearch(
      "?area=Lower%20Green&reporting=sideways&reservoirs=maybe&powell=perhaps" +
      "&storage=-1&sort=banana&measure=cubits&top=-4&rank=vibes"))
      .toEqual(DEFAULT_OVERVIEW_STATE);
  });

  it("keeps zero as a real choice for the chart limit", () => {
    // Zero is "show all of them", not a missing value.
    expect(overviewStateFromSearch("?top=0").limit).toBe(0);
    expect(overviewStateFromSearch("?top=").limit).toBe(DEFAULT_OVERVIEW_STATE.limit);
  });

  it("reads a name with a space however the link spells it", () => {
    expect(overviewStateFromSearch("?q=Deer+Creek").query).toBe("Deer Creek");
    expect(overviewStateFromSearch("?q=Deer%20Creek").query).toBe("Deer Creek");
    expect(overviewStateFromSearch("?q=%E0%A4").query).toBe("");
  });
});

describe("writing the overview view into a link", () => {
  it("writes nothing at all for a view nobody has touched", () => {
    expect(searchWithOverviewState(DEFAULT_OVERVIEW_STATE)).toBe("");
    expect(searchWithOverviewState({})).toBe("");
  });

  it("puts the query first, so the readable part of a link leads", () => {
    const search = searchWithOverviewState({ query: "Deer Creek", sort: "percent" });
    expect(search.indexOf("q=")).toBeLessThan(search.indexOf("sort="));
  });

  it("writes a space as an escape, the way the rest of the site does", () => {
    expect(searchWithOverviewState({ query: "Deer Creek" })).toBe("?q=Deer%20Creek");
  });

  it("keeps a parameter that belongs to another page", () => {
    const search = searchWithOverviewState({ query: "Deer" }, "?basemap=streets&month=2026-02");
    expect(search).toContain("basemap=streets");
    expect(search).toContain("month=2026-02");
  });

  it("replaces its own parameters rather than repeating them", () => {
    const search = searchWithOverviewState({ query: "Bear" }, "?q=Deer&sort=name");
    expect(search).toBe("?q=Bear");
    expect(search.match(/q=/g)).toHaveLength(1);
  });

  it("survives a round trip in every combination the controls can reach", () => {
    for (const geography of ["utah", "connected"] as const) {
      for (const lakePowell of ["exclude", "include"] as const) {
        for (const reporting of ["all", "daily", "monthly", "late"] as const) {
          for (const measure of ["percent", "storage"] as const) {
            for (const limit of [0, 10, 15, 25]) {
              const state = {
                ...DEFAULT_OVERVIEW_STATE,
                query: "Ken's Lake",
                drainageArea: "140600",
                storageClass: 3,
                geography, lakePowell, reporting, measure, limit
              };
              expect(overviewStateFromSearch(searchWithOverviewState(state))).toEqual(state);
            }
          }
        }
      }
    }
  });
});

/* The reason five of the ten parameters are the map's own names. Both pages
 * filter the same reservoirs by the same questions, so a reader who narrows
 * one and opens the other should not have to narrow it again. */
describe("a link shared between the map and the overview", () => {
  it("carries the filters both pages have in common", () => {
    const search = searchWithOverviewState({
      drainageArea: "140600", geography: "connected", lakePowell: "include", storageClass: 1
    });
    const onTheMap = stateFromSearch(search);
    expect(onTheMap.drainageArea).toBe("140600");
    expect(onTheMap.geography).toBe("connected");
    expect(onTheMap.lakePowell).toBe("include");
    expect(onTheMap.storageClass).toBe(1);
  });

  it("honours a map link as far as this page can, and no further", () => {
    /* `late=false` is the map's current-data filter; this page offers daily,
     * monthly and late instead. The link must still open, with the
     * parameter it cannot honour falling back rather than rejected. */
    const fromMap = "?reservoirs=connected&powell=include&drainage=140600" +
      "&class=1&late=false";
    const state = overviewStateFromSearch(fromMap);
    expect(state.geography).toBe("connected");
    expect(state.lakePowell).toBe("include");
    expect(state.drainageArea).toBe("140600");
    expect(state.storageClass).toBe(1);
    expect(state.reporting).toBe("all");
  });

  it("accepts the map's late-only spelling", () => {
    expect(overviewStateFromSearch("?late=true").reporting).toBe("late");
  });

  it("does not throw away the map's own month on the way past", () => {
    expect(searchWithOverviewState({ query: "Deer" }, "?month=2026-02"))
      .toContain("month=2026-02");
  });
});
