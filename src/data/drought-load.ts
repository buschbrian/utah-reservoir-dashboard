import type { DroughtCoveragePayload } from "../types";
import { fetchWithin } from "./fetch";
import { validateDroughtCoverage } from "./drought-validate";

/* One path for both modes: the analysis tool writes into `data/drought/`,
 * and the build copies that directory verbatim, so the development and the
 * published URL are the same string. */
export async function loadDroughtCoverage(
  url = "./data/drought/usdm-huc6.json"
): Promise<DroughtCoveragePayload> {
  const response = await fetchWithin(url);
  return validateDroughtCoverage(await response.json() as unknown);
}
