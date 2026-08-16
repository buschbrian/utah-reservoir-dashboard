import { describe, expect, it } from "vitest";
import { snowSearchFromState, snowStateFromSearch } from "./snow-url";

describe("snow URL state", () => {
  it("reads a six-digit drainage area and nothing else", () => {
    expect(snowStateFromSearch("?area=160201").area).toBe("160201");
    expect(snowStateFromSearch("?area=abc").area).toBeNull();
    expect(snowStateFromSearch("?area=1602010").area).toBeNull();
    expect(snowStateFromSearch("").area).toBeNull();
  });

  it("reads a well-formed day and refuses anything else", () => {
    expect(snowStateFromSearch("?day=2026-04-01").day).toBe("2026-04-01");
    expect(snowStateFromSearch("?day=April").day).toBeNull();
    expect(snowStateFromSearch("?day=2026-4-1").day).toBeNull();
    expect(snowStateFromSearch("").day).toBeNull();
  });

  it("reads a station identifier and refuses anything else", () => {
    expect(snowStateFromSearch("?site=1030%3ACO%3ASNTL").site).toBe("1030:CO:SNTL");
    expect(snowStateFromSearch("?site=Arapaho+Ridge").site).toBeNull();
    expect(snowStateFromSearch("").site).toBeNull();
  });

  it("round-trips every reachable state", () => {
    for (const area of ["140100", null]) {
      for (const day of ["2026-04-01", null]) {
        for (const site of ["1030:CO:SNTL", null]) {
          const state = { area, day, site, query: "", band: "all" as const,
            status: "all" as const };
          expect(snowStateFromSearch(snowSearchFromState(state, ""))).toEqual(state);
        }
      }
    }
  });

  it("drops every parameter entirely for the default view", () => {
    expect(snowSearchFromState(
      { area: null, day: null, site: null, query: "", band: "all", status: "all" },
      "?area=160201&day=2026-04-01&site=1030%3ACO%3ASNTL&q=alta&elev=high&status=late"))
      .toBe("");
  });

  it("leaves parameters it does not own alone", () => {
    const search = snowSearchFromState(
      { area: "140100", day: null, site: null, query: "", band: "all", status: "all" },
      "?theme=dark");
    expect(search).toContain("theme=dark");
    expect(search).toContain("area=140100");
    expect(search).not.toContain("day=");
  });

  /* The three table controls. They are separate from `?area=`, which is the
   * shared cross-page vocabulary and changes the whole page; these only
   * narrow the table under it. */
  it("carries a search, an elevation band and a reporting status", () => {
    expect(snowStateFromSearch("?q=alta&elev=high&status=late"))
      .toMatchObject({ query: "alta", band: "high", status: "late" });
  });

  it("falls back to no narrowing for values it does not recognise", () => {
    expect(snowStateFromSearch("?elev=summit&status=broken"))
      .toMatchObject({ band: "all", status: "all" });
  });

  /* A search box is the one field a link can carry arbitrary text in, and
   * the value is only ever a case-insensitive substring test. */
  it("trims and caps the search text", () => {
    expect(snowStateFromSearch("?q=%20%20alta%20%20").query).toBe("alta");
    expect(snowStateFromSearch(`?q=${"x".repeat(200)}`).query).toHaveLength(60);
  });

  it("leaves a whitespace-only search out of the address bar", () => {
    expect(snowSearchFromState(
      { area: null, day: null, site: null, query: "   ", band: "all", status: "all" }, ""))
      .toBe("");
  });
});
