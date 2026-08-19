/* The committed payload, read from disk and put through the same validator
 * the browser uses. Test-only: the application fetches this file at runtime
 * and never imports it (ADR-002), and the deploy fails if it appears in the
 * bundle -- so this helper stays out of the module graph of `main.ts`.
 */
import { readFileSync } from "node:fs";
import type {
  DroughtCoveragePayload,
  ReservoirPayload,
  SnowpackPayload
} from "../types";
import { validateDroughtCoverage } from "./drought-validate";
import { validateSnowpackPayload } from "./snow-validate";
import { validateReservoirPayload } from "./validate";

export function readPayload(): ReservoirPayload {
  const source = readFileSync(new URL("../../reservoirs.json", import.meta.url), "utf8");
  return validateReservoirPayload(JSON.parse(source) as unknown);
}

/**
 * The payload shape readers could have cached before comparison metadata was
 * added. Keep constructing it even after the committed daily file gains the
 * fields, so optional-header compatibility cannot disappear with a refresh.
 */
export function readPayloadWithoutNormalMetadata(): ReservoirPayload {
  const source = readFileSync(new URL("../../reservoirs.json", import.meta.url), "utf8");
  const value = JSON.parse(source) as Record<string, unknown>;
  delete value.normal_period;
  delete value.normal_window_days;
  return validateReservoirPayload(value);
}

/** The committed snow payload, through the same validator the browser uses. */
export function readSnowpack(): SnowpackPayload {
  const source = readFileSync(new URL("../../snowpack.json", import.meta.url), "utf8");
  return validateSnowpackPayload(JSON.parse(source) as unknown);
}

/** The committed weekly drought coverage, through the browser's validator. */
export function readDroughtCoverage(): DroughtCoveragePayload {
  const source = readFileSync(
    new URL("../../data/drought/usdm-huc6.json", import.meta.url), "utf8");
  return validateDroughtCoverage(JSON.parse(source) as unknown);
}

/**
 * The committed boundaries of one named scope, found through the reference
 * export rather than by file name.
 *
 * Which file holds which geography is a product decision that has moved once
 * already (ADR-063) and will move again when the roster expands west. A test
 * naming `huc6.geojson` was reading the drawn scope until the day it was not,
 * and would have gone on passing against a geography nothing draws.
 */
function readScopeGeoJson(scope: string): unknown {
  const reference = readReferenceExport() as {
    geography: { watersheds: { scopes: Record<string, { source_file: string }> } };
  };
  const entry = reference.geography.watersheds.scopes[scope];
  if (!entry) throw new Error(`reference.json publishes no scope named ${scope}`);
  return JSON.parse(
    readFileSync(new URL(`../../${entry.source_file}`, import.meta.url), "utf8")) as unknown;
}

function namedScope(key: "default_scope" | "roster_scope"): string {
  const reference = readReferenceExport() as {
    geography: { watersheds: Record<string, unknown> };
  };
  const name = reference.geography.watersheds[key];
  if (typeof name !== "string") throw new Error(`reference.json names no ${key}`);
  return name;
}

/** The boundaries of the scope the maps draw: 75 basins across the west. */
export function readDrainageGeoJson(): unknown {
  return readScopeGeoJson(namedScope("default_scope"));
}

/**
 * The boundaries of the scope the reservoir roster was admitted from, which
 * is what the storage map opens on. A subset of the drawn scope, and the same
 * geometry area for area -- `tests/test_watershed_scopes.py` holds the two
 * files to that.
 */
export function readRosterDrainageGeoJson(): unknown {
  return readScopeGeoJson(namedScope("roster_scope"));
}

/** The committed reference export, as the pages receive it (ADR-018). */
export function readReferenceExport(): unknown {
  const source = readFileSync(new URL("../../reference.json", import.meta.url), "utf8");
  return JSON.parse(source) as unknown;
}
