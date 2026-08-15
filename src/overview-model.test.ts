import { describe, expect, it } from "vitest";
import { readPayload } from "./data/payload-fixture";
import {
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
    for (const geography of ["utah", "connected"] as const) {
      for (const lakePowell of ["include", "exclude"] as const) {
        for (const shown of overviewScope(published, { geography, lakePowell })) {
          reachable.add(shown.name);
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
      query: "echo", huc6: "160202", cadence: "late"
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
