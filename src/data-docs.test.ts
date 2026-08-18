import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DROUGHT_GROUPS,
  REFERENCE_GROUPS,
  RESERVOIR_GROUPS,
  SNOW_GROUPS,
  type ApiFieldGroup
} from "./data-docs-schema";

const read = (file: string): Record<string, any> => JSON.parse(
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
) as Record<string, any>;

function group(groups: readonly ApiFieldGroup[], id: string): ApiFieldGroup {
  const found = groups.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing documentation group ${id}`);
  return found;
}

function expectFields(
  groups: readonly ApiFieldGroup[], id: string, value: Record<string, unknown>
): void {
  const docs = group(groups, id).fields;
  const documented = new Set(docs.map((field) => field.key));
  const actual = new Set(Object.keys(value));
  const undocumented = [...actual].filter((key) => !documented.has(key));
  const absent = docs.filter((field) => !field.optional && !actual.has(field.key))
    .map((field) => field.key);
  expect(undocumented, `${id} has undocumented fields`).toEqual([]);
  expect(absent, `${id} documents fields the payload does not emit`).toEqual([]);
}

function merged(records: Record<string, unknown>[]): Record<string, unknown> {
  return Object.assign({}, ...records);
}

describe("public API field documentation", () => {
  it("covers every current reservoir field", () => {
    const data = read("reservoirs.json");
    expectFields(RESERVOIR_GROUPS, "reservoir-header", data);
    expect(group(RESERVOIR_GROUPS, "reservoir-normal-period").fields.map((field) => field.key))
      .toEqual(["start_year", "end_year"]);
    expectFields(RESERVOIR_GROUPS, "reservoir-schedules", data.stale_after_days_by_cadence);
    expectFields(RESERVOIR_GROUPS, "reservoir-source", data.sources[0]);
    expectFields(RESERVOIR_GROUPS, "reservoir-source-counts", data.source_counts);
    expectFields(RESERVOIR_GROUPS, "reservoir-watersheds", data.watersheds);
    expectFields(RESERVOIR_GROUPS, "reservoir-record", merged(data.reservoirs));
    expectFields(RESERVOIR_GROUPS, "reservoir-month",
      merged(data.reservoirs.flatMap((record: Record<string, any>) => record.monthly)));
  });

  it("covers every current snow field", () => {
    const data = read("snowpack.json");
    expectFields(SNOW_GROUPS, "snow-header", data);
    expectFields(SNOW_GROUPS, "snow-period", data.normal_period);
    expectFields(SNOW_GROUPS, "snow-rollup", data.rollups[0]);
    expectFields(SNOW_GROUPS, "snow-rollup-series", data.rollups[0].series[0]);
    expectFields(SNOW_GROUPS, "snow-site", merged(data.sites));
    expectFields(SNOW_GROUPS, "snow-timing",
      merged(data.sites.map((site: Record<string, any>) => site.normal_timing)));
    expectFields(SNOW_GROUPS, "snow-peak",
      merged(data.sites.map((site: Record<string, any>) => site.normal_timing.peak)));
    expectFields(SNOW_GROUPS, "snow-date", merged(data.sites.flatMap(
      (site: Record<string, any>) => [site.normal_timing.onset, site.normal_timing.meltout])));
    /* The three columns are parallel, so the check that matters is that they
     * stay the same length as one another -- a documented column that is
     * shorter than its neighbours rebuilds into a shorter series, which
     * draws a complete and plausible curve for the wrong days. */
    for (const site of data.sites as Record<string, any>[]) {
      expect(site.series_values.length).toBe(site.series_days.length);
      expect(site.series_normals.length).toBe(site.series_days.length);
    }
  });

  it("covers every current reference field", () => {
    const data = read("reference.json");
    const catalog = data.capacity_catalog;
    const state = data.geography.state;
    const scopes = Object.values(data.geography.watersheds.scopes) as Record<string, any>[];
    const scope = scopes[0];
    if (!scope) throw new Error("reference data has no named drainage-area scope");
    const stateFeature = state.features[0];
    expectFields(REFERENCE_GROUPS, "reference-header", data);
    expectFields(REFERENCE_GROUPS, "reference-capacity", catalog);
    expectFields(REFERENCE_GROUPS, "reference-capacity-entry", Object.values(catalog.capacities)[0] as Record<string, unknown>);
    expectFields(REFERENCE_GROUPS, "reference-dam-points", catalog.dam_points);
    expectFields(REFERENCE_GROUPS, "reference-geography", data.geography);
    expectFields(REFERENCE_GROUPS, "reference-state", state);
    expectFields(REFERENCE_GROUPS, "reference-watersheds", data.geography.watersheds);
    expectFields(REFERENCE_GROUPS, "reference-scope", scope);
    expectFields(REFERENCE_GROUPS, "reference-geojson-collection", {
      type: state.type, features: state.features
    });
    // Each scope checked alone: a field missing from one scope must not be
    // hidden by another scope that still carries it.
    for (const entry of scopes) {
      expectFields(REFERENCE_GROUPS, "reference-scope-unit", entry.units[0]);
    }
    expectFields(REFERENCE_GROUPS, "reference-geojson", stateFeature);
    expectFields(REFERENCE_GROUPS, "reference-geometry", stateFeature.geometry);
    expectFields(REFERENCE_GROUPS, "reference-state-properties", stateFeature.properties);
  });

  it("covers every current drought coverage field", () => {
    const data = read("data/drought/usdm-huc6.json");
    expectFields(DROUGHT_GROUPS, "drought-header", data);
    expectFields(DROUGHT_GROUPS, "drought-method", data.method);
    expectFields(DROUGHT_GROUPS, "drought-unit", merged(data.units));
    expectFields(DROUGHT_GROUPS, "drought-shares",
      merged(data.units.map((unit: Record<string, any>) => unit.percent_of_area)));
    expectFields(DROUGHT_GROUPS, "drought-at-least",
      merged(data.units.map((unit: Record<string, any>) => unit.percent_of_area_at_least)));
  });

  it("keeps API explanations in plain language", () => {
    const prose = [...RESERVOIR_GROUPS, ...SNOW_GROUPS, ...DROUGHT_GROUPS, ...REFERENCE_GROUPS]
      .flatMap((section) => [section.title,
        ...section.fields.flatMap((field) => [field.units, field.meaning])])
      .join(" ");
    expect(prose).not.toMatch(/\baf\b|period-of-record|seasonal percentile|\bRISE\b|\bAWDB\b|\bstale\b/i);
  });
});
