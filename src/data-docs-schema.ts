export interface ApiField {
  key: string;
  units: string;
  meaning: string;
  optional?: boolean;
}

export interface ApiFieldGroup {
  id: string;
  title: string;
  path: string;
  fields: readonly ApiField[];
}

const f = (key: string, units: string, meaning: string, optional = false): ApiField =>
  ({ key, units, meaning, optional });

export const RESERVOIR_GROUPS: readonly ApiFieldGroup[] = [
  { id: "reservoir-header", title: "File header", path: "root", fields: [
    f("schema_version", "version number", "Version of this JSON structure."),
    f("generated_at", "date and time", "Time the file was generated, in coordinated universal time."),
    f("start_date", "date", "First date requested from the storage providers."),
    f("normal_period", "object", "First and last years that can support the weekly comparison.", true),
    f("normal_window_days", "days", "Days before or after the same date used for the weekly comparison.", true),
    f("baselines", "array", "Periods a reader can measure each reservoir against.", true),
    f("default_baseline", "identifier", "Period the map opens on.", true),
    f("climate_normals", "object", "Where the standard-period values came from.", true),
    f("stale_after_days", "days", "Default number of days allowed before a daily reading is late."),
    f("stale_after_days_by_cadence", "object", "Late-data limits for each update schedule."),
    f("source", "text", "Short description of the storage providers."),
    f("sources", "array", "Provider descriptions used by the reservoir records."),
    f("source_counts", "object", "Number of reservoir records from each provider."),
    f("reservoir_count", "reservoirs", "Number of records in the reservoirs array."),
    f("stale_count", "reservoirs", "Number of records with late data."),
    f("capacity_count", "reservoirs", "Number of records with a traced full level."),
    f("withdraw_after_days", "days", "The most days a reading can be old and still be published."),
    f("withdrawn_count", "reservoirs", "Number of reservoirs held back for old data."),
    f("withdrawn", "array", "Reservoirs held back because their newest reading is too old to belong beside the others."),
    f("watersheds", "object", "Summary of drainage-area assignment coverage."),
    f("counties", "object", "Summary of county assignment coverage."),
    f("reservoirs", "array", "Current storage records and 12-month histories.")
  ]},
  { id: "reservoir-normal-period", title: "Weekly comparison period", path: "normal_period", fields: [
    f("start_year", "year", "First year that can support the weekly comparison."),
    f("end_year", "year", "Last year that can support the weekly comparison.")
  ]},
  { id: "reservoir-baseline-choice", title: "Comparison period",
    path: "baselines[]", fields: [
      f("id", "identifier", "Stable key used by each reservoir record."),
      f("label", "text", "Short name for the period."),
      f("period_label", "text", "First and last year of the period, in words."),
      f("start_year", "year", "First year of the period."),
      f("end_year", "year", "Last year of the period."),
      f("note", "text", "What this period can and cannot show.")
    ]},
  { id: "reservoir-climate-normals", title: "Standard-period values",
    path: "climate_normals", fields: [
      f("built", "date", "Date the standard-period values were last worked out."),
      f("file", "text", "Name of the file that holds the standard-period values."),
      f("available_count", "reservoirs", "Records with a standard-period value."),
      f("minimum_years", "years", "Fewest years a period needs before a record opens on it.")
    ]},
  { id: "reservoir-schedules", title: "Update limits", path: "stale_after_days_by_cadence", fields: [
    f("daily", "days", "Limit for readings expected every day."),
    f("monthly", "days", "Limit for readings expected once a month.")
  ]},
  { id: "reservoir-source", title: "Provider entry", path: "sources[]", fields: [
    f("key", "identifier", "Stable provider key used by reservoir records."),
    f("label", "text", "Provider label stored in the payload."),
    f("url", "web address", "Provider service address."),
    f("cadence", "text", "Provider update schedule.")
  ]},
  { id: "reservoir-source-counts", title: "Provider counts", path: "source_counts", fields: [
    f("rise", "reservoirs", "Records from the Bureau of Reclamation."),
    f("awdb", "reservoirs", "Records from the Natural Resources Conservation Service.")
  ]},
  { id: "reservoir-counties", title: "County summary", path: "counties", fields: [
    f("source", "text", "County boundary publisher."),
    f("assignment_rule", "text",
      "Point used to place a reservoir in a county. Deliberately not the one above."),
    f("assigned", "reservoirs", "Records with a county assignment."),
    f("unassigned", "reservoirs", "Records without one."),
    f("county_count", "counties", "Number of counties holding at least one reservoir."),
    f("state_count", "states", "Number of states holding at least one reservoir.")
  ]},
  { id: "reservoir-watersheds", title: "Drainage-area summary", path: "watersheds", fields: [
    f("source", "text", "Boundary publisher."),
    f("level", "digits", "Size of the drainage areas, as the length of their code."),
    f("boundaries", "file name", "Boundary file used for assignment."),
    f("assignment_rule", "text", "Point used to place a reservoir in a drainage area."),
    f("unit_count", "drainage areas", "Number of published drainage areas."),
    f("assigned", "reservoirs", "Records with a drainage-area assignment."),
    f("unassigned", "reservoirs", "Records without an assignment."),
    f("assigned_by_dam", "reservoirs", "Assignments made from a reviewed dam or outlet point."),
    f("in_utah", "reservoirs", "Records whose provider point is in Utah."),
    f("intersects_utah", "reservoirs", "Records whose reviewed waterbody reaches Utah."),
    f("subregions", "array",
      "Four-digit subregions the drainage areas roll up into, with their names.")
  ]},
  { id: "reservoir-subregion", title: "Subregion", path: "watersheds.subregions[]",
    fields: [
      f("huc4", "identifier", "Four-digit subregion code."),
      f("name", "text", "Subregion name.")
    ]},
  { id: "reservoir-record", title: "Reservoir record", path: "reservoirs[]", fields: [
    f("name", "text", "Reservoir name."),
    f("rise_item_id", "identifier", "Bureau of Reclamation item identifier, or null for another provider."),
    f("source_key", "identifier", "Provider key."),
    f("source_label", "text", "Provider label stored by the pipeline."),
    f("source_url", "web address", "Provider service address."),
    f("source_station_id", "identifier", "Provider station or item identifier."),
    f("data_frequency", "text", "Expected update schedule: daily or monthly."),
    f("stale_after_days", "days", "Late-data limit for this record."),
    f("lat", "decimal degrees", "Latitude of the provider or reviewed assignment point."),
    f("lon", "decimal degrees", "Longitude of the provider or reviewed assignment point."),
    f("as_of", "date", "Date of the newest storage reading."),
    f("days_stale", "days", "Age of the newest reading when the file was generated."),
    f("is_stale", "true or false", "Whether the reading exceeds its update limit."),
    f("fetch_ok", "true or false", "Whether this run received a usable provider response."),
    f("fetch_error", "text", "Failure message when the last good record was retained.", true),
    f("current_storage_af", "acre-feet", "Newest usable storage reading."),
    f("record_max_af", "acre-feet", "Highest storage in the requested record."),
    f("record_min_af", "acre-feet", "Lowest storage in the requested record."),
    f("pct_of_record_max", "percent", "Current storage divided by the highest recorded storage."),
    f("capacity_af", "acre-feet", "Reviewed reservoir full level, or null when unavailable."),
    f("capacity_basis", "identifier", "Source field used for the full level."),
    f("pct_of_capacity", "percent", "Current storage divided by the reviewed full level."),
    f("seasonal_percentile", "percent", "Rank against earlier readings near the same date."),
    f("seasonal_normal_af", "acre-feet", "Middle earlier-year reading near the same date."),
    f("pct_of_seasonal_normal", "percent", "Current storage divided by the weekly normal value."),
    f("seasonal_sample_years", "years", "Number of earlier calendar years in the weekly comparison."),
    f("baselines", "object", "The same comparison against each period on offer.", true),
    f("change_7d_af", "acre-feet", "Storage change over about seven days."),
    f("change_7d_pct", "percent", "Seven-day change divided by the earlier reading."),
    f("change_30d_af", "acre-feet", "Storage change over about 30 days."),
    f("change_30d_pct", "percent", "Thirty-day change divided by the earlier reading."),
    f("change_365d_af", "acre-feet", "Storage change over about one year."),
    f("change_365d_pct", "percent", "One-year change divided by the earlier reading."),
    f("peak_this_year_af", "acre-feet", "Highest storage in the current calendar year."),
    f("peak_this_year_date", "date", "Date of the current-year high value."),
    f("pct_of_peak_this_year", "percent", "Current storage divided by the current-year high value."),
    f("monthly", "array", "Twelve monthly summary records."),
    f("first_obs", "date", "First usable observation for this reservoir."),
    f("n_obs", "readings", "Number of usable observations."),
    f("years_of_record", "years", "Length of the usable record."),
    f("in_utah", "true or false", "Whether the provider point is in Utah."),
    f("intersects_utah", "true or false", "Whether the reviewed waterbody reaches Utah."),
    f("huc6", "identifier", "Six-digit drainage-area code."),
    f("huc6_name", "text", "Six-digit drainage-area name."),
    f("huc_assignment_point", "longitude, latitude", "Point used for drainage-area assignment."),
    f("huc_assignment_source", "text", "Evidence used for the assignment point."),
    f("state", "state code", "State holding the published point. One state."),
    f("waterbody_states", "array of state codes",
      "Every state the water touches. Reviewed where the water crosses a state line."),
    f("connected_states", "array of state codes",
      "Every state the drainage area reaches, which is where the water comes from."),
    f("county_fips", "identifier", "Five-digit county code holding the published point."),
    f("county_name", "text", "County name. Read it with the state: several names repeat.")
  ]},
  { id: "reservoir-month", title: "Monthly history entry", path: "reservoirs[].monthly[]", fields: [
    f("month", "year and month", "Month represented by the entry."),
    f("mean_af", "acre-feet", "Average storage during the month."),
    f("min_af", "acre-feet", "Lowest storage during the month."),
    f("max_af", "acre-feet", "Highest storage during the month."),
    f("end_af", "acre-feet", "Last usable storage reading in the month."),
    f("days", "readings", "Number of readings in the monthly summary."),
    f("normal_af", "acre-feet", "Middle earlier-year value for the month."),
    f("climate_normal_af", "acre-feet",
      "Middle value for the month across the standard climate period.", true)
  ]},
  { id: "reservoir-baselines", title: "Comparison periods for one reservoir",
    path: "reservoirs[].baselines", fields: [
      f("recent", "object", "Comparison against the years this site collects."),
      f("climate", "object", "Comparison against the standard climate period, or null."),
      f("default", "identifier", "Period this reservoir opens on.")
    ]},
  { id: "reservoir-baseline", title: "One comparison",
    path: "reservoirs[].baselines.recent", fields: [
      f("normal_af", "acre-feet", "Middle reading near the same date across the period."),
      f("pct_of_normal", "percent", "Current storage divided by that middle reading."),
      f("sample_years", "years", "Calendar years behind the middle reading."),
      f("covers_full_period", "true or false",
        "False when the reservoir is newer than the period."),
      f("first_obs", "date", "First reading used for this comparison.")
    ]}
];

export const SNOW_GROUPS: readonly ApiFieldGroup[] = [
  { id: "snow-header", title: "File header", path: "root", fields: [
    f("schema_version", "version number", "Version of this JSON structure."),
    f("generated_at", "date and time", "Time the file was generated."),
    f("as_of", "date", "Newest date requested from the provider."),
    f("water_year", "year", "Water year represented by the series."),
    f("normal_period", "object", "Standard climate comparison period."),
    f("units", "text", "Storage unit used by each site series."),
    f("site_series_fields", "array", "Meaning and order of values in each compact site-series row."),
    f("subregions", "array",
      "Names of the larger drainage areas the sites fall in, for a reader " +
      "who asks for that grouping. Codes are the first four digits of each " +
      "site's own drainage-area code."),
    f("series_dates", "array", "The water-year calendar the sites index into, ascending, written once."),
    f("source", "web address", "Provider service address."),
    f("site_count", "sites", "Number of published monitoring sites."),
    f("late_site_count", "sites", "Number of sites with late readings."),
    f("missing_site_count", "sites", "Number of inventory sites that published nothing today and are absent from this file. Files written before this field was recorded omit it.", true),
    f("rollups", "array", "Daily drainage-area summaries."),
    f("sites", "array", "Site details and daily series.")
  ]},
  { id: "snow-period", title: "Climate comparison period", path: "normal_period", fields: [
    f("start_year", "year", "First year in the standard comparison period."),
    f("end_year", "year", "Last year in the standard comparison period.")
  ]},
  { id: "snow-rollup", title: "Drainage-area summary", path: "rollups[]", fields: [
    f("huc6", "identifier", "Six-digit drainage-area code."),
    f("huc6_name", "text", "Six-digit drainage-area name."),
    f("site_count", "sites", "Verified sites assigned to the area."),
    f("minimum_reporting_sites", "sites", "Minimum reporting sites needed for a daily value."),
    f("series", "array", "Daily drainage-area values.")
  ]},
  { id: "snow-rollup-series", title: "Drainage-area daily entry", path: "rollups[].series[]", fields: [
    f("date", "date", "Observation date."),
    f("reporting_site_count", "sites", "Sites contributing to the date."),
    f("mean_percent_of_normal_median", "percent", "Average of site percentages against their standard normal values.")
  ]},
  { id: "snow-site", title: "Monitoring-site record", path: "sites[]", fields: [
    f("station", "identifier", "Provider station identifier."),
    f("name", "text", "Station name."),
    f("state", "postal code", "State containing the station."),
    f("county", "text", "County containing the station."),
    f("lat", "decimal degrees", "Station latitude."),
    f("lon", "decimal degrees", "Station longitude."),
    f("elevation_feet", "feet", "Station elevation."),
    f("begins", "date", "First date in the station record."),
    f("huc6", "identifier", "Verified six-digit drainage-area code."),
    f("huc6_name", "text", "Verified six-digit drainage-area name."),
    f("provider_huc6", "identifier", "Drainage-area code reported by the provider."),
    f("latest_date", "date", "Newest published site reading."),
    f("late", "true or false", "Whether the newest reading is late."),
    f("normal_timing", "object", "Usual snow onset, high point and melt-out dates."),
    f("series_days", "array", "Positions in series_dates this site published."),
    f("series_values", "array", "Measured snow water equivalent, in inches, one per entry in series_days."),
    f("series_normals", "array", "Standard normal median, in inches, one per entry in series_days.")
  ]},
  { id: "snow-timing", title: "Normal timing", path: "sites[].normal_timing", fields: [
    f("peak", "object", "Usual high point: month, day and inches."),
    f("onset", "object", "Usual start: month and day."),
    f("meltout", "object", "Usual melt-out: month and day.")
  ]},
  { id: "snow-peak", title: "Normal high point", path: "sites[].normal_timing.peak", fields: [
    f("month", "month number", "Usual month of the high value."),
    f("day", "day number", "Usual day of the high value."),
    f("value", "inches", "Usual high snow water equivalent.")
  ]},
  { id: "snow-date", title: "Normal onset or melt-out date", path: "sites[].normal_timing.onset or meltout", fields: [
    f("month", "month number", "Usual month."),
    f("day", "day number", "Usual day.")
  ]}
];

export const DROUGHT_GROUPS: readonly ApiFieldGroup[] = [
  { id: "drought-header", title: "File header", path: "root", fields: [
    f("schema_version", "version number", "Version of this JSON structure."),
    f("map_date", "date", "The week the drought map describes."),
    f("release_date", "date", "The Thursday the map was published."),
    f("source", "web address", "Provider service address."),
    f("attribution", "text", "Credit statement for the drought map."),
    f("method", "object", "How the area shares were calculated."),
    f("level", "digits", "Size of the drainage areas, as the length of their code."),
    f("unit_count", "areas", "Number of published drainage areas."),
    f("units", "array", "Per-drainage-area shares."),
    f("previous", "object",
      "The week before this one, or null for the first week kept.", true)
  ]},
  { id: "drought-previous", title: "The week before this one",
    path: "previous", fields: [
      f("map_date", "date", "The week that earlier map describes."),
      f("release_date", "date", "The Thursday it was published."),
      f("units", "array",
        "Per-drainage-area shares for that week, cumulative only.")
    ]},
  { id: "drought-method", title: "Calculation method", path: "method", fields: [
    f("sampling", "text", "How points were placed over each area."),
    f("grid_step_degrees", "decimal degrees", "Distance between sampled points."),
    f("weighting", "text", "How each point's land area was weighted."),
    f("classes", "text", "How the drought classes relate to each other.")
  ]},
  { id: "drought-unit", title: "Drainage-area record", path: "units[]", fields: [
    f("huc6", "identifier",
      "Six-digit drainage-area code. Present in the file at that level.", true),
    f("huc6_name", "text", "Six-digit drainage-area name.", true),
    f("huc4", "identifier",
      "Four-digit drainage-area code. Present in the file at that level.", true),
    f("huc4_name", "text", "Four-digit drainage-area name.", true),
    f("percent_of_area", "object",
      "Share of the measured land in exactly each class. " +
      "Absent when the drought monitor measures none of the area.", true),
    f("percent_of_area_at_least", "object",
      "Share of the measured land in each class or worse. " +
      "Absent when the drought monitor measures none of the area.", true),
    f("measured", "object",
      "How much of the drainage area the shares above cover. " +
      "Absent when the drought monitor measures all of it.", true)
  ]},
  { id: "drought-measured", title: "Measured share of the area",
    path: "units[].measured", fields: [
      f("percent_of_area", "percent",
        "Share of the whole drainage area the drought monitor covers. " +
        "Kept apart from the class shares above, which divide by the " +
        "measured land: the two have different denominators and must not " +
        "be added or subtracted."),
      f("basis", "text", "What the measured land is.")
    ]},
  { id: "drought-shares", title: "Share in exactly each class",
    path: "units[].percent_of_area", fields: [
      f("none", "percent", "Land in no drought class."),
      f("d0", "percent", "Land that is abnormally dry (D0)."),
      f("d1", "percent", "Land in moderate drought (D1)."),
      f("d2", "percent", "Land in severe drought (D2)."),
      f("d3", "percent", "Land in extreme drought (D3)."),
      f("d4", "percent", "Land in exceptional drought (D4).")
    ]},
  { id: "drought-at-least", title: "Share in each class or worse",
    path: "units[].percent_of_area_at_least", fields: [
      f("d0", "percent", "Land that is abnormally dry or worse."),
      f("d1", "percent", "Land in moderate drought or worse."),
      f("d2", "percent", "Land in severe drought or worse."),
      f("d3", "percent", "Land in extreme drought or worse."),
      f("d4", "percent", "Land in exceptional drought.")
    ]}
];

export const REFERENCE_GROUPS: readonly ApiFieldGroup[] = [
  { id: "reference-header", title: "File header", path: "root", fields: [
    f("capacity_catalog", "object", "Reviewed full levels and dam-point evidence."),
    f("geography", "object", "Drainage-area boundary collections."),
    f("schema_version", "version number", "Version of this JSON structure.")
  ]},
  { id: "reference-capacity", title: "Capacity catalog", path: "capacity_catalog", fields: [
    f("capacities", "object",
      "Station-id map of reviewed capacity entries. Keyed by the same " +
      "identifier each reservoir record publishes as source_station_id, " +
      "because two reservoirs may share a name."),
    f("keyed_by", "field name", "Which identifier the capacity map is keyed by."),
    f("admitted_reservoirs", "file name", "Reviewed admitted-reservoir source file."),
    f("dam_points", "object", "Summary of reviewed dam coordinates."),
    f("denominator", "text", "Rule used to choose the published full level."),
    f("note", "text", "Capacity review warning."),
    f("retrieved", "date", "Date the inventory records were retrieved."),
    f("source", "text", "Capacity publisher."),
    f("source_layer", "web address", "Capacity source layer."),
    f("unmatched", "array", "Inventory names that could not be matched.")
  ]},
  { id: "reference-capacity-entry", title: "Capacity entry", path: "capacity_catalog.capacities.<station id>", fields: [
    f("name", "text", "What this reservoir is called."),
    f("capacity_af", "acre-feet", "Selected full level used by the dashboard."),
    f("capacity_basis", "identifier", "Inventory field selected as the full level."),
    f("dam_lat", "decimal degrees", "Reviewed dam latitude."),
    f("dam_lon", "decimal degrees", "Reviewed dam longitude."),
    f("max_storage_af", "acre-feet", "Inventory maximum-storage value."),
    f("nid_dam_name", "text", "Dam name in the National Inventory of Dams."),
    f("nid_id", "identifier", "National Inventory of Dams identifier."),
    f("nid_storage_af", "acre-feet", "Inventory storage value."),
    f("normal_storage_af", "acre-feet", "Inventory normal-storage value.")
  ]},
  { id: "reference-dam-points", title: "Dam-point summary", path: "capacity_catalog.dam_points", fields: [
    f("count", "dams", "Reviewed dam-point count."),
    f("note", "text", "How dam points are used."),
    f("source", "web address", "Dam-point source layer.")
  ]},
  { id: "reference-geography", title: "Geography", path: "geography", fields: [
    f("watersheds", "object", "Named drainage-area scopes.")
  ]},
  { id: "reference-watersheds", title: "Drainage-area scopes", path: "geography.watersheds", fields: [
    f("default_scope", "identifier", "Scope the maps draw."),
    f("roster_scope", "identifier", "Scope the reservoir roster covers."),
    f("drawn_scopes", "object",
      "Scope drawn at each area size a reader may choose, keyed by the length of its codes."),
    f("scopes", "object", "Named scope entries.")
  ]},
  { id: "reference-scope", title: "Named scope", path: "geography.watersheds.scopes.<scope>", fields: [
    f("description", "text", "Scope inclusion rule."),
    f("huc6", "array",
      "Six-digit drainage-area codes. Present in a scope at that level.", true),
    f("huc4", "array",
      "Four-digit drainage-area codes. Present in a scope at that level.", true),
    f("huc2", "array",
      "Two-digit region codes. Present in a scope at that level.", true),
    f("name", "identifier", "Stable scope name."),
    f("source_file", "file name", "Reviewed boundary source file."),
    f("level", "digits", "Size of the drainage areas, as the length of their code."),
    f("unit_count", "drainage areas", "Number of units in the scope."),
    f("units", "array", "Drainage areas in the scope, by code, name and opening box.")
  ]},
  { id: "reference-scope-unit", title: "Drainage area", path: "geography.watersheds.scopes.<scope>.units[]", fields: [
    f("huc6", "identifier",
      "Six-digit drainage-area code. Present in a scope at that level.", true),
    f("huc4", "identifier",
      "Four-digit drainage-area code. Present in a scope at that level.", true),
    f("huc2", "identifier",
      "Two-digit region code. Present in a scope at that level.", true),
    f("name", "text", "Drainage-area name."),
    f("states", "text", "States touched by the drainage area."),
    f("bbox", "decimal degrees",
      "The edges of a box a map can open on to show this drainage area: west, south, east and north, in that order.")
  ]},
];
