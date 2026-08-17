import { describe, expect, it } from "vitest";
import {
  DEFAULT_DROUGHT_SORT,
  droughtSearchFromState,
  droughtStateFromSearch
} from "./drought-url";

describe("the drought view's address bar", () => {
  it("opens on every area, most severe first, with no parameters", () => {
    expect(droughtStateFromSearch("")).toEqual({
      worse: null, sort: DEFAULT_DROUGHT_SORT, area: null
    });
  });

  it("reads a class, an order and a drainage area", () => {
    expect(droughtStateFromSearch("?worse=d2&sort=storage&area=140100")).toEqual({
      worse: "d2", sort: "storage", area: "140100"
    });
  });

  /* A link is written by people as often as by this page, and a value the
   * page cannot honour has to fall back rather than filter to nothing or
   * order by a comparison that does not exist. */
  it("ignores a class, an order or an area it does not recognise", () => {
    /* Seven digits is not a hydrologic unit at any level -- the codes are
     * fixed-width and zero-padded, so the levels are the even lengths. This
     * used to be "14" on the reading that anything short of six digits was
     * nonsense; two digits is a real region code now. */
    expect(droughtStateFromSearch("?worse=d9&sort=rainfall&area=1401000"))
      .toEqual({ worse: null, sort: DEFAULT_DROUGHT_SORT, area: null });
    expect(droughtStateFromSearch("?area=abc").area).toBeNull();
  });

  /* The codes are fixed-width, so the level a link names is simply how long
   * its code is. The page carries whichever it is given rather than assuming
   * six digits, because which sizes of drainage area exist is a property of
   * the data, not of the address bar. */
  it("carries an area code at any hydrologic level", () => {
    for (const area of ["14", "1401", "140100", "14010001"]) {
      expect(droughtStateFromSearch(`?area=${area}`).area, area).toBe(area);
    }
  });

  it("carries only what the reader changed", () => {
    expect(droughtSearchFromState(
      { worse: "d3", sort: DEFAULT_DROUGHT_SORT, area: null }, ""))
      .toBe("?worse=d3");
    expect(droughtSearchFromState(
      { worse: null, sort: "name", area: null }, ""))
      .toBe("?sort=name");
  });

  it("empties the address bar when nothing is narrowed", () => {
    expect(droughtSearchFromState(
      { worse: null, sort: DEFAULT_DROUGHT_SORT, area: null }, "?worse=d4&sort=storage"))
      .toBe("");
  });

  /* `?area=` is the same parameter the storage and snow views use, so a link
   * can cross between all three without translation. Parameters this view
   * does not own are left alone for the same reason. */
  it("keeps parameters it does not own", () => {
    expect(droughtSearchFromState(
      { worse: null, sort: DEFAULT_DROUGHT_SORT, area: "160202" }, "?utm=news"))
      .toBe("?utm=news&area=160202");
  });

  it("round-trips every state it can produce", () => {
    for (const worse of [null, "d0", "d4"]) {
      for (const sort of ["severity", "storage", "name"] as const) {
        const state = { worse, sort, area: null };
        expect(droughtStateFromSearch(droughtSearchFromState(state, "")))
          .toEqual(state);
      }
    }
  });
});
