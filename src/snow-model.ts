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
import type { DrainageScope } from "./data/boundaries";
import type {
  NullableNumber,
  SnowpackPayload,
  SnowRollup,
  SnowRollupDay,
  SnowSite
} from "./types";

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

/**
 * The payload regrouped into larger drainage areas.
 *
 * A reader may ask for subregions instead of basins (ADR-064), and what
 * changes is only how the same sites are grouped: 217 stations reporting into
 * 11 areas rather than 14. Every figure on the page is rebuilt from the
 * *sites*, never by averaging the published basin means -- those are means
 * over unequal numbers of stations, and a mean of them is a different number
 * with no name.
 *
 * The whole payload is rebuilt rather than the rollups alone, so nothing
 * downstream learns about levels: the picker, the curves, the site table, the
 * map and the `?basin=` link all read `huc6` and get whichever grouping the
 * reader asked for. It is the arrangement `validateSnowpackPayload` uses for
 * the shared water-year calendar, one level up.
 *
 * The names come from the payload's own subregion roster, which is names and
 * nothing else because the codes are the first four digits of one every site
 * already carries (ADR-060's rule, applied to this payload). An area with no
 * published name is labelled by its code, exactly as `parseDrainageUnits`
 * does.
 */
export function payloadAtLevel(
  payload: SnowpackPayload, level: number
): SnowpackPayload {
  if (level >= 6) return payload;
  const names = new Map((payload.subregions ?? []).map(
    (entry) => [entry.huc4, entry.name]));
  const label = (code: string): string => {
    const name = names.get(code);
    return name !== undefined && name !== "" ? name : code;
  };
  const sites = payload.sites.map((site) => {
    const code = site.huc6.slice(0, level);
    return { ...site, huc6: code, huc6_name: label(code) };
  });
  /* The pipeline's own floor, carried rather than chosen here: a coarser area
   * holds more stations, so the minimum that made a basin's mean publishable
   * cannot make a subregion's less so. */
  const floor = payload.rollups.reduce(
    (highest, rollup) => Math.max(highest, rollup.minimum_reporting_sites), 2);
  const grouped = new Map<string, SnowSite[]>();
  for (const site of sites) {
    const bucket = grouped.get(site.huc6);
    if (bucket) bucket.push(site);
    else grouped.set(site.huc6, [site]);
  }
  const rollups: SnowRollup[] = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, members]) => ({
      huc6: code,
      huc6_name: label(code),
      site_count: members.length,
      minimum_reporting_sites: floor,
      series: seriesOverSites(members, floor)
    }));
  return { ...payload, sites, rollups };
}

/**
 * The payload narrowed to one state's sites, with every drainage-area figure
 * rebuilt from those sites -- never by averaging the published basin means
 * (the same rule `payloadAtLevel` follows for a coarser grouping, and
 * ADR-064's rule for the level control, extended here to a state filter).
 *
 * Unlike `payloadAtLevel`, the areas themselves do not change shape: a state
 * filter narrows which sites count inside each already-published area, it
 * does not merge several areas into one. So each area keeps its own
 * published `minimum_reporting_sites` rather than borrowing the highest
 * floor on the payload -- there is no new, coarser area whose old floor
 * would be too strict for it.
 *
 * An area with no sites left in this state is dropped from `rollups`
 * entirely, not published with an empty series: there is nothing to recompute
 * a mean from, which is a different fact from every day of that mean falling
 * below the reporting floor. An area that keeps some sites but fewer than its
 * floor stays in `rollups` -- its `series` is exactly what `seriesOverSites`
 * already produces below the floor, `mean_percent_of_normal_median: null` on
 * every day, which is how this payload has always said "not measured" rather
 * than printing a zero (ADR-059).
 *
 * `"all"` returns the payload unchanged, the same sentinel `reservoirInState`
 * reads in `overview-model.ts`.
 */
export function payloadForState(
  payload: SnowpackPayload, state: string
): SnowpackPayload {
  if (state === "all") return payload;
  const sites = payload.sites.filter((site) => site.state === state);
  const floors = new Map(
    payload.rollups.map((rollup) => [rollup.huc6, rollup.minimum_reporting_sites]));
  const names = new Map(
    payload.rollups.map((rollup) => [rollup.huc6, rollup.huc6_name]));
  const grouped = new Map<string, SnowSite[]>();
  for (const site of sites) {
    const bucket = grouped.get(site.huc6);
    if (bucket) bucket.push(site);
    else grouped.set(site.huc6, [site]);
  }
  const rollups: SnowRollup[] = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, members]) => {
      const floor = floors.get(code) ?? 2;
      return {
        huc6: code,
        huc6_name: names.get(code) ?? code,
        site_count: members.length,
        minimum_reporting_sites: floor,
        series: seriesOverSites(members, floor)
      };
    });
  return payloadForSites(payload, sites, rollups);
}

/**
 * A payload's trailing per-payload totals (`site_count`, `late_site_count`),
 * rebuilt from a caller's own narrowed `sites` and `rollups` -- every other
 * field carried through unchanged.
 *
 * One place for the shape every narrowing pass returns, so it cannot drift
 * between a pass that recomputes each surviving area's mean from its own
 * sites (`payloadForState`, above) and one that only drops whole areas
 * wholesale without touching any series (the opening scope's area pass in
 * `snow.ts`, which narrows a payload `payloadForState` has already
 * narrowed once).
 */
export function payloadForSites(
  payload: SnowpackPayload, sites: SnowSite[], rollups: SnowRollup[]
): SnowpackPayload {
  return {
    ...payload,
    sites,
    rollups,
    site_count: sites.length,
    late_site_count: sites.filter((site) => site.late).length
  };
}

/** One mean per date over a set of sites: the rule `build_rollups` uses in
 * `refresh_snowpack.py`, and the one `regionCurve` already reimplements for
 * the whole region. A test holds all three together. */
function seriesOverSites(
  sites: readonly SnowSite[], floor: number
): SnowRollupDay[] {
  const byDate = new Map<string, number[]>();
  for (const site of sites) {
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
      reporting_site_count: percents.length,
      mean_percent_of_normal_median: percents.length >= floor
        ? roundTenth(percents.reduce((sum, value) => sum + value, 0) / percents.length)
        : null
    }));
}

/**
 * The drawn scope narrowed to the areas this payload measures.
 *
 * The maps draw 75 basins across the west and the snow network reports in 51
 * of them (`a598850 Take the snow network west`; 637 sites across 11
 * states). Drawing the other 24 here would put an outline on the one map
 * whose subject *is* the drainage areas with nothing behind it: no percent of
 * normal, no site, and a hover card that comes back empty -- which ADR-050
 * already judges to be less information rather than more.
 *
 * Deliberately not the same answer as the drought map's, which draws all 75
 * because it has a measurement for all 75. Each map draws what it can say
 * something about.
 */
/**
 * Whether an area holds enough sites to ever publish a mean.
 *
 * One predicate, because the map, the basin picker and the `?basin=` link are
 * three ways to the same card: an area offered by one and missing from
 * another is a control that does nothing. Written twice it would eventually
 * be two different rules.
 */
export function areaCanReport(
  rollup: { site_count: number; minimum_reporting_sites: number }
): boolean {
  return rollup.site_count >= rollup.minimum_reporting_sites;
}

export function measuredScope(
  scope: DrainageScope, payload: SnowpackPayload
): DrainageScope {
  /* A rollup is not the same as something to say.
   *
   * The payload publishes a rollup for every area the network reaches, and
   * an area holding fewer sites than its own reporting floor publishes no
   * mean at all -- nothing rather than zero, which is the right way round.
   * But it still has a rollup, so filtering on "has a rollup" drew it: an
   * outline a reader can point at, hover, and get nothing back from. That is
   * exactly what ADR-050 refuses -- a shape with no figure behind it is less
   * information rather than more -- and it is the same rule that keeps the
   * drought map to the areas its engine measures.
   *
   * Structural, not seasonal. This drops an area that can *never* meet its
   * floor because it does not hold enough sites, which is a fact about the
   * network rather than about today: San Joaquin and North Lahontan each
   * hold one site against a floor of two. An area with enough sites that
   * happen to be quiet today keeps its outline and reads as having no value
   * today, which is a different statement and the true one. */
  const measured = new Set(payload.rollups
    .filter(areaCanReport)
    .map((rollup) => rollup.huc6));
  return {
    level: scope.level,
    areas: scope.areas.filter((area) => measured.has(area.huc6))
  };
}

export function basinChoices(payload: SnowpackPayload): BasinChoice[] {
  /* The same floor the map draws by. An area the map cannot draw must not be
   * offered here either, or the picker holds a choice that changes nothing. */
  return payload.rollups
    .filter(areaCanReport)
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

/** One day of the region's snow depth: the mean across every site that
 * reported a value, and how many did. */
export interface DepthPoint {
  date: string;
  meanInches: number;
  reportingSites: number;
}

/**
 * The region's snow depth day by day, in inches.
 *
 * The percent-of-normal curve cannot answer "when was there most snow",
 * because a ratio is small over small. A site that has melted out reports
 * zero and is counted: that is a real reading and it should pull the mean
 * down, which is exactly what makes this curve peak at the true maximum
 * rather than at the last day anyone measured.
 */
export function regionDepthCurve(payload: SnowpackPayload): DepthPoint[] {
  const byDate = new Map<string, number[]>();
  for (const site of payload.sites) {
    for (const [date, inches] of site.series) {
      if (inches === null) continue;
      const bucket = byDate.get(date);
      if (bucket) bucket.push(inches);
      else byDate.set(date, [inches]);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({
      date,
      meanInches: values.reduce((sum, value) => sum + value, 0) / values.length,
      reportingSites: values.length
    }));
}

/**
 * The day the map opens on: the season's peak snow.
 *
 * It used to be the newest day that met the reporting floor, and that was
 * wrong in a way only the data showed. Late in the melt season the newest
 * qualifying day is the *most depleted* day that still qualifies, so the map
 * opened on the worst picture of the year by construction -- in this record,
 * 2026-05-09, where every reporting basin sits under a quarter of normal and
 * the whole region is one colour.
 *
 * Peak snow, not peak percent of normal. That distinction was measured and it
 * matters: the highest percent-of-normal day in this record is 2025-12-06 at
 * 78% of normal, on a mean of 2.3 inches of snow -- a good ratio in early
 * December, when the normal it is divided by is also tiny. The peak depth day
 * is 2026-03-07, at 61% of normal on 8.4 inches. The first is arithmetically
 * the best day and hydrologically nearly meaningless; the second is the day
 * the snowpack actually held the most water, which is what a reader means by
 * the peak and what the rest of the year is judged against.
 *
 * The same half-the-sites floor applies, so a handful of high stations cannot
 * define the peak on their own.
 */
export function defaultMapDay(payload: SnowpackPayload): string | null {
  const floor = headlineFloor(payload.site_count, 2);
  let best: DepthPoint | null = null;
  for (const point of regionDepthCurve(payload)) {
    if (point.reportingSites < floor) continue;
    if (best === null || point.meanInches > best.meanInches) best = point;
  }
  /* Out of season, or a record too thin to find a peak in, falls back to the
   * newest day that met the floor -- which is the old behaviour, and still
   * the right answer when there is no peak to show. */
  return best?.date
    ?? newestHeadline(regionCurve(payload), floor)?.date
    ?? null;
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

/* ------------------------------------------------------------------ */
/* Narrowing the site table                                            */
/* ------------------------------------------------------------------ */

/**
 * The elevation bands the site filter offers.
 *
 * Snow behaves differently at different heights -- a low site melts out
 * weeks before a high one, so a regional mean mixes two seasons -- and these
 * three bands are where the region's own sites actually divide. They are
 * presentation, not a published classification, which is why they live here
 * beside the filter rather than in the payload.
 */
export type ElevationBand = "all" | "low" | "middle" | "high";

export const ELEVATION_BANDS: readonly ElevationBand[] = ["all", "low", "middle", "high"];

/** Feet. Inclusive at the bottom, exclusive at the top, like every other
 * class table in this project. */
export const ELEVATION_BREAKS = { low: 8000, high: 9500 } as const;

export function isElevationBand(value: string): value is ElevationBand {
  return (ELEVATION_BANDS as readonly string[]).includes(value);
}

export function elevationBandOf(feet: number): Exclude<ElevationBand, "all"> {
  if (feet < ELEVATION_BREAKS.low) return "low";
  if (feet < ELEVATION_BREAKS.high) return "middle";
  return "high";
}

export function elevationBandLabel(band: ElevationBand): string {
  if (band === "low") return `Below ${ELEVATION_BREAKS.low.toLocaleString("en-US")} feet`;
  if (band === "middle") {
    return `${ELEVATION_BREAKS.low.toLocaleString("en-US")} to ` +
      `${ELEVATION_BREAKS.high.toLocaleString("en-US")} feet`;
  }
  if (band === "high") return `${ELEVATION_BREAKS.high.toLocaleString("en-US")} feet and above`;
  return "Every elevation";
}

/** Which sites the reader wants: all of them, only the late ones, or only
 * the ones still sending values. */
export type SiteStatus = "all" | "late" | "reporting";

export const SITE_STATUSES: readonly SiteStatus[] = ["all", "late", "reporting"];

export function isSiteStatus(value: string): value is SiteStatus {
  return (SITE_STATUSES as readonly string[]).includes(value);
}

export interface SiteFilter {
  /** Matched against the site name and its county, case-insensitively. */
  query: string;
  band: ElevationBand;
  status: SiteStatus;
}

export const NO_SITE_FILTER: SiteFilter = { query: "", band: "all", status: "all" };

/**
 * The rows a filter leaves.
 *
 * The county is searched as well as the name because that is how people ask
 * for these sites out loud -- "the ones above Heber" is a county, not a
 * station name -- and the county is already in the table beside the name.
 */
export function filterSiteRows(
  rows: readonly SiteRow[], filter: SiteFilter
): SiteRow[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.band !== "all" && elevationBandOf(row.elevationFeet) !== filter.band) {
      return false;
    }
    if (filter.status === "late" && !row.late) return false;
    if (filter.status === "reporting" && row.late) return false;
    if (query.length > 0) {
      const haystack = `${row.name} ${row.county}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/** True when the reader has narrowed anything. Not derived from a row count:
 * a filter that happens to keep every row is still a filter, and the page
 * says so rather than claiming nothing is applied. */
export function siteFilterActive(filter: SiteFilter): boolean {
  return filter.query.trim().length > 0 || filter.band !== "all" || filter.status !== "all";
}

/* ------------------------------------------------------------------ */
/* How the day's readings are spread                                   */
/* ------------------------------------------------------------------ */

/** How many sites fell in each snow class on one day, plus how many had no
 * fair value at all. Index matches `SNOW_CLASSES`. */
export interface SiteSpread {
  counts: number[];
  noValue: number;
  reporting: number;
}

/**
 * The spread of one day's site readings across the classes.
 *
 * The mean the map and the curve draw is one number over two hundred
 * stations, and it cannot tell a region that is uniformly at 70% from one
 * where half the sites are bare and half are near normal. Those are very
 * different winters and they matter to different people, so the page shows
 * the spread beside the mean.
 *
 * `classIndexOf` is injected rather than imported so this stays free of the
 * colour table: the model decides how many fell where, the view decides what
 * colour that is.
 */
export function siteSpread(
  values: ReadonlyMap<string, number | null>,
  classCount: number,
  classIndexOf: (percent: number | null) => number | null
): SiteSpread {
  const counts = new Array<number>(classCount).fill(0);
  let noValue = 0;
  for (const percent of values.values()) {
    const index = classIndexOf(percent);
    if (index === null || index < 0 || index >= classCount) noValue += 1;
    else counts[index] = (counts[index] ?? 0) + 1;
  }
  return { counts, noValue, reporting: values.size - noValue };
}
