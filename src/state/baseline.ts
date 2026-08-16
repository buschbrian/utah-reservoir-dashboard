/*
 * Which period "normal" means, and what to say when a reservoir cannot answer.
 *
 * The site used to have one answer to "is this normal for the time of year?",
 * and it was a median over 2015 onward -- not because anyone chose that
 * period, but because 2015 is when the pipeline starts asking. Those years are
 * the driest stretch in the modern record here, so a reservoir measured
 * against them is measured against the drought, and a bad year reads as
 * ordinary. The mountain snow half of the same site has always compared
 * against the standard 1991-2020 period. One dashboard was answering one
 * question two ways.
 *
 * Now both periods are published and the reader picks. The rules this module
 * exists to hold:
 *
 * **The period travels with the number.** Every sentence that quotes a normal
 * names the years it came from and how many of them there were. A median over
 * thirty years and a median over three are not the same claim.
 *
 * **A missing period is said, not filled in.** Five reservoirs are younger
 * than 1991 -- Jackson Flat's dam dates from 2017 -- and for those the
 * standard comparison does not exist. Quietly showing the other period's
 * number under the label the reader selected would make the control a lie.
 * The substitution is allowed; hiding it is not.
 */
import type {
  Baseline, BaselineChoice, BaselineId, Reservoir, ReservoirPayload
} from "../types";
import { formatAcreFeet, formatPercent } from "../viz/format";

export const BASELINE_IDS: readonly BaselineId[] = ["recent", "climate"];

/** The periods to offer when a payload predates the selectable baseline. */
export const FALLBACK_CHOICES: readonly BaselineChoice[] = [
  {
    id: "recent",
    label: "Recent years",
    period_label: "recent years",
    start_year: 2015,
    end_year: 2025,
    note: "Every earlier year this site holds."
  }
];

export function isBaselineId(value: unknown): value is BaselineId {
  return value === "recent" || value === "climate";
}

/**
 * The periods this payload can actually offer.
 *
 * A choice with nothing behind it for any reservoir is dropped rather than
 * rendered as a disabled control, because a control that never does anything
 * is a question the reader has to answer about the page instead of about the
 * water.
 */
export function baselineChoices(payload: ReservoirPayload): BaselineChoice[] {
  const declared = payload.baselines ?? FALLBACK_CHOICES;
  const minimum = payload.climate_normals?.minimum_years ?? 0;
  return declared.filter((choice) => payload.reservoirs.some((reservoir) => {
    const found = readBaseline(reservoir, choice.id);
    return found !== null && found.sample_years >= minimum;
  }));
}

/**
 * One reservoir's figures for one period.
 *
 * Falls back to the three `seasonal_*` fields for the recent period, so a
 * payload written before this change still answers. Those fields are the
 * recent baseline -- the pipeline computes both from the same expression --
 * which is why this is a compatibility shim rather than a second definition.
 */
export function readBaseline(
  reservoir: Reservoir, id: BaselineId
): Baseline | null {
  const published = reservoir.baselines?.[id];
  if (published) return published;
  if (reservoir.baselines || id !== "recent") return null;
  if (reservoir.seasonal_normal_af === null) return null;
  return {
    normal_af: reservoir.seasonal_normal_af,
    pct_of_normal: reservoir.pct_of_seasonal_normal,
    sample_years: reservoir.seasonal_sample_years,
    covers_full_period: true,
    first_obs: reservoir.first_obs
  };
}

export interface ActiveBaseline {
  /** The period the reader asked for. */
  requested: BaselineId;
  /** The period actually behind the numbers, which can differ. */
  shown: BaselineId | null;
  value: Baseline | null;
  /** True when the requested period does not exist for this reservoir. */
  substituted: boolean;
  /**
   * Why the requested period was not used.
   *
   * "none" is a reservoir with no readings in the period at all. "thin" is
   * the subtler one and the reason this field exists: Jackson Flat's dam
   * dates from 2017, so it has three years inside 1991-2020 and would
   * otherwise present a three-year median under the label "1991 through
   * 2020". That is true in every word and wrong as a whole.
   */
  reason: "none" | "thin" | null;
}

/**
 * What to show for one reservoir under the reader's chosen period.
 *
 * The substitution is deliberate and is reported. A reader comparing twenty
 * reservoirs should not lose the row for the one dam built in 2017; they
 * should see its number and be told which period it belongs to.
 *
 * `minimumYears` comes from the payload rather than from a constant here, so
 * the pipeline and the page cannot disagree about how many years make a
 * normal. Zero means "publish whatever there is", which is what an older
 * payload that never declared a threshold gets.
 */
export function activeBaseline(
  reservoir: Reservoir, requested: BaselineId, minimumYears = 0
): ActiveBaseline {
  const wanted = readBaseline(reservoir, requested);
  if (wanted && wanted.sample_years >= minimumYears) {
    return {
      requested, shown: requested, value: wanted, substituted: false, reason: null
    };
  }
  const other = BASELINE_IDS.find((id) => id !== requested) as BaselineId;
  const substitute = readBaseline(reservoir, other);
  return {
    requested,
    shown: substitute ? other : null,
    value: substitute,
    substituted: substitute !== null,
    reason: wanted ? "thin" : "none"
  };
}

/** The years a period covers, in words a reader can compare against a date. */
export function periodLabel(
  choices: readonly BaselineChoice[], id: BaselineId | null
): string {
  if (id === null) return "no earlier years";
  const choice = choices.find((entry) => entry.id === id);
  return choice ? choice.period_label : "earlier years";
}

/**
 * The normal value, what share of it the reservoir holds, and how many years
 * stand behind it.
 *
 * Every part of that sentence is load-bearing, which is why it is one
 * function rather than three call sites that might each drop a different part.
 */
export function describeBaseline(
  active: ActiveBaseline, choices: readonly BaselineChoice[]
): string {
  if (!active.value || active.value.normal_af === null) {
    return "No earlier years to compare with.";
  }
  const { normal_af: normal, pct_of_normal: share, sample_years: years } = active.value;
  const amount = `${formatAcreFeet(normal)} acre-feet`;
  const at = share === null || !Number.isFinite(share)
    ? "" : ` (now at ${formatPercent(share)})`;
  const span = years > 0
    ? `; ${years} ${years === 1 ? "year" : "years"} of ${periodLabel(choices, active.shown)}`
    : "";
  /* The two reasons are different facts and read differently to someone
   * deciding whether to trust the row, so they are not one sentence with the
   * detail dropped. */
  const swap = !active.substituted ? ""
    : active.reason === "thin"
      ? `. This reservoir has too few years in ${periodLabel(choices, active.requested)} ` +
        "for that comparison, so this uses the other period"
      : `. There is no ${periodLabel(choices, active.requested)} comparison for this ` +
        "reservoir, so this uses the other period";
  return `${amount}${at}${span}${swap}`;
}

/**
 * The heading over the comparison, naming the period rather than saying
 * "normal" and leaving the reader to guess which normal.
 */
export function baselineRowLabel(
  active: ActiveBaseline, choices: readonly BaselineChoice[]
): string {
  return `Normal for this week, ${periodLabel(choices, active.shown)}`;
}

/**
 * How many reservoirs the chosen period actually covers.
 *
 * Shown beside the control, because the honest cost of the standard period is
 * that a handful of young reservoirs cannot use it, and a reader switching to
 * it deserves to know that before they read the map rather than after.
 */
export function baselineCoverage(
  reservoirs: readonly Reservoir[], id: BaselineId, minimumYears = 0
): { covered: number; total: number } {
  return {
    covered: reservoirs.filter((reservoir) => {
      const found = readBaseline(reservoir, id);
      return found !== null && found.sample_years >= minimumYears;
    }).length,
    total: reservoirs.length
  };
}
