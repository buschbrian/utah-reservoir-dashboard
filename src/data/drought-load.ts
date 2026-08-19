import type { DroughtCoveragePayload } from "../types";
import { fetchWithin } from "./fetch";
import { validateDroughtCoverage } from "./drought-validate";

/* One path for both modes: the analysis tool writes into `data/drought/`,
 * and the build copies that directory verbatim, so the development and the
 * published URL are the same string. */
export function droughtCoverageUrl(level: number): string {
  return `./data/drought/usdm-huc${level}.json`;
}

/**
 * The week's coverage at one level.
 *
 * One file per offered level (ADR-064), computed from the same weekly
 * download, so changing level never moves a reader to another week -- the
 * pipeline checks every file against the polygons before either is committed.
 */
export async function loadDroughtCoverage(
  level = 6, url = droughtCoverageUrl(level)
): Promise<DroughtCoveragePayload> {
  const response = await fetchWithin(url);
  return validateDroughtCoverage(await response.json() as unknown);
}
