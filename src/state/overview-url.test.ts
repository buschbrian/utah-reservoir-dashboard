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
      "?q=Deer&area=140600&state=UT&huc4=1406&county=49051&reporting=late&reservoirs=connected&powell=include" +
      "&mead=include&storage=2&sort=percent&measure=storage&top=25&rank=name");
    expect(state).toEqual({
      query: "Deer",
      drainageArea: "140600",
      state: "UT",
      subregion: "1406",
      county: "49051",
      reporting: "late",
      geography: "connected",
      lakePowell: "include",
      lakeMead: "include",
      storageClass: 2,
      sort: "percent",
      measure: "storage",
      limit: 25,
      rank: "name"
    });
  });

  it("opens with both large reservoirs in, and spells only the narrow choice", () => {
    /* The two pages share a scope a reader carries between them, so they
     * cannot disagree about what an unset switch means. Both open with Lake
     * Powell and Lake Mead in the totals; a link states the exclusion. */
    expect(DEFAULT_OVERVIEW_STATE.lakePowell).toBe("include");
    expect(DEFAULT_OVERVIEW_STATE.lakeMead).toBe("include");
    expect(overviewStateFromSearch("").lakePowell).toBe("include");
    expect(overviewStateFromSearch("").lakeMead).toBe("include");
    expect(overviewStateFromSearch("?powell=exclude").lakePowell).toBe("exclude");
    expect(overviewStateFromSearch("?mead=exclude").lakeMead).toBe("exclude");
    expect(searchWithOverviewState({ lakePowell: "include", lakeMead: "include" }))
      .toBe("");
    expect(searchWithOverviewState({ lakePowell: "exclude" })).toContain("powell=exclude");
    expect(searchWithOverviewState({ lakeMead: "exclude" })).toContain("mead=exclude");
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

/* A FIPS code is fixed-width and zero-padded, so the digit count is the whole
 * validation -- and the leading zero is real. Arizona is 04, so anything that
 * treats the code as a number loses a state. */
describe("the county parameter", () => {
  it("keeps a leading zero", () => {
    expect(overviewStateFromSearch("?county=08117").county).toBe("08117");
  });

  it("refuses anything that is not five digits", () => {
    for (const value of ["4905", "490511", "49o51", "Summit", ""]) {
      expect(overviewStateFromSearch(`?county=${value}`).county).toBe("all");
    }
  });

  it("writes the county back only when one is chosen", () => {
    expect(searchWithOverviewState({ county: "49051" })).toContain("county=49051");
    expect(searchWithOverviewState({ county: "all" })).not.toContain("county");
  });
});

describe("the state and subregion parameters", () => {
  it("accepts a two-letter code in any case and normalises it", () => {
    expect(overviewStateFromSearch("?state=ut").state).toBe("UT");
    expect(overviewStateFromSearch("?state=WY").state).toBe("WY");
  });

  it("refuses anything that is not a state code", () => {
    for (const value of ["U", "UTA", "4", "Utah", ""]) {
      expect(overviewStateFromSearch(`?state=${value}`).state).toBe("all");
    }
  });

  it("takes a four-digit subregion and nothing else", () => {
    expect(overviewStateFromSearch("?huc4=1601").subregion).toBe("1601");
    for (const value of ["160", "16011", "16a1", ""]) {
      expect(overviewStateFromSearch(`?huc4=${value}`).subregion).toBe("all");
    }
  });

  it("writes each back only when one is chosen", () => {
    expect(searchWithOverviewState({ state: "UT" })).toContain("state=UT");
    expect(searchWithOverviewState({ subregion: "1601" })).toContain("huc4=1601");
    const empty = searchWithOverviewState({ state: "all", subregion: "all" });
    expect(empty).not.toContain("state=");
    expect(empty).not.toContain("huc4=");
  });
});
