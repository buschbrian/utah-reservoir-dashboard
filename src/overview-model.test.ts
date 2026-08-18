import { describe, expect, it } from "vitest";
import { readPayload } from "./data/payload-fixture";
import {
  countyOptions,
  reservoirInState,
  stateOptions,
  subregionOf,
  subregionOptions,
  filterAndSort,
  filterOverview,
  monthlyTrend,
  overviewScope,
  watershedOptions
} from "./overview-model";

const base = readPayload().reservoirs[0]!;
const reservoir = (overrides: Partial<typeof base>): typeof base => ({ ...base, ...overrides });

describe("modern overview model", () => {
  it("uses the same Utah-intersection scope as the modern map", () => {
    const included = reservoir({ name: "Cross-border", rise_item_id: 100,
      intersects_utah: true });
    const powell = reservoir({ name: "Glen Canyon reservoir", rise_item_id: 509,
      intersects_utah: true });
    const outside = reservoir({ name: "Outside", rise_item_id: 101,
      intersects_utah: false });
    expect(overviewScope([outside, powell, included])).toEqual([included]);
  });

  /* ADR-020. Publishing a reservoir the reader cannot reach by any choice of
   * the two controls is a refresh paying every morning for a record nobody can
   * see. This asserts reachability, not a count, so a morning that adds a
   * reservoir cannot fail it -- only a morning that adds an unreachable one. */
  it("leaves no published reservoir unreachable by some scope choice", () => {
    const published = readPayload().reservoirs;
    const reachable = new Set<string>();
    /* Every control, not every control this test happened to know about.
     * Lake Mead's admission added a third (ADR-062) and it was unreachable
     * until this loop learned it -- which is exactly the failure ADR-020
     * exists to catch, arriving through the test rather than the payload. */
    for (const geography of ["utah", "connected"] as const) {
      for (const lakePowell of ["include", "exclude"] as const) {
        for (const lakeMead of ["include", "exclude"] as const) {
          for (const shown of overviewScope(published, { geography, lakePowell, lakeMead })) {
            reachable.add(shown.name);
          }
        }
      }
    }
    expect(published.filter((item) => !reachable.has(item.name))).toEqual([]);
  });

  it("filters by reservoir or drainage-area name", () => {
    const bear = reservoir({ name: "Bear Lake", huc6_name: "Upper Bear" });
    const deer = reservoir({ name: "Deer Creek", huc6_name: "Jordan" });
    expect(filterAndSort([bear, deer], "upper", "name")).toEqual([bear]);
  });

  it("sorts missing capacity percentages last", () => {
    const missing = reservoir({ name: "Missing", pct_of_capacity: null });
    const low = reservoir({ name: "Low", pct_of_capacity: 20 });
    const high = reservoir({ name: "High", pct_of_capacity: 80 });
    expect(filterAndSort([missing, low, high], "", "percent").map((item) => item.name))
      .toEqual(["High", "Low", "Missing"]);
  });

  it("cross-filters query, watershed and reporting status", () => {
    const daily = reservoir({ name: "Deer Creek", rise_item_id: 100, huc6: "160202",
      huc6_name: "Great Salt Lake", data_frequency: "daily", is_stale: false });
    const late = reservoir({ name: "Echo", rise_item_id: 101, huc6: "160202",
      huc6_name: "Great Salt Lake", data_frequency: "monthly", days_stale: 46,
      is_stale: true });
    const other = reservoir({ name: "Scofield", rise_item_id: 102, huc6: "140600",
      huc6_name: "Lower Green", data_frequency: "monthly", days_stale: 46,
      is_stale: true });

    expect(filterOverview([daily, late, other], {
      query: "echo", state: "all", huc4: "all", huc6: "160202",
      county: "all", cadence: "late"
    })).toEqual([late]);
  });

  /* Every reservoir carries twelve months, but a late reservoir's twelve are
   * older ones, so the union across the set spans more than twelve -- and the
   * chart drawn from this claims to be "the last twelve months". */
  it("keeps the trend to the newest twelve months when late windows stretch the union", () => {
    const window12 = (endYear: number, endMonth: number): typeof base.monthly =>
      Array.from({ length: 12 }, (_, index) => {
        const date = new Date(Date.UTC(endYear, endMonth - 12 + index, 1));
        const month = `${date.getUTCFullYear()}-`
          + `${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
        return {
          month, mean_af: 100, min_af: 90, max_af: 110, end_af: 100,
          normal_af: 100, days: 28
        };
      });
    const current = reservoir({ name: "Current", monthly: window12(2026, 8) });
    const late = reservoir({ name: "Late", monthly: window12(2026, 5) });

    const trend = monthlyTrend([current, late]);
    expect(trend).toHaveLength(12);
    expect(trend[0]?.month).toBe("2025-09");
    expect(trend[trend.length - 1]?.month).toBe("2026-08");
  });

  it("provides unique alphabetized watershed choices", () => {
    const reservoirs = [
      reservoir({ huc6: "2", huc6_name: "Zion" }),
      reservoir({ huc6: "1", huc6_name: "Bear" }),
      reservoir({ huc6: "2", huc6_name: "Zion" }),
      reservoir({ huc6: null, huc6_name: null })
    ];
    expect(watershedOptions(reservoirs)).toEqual([
      { code: "1", label: "Bear" }, { code: "2", label: "Zion" }
    ]);
  });
});

/* Counties are a search and filter axis and deliberately not an aggregation
 * one (ADR-058): 68 reservoirs fall in 34 counties and 19 of those hold one,
 * so there is nothing here that groups by county and nothing that should. */
describe("the county axis", () => {
  const summitUt = reservoir({ name: "Rockport", rise_item_id: 200,
    county_fips: "49043", county_name: "Summit County", state: "UT" });
  const summitCo = reservoir({ name: "Dillon Reservoir", rise_item_id: 201,
    county_fips: "08117", county_name: "Summit County", state: "CO" });
  const washington = reservoir({ name: "Gunlock", rise_item_id: 202,
    county_fips: "49053", county_name: "Washington County", state: "UT" });
  const all = [summitUt, summitCo, washington];

  const filters = (overrides: Partial<Parameters<typeof filterOverview>[1]>) =>
    ({ query: "", state: "all", huc4: "all", huc6: "all", county: "all",
       cadence: "all" as const, ...overrides });

  it("separates two counties that share a name in different states", () => {
    expect(filterOverview(all, filters({ county: "49043" }))).toEqual([summitUt]);
    expect(filterOverview(all, filters({ county: "08117" }))).toEqual([summitCo]);
  });

  it("labels the choices with their state, and keys them on the code", () => {
    expect(countyOptions(all)).toEqual([
      { code: "08117", label: "Summit County, CO" },
      { code: "49043", label: "Summit County, UT" },
      { code: "49053", label: "Washington County, UT" }
    ]);
  });

  /* The payload published before the assignment shipped carries no county at
   * all. An empty list is how the page knows to leave the control out, so a
   * reader is never offered a filter whose every choice narrows to nothing. */
  it("offers nothing when the payload carries no counties", () => {
    /* The keys are removed rather than set to undefined, because that is what
     * an older payload actually is -- and because the fixture reads the
     * committed payload, which will carry counties itself once the assignment
     * ships. A fixture that stops representing the old shape stops testing
     * backward compatibility on the morning it matters. */
    const { county_fips, county_name, state, ...older } =
      reservoir({ name: "Older payload", rise_item_id: 203 });
    void county_fips; void county_name; void state;
    expect(countyOptions([older])).toEqual([]);
  });

  it("leaves a reservoir with no county out of a chosen county", () => {
    const unknown = reservoir({ name: "Unassigned", rise_item_id: 204,
      county_fips: null, county_name: null, state: null });
    expect(filterOverview([...all, unknown], filters({ county: "49043" })))
      .toEqual([summitUt]);
    expect(filterOverview([...all, unknown], filters({}))).toHaveLength(4);
  });

  it("finds a reservoir by its county, which is why the axis exists", () => {
    expect(filterOverview(all, filters({ query: "washington" }))).toEqual([washington]);
    /* Typing the state narrows a shared name the same way the code does. */
    expect(filterOverview(all, filters({ query: "summit county, co" })))
      .toEqual([summitCo]);
  });

  it("searches county in the sorted path too, so the two cannot drift", () => {
    expect(filterAndSort(all, "washington", "name")).toEqual([washington]);
  });
});

/* State and subregion, the two grouping axes the western expansion actually
 * wants. Both narrow each other: a state holds subregions, a subregion holds
 * drainage areas, and a reader starts wherever they like. */
describe("the state and subregion axes", () => {
  const powell = reservoir({ name: "Lake Powell", rise_item_id: 509,
    huc6: "140700", state: "UT", waterbody_states: ["AZ", "UT"] });
  const bear = reservoir({ name: "Bear Lake", rise_item_id: 601,
    huc6: "160101", state: "ID", waterbody_states: ["ID", "UT"] });
  const hyrum = reservoir({ name: "Hyrum", rise_item_id: 602,
    huc6: "160102", state: "UT", waterbody_states: ["UT"] });
  const all = [powell, bear, hyrum];

  const filters = (overrides: Partial<Parameters<typeof filterOverview>[1]>) =>
    ({ query: "", state: "all", huc4: "all", huc6: "all", county: "all",
       cadence: "all" as const, ...overrides });

  /* The choice ADR-060 forces: "in Utah" means the water, not the point.
   * Bear Lake's point is in Idaho and it belongs in Utah's list, which is
   * exactly what `intersects_utah` has always meant. */
  it("matches on where the water is, not where the point is", () => {
    expect(filterOverview(all, filters({ state: "UT" })))
      .toEqual([powell, bear, hyrum]);
    expect(filterOverview(all, filters({ state: "ID" }))).toEqual([bear]);
    expect(filterOverview(all, filters({ state: "AZ" }))).toEqual([powell]);
  });

  it("lists a reservoir under every state its water touches", () => {
    expect(stateOptions(all).map((o) => o.code)).toEqual(["AZ", "ID", "UT"]);
  });

  /* An older payload has no `waterbody_states`, and must not vanish from
   * every state filter because of it. */
  it("falls back to the point's state for a payload without the array", () => {
    const { waterbody_states, ...older } = reservoir({
      name: "Older", rise_item_id: 603, state: "WY" });
    void waterbody_states;
    expect(reservoirInState(older, "WY")).toBe(true);
    expect(reservoirInState(older, "UT")).toBe(false);
    expect(stateOptions([older]).map((o) => o.code)).toEqual(["WY"]);
  });

  /* Codes are fixed-width, so a subregion needs nothing published but its
   * name -- the first four digits are already in every record (ADR-050). */
  it("derives the subregion from the drainage-area code", () => {
    expect(subregionOf(powell)).toBe("1407");
    expect(subregionOf(bear)).toBe("1601");
    expect(subregionOf(reservoir({ huc6: null }))).toBeNull();
  });

  it("filters by subregion", () => {
    expect(filterOverview(all, filters({ huc4: "1601" }))).toEqual([bear, hyrum]);
    expect(filterOverview(all, filters({ huc4: "1407" }))).toEqual([powell]);
  });

  it("names subregions from the roster and falls back to the code", () => {
    const names = new Map([["1601", "Bear"]]);
    expect(subregionOptions(all, names)).toEqual([
      { code: "1407", label: "1407" },
      { code: "1601", label: "Bear" }
    ]);
  });

  it("narrows: state, then subregion, then drainage area", () => {
    expect(filterOverview(all, filters({ state: "UT", huc4: "1601" })))
      .toEqual([bear, hyrum]);
    expect(filterOverview(all, filters({ state: "ID", huc4: "1601", huc6: "160102" })))
      .toEqual([]);
    expect(filterOverview(all, filters({ state: "UT", huc4: "1601", huc6: "160102" })))
      .toEqual([hyrum]);
  });
});
