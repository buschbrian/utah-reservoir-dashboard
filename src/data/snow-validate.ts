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

function isSeriesRow(value: unknown): value is SnowSeriesRow {
  return Array.isArray(value) && value.length === 3 &&
    typeof value[0] === "string" &&
    hasNullableNumber(value[1]) &&
    hasNullableNumber(value[2]);
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
    isNormalTiming(value.normal_timing) &&
    Array.isArray(value.series) && value.series.length > 0 &&
    value.series.every(isSeriesRow);
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
      fields[0] !== "date" || fields[1] !== "value_inches" ||
      fields[2] !== "normal_median_inches") {
    throw new Error("snowpack.json declares unexpected series columns");
  }
  const badSite = value.sites.findIndex((record) => !isSnowSite(record));
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
