import type {
  SnowNormalTiming,
  SnowNormalTimingPoint,
  SnowRollup,
  SnowRollupDay,
  SnowSeriesRow,
  SnowSite,
  SnowpackPayload
} from "../types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasNullableNumber(value: unknown): value is number | null {
  return value === null || hasNumber(value);
}

/**
 * Rebuilds a site's rows from the three parallel columns the payload carries.
 *
 * The dates live once at the top of the file and each site names the ones it
 * has by position, so this is where a site's `[date, value, normal]` rows
 * come back. Every reader downstream sees exactly what it saw before the
 * columns were split apart -- the saving is on the wire, not in the model.
 *
 * A row is rebuilt only for a day the site actually published. That is the
 * distinction the encoding exists to keep: a null reading is a row, and a
 * day with no row is not the same fact.
 */
function rebuildSeries(
  value: Record<string, unknown>, dates: readonly string[]
): SnowSeriesRow[] | null {
  const days = value["series_days"];
  const values = value["series_values"];
  const normals = value["series_normals"];
  if (!Array.isArray(days) || !Array.isArray(values) || !Array.isArray(normals)) {
    return null;
  }
  if (days.length !== values.length || days.length !== normals.length) return null;
  const rows: SnowSeriesRow[] = [];
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    /* A position outside the shared calendar is a payload this cannot read,
     * not a row to skip: skipping would publish a shorter series than the
     * site reported and every percentage drawn from it would be quietly
     * wrong. */
    if (!Number.isInteger(day) || (day as number) < 0 || (day as number) >= dates.length) {
      return null;
    }
    const date = dates[day as number];
    if (date === undefined) return null;
    if (!hasNullableNumber(values[index]) || !hasNullableNumber(normals[index])) {
      return null;
    }
    rows.push([date, values[index] as number | null, normals[index] as number | null]);
  }
  return rows.length > 0 ? rows : null;
}

function isTimingPoint(value: unknown): value is SnowNormalTimingPoint | null {
  if (value === null) return true;
  return isObject(value) &&
    Number.isInteger(value.month) &&
    Number.isInteger(value.day) &&
    (value.value === undefined || hasNullableNumber(value.value));
}

function isNormalTiming(value: unknown): value is SnowNormalTiming {
  return isObject(value) &&
    isTimingPoint(value.peak) &&
    isTimingPoint(value.onset) &&
    isTimingPoint(value.meltout);
}

function isSnowSite(value: unknown): value is SnowSite {
  if (!isObject(value)) return false;
  return typeof value.station === "string" && value.station.length > 0 &&
    typeof value.name === "string" && value.name.length > 0 &&
    typeof value.state === "string" &&
    typeof value.county === "string" &&
    hasNumber(value.lat) && hasNumber(value.lon) &&
    hasNumber(value.elevation_feet) &&
    typeof value.begins === "string" &&
    typeof value.huc6 === "string" && value.huc6.length === 6 &&
    typeof value.huc6_name === "string" &&
    (value.provider_huc6 === null || typeof value.provider_huc6 === "string") &&
    typeof value.latest_date === "string" &&
    typeof value.late === "boolean" &&
    isNormalTiming(value.normal_timing);
}

function isRollupDay(value: unknown): value is SnowRollupDay {
  return isObject(value) &&
    typeof value.date === "string" &&
    hasNumber(value.reporting_site_count) &&
    hasNullableNumber(value.mean_percent_of_normal_median);
}

function isRollup(value: unknown): value is SnowRollup {
  return isObject(value) &&
    typeof value.huc6 === "string" && value.huc6.length === 6 &&
    typeof value.huc6_name === "string" &&
    hasNumber(value.site_count) &&
    hasNumber(value.minimum_reporting_sites) &&
    Array.isArray(value.series) && value.series.every(isRollupDay);
}

export function validateSnowpackPayload(value: unknown): SnowpackPayload {
  if (!isObject(value) || !Array.isArray(value.sites)) {
    throw new Error("snowpack.json must be an object with a sites array");
  }
  if (!Number.isInteger(value.schema_version)) {
    throw new Error("snowpack.json has an invalid schema version");
  }
  if (typeof value.generated_at !== "string" || typeof value.as_of !== "string" ||
      !Number.isInteger(value.water_year) || typeof value.source !== "string") {
    throw new Error("snowpack.json is missing generation metadata");
  }
  const normalPeriod = value.normal_period;
  if (!isObject(normalPeriod) ||
      !Number.isInteger(normalPeriod.start_year) ||
      !Number.isInteger(normalPeriod.end_year) ||
      (normalPeriod.start_year as number) > (normalPeriod.end_year as number)) {
    throw new Error("snowpack.json has invalid normal period metadata");
  }
  if (value.units !== "inches") {
    throw new Error("snowpack.json does not declare inches");
  }
  const fields = value.site_series_fields;
  if (!Array.isArray(fields) || fields.length !== 3 ||
      fields[0] !== "series_days" || fields[1] !== "series_values" ||
      fields[2] !== "series_normals") {
    throw new Error("snowpack.json declares unexpected series columns");
  }
  /* The water-year calendar, written once. Checked rather than assumed: a
   * payload whose dates are missing or out of order would rebuild every
   * site's series against the wrong days, which draws a complete and
   * plausible curve for the wrong dates. */
  const dates = value.series_dates;
  if (!Array.isArray(dates) || dates.length === 0 ||
      !dates.every((date) => typeof date === "string")) {
    throw new Error("snowpack.json is missing its shared series dates");
  }
  const ordered = dates as string[];
  for (let index = 1; index < ordered.length; index += 1) {
    if ((ordered[index] as string) <= (ordered[index - 1] as string)) {
      throw new Error("snowpack.json series dates are not in ascending order");
    }
  }
  /* Rebuilt before the site check, so a site whose columns do not line up
   * fails as an invalid site record rather than reaching a reader as a site
   * with no series at all. */
  for (const record of value.sites) {
    if (!isObject(record)) continue;
    const rows = rebuildSeries(record, ordered);
    if (rows) record["series"] = rows;
  }
  const badSite = value.sites.findIndex(
    (record) => !isSnowSite(record) ||
      !Array.isArray((record as unknown as Record<string, unknown>)["series"]));
  if (badSite >= 0) {
    const candidate = value.sites[badSite];
    const name = isObject(candidate) && typeof candidate.name === "string"
      ? ` (${candidate.name})` : "";
    throw new Error(`Invalid snow site record at index ${badSite}${name}`);
  }
  if (!hasNumber(value.site_count) || value.site_count !== value.sites.length) {
    throw new Error("site_count does not match the sites array");
  }
  const lateSites = value.sites.filter(
    (site) => (site as { late: boolean }).late
  ).length;
  if (!hasNumber(value.late_site_count) || value.late_site_count !== lateSites) {
    throw new Error("late_site_count does not match the late sites");
  }
  if (!Array.isArray(value.rollups)) {
    throw new Error("snowpack.json is missing drainage area rollups");
  }
  const badRollup = value.rollups.findIndex((record) => !isRollup(record));
  if (badRollup >= 0) {
    throw new Error(`Invalid snow rollup record at index ${badRollup}`);
  }
  const rollupUnits = new Set(
    value.rollups.map((rollup) => (rollup as { huc6: string }).huc6)
  );
  const orphan = value.sites.find(
    (site) => !rollupUnits.has((site as { huc6: string }).huc6)
  );
  if (orphan) {
    throw new Error(
      `Snow site ${(orphan as { station: string }).station} has no drainage area rollup`
    );
  }
  return value as unknown as SnowpackPayload;
}
