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
          const search = snowSearchFromState({ area, day, site }, "");
          expect(snowStateFromSearch(search)).toEqual({ area, day, site });
        }
      }
    }
  });

  it("drops every parameter entirely for the default view", () => {
    expect(snowSearchFromState(
      { area: null, day: null, site: null },
      "?area=160201&day=2026-04-01&site=1030%3ACO%3ASNTL")).toBe("");
  });

  it("leaves parameters it does not own alone", () => {
    const search = snowSearchFromState(
      { area: "140100", day: null, site: null }, "?theme=dark");
    expect(search).toContain("theme=dark");
    expect(search).toContain("area=140100");
    expect(search).not.toContain("day=");
  });
});
