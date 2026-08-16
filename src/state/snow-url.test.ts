import { describe, expect, it } from "vitest";
import { snowSearchFromState, snowStateFromSearch } from "./snow-url";

describe("snow URL state", () => {
  it("reads a six-digit drainage area and nothing else", () => {
    expect(snowStateFromSearch("?area=160201")).toEqual({ area: "160201" });
    expect(snowStateFromSearch("?area=abc")).toEqual({ area: null });
    expect(snowStateFromSearch("?area=1602010")).toEqual({ area: null });
    expect(snowStateFromSearch("")).toEqual({ area: null });
  });

  it("round-trips every reachable state", () => {
    for (const area of ["140100", null]) {
      const search = snowSearchFromState({ area }, "");
      expect(snowStateFromSearch(search)).toEqual({ area });
    }
  });

  it("drops the parameter entirely for the whole region", () => {
    expect(snowSearchFromState({ area: null }, "?area=160201")).toBe("");
  });

  it("leaves parameters it does not own alone", () => {
    const search = snowSearchFromState({ area: "140100" }, "?theme=dark");
    expect(search).toContain("theme=dark");
    expect(search).toContain("area=140100");
  });
});
