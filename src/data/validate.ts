import type { MonthlyRecord, Reservoir, ReservoirPayload } from "../types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMonthlyRecord(value: unknown): value is MonthlyRecord {
  return isObject(value) && typeof value.month === "string" &&
    hasNumber(value.days) &&
    (value.mean_af === null || hasNumber(value.mean_af));
}

function isReservoir(value: unknown): value is Reservoir {
  if (!isObject(value)) return false;
  return typeof value.name === "string" && value.name.length > 0 &&
    typeof value.as_of === "string" &&
    hasNumber(value.lat) && hasNumber(value.lon) &&
    hasNumber(value.current_storage_af) && hasNumber(value.record_max_af) &&
    (value.capacity_af === null || hasNumber(value.capacity_af)) &&
    (value.source_key === "rise" || value.source_key === "awdb") &&
    (value.data_frequency === "daily" || value.data_frequency === "monthly") &&
    hasNumber(value.stale_after_days) &&
    typeof value.is_stale === "boolean" && typeof value.fetch_ok === "boolean" &&
    Array.isArray(value.monthly) && value.monthly.every(isMonthlyRecord);
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
  return value as unknown as ReservoirPayload;
}
