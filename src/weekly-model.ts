/*
 * What moved this week, as arithmetic over the committed payloads.
 *
 * The competitive survey found no product in the West that publishes an
 * automatic "what changed" digest, and this is that. It is deliberately not a
 * new pipeline: every fact here is derived from files the site already
 * fetches, so a digest cannot disagree with the pages it summarizes, and there
 * is nothing extra to keep fresh.
 *
 * Everything here is arithmetic. Nothing is modelled, ranked by importance,
 * or described in words -- the words live in the view, where the Simplified
 * Technical English test can read them (ADR-006), and where a sentence that
 * needs a caveat can carry one.
 *
 * The hard part of a digest is not computing the numbers, it is refusing to
 * state the ones that are not there. Each section reports its own coverage and
 * its own reason for being unavailable, because a weekly summary that quietly
 * omits a section is worse than one that says why it is empty:
 *
 *   - only the daily-cadence reservoirs can move in a week at all, so the
 *     storage section always says how many of the published reservoirs it
 *     actually measured;
 *   - snow percent of normal is undefined once the sites melt out, because the
 *     normal it divides by is zero, so out of season the snow section reports
 *     that rather than a change of nothing;
 *   - drought is published weekly but only one week is committed, so there is
 *     no week-over-week comparison to make and the section says so instead of
 *     comparing a week with itself.
 */
import type { DroughtCoveragePayload, Reservoir, SnowpackPayload } from "./types";
import { isMeasured, shareAtOrWorse, worstClass, type StorageSource } from "./drought-model";
import { MEANINGFUL_NORMAL_INCHES, percentOfNormal } from "./snow-model";
import type { DroughtClass } from "./viz/drought-classes";

/** How many days back a "week" reaches. The reservoir payload publishes a
 * seven-day change directly, and the snow comparison uses the same span so
 * both halves of the digest describe one period. */
export const WEEK_DAYS = 7;

/**
 * One reservoir's move over the week, in the two units that mean different
 * things.
 *
 * The distinction is not pedantry, it decides which reservoir the digest
 * names. `changePercent` is the payload's own `change_7d_pct`, which is a
 * share of *the previous reading* -- so a small reservoir that went from 505
 * to 1,069 acre-feet reports +111.9%, which is true and is a doubling. By
 * volume that same move is 565 acre-feet, against Lake Powell losing 69,480
 * in the same week. Naming either one as "the biggest move" without saying by
 * what measure would be the digest's easiest lie.
 *
 * `changePoints` is the third framing and the one the rest of the site uses:
 * the move as points of the reservoir's own full level, which is what the map
 * colours by.
 */
export interface WeeklyMove {
  name: string;
  /** Acre-feet, signed. */
  changeAf: number;
  /** Share of the reading a week earlier, signed. The payload's own figure. */
  changePercent: number | null;
  /** Points of this reservoir's own full level, signed. Null with no full
   * level to divide by. */
  changePoints: number | null;
  asOf: string;
}

export interface WeeklyStorage {
  /** Reservoirs that published a seven-day change. */
  measured: number;
  /** Reservoirs in the payload, measured or not. */
  published: number;
  /** Combined acre-feet across the measured reservoirs, signed. */
  netAf: number;
  rose: number;
  fell: number;
  steady: number;
  /** Combined percent full over the measured reservoirs, now and a week ago.
   * Null when none of them publishes a full level to divide by. */
  percentNow: number | null;
  percentBefore: number | null;
  /** The largest rise and fall by volume, which is what moves a region. */
  biggestRise: WeeklyMove | null;
  biggestFall: WeeklyMove | null;
  /** The largest move as a share of one reservoir's own full level, either
   * direction. A different reservoir from the volume leaders whenever a small
   * one has had a big week, which is most weeks. */
  largestShareMove: WeeklyMove | null;
}

/** A reservoir contributes to the digest only if it published a change. */
type WeeklySource = Pick<
  Reservoir,
  "name" | "as_of" | "current_storage_af" | "capacity_af" | "record_max_af"
  | "change_7d_af" | "change_7d_pct"
>;

/**
 * The storage half of the week.
 *
 * `change_7d_af` is the pipeline's own figure -- the difference against the
 * reading nearest seven days before this one -- so the digest and the details
 * panel cannot disagree about what a reservoir did. A reservoir on a monthly
 * schedule publishes no seven-day change and is counted in `published` but not
 * in `measured`, which is the number every sentence about this section has to
 * be qualified by.
 */
export function weeklyStorage(reservoirs: readonly WeeklySource[]): WeeklyStorage {
  const measured = reservoirs.filter((reservoir) => reservoir.change_7d_af !== null);
  let netAf = 0;
  let rose = 0;
  let fell = 0;
  let steady = 0;
  let storageNow = 0;
  let storageBefore = 0;
  let capacity = 0;
  let biggestRise: WeeklyMove | null = null;
  let biggestFall: WeeklyMove | null = null;
  let largestShareMove: WeeklyMove | null = null;

  for (const reservoir of measured) {
    const change = reservoir.change_7d_af as number;
    netAf += change;
    if (change > 0) rose += 1;
    else if (change < 0) fell += 1;
    else steady += 1;

    /* The full level, on whichever basis the reservoir publishes -- the same
     * fallback the map and the details panel use, so one reservoir cannot be
     * measured two ways on two surfaces. */
    const full = reservoir.capacity_af ?? reservoir.record_max_af;
    if (full > 0) {
      capacity += full;
      storageNow += reservoir.current_storage_af;
      storageBefore += reservoir.current_storage_af - change;
    }

    const move: WeeklyMove = {
      name: reservoir.name,
      changeAf: change,
      changePercent: reservoir.change_7d_pct,
      changePoints: full > 0 ? (change / full) * 100 : null,
      asOf: reservoir.as_of
    };
    if (change > 0 && (biggestRise === null || change > biggestRise.changeAf)) {
      biggestRise = move;
    }
    if (change < 0 && (biggestFall === null || change < biggestFall.changeAf)) {
      biggestFall = move;
    }
    if (move.changePoints !== null && (largestShareMove === null
      || Math.abs(move.changePoints) > Math.abs(largestShareMove.changePoints ?? 0))) {
      largestShareMove = move;
    }
  }

  return {
    measured: measured.length,
    published: reservoirs.length,
    netAf,
    rose,
    fell,
    steady,
    percentNow: capacity > 0 ? (storageNow / capacity) * 100 : null,
    percentBefore: capacity > 0 ? (storageBefore / capacity) * 100 : null,
    biggestRise,
    biggestFall,
    largestShareMove
  };
}

export interface WeeklySnow {
  /** True when both ends of the week have a fair regional value. */
  comparable: boolean;
  day: string | null;
  previousDay: string | null;
  percentNow: number | null;
  percentBefore: number | null;
  /** Sites with a fair value on the newer day. */
  reporting: number;
}

function isoDaysBefore(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

/** The mean percent of normal across every site with a fair value that day. */
function regionalPercentOn(
  payload: SnowpackPayload, date: string
): { percent: number | null; reporting: number } {
  const values: number[] = [];
  const normals: number[] = [];
  for (const site of payload.sites) {
    const row = site.series.find((entry) => entry[0] === date);
    if (!row) continue;
    const percent = percentOfNormal(row[1], row[2]);
    if (percent === null) continue;
    values.push(percent);
    normals.push(row[2] as number);
  }
  if (values.length === 0) return { percent: null, reporting: 0 };
  /* The same denominator floor the snow page holds its headlines to
   * (`MEANINGFUL_NORMAL_INCHES`): in October the sites' normals are tiny but
   * positive, so every per-site ratio exists and their mean is a number --
   * the same "266% of normal" the snow page refuses to headline. A digest
   * line is a headline, so it holds the same floor, and the two surfaces
   * cannot contradict each other over one payload. */
  const meanNormal = normals.reduce((sum, value) => sum + value, 0) / normals.length;
  if (meanNormal < MEANINGFUL_NORMAL_INCHES) {
    return { percent: null, reporting: values.length };
  }
  return {
    percent: values.reduce((sum, value) => sum + value, 0) / values.length,
    reporting: values.length
  };
}

/**
 * The snow half of the week.
 *
 * Undefined out of season rather than zero, and that is the whole subtlety.
 * Percent of normal divides by the normal median for the same day, which is
 * zero once the sites have melted out, so `percentOfNormal` correctly answers
 * null and a mean over nothing is not a number. In August every site is in
 * that state, so the honest report is "there is no snow season to compare",
 * not "snow did not change".
 */
export function weeklySnow(payload: SnowpackPayload): WeeklySnow {
  /* The newest day any site published, rather than the payload's `as_of`:
   * the file is written the morning after the readings it carries. */
  let day: string | null = null;
  for (const site of payload.sites) {
    for (const [date, inches] of site.series) {
      if (inches === null) continue;
      if (day === null || date > day) day = date;
    }
  }
  if (day === null) {
    return {
      comparable: false, day: null, previousDay: null,
      percentNow: null, percentBefore: null, reporting: 0
    };
  }
  const previousDay = isoDaysBefore(day, WEEK_DAYS);
  const now = regionalPercentOn(payload, day);
  const before = regionalPercentOn(payload, previousDay);
  return {
    comparable: now.percent !== null && before.percent !== null,
    day,
    previousDay,
    percentNow: now.percent,
    percentBefore: before.percent,
    reporting: now.reporting
  };
}

export interface WeeklyDrought {
  mapDate: string;
  releaseDate: string;
  worst: DroughtClass | null;
  /** Areas with any land in severe drought or worse. */
  areasAtOrWorse: number;
  units: number;
  /**
   * Whether a week-over-week comparison is possible at all.
   *
   * False for the first week the pipeline ever computed, and after that
   * true: the coverage file carries the week before it. When it is false the
   * reason is a fact about this project's data rather than about the
   * monitor, and the sentence has to say which.
   */
  comparable: boolean;
  /** The week compared against, when there is one. */
  previousDate: string | null;
  /**
   * Drainage areas that moved into, or out of, severe drought or worse since
   * that week. Counted rather than averaged: a share of land averaged across
   * areas of very different sizes is not a quantity anybody can act on, and
   * "two more areas have land in severe drought" is.
   */
  areasWorse: number;
  areasBetter: number;
  /** The largest change in the share of one area's land at that class,
   * signed, with the area's name. Null when nothing moved. */
  biggestMove: { name: string; points: number } | null;
}

/** The class a week-over-week comparison is measured at. Severe drought is
 * where the monitor's own impact language turns from developing conditions to
 * actual shortage, and it is the class the rest of this page counts by. */
const CHANGE_CLASS = "d2" as const;

export function weeklyDrought(payload: DroughtCoveragePayload): WeeklyDrought {
  let worst: DroughtClass | null = null;
  let areas = 0;
  for (const unit of payload.units) {
    const unitWorst = worstClass(unit);
    if (unitWorst && (worst === null || unitWorst.key > worst.key)) worst = unitWorst;
    if (shareAtOrWorse(unit, "d2") > 0) areas += 1;
  }

  /* The week before this one travels in the same file, so the comparison
   * costs no extra request. Absent only for the first week the pipeline ever
   * computed. */
  const previous = payload.previous ?? null;
  const before = new Map(
    (previous?.units ?? []).map((unit) => [unit.huc6, unit.percent_of_area_at_least]));
  let areasWorse = 0;
  let areasBetter = 0;
  let biggestMove: { name: string; points: number } | null = null;
  if (previous) {
    for (const unit of payload.units) {
      const was = before.get(unit.huc6);
      /* An unmeasured area has no share to difference; it is skipped, not
       * compared at zero (ADR-059). */
      if (!was || !isMeasured(unit)) continue;
      const now = unit.percent_of_area_at_least[CHANGE_CLASS];
      const change = now - was[CHANGE_CLASS];
      /* A tenth of a point is the published precision, so anything smaller is
       * rounding rather than weather. */
      if (change > 0.05) areasWorse += 1;
      else if (change < -0.05) areasBetter += 1;
      if (Math.abs(change) > 0.05
        && (biggestMove === null || Math.abs(change) > Math.abs(biggestMove.points))) {
        biggestMove = { name: unit.huc6_name, points: change };
      }
    }
  }

  return {
    mapDate: payload.map_date,
    releaseDate: payload.release_date,
    worst,
    areasAtOrWorse: areas,
    units: payload.units.length,
    comparable: previous !== null,
    previousDate: previous?.map_date ?? null,
    areasWorse,
    areasBetter,
    biggestMove
  };
}

export interface WeeklySummary {
  /** The newest reservoir reading the digest describes. */
  through: string;
  storage: WeeklyStorage;
  snow: WeeklySnow;
  drought: WeeklyDrought | null;
}

/**
 * The whole digest. Drought is optional because its coverage file is a
 * separate fetch that this page is allowed to do without.
 */
export function weeklySummary(
  reservoirs: readonly (WeeklySource & StorageSource)[],
  snow: SnowpackPayload | null,
  drought: DroughtCoveragePayload | null
): WeeklySummary {
  const through = reservoirs.reduce(
    (newest, reservoir) => reservoir.as_of > newest ? reservoir.as_of : newest, "");
  return {
    through,
    storage: weeklyStorage(reservoirs),
    snow: snow
      ? weeklySnow(snow)
      : { comparable: false, day: null, previousDay: null,
        percentNow: null, percentBefore: null, reporting: 0 },
    drought: drought ? weeklyDrought(drought) : null
  };
}
