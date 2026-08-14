/* The committed payload, read from disk and put through the same validator
 * the browser uses. Test-only: the application fetches this file at runtime
 * and never imports it (ADR-002), and the deploy fails if it appears in the
 * bundle -- so this helper stays out of the module graph of `main.ts`.
 */
import { readFileSync } from "node:fs";
import type { ReservoirPayload } from "../types";
import { validateReservoirPayload } from "./validate";

export function readPayload(): ReservoirPayload {
  const source = readFileSync(new URL("../../reservoirs.json", import.meta.url), "utf8");
  return validateReservoirPayload(JSON.parse(source) as unknown);
}

export function readDrainageGeoJson(): unknown {
  const source = readFileSync(new URL("../../huc6.geojson", import.meta.url), "utf8");
  return JSON.parse(source) as unknown;
}

export function readUtahBoundaryGeoJson(): unknown {
  const source = readFileSync(new URL("../../utah-boundary.geojson", import.meta.url), "utf8");
  return JSON.parse(source) as unknown;
}

/** The committed reference export, as the pages receive it (ADR-018). */
export function readReferenceExport(): unknown {
  const source = readFileSync(new URL("../../reference.json", import.meta.url), "utf8");
  return JSON.parse(source) as unknown;
}
