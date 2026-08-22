export type DataFrequency = "daily" | "monthly";
export type SourceKey = "rise" | "awdb" | "cdec" | "cdss";
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
  /**
   * The same comparison as a position among the earlier years.
   *
   * `seasonal_rank` counts from the lowest and `seasonal_rank_of` is the
   * earlier years plus this reading, so 3 of 11 reads "third-lowest of
   * eleven". Optional because they arrive from the pipeline: a payload
   * written before them still answers with the percentage.
   */
  seasonal_rank?: NullableNumber;
  seasonal_rank_of?: NullableNumber;
  /**
   * What each change is actually a change from.
   *
   * The name of a change is the date the pipeline asks for, not the one it
   * gets: the nearest usable reading is taken within ten days for a daily
   * feed and forty-five for a month-end one, so `change_365d_af` has covered
   * 320 days to 410. Optional, because they arrive with the pipeline.
   */
  change_7d_reference_date?: string | null;
  change_7d_elapsed_days?: NullableNumber;
  change_30d_reference_date?: string | null;
  change_30d_elapsed_days?: NullableNumber;
  change_365d_reference_date?: string | null;
  change_365d_elapsed_days?: NullableNumber;
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

  // County membership (ADR-058). Optional for the same reason the drainage
  // fields are: the payload is rewritten every morning and the pages have to
  // keep reading the one published before this field existed.
  //
  // Assigned from the *published waterbody point*, deliberately not the dam
  // point above. The two answer different questions and disagree twice: Glen
  // Canyon Dam is in Coconino County, Arizona, and Lake Powell is the lake in
  // San Juan County, Utah that a reader is asking about.
  //
  // `county_fips` is the key and the name is not. This roster holds two
  // Summit Counties, two Carbon Counties and two Garfield Counties, each pair
  // in different states, so grouping by name merges reservoirs that are
  // hundreds of miles apart.
  county_fips?: string | null;
  county_name?: string | null;

  /**
   * Where the reservoir is, where its water is, and what its water drains
   * (ADR-060). Three questions the Utah pair answered for one state.
   *
   * `state` is the state containing the published point -- exactly one, and
   * `in_utah` is its Utah special case. `waterbody_states` is every state the
   * water touches: the reviewed answer where a waterbody crosses a line, and
   * the point's own state otherwise, which is a default rather than a
   * finding. `connected_states` is every state the drainage area reaches.
   *
   * They differ in ways a reader cares about. Lake Powell is in Utah, its
   * water is in Utah and Arizona, and it drains Utah and Arizona. Bear Lake's
   * point is in Idaho and its water reaches Utah. Hyrum is wholly in Utah and
   * fed from Idaho.
   */
  state?: string | null;
  waterbody_states?: string[];
  connected_states?: string[];
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

/** A subregion's code and name, for a reader who asks for the coarser
 * grouping (ADR-064). Names only: the code is the first four digits of one
 * every site already carries. */
export interface Subregion {
  huc4: string;
  name: string;
}

/** A region's code and name, the same thing one level coarser (ADR-073).
 * Its own type rather than a shared one keyed by a generic field, because
 * the field name is the level: a client reading `huc4` off a region would
 * find nothing and label by code, which is the failure both tables exist to
 * prevent. */
export interface Region {
  huc2: string;
  name: string;
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
  /** Absent in a payload written before the second level existed. */
  subregions?: Subregion[];
  /** Absent in a payload written before the third level existed (ADR-073). */
  regions?: Region[];
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

/**
 * How much of a drainage area the drought monitor can see (ADR-059).
 *
 * Present only when the answer is not the whole of it. The monitor maps the
 * United States and stops at both borders, so a basin crossing one is
 * partly unmeasured -- Kootenai is 24.8% United States land. Every drainage
 * area published today is wholly inside the country and carries no such
 * block.
 *
 * This is a share of a *different denominator* from the class shares beside
 * it, and lives in its own object for exactly that reason (ADR-046): the
 * class shares divide by the measured land, this divides by the whole area,
 * and the two must never be summed.
 */
export interface DroughtMeasuredExtent {
  percent_of_area: number;
  basis: string;
}

export interface DroughtUnit {
  huc6: string;
  huc6_name: string;
  /**
   * Shares of the land the monitor measures, not of the whole area.
   *
   * Absent -- together with the cumulative block -- only when the monitor
   * measures none of the area (ADR-059): no denominator means no share at
   * all, never zeros, and `measured.percent_of_area` is 0 to say why. The
   * validator holds the two blocks and that condition together.
   */
  percent_of_area?: DroughtShares;
  percent_of_area_at_least?: DroughtAtLeast;
  measured?: DroughtMeasuredExtent;
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

/**
 * What this roster holds for one state, and what it is known to miss.
 *
 * The counts are the payload's own arithmetic. `status` and the source fields
 * are a reviewed judgement about the world outside it, which no amount of
 * counting could produce -- and without which a row reading "8 reservoirs" is
 * indistinguishable from a state that only has eight.
 */
export interface StateCoverage {
  tracked_reservoir_count: number;
  tracked_reference_capacity_af: number;
  daily_count: number;
  monthly_count: number;
  current_count: number;
  climate_baseline_count: number;
  /** "more to add", "not machine readable", "none found", "not reviewed". */
  status: string;
  known_additional_source: string | null;
  known_additional_source_url: string | null;
  known_additional_about: number | null;
  note: string;
}

export interface SourceCoverage {
  /** When the sources were last checked, not when the counts were computed. */
  reviewed: string;
  /** Which of ADR-060's three questions the grouping asked. */
  basis: string;
  note: string;
  states: Record<string, StateCoverage>;
}

export interface ReservoirPayload {
  schema_version?: number;
  /** The calculations behind the derived values, separate from the shape. */
  method_version?: string;
  /** How complete the roster is, state by state. Optional: it arrives. */
  coverage?: SourceCoverage;
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
  /**
   * How old a reading may be and still be published at all (ADR-056).
   *
   * Optional because a payload written before ADR-056 has no withdrawal
   * record. The pipeline always writes all three now, so absent means old,
   * not broken -- the validator draws the same line.
   */
  withdraw_after_days?: number;
  withdrawn_count?: number;
  /** Reservoirs this run declined to publish, and why. Never charted. */
  withdrawn?: WithdrawnReservoir[];
  /**
   * The drainage-area envelope. Only the part the surfaces read is typed:
   * the block carries counts and provenance too, and a payload is not a
   * place to restate the pipeline's own bookkeeping as a contract.
   */
  watersheds?: {
    /** HUC-4 subregions the payload's areas roll up into, named (ADR-048). */
    subregions?: { huc4: string; name: string }[];
    /** HUC-2 regions they roll up into, named the same way (ADR-073). */
    regions?: { huc2: string; name: string }[];
  };
  reservoirs: Reservoir[];
}

/**
 * A reservoir held back from the payload for being too far out of date.
 *
 * Deliberately not a `Reservoir`: it carries no storage, no percent full and
 * no baseline, because the whole reason it is here is that its last figure
 * describes a different season from the one every other record describes.
 * It exists so a shorter roster is legible as a decision rather than as an
 * unexplained gap.
 */
export interface WithdrawnReservoir {
  name: string;
  as_of: string;
  days_stale: number;
  source_label: string;
  reason: string;
}

/**
 * One reservoir's upstream set, from the committed trace (ADR-077).
 *
 * An unordered containment answer: every published reservoir and snow site
 * whose point falls inside the contributing area NLDI traces above this
 * one's dam. It is not a flow order -- "which reservoir is directly above"
 * is a different question this file does not answer -- and it is about
 * water, not operations: upstream of, never feeds.
 */
export interface UpstreamTrace {
  name: string;
  /** Where the trace started: the reviewed dam point or the published point. */
  trace_point?: string;
  /** The NLDI COMID the trace was taken from -- the reproducibility evidence. */
  comid?: string;
  basin_vertices?: number;
  basin_area_sq_mi?: number;
  upstream_reservoirs: string[];
  upstream_snow_sites: string[];
  /** Why no set could be produced, when none could. */
  screen?: string;
  detail?: string;
  /** Set when the basin measures past the review threshold and needs a look. */
  review?: string;
}

/**
 * The committed upstream index, published verbatim as `upstream_index.json`.
 *
 * Keyed by `source_station_id` (ADR-066). The evidence fields ride along at
 * near-zero gzip cost because station lists compress to almost nothing; they
 * are what makes a trace reproducible without re-asking NLDI.
 */
export interface UpstreamIndex {
  source: string;
  source_url: string;
  retrieved: string;
  keyed_by: string;
  selection: string;
  self_exclusion: string;
  area_method?: string;
  review_area_sq_mi?: number;
  traced_count?: number;
  screened_count?: number;
  review_count?: number;
  traces: Record<string, UpstreamTrace>;
}
