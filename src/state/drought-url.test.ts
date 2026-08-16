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
    expect(droughtStateFromSearch("?worse=d9&sort=rainfall&area=14"))
      .toEqual({ worse: null, sort: DEFAULT_DROUGHT_SORT, area: null });
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
