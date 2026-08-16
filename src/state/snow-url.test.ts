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

  it("round-trips every reachable state", () => {
    for (const area of ["140100", null]) {
      for (const day of ["2026-04-01", null]) {
        const search = snowSearchFromState({ area, day }, "");
        expect(snowStateFromSearch(search)).toEqual({ area, day });
      }
    }
  });

  it("drops both parameters entirely for the default view", () => {
    expect(snowSearchFromState(
      { area: null, day: null }, "?area=160201&day=2026-04-01")).toBe("");
  });

  it("leaves parameters it does not own alone", () => {
    const search = snowSearchFromState({ area: "140100", day: null }, "?theme=dark");
    expect(search).toContain("theme=dark");
    expect(search).toContain("area=140100");
    expect(search).not.toContain("day=");
  });
});
