import { describe, expect, it } from "vitest";
import { readDrainageGeoJson, readPayload, readSnowpack } from "./payload-fixture";
import {
  areaReachesState,
  isUsStateCode,
  offeredStates,
  parseStateList,
  stateName,
  US_STATE_CODES,
  type StatesBearing
} from "./state-vocabulary";

describe("the explicit US state vocabulary", () => {
  it("is exactly the fifty states plus the District of Columbia", () => {
    expect(US_STATE_CODES.length).toBe(51);
    expect(new Set(US_STATE_CODES).size).toBe(51);
    expect(US_STATE_CODES.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
  });

  it("never includes the border markers the boundary dataset publishes", () => {
    expect(US_STATE_CODES).not.toContain("MX");
    expect(US_STATE_CODES).not.toContain("CN");
  });

  it("recognizes a state the roster holds and rejects a border marker", () => {
    expect(isUsStateCode("UT")).toBe(true);
    expect(isUsStateCode("DC")).toBe(true);
    expect(isUsStateCode("MX")).toBe(false);
    expect(isUsStateCode("CN")).toBe(false);
    expect(isUsStateCode("")).toBe(false);
    expect(isUsStateCode("utah")).toBe(false);
  });

  it("names a known code and falls back to the code for an unknown one", () => {
    expect(stateName("UT")).toBe("Utah");
    expect(stateName("CO")).toBe("Colorado");
    expect(stateName("MX")).toBe("MX");
  });
});

describe("parsing a drainage area's comma-joined states", () => {
  it("splits a plain list", () => {
    expect(parseStateList("CO,UT")).toEqual(["CO", "UT"]);
  });

  it("tolerates whitespace around a code", () => {
    expect(parseStateList("CO, UT")).toEqual(["CO", "UT"]);
    expect(parseStateList(" CO , UT ")).toEqual(["CO", "UT"]);
  });

  it("tolerates an empty string", () => {
    expect(parseStateList("")).toEqual([]);
  });

  it("tolerates a trailing comma without inventing an empty code", () => {
    expect(parseStateList("UT,")).toEqual(["UT"]);
  });

  it("keeps a single code as a one-element list", () => {
    expect(parseStateList("UT")).toEqual(["UT"]);
  });
});

describe("whether a drainage area's water reaches a state", () => {
  const twoState: StatesBearing = { states: "CO,UT" };
  const oneState: StatesBearing = { states: "UT" };
  const noState: StatesBearing = { states: "" };

  it("answers true for every state the water touches", () => {
    expect(areaReachesState(twoState, "CO")).toBe(true);
    expect(areaReachesState(twoState, "UT")).toBe(true);
  });

  it("answers false for a state the water does not touch", () => {
    expect(areaReachesState(oneState, "CO")).toBe(false);
    expect(areaReachesState(noState, "UT")).toBe(false);
  });

  it("treats \"all\" as matching everything, the same sentinel reservoirInState reads", () => {
    expect(areaReachesState(noState, "all")).toBe(true);
    expect(areaReachesState(twoState, "all")).toBe(true);
  });
});

describe("the states offered to a reader", () => {
  it("derives the list from what the three payloads actually hold", () => {
    const reservoirs = readPayload().reservoirs;
    const snow = readSnowpack();
    const drainage = readDrainageGeoJson() as {
      features: { properties: Record<string, string> }[];
    };

    const offered = offeredStates({
      reservoirStates: reservoirs.map(
        (reservoir) => reservoir.waterbody_states ?? reservoir.state ?? null),
      snowSiteStates: snow.sites.map((site) => site.state),
      drainageAreaStates: drainage.features.map((feature) => feature.properties["states"] ?? "")
    });

    expect(offered.length).toBeGreaterThan(0);
    /* Sorted by code, and every code labelled with a real name rather than
     * falling back to itself. */
    const codes = offered.map((option) => option.code);
    expect(codes).toEqual([...codes].sort());
    for (const option of offered) {
      expect(option.label).not.toBe(option.code);
    }
  });

  it("excludes the border markers even though the drainage payload carries them", () => {
    const drainage = readDrainageGeoJson() as {
      features: { properties: Record<string, string> }[];
    };
    /* Confirms the fixture actually exercises the exclusion this test is
     * about, rather than passing because no border marker was ever present. */
    const rawCodes = new Set(
      drainage.features.flatMap((feature) =>
        parseStateList(feature.properties["states"] ?? "")));
    expect(rawCodes.has("MX")).toBe(true);
    expect(rawCodes.has("CN")).toBe(true);

    const offered = offeredStates({
      drainageAreaStates: drainage.features.map((feature) => feature.properties["states"] ?? "")
    });
    const offeredCodes = new Set(offered.map((option) => option.code));
    expect(offeredCodes.has("MX")).toBe(false);
    expect(offeredCodes.has("CN")).toBe(false);
  });

  it("offers every state a reservoir's water actually touches", () => {
    const reservoirs = readPayload().reservoirs;
    const offered = new Set(offeredStates({
      reservoirStates: reservoirs.map(
        (reservoir) => reservoir.waterbody_states ?? reservoir.state ?? null)
    }).map((option) => option.code));

    for (const reservoir of reservoirs) {
      const states = reservoir.waterbody_states?.length
        ? reservoir.waterbody_states
        : (reservoir.state ? [reservoir.state] : []);
      for (const code of states) expect(offered.has(code)).toBe(true);
    }
  });

  it("returns nothing when no source is given", () => {
    expect(offeredStates({})).toEqual([]);
  });
});
