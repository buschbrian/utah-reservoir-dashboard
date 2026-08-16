import { describe, expect, it } from "vitest";
import { readSnowpack } from "./data/payload-fixture";
import {
  basinChoices,
  basinCurve,
  defaultMapDay,
  headlineFloor,
  mapDayValues,
  monthReadings,
  newestHeadline,
  percentOfNormal,
  regionCurve,
  seasonHighPoint,
  seasonLabel,
  siteRows,
  type CurvePoint
} from "./snow-model";

const payload = readSnowpack();

describe("percent of normal", () => {
  it("refuses to divide by a zero or missing normal median", () => {
    expect(percentOfNormal(0, 0)).toBeNull();
    expect(percentOfNormal(5, null)).toBeNull();
    expect(percentOfNormal(null, 10)).toBeNull();
  });

  it("rounds to one decimal place, the pipeline's own precision", () => {
    expect(percentOfNormal(1, 3)).toBe(33.3);
    expect(percentOfNormal(10, 8)).toBe(125);
  });
});

describe("basin choices", () => {
  it("lists every published drainage area once, ordered by name", () => {
    const choices = basinChoices(payload);
    expect(choices.length).toBe(payload.rollups.length);
    const labels = choices.map((choice) => choice.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    const totalSites = choices.reduce((sum, choice) => sum + choice.siteCount, 0);
    expect(totalSites).toBe(payload.site_count);
  });
});

describe("the curves", () => {
  it("reads a drainage area's curve from the published rollup", () => {
    const first = payload.rollups[0]!;
    const curve = basinCurve(payload, first.huc6);
    expect(curve).not.toBeNull();
    expect(curve!.length).toBe(first.series.length);
    expect(curve![0]!.percent).toBe(first.series[0]!.mean_percent_of_normal_median);
  });

  it("returns null for a drainage area the payload does not carry", () => {
    expect(basinCurve(payload, "999999")).toBeNull();
  });

  /*
   * The rule holding the client to the pipeline: recompute one basin from
   * its sites with the client's own arithmetic and compare against the
   * published rollup, value for value. If either side changes its percent
   * rule, its rounding, or its reporting floor, this is what notices.
   */
  it("computes percents exactly as the pipeline's rollups do", () => {
    const rollup = payload.rollups.find((entry) => entry.site_count >= 2)!;
    const sites = payload.sites.filter((site) => site.huc6 === rollup.huc6);
    const byDate = new Map<string, number[]>();
    for (const site of sites) {
      for (const [date, value, median] of site.series) {
        const percent = percentOfNormal(value, median);
        if (percent === null) continue;
        byDate.set(date, [...(byDate.get(date) ?? []), percent]);
      }
    }
    for (const day of rollup.series) {
      const percents = byDate.get(day.date) ?? [];
      expect(percents.length).toBe(day.reporting_site_count);
      const mean = percents.length >= rollup.minimum_reporting_sites
        ? Math.round(
          (percents.reduce((sum, value) => sum + value, 0) / percents.length) * 10
        ) / 10
        : null;
      if (mean === null || day.mean_percent_of_normal_median === null) {
        expect(mean).toBe(day.mean_percent_of_normal_median);
      } else {
        /* One rounding step of tolerance, not more: Python's round() breaks
         * a half-tie to the even digit and Math.round breaks it upward, so a
         * value landing exactly on a tie can differ by 0.1 between the
         * pipeline and this port. Anything larger is a real rule change --
         * a different percent formula, floor, or precision -- and fails. */
        expect(Math.abs(mean - day.mean_percent_of_normal_median))
          .toBeLessThanOrEqual(0.1 + 1e-9);
      }
    }
  });

  it("counts every basin's reporting sites in the whole-region curve", () => {
    const region = regionCurve(payload);
    expect(region.length).toBeGreaterThan(0);
    const regionByDate = new Map(region.map((point) => [point.date, point]));
    const summed = new Map<string, number>();
    for (const rollup of payload.rollups) {
      for (const day of rollup.series) {
        summed.set(day.date, (summed.get(day.date) ?? 0) + day.reporting_site_count);
      }
    }
    for (const [date, count] of summed) {
      expect(regionByDate.get(date)?.reportingSites).toBe(count);
    }
  });

  it("keeps the region curve in date order", () => {
    const dates = regionCurve(payload).map((point) => point.date);
    expect(dates).toEqual([...dates].sort());
  });
});

describe("site rows", () => {
  it("returns every site with a latest reading resolved", () => {
    const rows = siteRows(payload, null);
    expect(rows.length).toBe(payload.site_count);
    expect(rows.filter((row) => row.late).length).toBe(payload.late_site_count);
  });

  it("narrows to one drainage area", () => {
    const first = payload.rollups[0]!;
    const rows = siteRows(payload, first.huc6);
    expect(rows.length).toBe(first.site_count);
    expect(rows.every((row) => row.huc6 === first.huc6)).toBe(true);
  });
});

describe("labels", () => {
  it("names the season from the water year", () => {
    expect(seasonLabel(payload))
      .toBe(`October ${payload.water_year - 1} through September ${payload.water_year}`);
  });
});

describe("headline readings", () => {
  const points: CurvePoint[] = [
    { date: "2025-10-16", percent: 115.8, reportingSites: 12 },
    { date: "2025-12-06", percent: 77.7, reportingSites: 169 },
    { date: "2026-04-01", percent: 60.2, reportingSites: 150 },
    { date: "2026-06-21", percent: 0, reportingSites: 2 }
  ];

  it("requires at least half the sites in view", () => {
    expect(headlineFloor(217, 2)).toBe(109);
    expect(headlineFloor(3, 2)).toBe(2);
  });

  it("refuses an October artifact as the season high point", () => {
    // 115.8% from twelve early sites is not the story; 77.7% from 169 is.
    expect(seasonHighPoint(points, 109)?.percent).toBe(77.7);
  });

  it("refuses two unmelted June stations as the newest value", () => {
    expect(newestHeadline(points, 109)?.date).toBe("2026-04-01");
  });

  it("returns null when no day meets the floor", () => {
    expect(seasonHighPoint(points, 200)).toBeNull();
    expect(newestHeadline(points, 200)).toBeNull();
  });

  it("finds a headline in the committed payload", () => {
    const region = regionCurve(payload);
    const floor = headlineFloor(payload.site_count, 2);
    // Data-independent: any real season has at least one broad reading.
    expect(seasonHighPoint(region, floor)).not.toBeNull();
    expect(newestHeadline(region, floor)).not.toBeNull();
  });
});

describe("the map day", () => {
  it("opens on the newest day at least half the sites reported", () => {
    const day = defaultMapDay(payload);
    expect(day).not.toBeNull();
    const region = regionCurve(payload);
    const floor = headlineFloor(payload.site_count, 2);
    expect(day).toBe(newestHeadline(region, floor)?.date);
  });

  it("reads the same basin values the published rollups carry", () => {
    const day = defaultMapDay(payload)!;
    const values = mapDayValues(payload, day);
    expect(values.basins.size).toBe(payload.rollups.length);
    for (const rollup of payload.rollups) {
      const published = rollup.series.find((entry) => entry.date === day);
      expect(values.basins.get(rollup.huc6))
        .toBe(published ? published.mean_percent_of_normal_median : null);
    }
  });

  it("answers for every site, with null for a day it did not report", () => {
    const day = defaultMapDay(payload)!;
    const values = mapDayValues(payload, day);
    expect(values.sites.size).toBe(payload.site_count);
    const withValues = [...values.sites.values()]
      .filter((value) => value !== null).length;
    // The default day met the half-the-sites floor by construction.
    expect(withValues).toBeGreaterThanOrEqual(
      headlineFloor(payload.site_count, 2));
  });

  it("returns all null for a day outside the season", () => {
    const values = mapDayValues(payload, "1999-01-01");
    expect([...values.basins.values()].every((value) => value === null)).toBe(true);
    expect([...values.sites.values()].every((value) => value === null)).toBe(true);
  });
});

describe("month readings", () => {
  it("keeps one row per month, first-of-month values only", () => {
    const region = regionCurve(payload);
    const months = monthReadings(region);
    const keys = months.map((month) => month.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const month of months) {
      if (month.point) expect(month.point.date).toBe(`${month.key}-01`);
    }
    // The water year starts in October, so October leads the table.
    expect(keys[0]?.slice(5)).toBe("10");
  });
});
