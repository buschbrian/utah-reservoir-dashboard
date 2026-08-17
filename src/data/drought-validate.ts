import type {
  DroughtAtLeast,
  DroughtCoveragePayload,
  DroughtShares,
  DroughtUnit
} from "../types";

const LEVELS = ["d0", "d1", "d2", "d3", "d4"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShare(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= 0 && value <= 100;
}

function isShares(value: unknown): value is DroughtShares {
  if (!isObject(value) || !isShare(value.none)) return false;
  if (!LEVELS.every((level) => isShare(value[level]))) return false;
  const total = LEVELS.reduce(
    (sum, level) => sum + (value[level] as number), value.none as number);
  // Six figures rounded to 0.1 can miss 100 by half a step each.
  return Math.abs(total - 100) <= 0.35;
}

function isAtLeast(value: unknown): value is DroughtAtLeast {
  if (!isObject(value)) return false;
  if (!LEVELS.every((level) => isShare(value[level]))) return false;
  // "This class or worse" cannot grow as the class worsens.
  for (let index = 1; index < LEVELS.length; index += 1) {
    const gentler = value[LEVELS[index - 1]!] as number;
    const worse = value[LEVELS[index]!] as number;
    if (worse > gentler + 0.05) return false;
  }
  return true;
}

function isDroughtUnit(value: unknown): value is DroughtUnit {
  return isObject(value) &&
    typeof value.huc6 === "string" && /^\d{6}$/.test(value.huc6) &&
    typeof value.huc6_name === "string" && value.huc6_name.length > 0 &&
    isShares(value.percent_of_area) &&
    isAtLeast(value.percent_of_area_at_least);
}

/**
 * The earlier week carried in this file, if there is one.
 *
 * The one thing this refuses is a `previous` that is not strictly older than
 * the week around it. A file comparing a week with itself would publish a
 * change of zero for every drainage area and present it as a measurement,
 * which is worse than publishing no comparison at all.
 */
function isPreviousWeek(value: unknown, mapDate: string): boolean {
  if (!isObject(value)) return false;
  if (typeof value.map_date !== "string" || value.map_date >= mapDate) return false;
  if (value.release_date !== null && typeof value.release_date !== "string") return false;
  if (!Array.isArray(value.units) || value.units.length === 0) return false;
  return value.units.every((unit) =>
    isObject(unit) && typeof unit.huc6 === "string" && /^\d{6}$/.test(unit.huc6) &&
    isAtLeast(unit.percent_of_area_at_least));
}

export function validateDroughtCoverage(value: unknown): DroughtCoveragePayload {
  if (!isObject(value) || !Array.isArray(value.units)) {
    throw new Error("drought coverage must be an object with a units array");
  }
  if (!Number.isInteger(value.schema_version)) {
    throw new Error("drought coverage has an invalid schema version");
  }
  if (typeof value.map_date !== "string" || typeof value.release_date !== "string" ||
      typeof value.source !== "string" || typeof value.attribution !== "string") {
    throw new Error("drought coverage is missing its source metadata");
  }
  const badUnit = value.units.findIndex((unit) => !isDroughtUnit(unit));
  if (badUnit >= 0) {
    const candidate = value.units[badUnit];
    const name = isObject(candidate) && typeof candidate.huc6_name === "string"
      ? ` (${candidate.huc6_name})` : "";
    throw new Error(`Invalid drought coverage record at index ${badUnit}${name}`);
  }
  if (value.unit_count !== value.units.length || value.units.length === 0) {
    throw new Error("unit_count does not match the units array");
  }
  const codes = new Set(value.units.map((unit) => (unit as DroughtUnit).huc6));
  if (codes.size !== value.units.length) {
    throw new Error("drought coverage repeats a drainage area");
  }
  if (value.previous !== undefined && value.previous !== null &&
      !isPreviousWeek(value.previous, value.map_date)) {
    throw new Error("drought coverage carries an invalid earlier week");
  }
  return value as unknown as DroughtCoveragePayload;
}
