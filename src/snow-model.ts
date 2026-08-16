/*
 * The snowpack view's data shaping, kept pure so it can be tested against
 * the committed payload without a browser.
 *
 * The drainage-area curves are read from the payload's own rollups, never
 * recomputed here: the pipeline is the one place the rollup rule is written
 * (ADR-021 keeps snow ingestion in the refresh), and a second implementation
 * in the client is how the two would drift. The whole-region curve does not
 * exist in the payload, so it is computed here with the same rule the
 * pipeline uses, and a unit test holds the two implementations together by
 * recomputing a basin from its sites and comparing against the published
 * rollup, value for value.
 */
import type { NullableNumber, SnowpackPayload, SnowSite } from "./types";

export interface BasinChoice {
  code: string;
  label: string;
  siteCount: number;
}

export interface CurvePoint {
  date: string;
  /** Mean percent of the normal median, or null below the reporting floor. */
  percent: number | null;
  reportingSites: number;
}

export interface SiteRow {
  station: string;
  name: string;
  county: string;
  state: string;
  huc6: string;
  basinName: string;
  elevationFeet: number;
  latestDate: string;
  late: boolean;
  /** The newest reading, in inches of snow water equivalent. */
  inches: number | null;
  /** The normal median for the same day, in inches. */
  normalInches: number | null;
  /** Reading over normal, or null while the normal median is zero. */
  percent: number | null;
}

const roundTenth = (value: number): number => Math.round(value * 10) / 10;

/** The pipeline's own percent rule: null unless the normal median is above
 * zero, so a summer reading is never divided by nothing. */
export function percentOfNormal(
  value: number | null, median: number | null
): number | null {
  if (value === null || median === null || median <= 0) return null;
  return roundTenth((value / median) * 100);
}

export function basinChoices(payload: SnowpackPayload): BasinChoice[] {
  return payload.rollups
    .map((rollup) => ({
      code: rollup.huc6,
      label: rollup.huc6_name,
      siteCount: rollup.site_count
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** A drainage area's published seasonal curve, or null for an unknown code. */
export function basinCurve(
  payload: SnowpackPayload, huc6: string
): CurvePoint[] | null {
  const rollup = payload.rollups.find((entry) => entry.huc6 === huc6);
  if (!rollup) return null;
  return rollup.series.map((day) => ({
    date: day.date,
    percent: day.mean_percent_of_normal_median,
    reportingSites: day.reporting_site_count
  }));
}

/**
 * The whole region as one curve, computed from every site with the same
 * mean-of-site-percents rule and the same reporting floor the per-area
 * rollups publish.
 */
export function regionCurve(payload: SnowpackPayload): CurvePoint[] {
  const floor = payload.rollups.reduce(
    (highest, rollup) => Math.max(highest, rollup.minimum_reporting_sites), 2);
  const byDate = new Map<string, number[]>();
  for (const site of payload.sites) {
    for (const [date, value, median] of site.series) {
      const percent = percentOfNormal(value, median);
      if (percent === null) continue;
      const bucket = byDate.get(date);
      if (bucket) bucket.push(percent);
      else byDate.set(date, [percent]);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, percents]) => ({
      date,
      reportingSites: percents.length,
      percent: percents.length >= floor
        ? roundTenth(percents.reduce((sum, value) => sum + value, 0) / percents.length)
        : null
    }));
}

function latestReading(site: SnowSite): {
  inches: number | null; normalInches: number | null;
} {
  for (let index = site.series.length - 1; index >= 0; index -= 1) {
    const row = site.series[index];
    if (row && row[1] !== null) return { inches: row[1], normalInches: row[2] };
  }
  return { inches: null, normalInches: null };
}

/** The measurement sites in one drainage area, or all of them. The payload
 * is already ordered by area then name, and that order is kept. */
export function siteRows(
  payload: SnowpackPayload, huc6: string | null
): SiteRow[] {
  return payload.sites
    .filter((site) => huc6 === null || site.huc6 === huc6)
    .map((site) => {
      const { inches, normalInches } = latestReading(site);
      return {
        station: site.station,
        name: site.name,
        county: site.county,
        state: site.state,
        huc6: site.huc6,
        basinName: site.huc6_name,
        elevationFeet: site.elevation_feet,
        latestDate: site.latest_date,
        late: site.late,
        inches,
        normalInches,
        percent: percentOfNormal(inches, normalInches)
      };
    });
}

/** "October 2025 through September 2026" for water year 2026. */
export function seasonLabel(payload: SnowpackPayload): string {
  return `October ${payload.water_year - 1} through September ${payload.water_year}`;
}

export function normalPeriodLabel(payload: SnowpackPayload): string {
  return `${payload.normal_period.start_year} through ${payload.normal_period.end_year}`;
}

/*
 * The KPI floor. The published curve only needs two reporting sites for a
 * fair *daily mean*, but a single number promoted to a headline needs more:
 * in mid-October a handful of high stations divide small readings by small
 * normals and produce a "115% of normal" that describes almost nothing, and
 * in June the last two unmelted stations produce a 0% that describes even
 * less. A headline reading requires at least half the sites in view, and
 * the note beside it says so. The curve itself keeps the pipeline's floor --
 * this is a presentation rule, not a data rule.
 */
export function headlineFloor(siteCount: number, publishedFloor: number): number {
  return Math.max(publishedFloor, Math.ceil(siteCount / 2));
}

/** The newest day that meets the floor, or null when none does. */
export function newestHeadline(
  points: readonly CurvePoint[], floor: number
): CurvePoint | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]!;
    if (point.percent !== null && point.reportingSites >= floor) return point;
  }
  return null;
}

/** The highest mean among days that meet the floor, or null when none does. */
export function seasonHighPoint(
  points: readonly CurvePoint[], floor: number
): CurvePoint | null {
  let best: CurvePoint | null = null;
  for (const point of points) {
    if (point.percent === null || point.reportingSites < floor) continue;
    if (best === null || point.percent > (best.percent as number)) best = point;
  }
  return best;
}

/** One site's own reading for the chosen day, in the published units. */
export interface SiteDayDepth {
  inches: NullableNumber;
  normalInches: NullableNumber;
}

/** Everything the map colours for one day of the water year. */
export interface MapDayValues {
  /** Mean percent of normal per drainage area, from the published rollups. */
  basins: Map<string, number | null>;
  /** Percent of normal per station, from each site's own series. */
  sites: Map<string, number | null>;
  /**
   * Sites that reported for each drainage area that day.
   *
   * A separate fact from the mean, and the one a reader needs to weigh it:
   * an area at 46% of normal from eleven sites and the same figure from two
   * are different statements, and the fill draws them the same colour. The
   * map card says which.
   */
  reporting: Map<string, number>;
  /**
   * Depth per station, kept beside the percentage rather than derived from
   * it. The percentage is the framing everywhere in this view, but a card
   * that only gives a ratio cannot answer "of how much snow", and the two
   * numbers are already in the row the percentage was computed from.
   */
  depths: Map<string, SiteDayDepth>;
}

export function mapDayValues(
  payload: SnowpackPayload, date: string
): MapDayValues {
  const basins = new Map<string, number | null>();
  const reporting = new Map<string, number>();
  for (const rollup of payload.rollups) {
    const day = rollup.series.find((entry) => entry.date === date);
    basins.set(rollup.huc6, day ? day.mean_percent_of_normal_median : null);
    reporting.set(rollup.huc6, day ? day.reporting_site_count : 0);
  }
  const sites = new Map<string, number | null>();
  const depths = new Map<string, SiteDayDepth>();
  for (const site of payload.sites) {
    const row = site.series.find((entry) => entry[0] === date);
    sites.set(site.station, row ? percentOfNormal(row[1], row[2]) : null);
    depths.set(site.station, {
      inches: row ? row[1] : null,
      normalInches: row ? row[2] : null
    });
  }
  return { basins, sites, reporting, depths };
}

/**
 * The day the map opens on: the newest one where at least half the sites
 * reported, the same floor the headline values hold to. In August that is a
 * late-spring day, and the caption says so rather than colouring the region
 * from two melted stations.
 */
export function defaultMapDay(payload: SnowpackPayload): string | null {
  const region = regionCurve(payload);
  return newestHeadline(region, headlineFloor(payload.site_count, 2))?.date ?? null;
}

/** One published day of one site's series, with the columns named. */
export interface SitePoint {
  date: string;
  inches: number | null;
  normalInches: number | null;
}

export function sitePoints(site: SnowSite): SitePoint[] {
  return site.series.map(([date, inches, normalInches]) => ({
    date, inches, normalInches
  }));
}

export function siteByStation(
  payload: SnowpackPayload, station: string
): SnowSite | null {
  return payload.sites.find((site) => site.station === station) ?? null;
}

/**
 * The site's normal season, as dates in this water year.
 *
 * The provider publishes the timing as a month and day; October through
 * December belong to the water year's opening calendar year, January
 * onward to its closing one. A site whose timing the provider omits
 * answers null, and the page says the timing is not published rather than
 * inventing one.
 */
export interface SiteTiming {
  onset: string | null;
  peakDate: string | null;
  peakInches: number | null;
  meltout: string | null;
}

function timingDate(
  point: { month: number; day: number } | null, waterYear: number
): string | null {
  if (!point) return null;
  const year = point.month >= 10 ? waterYear - 1 : waterYear;
  const month = String(point.month).padStart(2, "0");
  const day = String(point.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function siteTiming(site: SnowSite, waterYear: number): SiteTiming {
  const timing = site.normal_timing;
  return {
    onset: timingDate(timing.onset, waterYear),
    peakDate: timingDate(timing.peak, waterYear),
    peakInches: timing.peak?.value ?? null,
    meltout: timingDate(timing.meltout, waterYear)
  };
}

/** The highest reading of the season so far, or null before any value. */
export function observedPeak(
  points: readonly SitePoint[]
): { date: string; inches: number } | null {
  let best: { date: string; inches: number } | null = null;
  for (const point of points) {
    if (point.inches !== null && (best === null || point.inches > best.inches)) {
      best = { date: point.date, inches: point.inches };
    }
  }
  return best;
}

/** First-of-month rows for the table behind a site's curve. */
export interface SiteMonthReading {
  key: string;
  label: string;
  point: SitePoint | null;
}

export function siteMonthReadings(
  points: readonly SitePoint[]
): SiteMonthReading[] {
  const months = new Map<string, SitePoint | null>();
  for (const point of points) {
    const key = point.date.slice(0, 7);
    if (!months.has(key)) {
      months.set(key, point.date.endsWith("-01") ? point : null);
    }
  }
  return [...months.entries()].map(([key, point]) => {
    const monthIndex = Number(key.slice(5)) - 1;
    return {
      key,
      label: `${MONTH_NAMES[monthIndex] ?? key} ${key.slice(0, 4)}`,
      point
    };
  });
}

export interface MonthReading {
  /** "2025-10" */
  key: string;
  label: string;
  point: CurvePoint | null;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/**
 * The first day of each month in the curve, for the table that carries the
 * chart's numbers as text. First-of-month rather than a monthly mean: it is
 * a reading the reader can point to on the chart, and "the value on the
 * first day of the month" needs no further explanation.
 */
export function monthReadings(points: readonly CurvePoint[]): MonthReading[] {
  const months = new Map<string, CurvePoint | null>();
  for (const point of points) {
    const key = point.date.slice(0, 7);
    if (!months.has(key)) {
      months.set(key, point.date.endsWith("-01") ? point : null);
    }
  }
  return [...months.entries()].map(([key, point]) => {
    const monthIndex = Number(key.slice(5)) - 1;
    return {
      key,
      label: `${MONTH_NAMES[monthIndex] ?? key} ${key.slice(0, 4)}`,
      point
    };
  });
}
