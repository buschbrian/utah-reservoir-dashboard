import type {
  Baseline,
  BaselineChoice,
  MonthlyRecord,
  Reservoir,
  ReservoirBaselines,
  ReservoirPayload,
  ReservoirSource
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

function hasNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isMonthlyRecord(value: unknown): value is MonthlyRecord {
  return isObject(value) && typeof value.month === "string" &&
    hasNumber(value.days) &&
    hasNullableNumber(value.mean_af) &&
    hasNullableNumber(value.min_af) &&
    hasNullableNumber(value.max_af) &&
    hasNullableNumber(value.end_af) &&
    hasNullableNumber(value.normal_af) &&
    (value.climate_normal_af === undefined ||
      hasNullableNumber(value.climate_normal_af));
}

function isBaseline(value: unknown): value is Baseline {
  return isObject(value) &&
    hasNullableNumber(value.normal_af) &&
    hasNullableNumber(value.pct_of_normal) &&
    hasNumber(value.sample_years) &&
    typeof value.covers_full_period === "boolean" &&
    typeof value.first_obs === "string";
}

function isBaselineId(value: unknown): boolean {
  return value === "recent" || value === "climate";
}

/**
 * Both baselines, or a clear absence.
 *
 * The one thing this refuses is a `default` naming a baseline that is not
 * there. A control offering a period with nothing behind it renders an empty
 * comparison that looks like a measurement, which is worse than the payload
 * being rejected outright.
 */
function isReservoirBaselines(value: unknown): value is ReservoirBaselines {
  if (!isObject(value)) return false;
  if (!isBaselineId(value.default)) return false;
  if (value.recent !== null && !isBaseline(value.recent)) return false;
  if (value.climate !== null && !isBaseline(value.climate)) return false;
  return value[value.default as string] !== null;
}

function isBaselineChoice(value: unknown): value is BaselineChoice {
  return isObject(value) &&
    isBaselineId(value.id) &&
    typeof value.label === "string" &&
    typeof value.period_label === "string" &&
    Number.isInteger(value.start_year) &&
    Number.isInteger(value.end_year) &&
    (value.start_year as number) <= (value.end_year as number) &&
    typeof value.note === "string";
}

function isReservoirSource(value: unknown): value is ReservoirSource {
  return isObject(value) &&
    (value.key === "rise" || value.key === "awdb") &&
    typeof value.label === "string" &&
    typeof value.url === "string" &&
    typeof value.cadence === "string";
}

function isOptionalPoint(value: unknown): boolean {
  return value === undefined || value === null ||
    (Array.isArray(value) && value.length === 2 && value.every(hasNumber));
}

function isReservoir(value: unknown): value is Reservoir {
  if (!isObject(value)) return false;
  return typeof value.name === "string" && value.name.length > 0 &&
    hasNullableNumber(value.rise_item_id) &&
    typeof value.source_label === "string" &&
    typeof value.source_url === "string" &&
    hasNullableString(value.source_station_id) &&
    typeof value.as_of === "string" &&
    hasNumber(value.lat) && hasNumber(value.lon) &&
    (value.source_key === "rise" || value.source_key === "awdb") &&
    (value.data_frequency === "daily" || value.data_frequency === "monthly") &&
    hasNumber(value.stale_after_days) &&
    hasNumber(value.days_stale) &&
    typeof value.is_stale === "boolean" && typeof value.fetch_ok === "boolean" &&
    (value.fetch_error === undefined || typeof value.fetch_error === "string") &&
    hasNumber(value.current_storage_af) &&
    hasNumber(value.record_max_af) &&
    hasNumber(value.record_min_af) &&
    hasNullableNumber(value.pct_of_record_max) &&
    hasNullableNumber(value.capacity_af) &&
    hasNullableString(value.capacity_basis) &&
    hasNullableNumber(value.pct_of_capacity) &&
    hasNullableNumber(value.seasonal_percentile) &&
    hasNullableNumber(value.seasonal_normal_af) &&
    hasNullableNumber(value.pct_of_seasonal_normal) &&
    hasNumber(value.seasonal_sample_years) &&
    (value.baselines === undefined || isReservoirBaselines(value.baselines)) &&
    hasNullableNumber(value.change_7d_af) &&
    hasNullableNumber(value.change_7d_pct) &&
    hasNullableNumber(value.change_30d_af) &&
    hasNullableNumber(value.change_30d_pct) &&
    hasNullableNumber(value.change_365d_af) &&
    hasNullableNumber(value.change_365d_pct) &&
    hasNullableNumber(value.peak_this_year_af) &&
    hasNullableString(value.peak_this_year_date) &&
    hasNullableNumber(value.pct_of_peak_this_year) &&
    Array.isArray(value.monthly) && value.monthly.every(isMonthlyRecord) &&
    typeof value.first_obs === "string" &&
    hasNumber(value.n_obs) &&
    hasNumber(value.years_of_record) &&
    typeof value.in_utah === "boolean" &&
    typeof value.intersects_utah === "boolean" &&
    (value.huc6 === undefined || hasNullableString(value.huc6)) &&
    (value.huc6_name === undefined || hasNullableString(value.huc6_name)) &&
    isOptionalPoint(value.huc_assignment_point) &&
    (value.huc_assignment_source === undefined ||
      hasNullableString(value.huc_assignment_source));
}

export function validateReservoirPayload(value: unknown): ReservoirPayload {
  if (!isObject(value) || !Array.isArray(value.reservoirs)) {
    throw new Error("reservoirs.json must be an object with a reservoirs array");
  }
  const badIndex = value.reservoirs.findIndex((record) => !isReservoir(record));
  if (badIndex >= 0) {
    const candidate = value.reservoirs[badIndex];
    const name = isObject(candidate) && typeof candidate.name === "string"
      ? ` (${candidate.name})` : "";
    throw new Error(`Invalid reservoir record at index ${badIndex}${name}`);
  }
  if (!hasNumber(value.reservoir_count) || value.reservoir_count !== value.reservoirs.length) {
    throw new Error("reservoir_count does not match the reservoirs array");
  }
  if (typeof value.generated_at !== "string" || typeof value.start_date !== "string") {
    throw new Error("reservoirs.json is missing generation metadata");
  }
  if (value.schema_version !== undefined &&
      (!hasNumber(value.schema_version) || !Number.isInteger(value.schema_version))) {
    throw new Error("reservoirs.json has an invalid schema version");
  }
  const normalPeriod = value.normal_period;
  if (normalPeriod !== undefined &&
      (!isObject(normalPeriod) ||
       !Number.isInteger(normalPeriod.start_year) ||
       !Number.isInteger(normalPeriod.end_year) ||
       (normalPeriod.start_year as number) > (normalPeriod.end_year as number))) {
    throw new Error("reservoirs.json has invalid normal period metadata");
  }
  if (value.baselines !== undefined &&
      (!Array.isArray(value.baselines) ||
       !value.baselines.every(isBaselineChoice))) {
    throw new Error("reservoirs.json has invalid baseline metadata");
  }
  if (value.default_baseline !== undefined && !isBaselineId(value.default_baseline)) {
    throw new Error("reservoirs.json names an unknown default baseline");
  }
  /* A default the control cannot offer would leave the page with no selected
   * period at all, so the two have to agree before anything renders. */
  if (value.default_baseline !== undefined && Array.isArray(value.baselines) &&
      !value.baselines.some((choice) =>
        isObject(choice) && choice.id === value.default_baseline)) {
    throw new Error("reservoirs.json names a default baseline it does not offer");
  }
  if (value.normal_window_days !== undefined &&
      (!hasNumber(value.normal_window_days) ||
       !Number.isInteger(value.normal_window_days) ||
       value.normal_window_days < 0)) {
    throw new Error("reservoirs.json has invalid normal window metadata");
  }
  const cadenceThresholds = value.stale_after_days_by_cadence;
  const sourceCounts = value.source_counts;
  if (!hasNumber(value.stale_after_days) ||
      !isObject(cadenceThresholds) ||
      !hasNumber(cadenceThresholds.daily) ||
      !hasNumber(cadenceThresholds.monthly) ||
      typeof value.source !== "string" ||
      !Array.isArray(value.sources) ||
      !value.sources.every(isReservoirSource) ||
      !isObject(sourceCounts) ||
      !hasNumber(sourceCounts.rise) ||
      !hasNumber(sourceCounts.awdb)) {
    throw new Error("reservoirs.json is missing source metadata");
  }
  if (!hasNumber(value.stale_count) || !hasNumber(value.capacity_count)) {
    throw new Error("reservoirs.json is missing summary counts");
  }
  return value as unknown as ReservoirPayload;
}
