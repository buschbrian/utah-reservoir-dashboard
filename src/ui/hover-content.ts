/*
 * What the hover cards say, as arithmetic and words over plain data.
 *
 * Kept out of the map modules for two reasons. It is the only part of hover
 * a test can reach -- `hitTest` is resolved by a render loop that does not
 * run in a headless browser, let alone in Node -- and it is visible text, so
 * it belongs in a file the Simplified Technical English test reads (ADR-006).
 * The map modules keep the pointer plumbing; this keeps the sentences.
 *
 * One rule runs through all of it: a card answers the question its own
 * symbol raises and does not repeat what the symbol already said. A colour
 * says which class, so the card gives the number and what it is a number
 * *of*. A size says how big, so the card gives the volume. A shape says
 * "reservoir", so the card says which drainage area it is in -- which is
 * the fact that lets a reader carry a reading from one view to another.
 */
import { isMeasured, type StorageContext } from "../drought-model";
import type { SiteDayDepth } from "../snow-model";
import type { DroughtUnit, NullableNumber, Reservoir, SnowSite } from "../types";
import { DROUGHT_CLASSES, NO_DROUGHT_LABEL } from "../viz/drought-classes";
import { formatAcreFeet, formatDate, formatPercent } from "../viz/format";
import { NO_VALUE_LABEL, SNOW_CLASSES, snowClassIndex } from "../viz/snow-classes";
import { headlineBasis, headlinePercent } from "../viz/symbols";

/** Inches to one decimal, or the words for having no reading. */
export function formatInches(value: NullableNumber): string {
  return value === null || !Number.isFinite(value)
    ? "no value" : `${value.toFixed(1)} inches`;
}

/** The snow class words for a percentage, or the words for no value. */
export function snowClassLabel(percent: number | null): string {
  const index = snowClassIndex(percent);
  const entry = index === null ? null : SNOW_CLASSES[index];
  return entry ? entry.label : NO_VALUE_LABEL;
}

/**
 * The storage map's card: the reservoir the reader is pointing at.
 *
 * The basis is named rather than assumed. "88% full" against a surveyed
 * capacity and against the highest level ever recorded are two different
 * claims, and the map draws them with the same circle, so the card is where
 * a reader finds out which one they are reading.
 */
export function storageReservoirLines(reservoir: Reservoir): string[] {
  const lines = [
    `${formatPercent(headlinePercent(reservoir))} of ${headlineBasis(reservoir)}`,
    `${formatAcreFeet(reservoir.current_storage_af)} acre-feet stored`
  ];
  if (reservoir.change_30d_pct !== null) {
    const sign = reservoir.change_30d_pct > 0 ? "+" : "";
    lines.push(`${sign}${formatPercent(reservoir.change_30d_pct)} over 30 days`);
  }
  /* A dashed ring says the reading is late without saying how late, and
   * "how late" is the whole question a late reading raises. */
  lines.push(`Reading ${formatDate(reservoir.as_of)}`);
  return lines;
}

/**
 * A reservoir on a map that is about something else.
 *
 * Short on purpose. These points are reference: they carry no storage
 * colour and no proportional size on the snow and drought maps, so the card
 * gives the one storage number, says where the reservoir sits, and points at
 * the surface that is actually about storage. `note` is whatever the host
 * map can add about the land around it.
 */
export function referenceReservoirLines(
  reservoir: Pick<Reservoir, "pct_of_capacity" | "pct_of_record_max">,
  areaName: string | null,
  note: string | null
): string[] {
  const percent = reservoir.pct_of_capacity ?? reservoir.pct_of_record_max;
  return [
    `Reservoir, ${formatPercent(percent)} full`,
    ...(areaName ? [`In the ${areaName} drainage area`] : []),
    ...(note ? [note] : [])
  ];
}

/** One measurement site on the snow map, for the day the slider is on. */
export function snowSiteLines(
  site: Pick<SnowSite, "elevation_feet" | "huc6_name" | "late" | "latest_date">,
  percent: number | null,
  depth: SiteDayDepth | undefined
): string[] {
  return [
    `${formatPercent(percent)} of normal — ${snowClassLabel(percent)}`,
    `${formatInches(depth?.inches ?? null)}, normally ` +
      `${formatInches(depth?.normalInches ?? null)}`,
    `${Math.round(site.elevation_feet).toLocaleString("en-US")} feet, ${site.huc6_name}`,
    site.late
      ? `Late data: newest value ${formatDate(site.latest_date)}`
      : `Newest value ${formatDate(site.latest_date)}`
  ];
}

/**
 * One drainage area on the snow map.
 *
 * The reporting count is the line that earns its place. An area at 46% of
 * normal from eleven sites and the same figure from two are different
 * statements, and the fill draws them in exactly the same colour.
 */
export function snowBasinLines(
  percent: number | null, reportingSites: number
): string[] {
  return [
    `${formatPercent(percent)} of normal — ${snowClassLabel(percent)}`,
    `Mean of ${reportingSites} ${reportingSites === 1 ? "site" : "sites"} ` +
      "reporting this day",
    "Choose this area above for its own season"
  ];
}

/**
 * One drainage area on the storage map.
 *
 * The outlines were pure decoration until now: they said where a boundary
 * ran and nothing about what was inside it, while the number a reader wants
 * from a drainage area -- how full the reservoirs in it are, all together --
 * existed only in the analysis controls. Combined storage over combined full
 * level is the ADR-011 arithmetic the drought view already joins by, so the
 * two surfaces answer the same question the same way.
 */
export function drainageAreaLines(
  storage: StorageContext | undefined
): string[] {
  if (!storage || storage.reservoirCount === 0) {
    return ["No reservoirs in this drainage area are in view"];
  }
  return [
    `${formatPercent(storage.percent)} full across ${storage.reservoirCount} ` +
      `${storage.reservoirCount === 1 ? "reservoir" : "reservoirs"}`,
    "Choose this area in the analysis controls to narrow the map"
  ];
}

export interface WorstDroughtShare {
  label: string;
  /** Percent of the area in that class or worse. */
  share: number;
}

/**
 * The most severe class present in an area, and how much land is in it or
 * worse.
 *
 * Both halves, never the label alone: "exceptional drought" beside an area
 * name reads as a statement about all of it, and the share is what says
 * whether it is a corner or nearly the whole thing.
 */
export function worstDroughtShare(unit: DroughtUnit): WorstDroughtShare | null {
  /* No shares means no answer, not "no drought" (ADR-059). */
  if (!isMeasured(unit)) return null;
  for (let index = DROUGHT_CLASSES.length - 1; index >= 0; index -= 1) {
    const entry = DROUGHT_CLASSES[index]!;
    const share = unit.percent_of_area_at_least[entry.key];
    if (share > 0) return { label: entry.label, share };
  }
  return { label: NO_DROUGHT_LABEL, share: unit.percent_of_area.none };
}

/** One drainage area on the drought map: its land, then its water. */
export function droughtAreaLines(
  unit: DroughtUnit, storage: StorageContext | undefined
): string[] {
  const worst = worstDroughtShare(unit);
  const storageLine = storage
    ? `Reservoirs here: ${formatPercent(storage.percent)} full across ` +
      `${storage.reservoirCount}`
    : "No reservoir reading for this area";
  /* `worst === null` and `!isMeasured` are one fact; both are tested so the
   * shares narrow to present for the measured sentences below. */
  if (worst === null || !isMeasured(unit)) {
    return [
      "The drought monitor does not measure land in this area",
      storageLine
    ];
  }
  return [
    `${formatPercent(worst.share)} of the land is ${worst.label} or worse`,
    `${formatPercent(unit.percent_of_area.none)} of it is in no class`,
    storageLine
  ];
}

/** The national sweep outside the drawn areas. The map draws it because
 * drought does not stop at a drainage-area edge; the card says that the
 * figures on the page below do. */
export function droughtClassLines(code: string): string[] {
  return [
    `Drought class ${code}`,
    "Outside the drainage areas this page reports"
  ];
}

/** The short note about the land under a reservoir, for the drought map's
 * reference card. Null when the area has no coverage row -- or no measured
 * land, which must not read as a claim about it (ADR-059). */
export function droughtNoteForArea(unit: DroughtUnit | undefined): string | null {
  if (!unit) return null;
  const worst = worstDroughtShare(unit);
  if (worst === null) return null;
  return `${formatPercent(worst.share)} of that land is ${worst.label} or worse`;
}
