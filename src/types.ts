export type DataFrequency = "daily" | "monthly";
export type SourceKey = "rise" | "awdb";
export type NullableNumber = number | null;

export interface MonthlyRecord {
  month: string;
  mean_af: NullableNumber;
  min_af: NullableNumber;
  max_af: NullableNumber;
  end_af: NullableNumber;
  days: number;
  /** The recent baseline's normal for this calendar month. */
  normal_af: NullableNumber;
  /**
   * The 1991-2020 normal for this calendar month.
   *
   * Optional because payloads written before the selectable baseline remain
   * readable, and null for a reservoir that has no climate record. Both cases
   * mean the same thing to a chart -- draw no climate line -- and neither may
   * be quietly answered with `normal_af` instead.
   */
  climate_normal_af?: NullableNumber;
}

/** Which period a comparison is measured against. */
export type BaselineId = "recent" | "climate";

/**
 * One reservoir measured against one period.
 *
 * `sample_years` is not decoration. A median over thirty years and a median
 * over three are both "the normal", and only one of them means what a reader
 * assumes it means, so every surface that shows a normal shows this too.
 */
export interface Baseline {
  normal_af: NullableNumber;
  pct_of_normal: NullableNumber;
  sample_years: number;
  /** False for a reservoir younger than the period it is measured against. */
  covers_full_period: boolean;
  first_obs: string;
}

/**
 * Both baselines for one reservoir, and which one it opens on.
 *
 * `climate` is null where there is no record to build one from -- a dam
 * younger than 1991, or a station the provider would not answer for. It is
 * never filled in from `recent` as a stand-in: a comparison that silently
 * swaps its own denominator is the failure this exists to fix.
 */
export interface ReservoirBaselines {
  recent: Baseline | null;
  climate: Baseline | null;
  default: BaselineId;
}

export interface Reservoir {
  name: string;
  rise_item_id: number | null;
  source_key: SourceKey;
  source_label: string;
  source_url: string;
  source_station_id: string | null;
  data_frequency: DataFrequency;
  stale_after_days: number;
  lat: number;
  lon: number;
  as_of: string;
  days_stale: number;
  is_stale: boolean;
  fetch_ok: boolean;
  fetch_error?: string;
  current_storage_af: number;
  record_max_af: number;
  record_min_af: number;
  pct_of_record_max: NullableNumber;
  capacity_af: NullableNumber;
  capacity_basis: string | null;
  pct_of_capacity: NullableNumber;
  seasonal_percentile: NullableNumber;
  seasonal_normal_af: NullableNumber;
  pct_of_seasonal_normal: NullableNumber;
  seasonal_sample_years: number;
  /**
   * The same question against a choice of period. Optional while payloads
   * written before the selectable baseline remain readable; the three
   * `seasonal_*` fields above stay exactly what they were and carry the
   * recent baseline, so nothing that already reads this payload changes
   * meaning.
   */
  baselines?: ReservoirBaselines;
  change_7d_af: NullableNumber;
  change_7d_pct: NullableNumber;
  change_30d_af: NullableNumber;
  change_30d_pct: NullableNumber;
  change_365d_af: NullableNumber;
  change_365d_pct: NullableNumber;
  peak_this_year_af: NullableNumber;
  peak_this_year_date: string | null;
  pct_of_peak_this_year: NullableNumber;
  monthly: MonthlyRecord[];
  first_obs: string;
  n_obs: number;
  years_of_record: number;

  // Watershed membership (Phase 1.5). `in_utah` describes the provider point;
  // `intersects_utah` owns the Phase 2 headline scope and includes reviewed
  // cross-border waterbodies. The remaining fields stay optional while the
  // production pages continue to accept older saved payloads. `huc6` is the
  // six-digit hydrologic unit that contains the
  // reservoir's dam or outlet point -- not the centre of its water polygon,
  // because a large reservoir can cross a boundary and what matters is
  // where the stored water leaves it.
  in_utah: boolean;
  intersects_utah: boolean;
  huc6?: string | null;
  huc6_name?: string | null;
  huc_assignment_point?: [number, number] | null;
  huc_assignment_source?: string | null;
}

export interface ReservoirSource {
  key: SourceKey;
  label: string;
  url: string;
  cadence: string;
}

export interface NormalPeriod {
  start_year: number;
  end_year: number;
}

/**
 * One published day in a snow station's water-year series, as the columnar
 * triple the pipeline writes: date, snow water equivalent in inches, and the
 * 1991–2020 normal median for that day. Field names are declared once in the
 * payload header (`site_series_fields`) rather than repeated on ~70,000 rows.
 */
export type SnowSeriesRow = [string, NullableNumber, NullableNumber];

/** A calendar day of the normal snow year; `value` is inches where published. */
export interface SnowNormalTimingPoint {
  month: number;
  day: number;
  value?: NullableNumber;
}

export interface SnowNormalTiming {
  peak: SnowNormalTimingPoint | null;
  onset: SnowNormalTimingPoint | null;
  meltout: SnowNormalTimingPoint | null;
}

export interface SnowSite {
  station: string;
  name: string;
  state: string;
  county: string;
  lat: number;
  lon: number;
  elevation_feet: number;
  begins: string;
  huc6: string;
  huc6_name: string;
  /** The provider's own drainage assignment, kept beside ours for review. */
  provider_huc6: string | null;
  latest_date: string;
  late: boolean;
  normal_timing: SnowNormalTiming;
  series: SnowSeriesRow[];
}

export interface SnowRollupDay {
  date: string;
  reporting_site_count: number;
  /** Null when fewer sites report than `minimum_reporting_sites` allows. */
  mean_percent_of_normal_median: NullableNumber;
}

export interface SnowRollup {
  huc6: string;
  huc6_name: string;
  site_count: number;
  minimum_reporting_sites: number;
  series: SnowRollupDay[];
}

export interface SnowpackPayload {
  schema_version: number;
  generated_at: string;
  as_of: string;
  water_year: number;
  normal_period: NormalPeriod;
  units: "inches";
  site_series_fields: [string, string, string];
  source: string;
  site_count: number;
  late_site_count: number;
  rollups: SnowRollup[];
  sites: SnowSite[];
}

/** Percent of a drainage area's land in each exclusive drought class, plus
 * the share in none of them. Written by `tools/compute_drought_coverage.py`. */
export interface DroughtShares {
  none: number;
  d0: number;
  d1: number;
  d2: number;
  d3: number;
  d4: number;
}

/** "This class or worse", as sums of the disjoint exclusive shares. */
export interface DroughtAtLeast {
  d0: number;
  d1: number;
  d2: number;
  d3: number;
  d4: number;
}

export interface DroughtUnit {
  huc6: string;
  huc6_name: string;
  percent_of_area: DroughtShares;
  percent_of_area_at_least: DroughtAtLeast;
}

/** One earlier week, reduced to what a comparison needs. */
export interface DroughtPreviousWeek {
  map_date: string;
  release_date: string | null;
  units: { huc6: string; percent_of_area_at_least: DroughtAtLeast }[];
}

export interface DroughtCoveragePayload {
  schema_version: number;
  /** The week the monitor's map describes. */
  map_date: string;
  /**
   * The week before this one, carried here rather than fetched.
   *
   * Null for the first week the pipeline ever computed, and only ever a
   * strictly earlier week — never this one, which would make every change
   * zero and call it a measurement. Optional while payloads written before
   * the history remain readable.
   */
  previous?: DroughtPreviousWeek | null;
  /** The Thursday the monitor published it. */
  release_date: string;
  source: string;
  attribution: string;
  method: Record<string, unknown>;
  unit_count: number;
  units: DroughtUnit[];
}

/** A period offered in the baseline control, described in its own words. */
export interface BaselineChoice {
  id: BaselineId;
  label: string;
  period_label: string;
  start_year: number;
  end_year: number;
  /** Why a reader might pick this one, and what it cannot tell them. */
  note: string;
}

export interface ClimateNormalsMeta {
  built: string | null;
  file: string;
  available_count: number;
  minimum_years: number;
}

export interface ReservoirPayload {
  schema_version?: number;
  generated_at: string;
  start_date: string;
  /** Optional while payloads generated before the disclosure remain readable. */
  normal_period?: NormalPeriod;
  normal_window_days?: number;
  /** The periods a reader can measure against. Optional for older payloads. */
  baselines?: BaselineChoice[];
  default_baseline?: BaselineId;
  climate_normals?: ClimateNormalsMeta;
  stale_after_days: number;
  stale_after_days_by_cadence: Record<DataFrequency, number>;
  source: string;
  sources: ReservoirSource[];
  source_counts: Record<SourceKey, number>;
  reservoir_count: number;
  stale_count: number;
  capacity_count: number;
  reservoirs: Reservoir[];
}
