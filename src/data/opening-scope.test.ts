/*
 * Slice S2 (docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md). Most of this
 * holds the narrowing arithmetic against small synthetic rosters, the same
 * way `extent.test.ts` holds `unionOfAreaBoxes` against synthetic boxes --
 * the narrowing rules are decisions, not geometry, and worth pinning down
 * with numbers a reader can check by hand. The last block grounds the
 * module against the committed reference export, asserting structure
 * rather than today's counts, so a morning refresh cannot turn this file
 * red.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAP_BOUNDS } from "../viz/extent";
import { readReferenceExport } from "./payload-fixture";
import type { DrainageArea, DrainageAreaBox } from "./boundaries";
import { parseStateList } from "./state-vocabulary";
import {
  DEFAULT_OPENING_SELECTION,
  loadOpeningRosters,
  openingSelectionFromSearch,
  regionRosterFromReference,
  resolveOpeningScope,
  withinOpeningArea,
  type OpeningRosters
} from "./opening-scope";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Answers every fetch with `body` as a 200 JSON response -- the pattern
 * `data/fetch.test.ts` already uses for `fetchWithin`, which `loadReference`
 * (and so `loadOpeningRosters`) goes through. */
function stubFetchJson(body: unknown): void {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

function box(west: number, south: number, east: number, north: number): DrainageAreaBox {
  return [[west, south], [east, north]];
}

function area(huc6: string, name: string, states: string, unitBox?: DrainageAreaBox): DrainageArea {
  return unitBox ? { huc6, name, states, box: unitBox } : { huc6, name, states };
}

/*
 * A small synthetic west: two regions, four subregions, five basins, with
 * two basins (140101/140102) sharing a subregion so the "siblings are still
 * offered" narrowing rule has something real to check. Codes nest the way
 * real HUC codes do -- a basin's first four digits are its subregion, its
 * first two its region -- which is the property the narrowing arithmetic
 * relies on.
 */
const REGIONS: readonly DrainageArea[] = [
  area("14", "Region Fourteen", "AZ,CO,NM,UT,WY", box(-112, 35, -105, 43)),
  area("16", "Region Sixteen", "CA,ID,NV,OR,UT,WY", box(-120, 35, -110, 43))
];
const SUBREGIONS: readonly DrainageArea[] = [
  area("1401", "Subregion Fourteen-Oh-One", "CO,UT", box(-109, 38, -105, 40)),
  area("1402", "Subregion Fourteen-Oh-Two", "CO", box(-108, 37, -106, 39)),
  area("1601", "Subregion Sixteen-Oh-One", "ID,UT,WY", box(-112, 41, -110, 43)),
  area("1602", "Subregion Sixteen-Oh-Two", "UT", box(-113, 40, -111, 41.5))
];
const AREAS: readonly DrainageArea[] = [
  area("140101", "Colorado Headwaters", "CO,UT", box(-109, 38, -107, 40)),
  // No published box, on purpose -- the same state S1 already allows for.
  // Also 140101's sibling under subregion 1401.
  area("140102", "Upper Colorado-Dolores", "CO,UT"),
  area("140200", "Gunnison", "CO", box(-108, 37, -106, 39)),
  area("160101", "Bear Lake", "ID,UT", box(-112, 41, -111, 42)),
  area("160201", "Great Salt Lake", "UT", box(-113, 40, -111, 41.5))
];

const ROSTERS: OpeningRosters = { regions: REGIONS, subregions: SUBREGIONS, areas: AREAS };

describe("reading ?state= and ?area=", () => {
  it("defaults to 'all' and null with no query string", () => {
    expect(openingSelectionFromSearch(null)).toEqual(DEFAULT_OPENING_SELECTION);
    expect(openingSelectionFromSearch("")).toEqual(DEFAULT_OPENING_SELECTION);
    expect(openingSelectionFromSearch(undefined)).toEqual(DEFAULT_OPENING_SELECTION);
  });

  it("reads a valid state and area together", () => {
    expect(openingSelectionFromSearch("?state=ID&area=1601")).toEqual({
      state: "ID", area: "1601"
    });
  });

  it("never honours a border marker, whatever a link asks for", () => {
    expect(openingSelectionFromSearch("?state=MX").state).toBe("all");
    expect(openingSelectionFromSearch("?state=CN").state).toBe("all");
  });

  it("rejects a state code outside the fifty-plus-DC vocabulary", () => {
    expect(openingSelectionFromSearch("?state=ZZ").state).toBe("all");
    expect(openingSelectionFromSearch("?state=utah").state).toBe("all");
  });

  it("accepts an area code at region, subregion or basin width", () => {
    expect(openingSelectionFromSearch("?area=14").area).toBe("14");
    expect(openingSelectionFromSearch("?area=1402").area).toBe("1402");
    expect(openingSelectionFromSearch("?area=140200").area).toBe("140200");
  });

  it("refuses an area code at a width this hierarchy does not narrow at", () => {
    // HUC_CODE itself accepts eight digits; this module's three levels do
    // not, and a silently-accepted eight-digit code would narrow every
    // roster to nothing.
    expect(openingSelectionFromSearch("?area=14020001").area).toBeNull();
    expect(openingSelectionFromSearch("?area=1").area).toBeNull();
    expect(openingSelectionFromSearch("?area=abcdef").area).toBeNull();
  });

  it("still reads a valid state through more than one leading '?'", () => {
    // A single `.replace(/^\?/, "")` strips only the first of several
    // leading question marks, and `URLSearchParams` itself strips only one
    // more -- so a caller who ever hands this a search string built by
    // prefixing "?" onto something that already had one (string
    // concatenation, not a real address bar, but cheap to guard) would
    // otherwise lose `state` silently rather than reading it.
    expect(openingSelectionFromSearch("??state=CA").state).toBe("CA");
    expect(openingSelectionFromSearch("???state=CA&area=14").state).toBe("CA");
    expect(openingSelectionFromSearch("???state=CA&area=14").area).toBe("14");
  });
});

describe("narrowing coarsest-first", () => {
  it("narrows region, subregion and area together when only a state is chosen", () => {
    const scope = resolveOpeningScope({ state: "UT", area: null }, ROSTERS);
    expect(scope.selection).toEqual({ state: "UT", area: null });
    expect(scope.regions.map((r) => r.huc6)).toEqual(["14", "16"]);
    expect(scope.subregions.map((s) => s.huc6)).toEqual(["1401", "1601", "1602"]);
    expect(scope.areas.map((a) => a.huc6)).toEqual(["140101", "140102", "160101", "160201"]);
    expect(scope.chosenAreas.map((a) => a.huc6)).toEqual(scope.areas.map((a) => a.huc6));
  });

  it("drops a region Utah does not touch, and everything nested under it", () => {
    // Subregion 1402 (Gunnison) is Colorado-only.
    const scope = resolveOpeningScope({ state: "UT", area: null }, ROSTERS);
    expect(scope.subregions.map((s) => s.huc6)).not.toContain("1402");
    expect(scope.areas.map((a) => a.huc6)).not.toContain("140200");
  });

  it("narrows the region list itself by state, not just what sits under it", () => {
    // Region "14" is AZ,CO,NM,UT,WY -- no ID. Region "16" is
    // CA,ID,NV,OR,UT,WY -- no CO. Every other test in this file happens to
    // choose a state both regions contain, which would pass even if
    // `regions` were never filtered at all -- this is the pair that tells
    // the two apart.
    const colorado = resolveOpeningScope({ state: "CO", area: null }, ROSTERS);
    expect(colorado.regions.map((r) => r.huc6)).toEqual(["14"]);
    const idaho = resolveOpeningScope({ state: "ID", area: null }, ROSTERS);
    expect(idaho.regions.map((r) => r.huc6)).toEqual(["16"]);
  });

  it("narrows subregions and areas to one region once a region is chosen", () => {
    const scope = resolveOpeningScope({ state: "all", area: "14" }, ROSTERS);
    expect(scope.selection.area).toBe("14");
    // Regions are never narrowed by their own level's choice -- a reader
    // needs a sibling to switch to.
    expect(scope.regions.map((r) => r.huc6)).toEqual(["14", "16"]);
    expect(scope.subregions.map((s) => s.huc6)).toEqual(["1401", "1402"]);
    expect(scope.areas.map((a) => a.huc6)).toEqual(["140101", "140102", "140200"]);
    expect(scope.chosenAreas.map((a) => a.huc6)).toEqual(["140101", "140102", "140200"]);
  });

  it("narrows areas to one subregion once a subregion is chosen, siblings included", () => {
    const scope = resolveOpeningScope({ state: "all", area: "1401" }, ROSTERS);
    // Subregions stop one level short too: 1402 is still offered as a
    // sibling to switch to, narrowed only by region.
    expect(scope.subregions.map((s) => s.huc6)).toEqual(["1401", "1402"]);
    expect(scope.areas.map((a) => a.huc6)).toEqual(["140101", "140102"]);
    expect(scope.chosenAreas.map((a) => a.huc6)).toEqual(["140101", "140102"]);
  });

  it("narrows to exactly one basin once a basin is chosen, siblings still offered", () => {
    const scope = resolveOpeningScope({ state: "all", area: "140101" }, ROSTERS);
    expect(scope.chosenAreas.map((a) => a.huc6)).toEqual(["140101"]);
    // The basin-level option list stops one level short, same as the rest:
    // narrowed to the subregion, not to the single chosen basin.
    expect(scope.areas.map((a) => a.huc6)).toEqual(["140101", "140102"]);
  });

  it("applies state and area together", () => {
    const scope = resolveOpeningScope({ state: "CO", area: "14" }, ROSTERS);
    expect(scope.chosenAreas.map((a) => a.huc6)).toEqual(["140101", "140102", "140200"]);
    const idaho = resolveOpeningScope({ state: "ID", area: "16" }, ROSTERS);
    expect(idaho.chosenAreas.map((a) => a.huc6)).toEqual(["160101"]);
  });
});

describe("a dead choice falls back to 'all'", () => {
  it("drops an area a state selection leaves nothing under, and keeps the state", () => {
    // Subregion 1402 is Colorado-only; nothing under it survives Utah.
    const scope = resolveOpeningScope({ state: "UT", area: "1402" }, ROSTERS);
    expect(scope.selection).toEqual({ state: "UT", area: null });
    expect(scope.chosenAreas.map((a) => a.huc6)).toEqual(
      resolveOpeningScope({ state: "UT", area: null }, ROSTERS).chosenAreas.map((a) => a.huc6));
  });

  it("drops an area code that matches nothing in any state", () => {
    const scope = resolveOpeningScope({ state: "all", area: "999999" }, ROSTERS);
    expect(scope.selection.area).toBeNull();
  });

  it("keeps a surviving choice rather than resetting it needlessly", () => {
    const scope = resolveOpeningScope({ state: "CO", area: "140200" }, ROSTERS);
    expect(scope.selection).toEqual({ state: "CO", area: "140200" });
  });

  it("state never falls back -- it is the coarsest axis", () => {
    // Idaho has real areas (160101), but none of them sit under 1402 --
    // the area is what falls back, never the state.
    const scope = resolveOpeningScope({ state: "ID", area: "1402" }, ROSTERS);
    expect(scope.selection.state).toBe("ID");
    expect(scope.selection.area).toBeNull();
  });
});

describe("the opening box", () => {
  it("is the union of the chosen areas' published boxes", () => {
    const scope = resolveOpeningScope({ state: "all", area: "140101" }, ROSTERS);
    expect(scope.box).toEqual(box(-109, 38, -107, 40));
  });

  it("falls back to MAP_BOUNDS when the only chosen area has no box", () => {
    const scope = resolveOpeningScope({ state: "all", area: "140102" }, ROSTERS);
    expect(scope.chosenAreas).toHaveLength(1);
    expect(scope.chosenAreas[0]?.box).toBeUndefined();
    expect(scope.box).toEqual(MAP_BOUNDS);
  });

  it("falls back to MAP_BOUNDS rather than an empty view when nothing survives", () => {
    const scope = resolveOpeningScope(
      { state: "all", area: "999999" }, { regions: [], subregions: [], areas: [] });
    expect(scope.chosenAreas).toHaveLength(0);
    expect(scope.box).toEqual(MAP_BOUNDS);
  });

  it("skips a boxless area rather than losing the whole view", () => {
    // 140102 (no box) sits alongside 140101 and 140200's boxes at the
    // region level; the union still comes from the two that published one.
    const scope = resolveOpeningScope({ state: "all", area: "14" }, ROSTERS);
    expect(scope.chosenAreas.map((a) => a.huc6)).toContain("140102");
    expect(scope.box).toEqual(box(-109, 37, -106, 40));
  });

  it("is exactly the union of a state's areas' own published boxes, not merely wide enough to contain them", () => {
    // Utah's chosen areas are 140101 (-109,38)-(-107,40), 160101
    // (-112,41)-(-111,42) and 160201 (-113,40)-(-111,41.5); 140102 has no
    // box. A containment-only check here would pass even against
    // `MAP_BOUNDS` itself (every one of these boxes sits inside it), so the
    // union has to be pinned to the exact corners it is expected to have.
    const scope = resolveOpeningScope({ state: "UT", area: null }, ROSTERS);
    expect(scope.chosenAreas.map((a) => a.huc6)).toEqual(
      ["140101", "140102", "160101", "160201"]);
    expect(scope.box).toEqual(box(-113, 38, -107, 42));
    // The exact union still contains every published box it was built
    // from, which is the property that makes it a fallback the reader can
    // trust rather than merely a wide one.
    const [[west, south], [east, north]] = scope.box;
    for (const chosen of scope.chosenAreas) {
      if (!chosen.box) continue;
      const [[cw, cs], [ce, cn]] = chosen.box;
      expect(west).toBeLessThanOrEqual(cw);
      expect(south).toBeLessThanOrEqual(cs);
      expect(east).toBeGreaterThanOrEqual(ce);
      expect(north).toBeGreaterThanOrEqual(cn);
    }
  });
});

describe("withinOpeningArea", () => {
  it("matches everything when nothing is chosen", () => {
    expect(withinOpeningArea("140100", null)).toBe(true);
    expect(withinOpeningArea(null, null)).toBe(true);
    expect(withinOpeningArea(undefined, null)).toBe(true);
  });

  it("prefix-matches a chosen area at any width", () => {
    expect(withinOpeningArea("140101", "14")).toBe(true);
    expect(withinOpeningArea("140101", "1401")).toBe(true);
    expect(withinOpeningArea("140101", "140101")).toBe(true);
    expect(withinOpeningArea("140200", "1401")).toBe(false);
  });

  it("does not match a record with no drainage-area code", () => {
    expect(withinOpeningArea(null, "14")).toBe(false);
    expect(withinOpeningArea(undefined, "14")).toBe(false);
    expect(withinOpeningArea("", "14")).toBe(false);
  });
});

describe("the region roster from a real reference export", () => {
  const reference = readReferenceExport();
  const regions = regionRosterFromReference(reference);

  it("reads five two-digit regions, named and stateful, from the registered scope", () => {
    expect(regions.length).toBe(5);
    for (const region of regions) {
      expect(region.huc6).toMatch(/^\d{2}$/);
      expect(region.name).not.toBe("");
      expect(region.states.length).toBeGreaterThan(0);
    }
  });

  it("returns nothing for a payload at the wrong schema version, rather than throwing", () => {
    const wrong = JSON.parse(JSON.stringify(reference)) as { schema_version: number };
    wrong.schema_version = 999;
    expect(regionRosterFromReference(wrong)).toEqual([]);
  });

  it("returns nothing for a malformed payload, rather than throwing", () => {
    expect(regionRosterFromReference(null)).toEqual([]);
    expect(regionRosterFromReference("not an object")).toEqual([]);
    expect(regionRosterFromReference({})).toEqual([]);
  });
});

describe("loadOpeningRosters against the committed reference export", () => {
  // Calls the exported async function itself, through a stubbed `fetch`
  // (the same seam `data/fetch.test.ts` uses) -- not a hand-rebuilt
  // equivalent. An edit to `loadOpeningRosters` that swapped which call
  // gets `SUBREGION_LEVEL`, or dropped the `url` pass-through, would fail
  // one of these; the earlier shape of this file, which called
  // `regionRosterFromReference`/`referenceGeography`/`parseDrainageUnits`
  // directly and reassembled their results, could not have.
  const reference = readReferenceExport();

  it("loads all three rosters from the real payload, structurally", async () => {
    stubFetchJson(reference);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rosters = await loadOpeningRosters("test://opening-scope/committed");
    expect(warned).not.toHaveBeenCalled();
    expect(rosters.regions.length).toBe(5);
    expect(rosters.subregions.length).toBeGreaterThan(0);
    expect(rosters.areas.length).toBeGreaterThan(0);
    // Subregions and basins are genuinely different levels here -- the
    // property the fallback test below exists because it can silently stop
    // being true.
    for (const subregion of rosters.subregions) expect(subregion.huc6).toMatch(/^\d{4}$/);
    for (const basin of rosters.areas) expect(basin.huc6).toMatch(/^\d{6}$/);

    const scope = resolveOpeningScope({ state: "UT", area: null }, rosters);
    expect(scope.chosenAreas.length).toBeGreaterThan(0);
    for (const chosen of scope.chosenAreas) {
      expect(parseStateList(chosen.states)).toContain("UT");
    }
  });

  it("narrows a real region to a strict subset of the full roster", async () => {
    stubFetchJson(reference);
    const rosters = await loadOpeningRosters("test://opening-scope/region-subset");
    const region = rosters.regions[0];
    if (!region) throw new Error("expected at least one published region");
    const scope = resolveOpeningScope({ state: "all", area: region.huc6 }, rosters);
    expect(scope.chosenAreas.length).toBeGreaterThan(0);
    expect(scope.chosenAreas.length).toBeLessThan(rosters.areas.length);
    for (const chosen of scope.chosenAreas) {
      expect(chosen.huc6.startsWith(region.huc6)).toBe(true);
    }
  });

  it("warns and degrades, rather than silently doubling the basin roster as subregions, when level 4 is not offered", async () => {
    const degraded = JSON.parse(JSON.stringify(reference)) as {
      geography: { watersheds: { drawn_scopes: Record<string, string> } };
    };
    delete degraded.geography.watersheds.drawn_scopes["4"];
    stubFetchJson(degraded);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rosters = await loadOpeningRosters("test://opening-scope/no-subregion-level");

    expect(warned).toHaveBeenCalledTimes(1);
    expect(String(warned.mock.calls[0]?.[0])).toContain("level 4");
    // Degraded, not silently wrong: `referenceGeography` fell back to
    // `default_scope` (still level 6 today), so the "subregion" roster is
    // exactly the basin roster relabelled -- visible in the warning above,
    // and here in the two lists actually being identical rather than one
    // pretending to be coarser than it is.
    expect(rosters.subregions.map((a) => a.huc6).sort())
      .toEqual(rosters.areas.map((a) => a.huc6).sort());
  });
});
