import type {
  DroughtAtLeast,
  DroughtCoveragePayload,
  DroughtShares,
  DroughtUnit
} from "../types";
import { HUC_CODE } from "./huc";

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

/**
 * The measured-extent block, when there is one (ADR-059).
 *
 * A share between 0 and 100 and a stated basis. The basis is required rather
 * than decorative: a number saying a drainage area is 24.8% measured is
 * unreadable without the sentence saying what measured means, and a caller
 * putting the figure on screen has to have something to put beside it.
 *
 * Refused at exactly 100: the writer omits the block when the whole area is
 * measured, so a block claiming 100 is a file disagreeing with itself.
 */
function isMeasuredExtent(value: unknown): boolean {
  return isObject(value) &&
    typeof value.percent_of_area === "number" &&
    Number.isFinite(value.percent_of_area) &&
    value.percent_of_area >= 0 && value.percent_of_area < 100 &&
    typeof value.basis === "string" && value.basis.length > 0;
}

function isDroughtUnit(value: unknown, field: string): value is DroughtUnit {
  if (!isObject(value) ||
      typeof value[field] !== "string" || !HUC_CODE.test(value[field] as string) ||
      typeof value[`${field}_name`] !== "string" ||
      (value[`${field}_name`] as string).length === 0 ||
      (value.measured !== undefined && !isMeasuredExtent(value.measured))) {
    return false;
  }
  /* No share at all is legal, and legal only, for an area with no measured
   * land (ADR-059): both blocks absent together, with the measured block
   * saying why. Anything in between -- one block without the other, or
   * zeros published for an unmeasured area -- is a file disagreeing with
   * itself. */
  if (value.percent_of_area === undefined && value.percent_of_area_at_least === undefined) {
    return isObject(value.measured) && value.measured.percent_of_area === 0;
  }
  return isShares(value.percent_of_area) && isAtLeast(value.percent_of_area_at_least);
}

/**
 * The earlier week carried in this file, if there is one.
 *
 * The one thing this refuses is a `previous` that is not strictly older than
 * the week around it. A file comparing a week with itself would publish a
 * change of zero for every drainage area and present it as a measurement,
 * which is worse than publishing no comparison at all.
 */
function isPreviousWeek(value: unknown, mapDate: string, field: string): boolean {
  if (!isObject(value)) return false;
  if (typeof value.map_date !== "string" || value.map_date >= mapDate) return false;
  if (value.release_date !== null && typeof value.release_date !== "string") return false;
  if (!Array.isArray(value.units) || value.units.length === 0) return false;
  return value.units.every((unit) =>
    isObject(unit) && typeof unit[field] === "string" &&
    HUC_CODE.test(unit[field] as string) &&
    isAtLeast(unit.percent_of_area_at_least));
}

/**
 * The attribute this file carries each area's code in.
 *
 * The file states its own level and names the attribute after it -- `huc4` in
 * the coarser file, `huc6` in the one every map opens at (ADR-050, ADR-064).
 * A file with no level is read as six, which is every file published before
 * the second level existed.
 */
function codeField(value: Record<string, unknown>): string {
  const level = value.level;
  return typeof level === "number" && Number.isInteger(level) && level > 0
    ? `huc${level}`
    : "huc6";
}

/**
 * One unit, with its code moved to the name the rest of this application
 * reads it under.
 *
 * `huc6` is that name at every level, the same way `DrainageArea.huc6` holds
 * whatever size the drawn scope is. Normalising here is what keeps the level
 * out of the drought model, the map, the hover cards and the chart: they ask
 * what an area is called and how dry it is, and the size of it is the
 * payload's business.
 */
function normalizeUnit(unit: Record<string, unknown>, field: string): DroughtUnit {
  if (field === "huc6") return unit as unknown as DroughtUnit;
  const { [field]: code, [`${field}_name`]: name, ...rest } = unit;
  return { ...rest, huc6: code, huc6_name: name } as unknown as DroughtUnit;
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
  const field = codeField(value);
  const badUnit = value.units.findIndex((unit) => !isDroughtUnit(unit, field));
  if (badUnit >= 0) {
    const candidate = value.units[badUnit];
    const label = isObject(candidate) && typeof candidate[`${field}_name`] === "string"
      ? ` (${candidate[`${field}_name`] as string})` : "";
    throw new Error(`Invalid drought coverage record at index ${badUnit}${label}`);
  }
  if (value.unit_count !== value.units.length || value.units.length === 0) {
    throw new Error("unit_count does not match the units array");
  }
  const codes = new Set(value.units.map(
    (unit) => (unit as Record<string, unknown>)[field]));
  if (codes.size !== value.units.length) {
    throw new Error("drought coverage repeats a drainage area");
  }
  if (value.previous !== undefined && value.previous !== null &&
      !isPreviousWeek(value.previous, value.map_date, field)) {
    throw new Error("drought coverage carries an invalid earlier week");
  }
  if (field === "huc6") return value as unknown as DroughtCoveragePayload;
  /* Rebuilt rather than read around, so nothing downstream knows which file
   * it was handed -- the same arrangement `validateSnowpackPayload` uses for
   * the shared water-year calendar. */
  const previous = isObject(value.previous)
    ? {
      ...value.previous,
      units: (value.previous.units as Record<string, unknown>[])
        .map((unit) => normalizeUnit(unit, field))
    }
    : value.previous;
  return {
    ...value,
    units: (value.units as Record<string, unknown>[])
      .map((unit) => normalizeUnit(unit, field)),
    ...(value.previous === undefined ? {} : { previous })
  } as unknown as DroughtCoveragePayload;
}
