/*
 * Slice S4 (docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md). Only the pure
 * half of `where-control.ts` is tested here -- `createWhereControl` builds
 * real custom elements, and nothing in this repo's test environment can
 * exercise one outside a browser (`ui/hover-content.test.ts` documents the
 * same split for the hover cards). `whereControlView` and the four
 * `nextSelectionFor*` functions are exactly the surface a DOM layer would
 * call, so pinning them down here pins down the control's real behaviour:
 * what each select offers, what it shows as chosen, and what a reader's
 * pick turns into.
 *
 * The synthetic roster below is the same shape `data/opening-scope.test.ts`
 * uses -- two regions, four subregions, five basins, with two basins
 * (140101/140102) sharing a subregion so "siblings are still offered" has
 * something real to check, and codes that nest the way real HUC codes do.
 */
import { describe, expect, it } from "vitest";
import type { DrainageArea, DrainageAreaBox } from "../data/boundaries";
import type { OpeningRosters, OpeningSelection } from "../data/opening-scope";
import {
  ALL_VALUE,
  AXIS_ORDER,
  nextSelectionForArea,
  nextSelectionForRegion,
  nextSelectionForState,
  nextSelectionForSubregion,
  offeredAxes,
  whereControlView,
  type WhereAxisName
} from "./where-control-model";

function box(west: number, south: number, east: number, north: number): DrainageAreaBox {
  return [[west, south], [east, north]];
}

function area(huc6: string, name: string, states: string, unitBox?: DrainageAreaBox): DrainageArea {
  return unitBox ? { huc6, name, states, box: unitBox } : { huc6, name, states };
}

const REGIONS: readonly DrainageArea[] = [
  area("14", "Upper Colorado Region", "AZ,CO,NM,UT,WY", box(-112, 35, -105, 43)),
  area("16", "Great Basin Region", "CA,ID,NV,OR,UT,WY", box(-120, 35, -110, 43))
];
const SUBREGIONS: readonly DrainageArea[] = [
  area("1401", "Colorado Headwaters", "CO,UT", box(-109, 38, -105, 40)),
  area("1402", "Gunnison", "CO", box(-108, 37, -106, 39)),
  area("1601", "Bear", "ID,UT,WY", box(-112, 41, -110, 43)),
  area("1602", "Great Salt Lake", "UT", box(-113, 40, -111, 41.5))
];
const AREAS: readonly DrainageArea[] = [
  area("140101", "Colorado Headwaters", "CO,UT", box(-109, 38, -107, 40)),
  // Sibling of 140101 under subregion 1401, no published box -- allowed
  // (S1) and irrelevant to option-building, which reads only the code and
  // the name.
  area("140102", "Upper Colorado-Dolores", "CO,UT"),
  area("140200", "Gunnison Basin", "CO", box(-108, 37, -106, 39)),
  area("160101", "Bear Lake", "ID,UT", box(-112, 41, -111, 42)),
  area("160201", "Great Salt Lake", "UT", box(-113, 40, -111, 41.5))
];

const ROSTERS: OpeningRosters = { regions: REGIONS, subregions: SUBREGIONS, areas: AREAS };

const ALL: OpeningSelection = { state: "all", area: null };

function values(list: readonly { value: string }[]): string[] {
  return list.map((entry) => entry.value);
}

describe("whereControlView: option lists narrow coarsest-first", () => {
  it("offers every state the roster's areas touch, and only those", () => {
    const view = whereControlView(ROSTERS, ALL);
    // "All states" plus every code the AREAS list's `states` column holds,
    // sorted: CO, ID, UT.
    expect(values(view.state.options)).toEqual([ALL_VALUE, "CO", "ID", "UT"]);
  });

  it("never offers a border marker even if a roster carried one", () => {
    const withBorder: OpeningRosters = {
      ...ROSTERS,
      areas: [...AREAS, area("180100", "Border Basin", "CA,MX")]
    };
    const view = whereControlView(withBorder, ALL);
    expect(values(view.state.options)).not.toContain("MX");
  });

  it("narrows the state list's own regions by the chosen state, not just what sits under it", () => {
    // Region 14 is AZ,CO,NM,UT,WY -- no ID. Region 16 is CA,ID,NV,OR,UT,WY --
    // no CO. This is the pair that would fail if `region` options were never
    // filtered by state at all.
    const colorado = whereControlView(ROSTERS, { state: "CO", area: null });
    expect(values(colorado.region.options)).toEqual([ALL_VALUE, "14"]);
    const idaho = whereControlView(ROSTERS, { state: "ID", area: null });
    expect(values(idaho.region.options)).toEqual([ALL_VALUE, "16"]);
  });

  it("narrows subregion options to the chosen region, with siblings still offered", () => {
    const view = whereControlView(ROSTERS, { state: "all", area: "14" });
    // 1601/1602 (region 16) dropped; 1401 and 1402 both offered, not just
    // the chosen one -- a reader needs a sibling to switch to.
    expect(values(view.subregion.options)).toEqual([ALL_VALUE, "1401", "1402"]);
  });

  it("narrows drainage-area options to the chosen subregion, with siblings still offered", () => {
    const view = whereControlView(ROSTERS, { state: "all", area: "1401" });
    expect(values(view.area.options)).toEqual([ALL_VALUE, "140101", "140102"]);
  });

  it("names a subregion at its own level, so it cannot be read as a basin", () => {
    // Subregion 1401 and basin 140101 are both named "Colorado Headwaters"
    // in this fixture, on purpose -- nineteen real drawn basins do this.
    const view = whereControlView(ROSTERS, { state: "all", area: "14" });
    const subregionOption = view.subregion.options.find((option) => option.value === "1401");
    expect(subregionOption?.label).toBe("Colorado Headwaters subregion");
    const basinView = whereControlView(ROSTERS, { state: "all", area: "1401" });
    const basinOption = basinView.area.options.find((option) => option.value === "140101");
    expect(basinOption?.label).toBe("Colorado Headwaters");
  });
});

describe("whereControlView: a surviving choice is kept on repopulate", () => {
  it("keeps a chosen region selected and present among the options", () => {
    const view = whereControlView(ROSTERS, { state: "all", area: "14" });
    expect(view.region.value).toBe("14");
    expect(values(view.region.options)).toContain("14");
  });

  it("keeps a chosen subregion selected once narrowed under its region", () => {
    const view = whereControlView(ROSTERS, { state: "all", area: "1401" });
    expect(view.region.value).toBe("14");
    expect(view.subregion.value).toBe("1401");
    expect(values(view.subregion.options)).toContain("1401");
    // Not narrowed away by the state axis either.
    expect(view.area.value).toBe(ALL_VALUE);
  });

  it("keeps a chosen basin selected at every coarser level too", () => {
    const view = whereControlView(ROSTERS, { state: "UT", area: "140101" });
    expect(view.state.value).toBe("UT");
    expect(view.region.value).toBe("14");
    expect(view.subregion.value).toBe("1401");
    expect(view.area.value).toBe("140101");
    expect(values(view.area.options)).toContain("140101");
  });

  it("survives repopulation after a state is added on top of an existing area choice", () => {
    // The reader had narrowed to subregion 1401 with no state chosen, then
    // picked Colorado -- a state 1401 does touch. The subregion choice must
    // not reset just because the view was rebuilt around a new selection.
    const before = whereControlView(ROSTERS, { state: "all", area: "1401" });
    expect(before.subregion.value).toBe("1401");
    const after = whereControlView(ROSTERS, { state: "CO", area: "1401" });
    expect(after.subregion.value).toBe("1401");
    expect(values(after.subregion.options)).toContain("1401");
  });
});

describe("whereControlView: a dead choice falls back to all", () => {
  it("drops an area a state selection leaves nothing under, at every level", () => {
    // Subregion 1402 (Gunnison) is Colorado-only; nothing under it survives
    // Idaho.
    const view = whereControlView(ROSTERS, { state: "ID", area: "1402" });
    expect(view.state.value).toBe("ID");
    expect(view.region.value).toBe(ALL_VALUE);
    expect(view.subregion.value).toBe(ALL_VALUE);
    expect(view.area.value).toBe(ALL_VALUE);
  });

  it("drops an area code that matches nothing in any state", () => {
    const view = whereControlView(ROSTERS, { state: "all", area: "999999" });
    expect(view.region.value).toBe(ALL_VALUE);
    expect(view.subregion.value).toBe(ALL_VALUE);
    expect(view.area.value).toBe(ALL_VALUE);
  });
});

describe("nextSelectionForState", () => {
  it("keeps an area the new state still reaches", () => {
    const next = nextSelectionForState({ state: "all", area: "1401" }, ROSTERS, "CO");
    expect(next).toEqual({ state: "CO", area: "1401" });
  });

  it("drops an area the new state leaves nothing under", () => {
    const next = nextSelectionForState({ state: "all", area: "1402" }, ROSTERS, "ID");
    expect(next).toEqual({ state: "ID", area: null });
  });

  it("reads the sentinel back to the 'all' state", () => {
    const next = nextSelectionForState({ state: "CO", area: "14" }, ROSTERS, ALL_VALUE);
    expect(next.state).toBe("all");
  });
});

describe("nextSelectionForRegion", () => {
  it("replaces the whole area choice with the picked region", () => {
    expect(nextSelectionForRegion({ state: "UT", area: "1401" }, "16"))
      .toEqual({ state: "UT", area: "16" });
  });

  it("clears the area choice entirely on 'All regions' -- there is no coarser level", () => {
    expect(nextSelectionForRegion({ state: "UT", area: "14" }, ALL_VALUE))
      .toEqual({ state: "UT", area: null });
  });
});

describe("nextSelectionForSubregion", () => {
  it("sets the picked subregion", () => {
    expect(nextSelectionForSubregion({ state: "all", area: "14" }, "1401"))
      .toEqual({ state: "all", area: "1401" });
  });

  it("falls back to the region on 'All subregions', not to nothing", () => {
    expect(nextSelectionForSubregion({ state: "all", area: "1401" }, ALL_VALUE))
      .toEqual({ state: "all", area: "14" });
  });

  it("falls back to null when no region was chosen either", () => {
    expect(nextSelectionForSubregion({ state: "all", area: null }, ALL_VALUE))
      .toEqual({ state: "all", area: null });
  });
});

describe("nextSelectionForArea", () => {
  it("sets the picked drainage area", () => {
    expect(nextSelectionForArea({ state: "all", area: "1401" }, "140101"))
      .toEqual({ state: "all", area: "140101" });
  });

  it("falls back to the subregion on 'All drainage areas', dropping only the basin", () => {
    expect(nextSelectionForArea({ state: "all", area: "140101" }, ALL_VALUE))
      .toEqual({ state: "all", area: "1401" });
  });
});

/*
 * The nesting itself (WATER-BODY-AND-NAVIGATION-SCOPING.md item 3): each
 * finer menu shows which coarser place its rows belong to, as indented
 * group headings rather than flyout submenus -- measured at 360px, where a
 * flyout is several screens of popup scroll.
 */
describe("whereControlView: the hierarchy shows inside each menu", () => {
  it("groups subregion rows under their region's published name", () => {
    const view = whereControlView(ROSTERS, { state: "all", area: "14" });
    const rows = view.subregion.options.filter((row) => row.value !== ALL_VALUE);
    expect(rows.map((row) => row.group))
      .toEqual(["Upper Colorado Region", "Upper Colorado Region"]);
  });

  it("groups basin rows under their subregion's plain name", () => {
    // Plain, without the "subregion" suffix the option label carries: the
    // heading states a parent level, it does not offer a sibling.
    const view = whereControlView(ROSTERS, { state: "all", area: "1401" });
    const rows = view.area.options.filter((row) => row.value !== ALL_VALUE);
    expect(rows.map((row) => [row.label, row.group])).toEqual([
      ["Colorado Headwaters", "Colorado Headwaters"],
      ["Upper Colorado-Dolores", "Colorado Headwaters"]
    ]);
  });

  it("leaves the All rows ungrouped above every group", () => {
    const view = whereControlView(ROSTERS, ALL);
    expect(view.subregion.options[0]).toEqual({ value: ALL_VALUE, label: "All subregions" });
    expect(view.area.options[0]).toEqual({ value: ALL_VALUE, label: "All drainage areas" });
  });

  it("keeps the state list ungrouped -- nothing sits above it", () => {
    const view = whereControlView(ROSTERS, ALL);
    for (const row of view.state.options) expect(row.group).toBeUndefined();
    for (const row of view.region.options) expect(row.group).toBeUndefined();
  });
});

/*
 * Which axes a host gets (ADR-071). `createWhereControl` builds the selects
 * and cannot be called here, but the rule it applies is this function, and
 * the rule is what the storage and snow pages depend on: a page that owns
 * its own drainage-area control must not be handed a second one.
 */describe("offeredAxes", () => {
  it("gives the whole drill-down by default, in drill-down order", () => {
    expect(offeredAxes("area")).toEqual(["state", "region", "subregion", "area"]);
    expect(offeredAxes("area")).toEqual([...AXIS_ORDER]);
  });

  it("stops at the named axis and offers nothing finer", () => {
    expect(offeredAxes("subregion")).toEqual(["state", "region", "subregion"]);
    expect(offeredAxes("region")).toEqual(["state", "region"]);
    expect(offeredAxes("state")).toEqual(["state"]);
  });

  it("never drops a coarser axis to keep a finer one", () => {
    /* A prefix, always: the finer lists are `resolveOpeningScope`'s answer
     * under the coarser choices, so a basin select with no subregion select
     * above it would show a list a reader has no way to change. */
    for (const finest of AXIS_ORDER) {
      const offered = offeredAxes(finest);
      expect(offered).toEqual(AXIS_ORDER.slice(0, offered.length));
      expect(offered[offered.length - 1]).toBe(finest);
    }
  });

  it("keeps the storage and snow pages one step above their own picker", () => {
    /* The three real callers, spelled out so a change to any of them fails
     * here rather than only in the browser suite. Snow's follows `?level=`;
     * drought owns no drainage-area picker and keeps all four. */
    const snowFinest = (level: number): WhereAxisName => level >= 6 ? "subregion" : "region";
    expect(offeredAxes(snowFinest(6))).not.toContain("area");
    expect(offeredAxes(snowFinest(4))).not.toContain("subregion");
    expect(offeredAxes("subregion")).not.toContain("area");
    expect(offeredAxes("area")).toContain("area");
  });
});
