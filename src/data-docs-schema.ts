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
    f("stale_after_days", "days", "Default number of days allowed before a daily reading is late."),
    f("stale_after_days_by_cadence", "object", "Late-data limits for each update schedule."),
    f("source", "text", "Short description of the storage providers."),
    f("sources", "array", "Provider descriptions used by the reservoir records."),
    f("source_counts", "object", "Number of reservoir records from each provider."),
    f("reservoir_count", "reservoirs", "Number of records in the reservoirs array."),
    f("stale_count", "reservoirs", "Number of records with late data."),
    f("capacity_count", "reservoirs", "Number of records with a traced full level."),
    f("watersheds", "object", "Summary of drainage-area assignment coverage."),
    f("reservoirs", "array", "Current storage records and 12-month histories.")
  ]},
  { id: "reservoir-normal-period", title: "Weekly comparison period", path: "normal_period", fields: [
    f("start_year", "year", "First year that can support the weekly comparison."),
    f("end_year", "year", "Last year that can support the weekly comparison.")
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
  { id: "reservoir-watersheds", title: "Drainage-area summary", path: "watersheds", fields: [
    f("source", "text", "Boundary publisher and unit level."),
    f("boundaries", "file name", "Boundary file used for assignment."),
    f("assignment_rule", "text", "Point used to place a reservoir in a drainage area."),
    f("unit_count", "drainage areas", "Number of published six-digit drainage areas."),
    f("assigned", "reservoirs", "Records with a drainage-area assignment."),
    f("unassigned", "reservoirs", "Records without an assignment."),
    f("assigned_by_dam", "reservoirs", "Assignments made from a reviewed dam or outlet point."),
    f("in_utah", "reservoirs", "Records whose provider point is in Utah."),
    f("intersects_utah", "reservoirs", "Records whose reviewed waterbody reaches Utah.")
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
    f("huc_assignment_source", "text", "Evidence used for the assignment point.")
  ]},
  { id: "reservoir-month", title: "Monthly history entry", path: "reservoirs[].monthly[]", fields: [
    f("month", "year and month", "Month represented by the entry."),
    f("mean_af", "acre-feet", "Average storage during the month."),
    f("min_af", "acre-feet", "Lowest storage during the month."),
    f("max_af", "acre-feet", "Highest storage during the month."),
    f("end_af", "acre-feet", "Last usable storage reading in the month."),
    f("days", "readings", "Number of readings in the monthly summary."),
    f("normal_af", "acre-feet", "Middle earlier-year value for the month.")
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
    f("source", "web address", "Provider service address."),
    f("site_count", "sites", "Number of published monitoring sites."),
    f("late_site_count", "sites", "Number of sites with late readings."),
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
    f("series", "array", "Compact daily rows ordered by site_series_fields.")
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
  ]},
  { id: "snow-site-series", title: "Compact site-series row", path: "sites[].series[]", fields: [
    f("0", "date", "Date, named by site_series_fields[0]."),
    f("1", "inches", "Measured snow water equivalent, named by site_series_fields[1]."),
    f("2", "inches", "Standard normal median, named by site_series_fields[2].")
  ]}
];

export const REFERENCE_GROUPS: readonly ApiFieldGroup[] = [
  { id: "reference-header", title: "File header", path: "root", fields: [
    f("capacity_catalog", "object", "Reviewed full levels and dam-point evidence."),
    f("geography", "object", "State and drainage-area boundary collections."),
    f("schema_version", "version number", "Version of this JSON structure.")
  ]},
  { id: "reference-capacity", title: "Capacity catalog", path: "capacity_catalog", fields: [
    f("capacities", "object", "Reservoir-name map of reviewed capacity entries."),
    f("connected_reservoirs", "file name", "Reviewed connected-reservoir source file."),
    f("dam_points", "object", "Summary of reviewed dam coordinates."),
    f("denominator", "text", "Rule used to choose the published full level."),
    f("note", "text", "Capacity review warning."),
    f("retrieved", "date", "Date the inventory records were retrieved."),
    f("source", "text", "Capacity publisher."),
    f("source_layer", "web address", "Capacity source layer."),
    f("unmatched", "array", "Inventory names that could not be matched.")
  ]},
  { id: "reference-capacity-entry", title: "Capacity entry", path: "capacity_catalog.capacities.<reservoir>", fields: [
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
    f("state", "GeoJSON collection", "Utah state boundary."),
    f("watersheds", "object", "Named drainage-area scopes.")
  ]},
  { id: "reference-state", title: "State boundary", path: "geography.state", fields: [
    f("feature_count", "features", "Number of state features."),
    f("features", "array", "GeoJSON state features."),
    f("source", "text", "Boundary publisher and source."),
    f("type", "text", "GeoJSON collection type.")
  ]},
  { id: "reference-watersheds", title: "Drainage-area scopes", path: "geography.watersheds", fields: [
    f("default_scope", "identifier", "Scope used by the dashboard."),
    f("scopes", "object", "Named scope entries.")
  ]},
  { id: "reference-scope", title: "Named scope", path: "geography.watersheds.scopes.<scope>", fields: [
    f("boundaries", "GeoJSON collection", "Generalized drainage-area polygons."),
    f("description", "text", "Scope inclusion rule."),
    f("huc6", "array", "Six-digit drainage-area codes."),
    f("name", "identifier", "Stable scope name."),
    f("source_file", "file name", "Reviewed boundary source file."),
    f("unit_count", "drainage areas", "Number of units in the scope.")
  ]},
  { id: "reference-geojson-collection", title: "GeoJSON collection", path: "all boundary collections", fields: [
    f("type", "text", "GeoJSON collection type."),
    f("features", "array", "Boundary features.")
  ]},
  { id: "reference-watershed-collection", title: "Drainage-area GeoJSON collection", path: "named scope boundaries", fields: [
    f("type", "text", "GeoJSON collection type."),
    f("features", "array", "Drainage-area boundary features."),
    f("filter", "text", "Hydrologic-region selection rule used to build the collection."),
    f("geometry", "object", "Coordinate system, precision and maximum offset used for this collection.", true),
    f("scope", "identifier", "Named drainage-area scope. Collections retrieved before this field was recorded omit it.", true),
    f("source", "text", "Boundary publisher and source."),
    f("unit_count", "drainage areas", "Number of features in the collection.")
  ]},
  { id: "reference-collection-geometry", title: "Collection geometry settings", path: "named scope boundaries.geometry", fields: [
    f("coordinate_decimal_places", "decimal places", "Number of coordinate decimal places requested from the source."),
    f("coordinate_system", "text", "Coordinate system used by the collection."),
    f("max_allowable_offset_degrees", "decimal degrees", "Largest coordinate offset allowed when the source simplifies the polygons.")
  ]},
  { id: "reference-geojson", title: "GeoJSON feature", path: "all boundary features", fields: [
    f("type", "text", "GeoJSON object type."),
    f("properties", "object", "Feature name and, for drainage areas, code and states."),
    f("geometry", "object", "Polygon or multipolygon type and coordinate arrays.")
  ]},
  { id: "reference-geometry", title: "GeoJSON geometry", path: "all boundary feature geometry", fields: [
    f("type", "text", "Polygon or multipolygon type."),
    f("coordinates", "decimal degrees", "Nested longitude and latitude coordinate arrays.")
  ]},
  { id: "reference-state-properties", title: "State feature properties", path: "geography.state.features[].properties", fields: [
    f("name", "text", "State name.")
  ]},
  { id: "reference-watershed-properties", title: "Drainage-area feature properties", path: "named scope boundaries[].properties", fields: [
    f("huc6", "identifier", "Six-digit drainage-area code."),
    f("name", "text", "Six-digit drainage-area name."),
    f("states", "text", "States touched by the drainage area.")
  ]}
];
