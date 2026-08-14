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
  normal_af: NullableNumber;
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

export interface ReservoirPayload {
  schema_version?: number;
  generated_at: string;
  start_date: string;
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
