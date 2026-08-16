import { describe, expect, it } from "vitest";
import { readSnowpack } from "./data/payload-fixture";
import { SNOW_CLASSES, snowClassIndex } from "./viz/snow-classes";
import {
  basinChoices,
  basinCurve,
  defaultMapDay,
  headlineFloor,
  mapDayValues,
  monthReadings,
  newestHeadline,
  percentOfNormal,
  observedPeak,
  regionCurve,
  regionDepthCurve,
  seasonHighPoint,
  seasonLabel,
  siteByStation,
  siteMonthReadings,
  sitePoints,
  siteRows,
  siteSpread,
  elevationBandOf,
  filterSiteRows,
  siteFilterActive,
  NO_SITE_FILTER,
  type SiteRow,
  siteTiming,
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
  /*
   * The map opens on the season's peak snow, and each half of that is a
   * decision the data forced.
   *
   * It used to open on the newest day meeting the floor. Late in the melt
   * season that is the *most depleted* day that still qualifies, so the map
   * opened on the worst picture of the year by construction.
   *
   * And peak depth, not peak percent of normal: the highest-ratio day in this
   * record sits in early December on a couple of inches of snow, because the
   * normal it is divided by is tiny then too.
   */
  it("opens on the day the region held the most snow", () => {
    const day = defaultMapDay(payload);
    const floor = headlineFloor(payload.site_count, 2);
    const qualifying = regionDepthCurve(payload)
      .filter((point) => point.reportingSites >= floor);

    expect(day).not.toBeNull();
    expect(qualifying.length).toBeGreaterThan(0);
    const peak = qualifying.reduce((best, point) =>
      point.meanInches > best.meanInches ? point : best);
    expect(day).toBe(peak.date);
  });

  it("does not open on the newest day, which is the most melted one", () => {
    const floor = headlineFloor(payload.site_count, 2);
    const newest = newestHeadline(regionCurve(payload), floor);
    const peak = regionDepthCurve(payload)
      .filter((point) => point.reportingSites >= floor)
      .reduce((best, point) => point.meanInches > best.meanInches ? point : best);

    /* Data-independent: assert the relationship, not the dates. In a record
     * that ends mid-winter these could coincide, and that would be correct. */
    expect(peak.meanInches).toBeGreaterThanOrEqual(
      regionDepthCurve(payload).find((p) => p.date === newest?.date)?.meanInches ?? 0);
  });

  it("lets a handful of high stations define nothing", () => {
    const floor = headlineFloor(payload.site_count, 2);
    const day = defaultMapDay(payload)!;
    const point = regionDepthCurve(payload).find((entry) => entry.date === day);

    expect(point?.reportingSites).toBeGreaterThanOrEqual(floor);
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

describe("one site's season", () => {
  const site = payload.sites[0]!;

  it("finds a site by its station and answers null for a stranger", () => {
    expect(siteByStation(payload, site.station)?.name).toBe(site.name);
    expect(siteByStation(payload, "0000:XX:NONE")).toBeNull();
  });

  it("names the columns of every published day", () => {
    const points = sitePoints(site);
    expect(points.length).toBe(site.series.length);
    expect(points[0]).toEqual({
      date: site.series[0]![0],
      inches: site.series[0]![1],
      normalInches: site.series[0]![2]
    });
  });

  it("places the normal season inside the water year", () => {
    const timing = siteTiming({
      ...site,
      normal_timing: {
        onset: { month: 10, day: 11 },
        peak: { month: 5, day: 1, value: 25.2 },
        meltout: { month: 6, day: 17 }
      }
    }, 2026);
    // October belongs to the opening calendar year, May and June to the
    // closing one.
    expect(timing.onset).toBe("2025-10-11");
    expect(timing.peakDate).toBe("2026-05-01");
    expect(timing.peakInches).toBe(25.2);
    expect(timing.meltout).toBe("2026-06-17");
  });

  it("answers null for timing the provider does not publish", () => {
    const timing = siteTiming({
      ...site,
      normal_timing: { peak: null, onset: null, meltout: null }
    }, 2026);
    expect(timing).toEqual({
      onset: null, peakDate: null, peakInches: null, meltout: null
    });
  });

  it("finds the season's highest reading", () => {
    const peak = observedPeak([
      { date: "2026-01-01", inches: 3, normalInches: 5 },
      { date: "2026-03-01", inches: 9.5, normalInches: 10 },
      { date: "2026-04-01", inches: null, normalInches: 11 }
    ]);
    expect(peak).toEqual({ date: "2026-03-01", inches: 9.5 });
    expect(observedPeak([
      { date: "2026-01-01", inches: null, normalInches: null }
    ])).toBeNull();
  });

  it("keeps one month row per month, first-of-month values only", () => {
    const months = siteMonthReadings(sitePoints(site));
    const keys = months.map((month) => month.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const month of months) {
      if (month.point) expect(month.point.date).toBe(`${month.key}-01`);
    }
  });

  it("gives every committed site a drawable season", () => {
    for (const entry of payload.sites) {
      const points = sitePoints(entry);
      expect(points.length).toBeGreaterThan(1);
      expect(points.some((point) => point.inches !== null)).toBe(true);
    }
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

describe("narrowing the site table", () => {
  const row = (over: Partial<SiteRow>): SiteRow => ({
    station: "1:UT:SNTL", name: "Alta", county: "Salt Lake", state: "UT",
    huc6: "160202", basinName: "Jordan", elevationFeet: 8800,
    latestDate: "2026-08-15", late: false, inches: 1, normalInches: 2, percent: 50,
    ...over
  });

  it("puts each site in an elevation band by its own height", () => {
    expect(elevationBandOf(7999)).toBe("low");
    expect(elevationBandOf(8000)).toBe("middle");
    expect(elevationBandOf(9499)).toBe("middle");
    expect(elevationBandOf(9500)).toBe("high");
  });

  it("keeps only the chosen band", () => {
    const rows = [row({ name: "Low", elevationFeet: 7000 }),
      row({ name: "Mid", elevationFeet: 8800 }),
      row({ name: "High", elevationFeet: 10000 })];

    expect(filterSiteRows(rows, { ...NO_SITE_FILTER, band: "high" })
      .map((entry) => entry.name)).toEqual(["High"]);
    expect(filterSiteRows(rows, NO_SITE_FILTER)).toHaveLength(3);
  });

  it("separates late sites from the ones still sending values", () => {
    const rows = [row({ name: "Fresh", late: false }), row({ name: "Old", late: true })];

    expect(filterSiteRows(rows, { ...NO_SITE_FILTER, status: "late" })
      .map((entry) => entry.name)).toEqual(["Old"]);
    expect(filterSiteRows(rows, { ...NO_SITE_FILTER, status: "reporting" })
      .map((entry) => entry.name)).toEqual(["Fresh"]);
  });

  /* The county is searched as well as the name because that is how people
   * ask for these sites out loud -- "the ones above Heber" is a county, not
   * a station name -- and the county is already a column in the table. */
  it("searches the name and the county, ignoring case and surrounding space", () => {
    const rows = [row({ name: "Alta", county: "Salt Lake" }),
      row({ name: "Trial Lake", county: "Summit" })];

    expect(filterSiteRows(rows, { ...NO_SITE_FILTER, query: "ALTA" }))
      .toHaveLength(1);
    expect(filterSiteRows(rows, { ...NO_SITE_FILTER, query: "  summit " })
      .map((entry) => entry.name)).toEqual(["Trial Lake"]);
    expect(filterSiteRows(rows, { ...NO_SITE_FILTER, query: "nowhere" }))
      .toHaveLength(0);
  });

  it("applies every narrowing at once", () => {
    const rows = [row({ name: "Alta", elevationFeet: 10000, late: true }),
      row({ name: "Alta Low", elevationFeet: 7000, late: true }),
      row({ name: "Brighton", elevationFeet: 10000, late: true })];

    expect(filterSiteRows(rows,
      { query: "alta", band: "high", status: "late" }).map((entry) => entry.name))
      .toEqual(["Alta"]);
  });

  /* Not derived from a row count: a filter that happens to keep every row is
   * still a filter, and the page says which one rather than claiming nothing
   * is applied. */
  it("reports itself active even when it excludes nothing", () => {
    expect(siteFilterActive(NO_SITE_FILTER)).toBe(false);
    expect(siteFilterActive({ ...NO_SITE_FILTER, band: "low" })).toBe(true);
    expect(siteFilterActive({ ...NO_SITE_FILTER, query: "  " })).toBe(false);
    expect(siteFilterActive({ ...NO_SITE_FILTER, query: "a" })).toBe(true);
  });
});

describe("how one day's readings are spread", () => {
  /* The mean cannot tell a region uniformly at 70% from one where half the
   * sites are bare and half are near normal. Those are different winters. */
  it("counts the sites in each class and the ones with no value", () => {
    const values = new Map<string, number | null>([
      ["a", 10], ["b", 45], ["c", 95], ["d", null], ["e", 200]
    ]);
    const spread = siteSpread(values, SNOW_CLASSES.length, snowClassIndex);

    // Under 25, then 25-50, then near normal, then above 110.
    expect(spread.counts[0]).toBe(1);
    expect(spread.counts[1]).toBe(1);
    expect(spread.counts[4]).toBe(1);
    expect(spread.counts[5]).toBe(1);
    expect(spread.noValue).toBe(1);
    expect(spread.reporting).toBe(4);
  });

  it("adds up to every site it was given", () => {
    const values = new Map<string, number | null>(
      Array.from({ length: 20 }, (_, index) =>
        [`s${index}`, index % 3 === 0 ? null : index * 12]));
    const spread = siteSpread(values, SNOW_CLASSES.length, snowClassIndex);

    const total = spread.counts.reduce((sum, count) => sum + count, 0) + spread.noValue;
    expect(total).toBe(values.size);
    expect(spread.reporting + spread.noValue).toBe(values.size);
  });

  it("answers for an empty day without inventing a class", () => {
    const spread = siteSpread(new Map(), SNOW_CLASSES.length, snowClassIndex);
    expect(spread.counts.every((count) => count === 0)).toBe(true);
    expect(spread.noValue).toBe(0);
    expect(spread.reporting).toBe(0);
  });
});
