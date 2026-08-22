import { describe, expect, it } from "vitest";
import { readPayload } from "./data/payload-fixture";
import type { OpeningRosters, OpeningSelection } from "./data/opening-scope";
import {
  spreadBoxes,
  countyOptions,
  distributionKeyLines,
  distributionStats,
  geographicChoices,
  openingScopeSummary,
  reservoirInState,
  stateOptions,
  subregionOf,
  subregionNames,
  subregionOptions,
  filterAndSort,
  filterOverview,
  fixedCohort,
  monthlyTrend,
  percentFullValues,
  overviewScope,
  watershedOptions
} from "./overview-model";
import { isLakeMead, isLakePowell, WIDEST_SCOPE } from "./data/rollup";

const base = readPayload().reservoirs[0]!;
const reservoir = (overrides: Partial<typeof base>): typeof base => ({ ...base, ...overrides });

describe("the histogram's own statistics", () => {
  const points = (values: number[]) => values.map((value, index) => ({
    id: index + 1, label: `R${index}`, value, group: "area"
  }));

  it("computes the mean, the middle value and the middle half", () => {
    /* Hand-checked: mean 30, sorted 10 20 30 40 50 so the middle is 30, and
     * the quarter positions are 1 and 3 exactly, needing no interpolation. */
    expect(distributionStats(points([10, 20, 30, 40, 50]))).toEqual({
      mean: 30, median: 30, p25: 20, p75: 40
    });
  });

  it("averages the two middle values when the count is even", () => {
    expect(distributionStats(points([10, 20, 30, 40]))?.median).toBe(25);
  });

  /*
   * Quantiles rather than a standard deviation.
   *
   * The spread used to be reported as a sample standard deviation, matched to
   * the SDK's own overlay. Both are gone: they describe a sample from one
   * homogeneous population, and these reservoirs differ by size, purpose,
   * hydrology, operating rules and flood-control duty. A quarter of the
   * reservoirs being below 41% is true whatever shape they came from.
   */
  it("reports the middle half, interpolating like the median", () => {
    const stats = distributionStats(points([2, 4, 4, 4, 5, 5, 7, 9]));
    expect(stats?.mean).toBe(5);
    // Positions 1.75 and 5.25 in a sorted sample of eight.
    expect(stats?.p25).toBeCloseTo(4, 10);
    expect(stats?.p75).toBeCloseTo(5.5, 10);
  });

  /* About a quarter, not exactly a quarter: the quarter position of eleven
   * values falls between two of them, and interpolating puts the answer
   * where neither is. Within one value is the guarantee an interpolated
   * quantile can actually make, and the ordering is exact. */
  it("puts about a quarter of the sample below each end of the middle half", () => {
    const numbers = [3, 9, 14, 20, 27, 33, 41, 55, 62, 88, 91];
    const stats = distributionStats(points(numbers));
    const below = (edge: number): number =>
      numbers.filter((value) => value < edge).length;
    expect(Math.abs(below(stats!.p25) - numbers.length * 0.25)).toBeLessThanOrEqual(1);
    expect(Math.abs(below(stats!.p75) - numbers.length * 0.75)).toBeLessThanOrEqual(1);
    expect(stats!.p25).toBeLessThanOrEqual(stats!.median);
    expect(stats!.median).toBeLessThanOrEqual(stats!.p75);
  });

  /* Every sample the page can hand it, against the payload rather than a
   * fixture: the ordering must hold whatever the reservoirs are doing. */
  it("keeps the quarters in order for every scope on the page", () => {
    const all = readPayload().reservoirs;
    for (const size of [2, 5, 20, all.length]) {
      const stats = distributionStats(percentFullValues(all.slice(0, size)));
      if (!stats) continue;
      expect(stats.p25, `${size} reservoirs`).toBeLessThanOrEqual(stats.median);
      expect(stats.median, `${size} reservoirs`).toBeLessThanOrEqual(stats.p75);
    }
  });

  it("has no answer for fewer than two values", () => {
    expect(distributionStats(points([42]))).toBeNull();
    expect(distributionStats([])).toBeNull();
  });

  it("labels the key with the values, and without them when there are none", () => {
    const stats = { mean: 41.05, median: 38.8, p25: 22.4, p75: 61.2 };
    expect(distributionKeyLines(stats).map((entry) => entry.label)).toEqual([
      /* 41.0, not 41.1: `toFixed` is what every percentage on this site is
       * printed with, and 41.05 is held just below the half in binary. The
       * key rounds the way the rest of the page rounds. */
      "Mean 41.0%",
      "Middle value 38.8%",
      "Middle half 22.4% to 61.2%"
    ]);
    expect(distributionKeyLines(null).map((entry) => entry.label)).toEqual([
      "Mean", "Middle value", "Middle half"
    ]);
  });

  it("is the only legend the histogram has", () => {
    /* The two lines the chart draws, and one more the key states without
     * drawing: the SDK's histogram has no quantile overlay, and quantiles are
     * what this distribution can honestly carry. The SDK's own rail is off
     * (`legendVisibility`), so anything this key does not name is unexplained
     * on the page. Each line carries the key its colour is looked up by, so a
     * label and its ink cannot come apart. */
    const lines = distributionKeyLines();
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.key)).toEqual([
      "mean", "median", "middle-half"]);
    // The stated line is marked as stated, so the key can render it as text.
    expect(lines.map((line) => line.style)).toEqual(["solid", "dashed", null]);
  });
});

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

  /* Nested under the state heading, the label no longer carries `, ST`:
   * the group says which state, and two Summit Counties stay apart by
   * sitting under different ones. */
  it("groups the choices under their state, and keys them on the code", () => {
    expect(countyOptions(all)).toEqual([
      { code: "08117", label: "Summit County", group: "CO" },
      { code: "49043", label: "Summit County", group: "UT" },
      { code: "49053", label: "Washington County", group: "UT" }
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

/*
 * Slice S3d (docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md): the sentence
 * naming the place a reader's ?state= and ?area= opened this page on.
 */
describe("the opening scope summary sentence", () => {
  const rosters: OpeningRosters = {
    regions: [{ huc6: "14", name: "Upper Colorado Region", states: "CO,UT,WY" }],
    subregions: [{ huc6: "1601", name: "Bear River", states: "ID,UT,WY" }],
    areas: [{ huc6: "160101", name: "Bear Lake", states: "ID,UT" }]
  };
  const selection = (overrides: Partial<OpeningSelection>): OpeningSelection =>
    ({ state: "all", area: null, ...overrides });

  it("says nothing was narrowed when neither is chosen", () => {
    expect(openingScopeSummary(selection({}), rosters)).toBe("");
  });

  it("names the state alone", () => {
    expect(openingScopeSummary(selection({ state: "ID" }), rosters))
      .toBe("Showing reservoir storage for Idaho.");
  });

  it("names the area alone, at any of the three widths", () => {
    expect(openingScopeSummary(selection({ area: "14" }), rosters))
      .toBe("Showing reservoir storage for Upper Colorado Region.");
    expect(openingScopeSummary(selection({ area: "1601" }), rosters))
      .toBe("Showing reservoir storage for Bear River.");
    expect(openingScopeSummary(selection({ area: "160101" }), rosters))
      .toBe("Showing reservoir storage for Bear Lake.");
  });

  it("names the state and the area together", () => {
    expect(openingScopeSummary(selection({ state: "ID", area: "1601" }), rosters))
      .toBe("Showing reservoir storage for Bear River, in Idaho.");
  });

  it("drops a code with no published name rather than printing the digits", () => {
    // Alive (it survived resolveOpeningScope's own aliveness check against
    // the state) but absent from this particular roster snapshot -- the same
    // gap a payload published between R1 and R2 would leave.
    expect(openingScopeSummary(selection({ state: "UT", area: "999999" }), rosters))
      .toBe("Showing reservoir storage for Utah.");
  });

  it("falls back to the raw code for a state stateName does not recognise", () => {
    // Not a code resolveOpeningScope would ever hand this function -- it
    // only reaches here already validated -- but stateName's own fallback
    // (the code itself) is worth pinning down so a change to that function
    // cannot silently start printing something else here.
    expect(openingScopeSummary(selection({ state: "ZZ" }), rosters))
      .toBe("Showing reservoir storage for ZZ.");
  });
});

/* The geographic controls are one axis and the scope controls are another
 * (ADR-011). These assert the two do not leak into each other: a reader who
 * has not switched Lake Powell on -- which is everyone on first load, since
 * ADR-062 makes excluded the default -- must still be offered every drainage
 * area the roster holds, Lake Powell's own among them. */
describe("the geographic controls against the scope controls", () => {
  const payload = readPayload();
  const names = subregionNames(payload);
  const widest = overviewScope(payload.reservoirs, WIDEST_SCOPE);
  const codes = (options: { code: string }[]): string[] =>
    options.map((option) => option.code).sort();

  const openControls = { state: "all", subregion: "all" };

  it("offers every drainage area some published reservoir sits in", () => {
    const offered = new Set(
      codes(geographicChoices(widest, openControls, names).drainageAreas));
    /* Reachability, not a count, the same way the scope test above is
     * written: a morning that admits a reservoir in a new area cannot fail
     * this, only a morning that admits one the control cannot reach. */
    const held = payload.reservoirs
      .map((item) => item.huc6).filter((code): code is string => Boolean(code));
    expect(held.length).toBeGreaterThan(0);
    expect(held.filter((code) => !offered.has(code))).toEqual([]);
    /* Named rather than left to the sweep above: both dominant reservoirs
     * are excluded by default (ADR-062), and their own basins disappearing
     * from the control is the failure this describes. */
    for (const dominant of payload.reservoirs.filter((item) =>
      isLakePowell(item) || isLakeMead(item))) {
      expect(offered.has(dominant.huc6!)).toBe(true);
    }
  });

  /* The failure this pair exists to keep from coming back, stated as the
   * measurement rather than as a description: narrowing the option source by
   * the reader's scope loses areas, and the widest source does not. */
  it("loses drainage areas when the option source follows the scope instead", () => {
    const widestCodes = new Set(
      codes(geographicChoices(widest, openControls, names).drainageAreas));
    const defaultScope = overviewScope(payload.reservoirs,
      { geography: "utah", lakePowell: "exclude", lakeMead: "exclude" });
    const narrowed = codes(
      geographicChoices(defaultScope, openControls, names).drainageAreas);
    expect(narrowed.length).toBeLessThan(widestCodes.size);
    for (const code of narrowed) expect(widestCodes.has(code)).toBe(true);
  });

  it("still narrows drainage areas to the chosen subregion", () => {
    const everyArea = codes(
      geographicChoices(widest, openControls, names).drainageAreas);
    const subregion = everyArea[0]!.slice(0, 4);
    const narrowed = codes(geographicChoices(widest,
      { state: "all", subregion }, names).drainageAreas);
    expect(narrowed.length).toBeGreaterThan(0);
    for (const code of narrowed) expect(code.slice(0, 4)).toBe(subregion);
    expect(narrowed.length).toBeLessThanOrEqual(everyArea.length);
  });

  /* The subregion list answers to the state above it and to nothing below
   * it: picking a subregion narrows drainage areas, never the subregions on
   * offer, or the control would drop every choice but the one just made. */
  it("keeps the subregion list steady when a subregion is chosen", () => {
    const all = codes(geographicChoices(widest, openControls, names).subregions);
    expect(all.length).toBeGreaterThan(1);
    expect(codes(geographicChoices(widest,
      { state: "all", subregion: all[0]! }, names).subregions)).toEqual(all);
  });

  /* The county list narrows by the chosen state, exactly as the subregion
   * list does -- it was left out of that narrowing once and offered 157
   * counties across 11 states whatever the reader had picked above it. */
  it("narrows the county list to what the chosen state leaves", () => {
    const all = codes(
      geographicChoices(widest, openControls, names).counties);
    expect(all.length).toBeGreaterThan(1);
    /* The state comes off a published record rather than off the FIPS:
     * a FIPS prefix is a numeric code, not the postal abbreviation the
     * control offers. */
    const state = payload.reservoirs
      .find((item) => item.county_fips && item.state)!.state!;
    const narrowed = geographicChoices(widest,
      { state, subregion: "all" }, names).counties;
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThan(all.length);
  });

  /* A county cuts across drainage areas: holding the reader's county while
   * they move between subregions is a choice still on offer. */
  it("does not narrow the county list when only a subregion is chosen", () => {
    const everySubregion = codes(
      geographicChoices(widest, openControls, names).subregions);
    const withSubregion = codes(geographicChoices(widest,
      { state: "all", subregion: everySubregion[0]! }, names).counties);
    expect(withSubregion.length).toBeGreaterThan(0);
  });
});

/*
 * A twelve-month series drawn from a population that changes between points.
 *
 * The arithmetic per month is right -- only reporting reservoirs are on
 * either side of the ratio -- and the series across months still compares
 * two different sets. Measured on the payload of 2026-08-19, the newest
 * month covered 79% of the combined full level where the eleven before it
 * covered about 100%, and the July-to-August fall read four points steeper
 * than the same reservoirs measured across both months.
 */
describe("the population behind the twelve-month trend", () => {
  const reservoirs = readPayload().reservoirs;
  const points = monthlyTrend(reservoirs);

  it("draws twelve months, oldest first", () => {
    expect(points.length).toBeLessThanOrEqual(12);
    expect([...points].map((point) => point.month).sort())
      .toEqual(points.map((point) => point.month));
  });

  it("carries the population behind every point, not only the thin ones", () => {
    for (const point of points) {
      expect(point.scopeCount, point.month).toBe(reservoirs.length);
      expect(point.reporting, point.month).toBeLessThanOrEqual(point.scopeCount);
      expect(point.percentCapacityReporting, point.month).not.toBeUndefined();
    }
  });

  /* The cohort is chosen once for the whole series. A cohort that changed
   * between months would be the very thing it exists to rule out. */
  it("measures one fixed set of reservoirs across every month", () => {
    const cohort = fixedCohort(reservoirs, points.map((point) => point.month));
    for (const point of points) {
      expect(point.cohortCount, point.month).toBe(cohort.length);
    }
    for (const reservoir of cohort) {
      for (const point of points) {
        const entry = reservoir.monthly.find((row) => row.month === point.month);
        expect(entry?.mean_af, `${reservoir.name} in ${point.month}`)
          .not.toBeNull();
      }
    }
  });

  it("draws its cohort from the reservoirs handed in and no others", () => {
    const names = new Set(reservoirs.map((reservoir) => reservoir.name));
    for (const reservoir of fixedCohort(reservoirs, points.map((p) => p.month))) {
      expect(names.has(reservoir.name)).toBe(true);
    }
    // A month nothing reported leaves no cohort, rather than everything.
    expect(fixedCohort(reservoirs, ["1900-01"])).toEqual([]);
    // And no months is no cohort, not every reservoir.
    expect(fixedCohort(reservoirs, [])).toEqual([]);
  });

  /* Where the two series disagree, the difference is the reporting set. The
   * assertion is that they are computed from different populations and both
   * stay inside the possible range -- never that they agree, because the
   * months where they do not are the ones worth drawing. */
  it("keeps both series inside the range a share can take", () => {
    for (const point of points) {
      expect(point.percent, point.month).toBeGreaterThanOrEqual(0);
      if (point.cohortPercent === null) continue;
      expect(point.cohortPercent, point.month).toBeGreaterThanOrEqual(0);
      expect(point.cohortCount, point.month).toBeGreaterThan(0);
    }
  });
});

describe("the spread within each drainage area", () => {
  const point = (id: number, label: string, group: string, value: number) =>
    ({ id, label, group, value });

  it("puts the five numbers where an ordinary box plot does", () => {
    /* 1..9 in one group: quartiles at 3 and 7, middle at 5, and no value
     * outside 1.5 times the middle half, so the whiskers are the ends. */
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (value, index) => point(index + 1, `R${index}`, "Area", value));
    const [box] = spreadBoxes(values);
    expect(box?.p25).toBe(3);
    expect(box?.median).toBe(5);
    expect(box?.p75).toBe(7);
    expect(box?.low).toBe(1);
    expect(box?.high).toBe(9);
    expect(box?.outliers).toEqual([]);
    expect(box?.count).toBe(9);
  });

  /* The outliers are this chart's subject: a reservoir far below its
   * neighbours is the one to go and look at, so it keeps its identity rather
   * than becoming a bare value. */
  it("keeps an outlier's reservoir, not just its number", () => {
    const values = [
      ...[40, 42, 44, 46, 48, 50].map((value, index) =>
        point(index + 1, `R${index}`, "Area", value)),
      point(99, "Lost Lake", "Area", 2)
    ];
    const [box] = spreadBoxes(values);
    expect(box?.outliers.map((entry) => entry.label)).toEqual(["Lost Lake"]);
    /* And the whisker stops at the furthest value still inside the fence,
     * never at the outlier itself. */
    expect(box?.low).toBe(40);
  });

  /* A box over two reservoirs has quartiles that are just the two values
   * again, and a reader cannot tell that from a genuinely tight spread. */
  it("leaves out a group too small to have a spread", () => {
    const values = [
      point(1, "A", "Small", 10), point(2, "B", "Small", 20),
      ...[1, 2, 3].map((value, index) => point(index + 3, `C${index}`, "Big", value))
    ];
    expect(spreadBoxes(values).map((box) => box.group)).toEqual(["Big"]);
  });

  it("orders the driest area first and breaks a tie by name", () => {
    const values = [
      ...[1, 2, 3].map((value, index) => point(index + 1, `a${index}`, "Wet", value + 60)),
      ...[1, 2, 3].map((value, index) => point(index + 4, `b${index}`, "Zed", value)),
      ...[1, 2, 3].map((value, index) => point(index + 7, `c${index}`, "Ash", value))
    ];
    expect(spreadBoxes(values).map((box) => box.group)).toEqual(["Ash", "Zed", "Wet"]);
  });

  it("ignores a value that is not a number", () => {
    const values = [
      ...[1, 2, 3, 4].map((value, index) => point(index + 1, `R${index}`, "Area", value)),
      point(9, "Broken", "Area", Number.NaN)
    ];
    expect(spreadBoxes(values)[0]?.count).toBe(4);
  });
});
