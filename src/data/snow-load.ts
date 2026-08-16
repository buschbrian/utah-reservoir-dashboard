import type { SnowpackPayload } from "../types";
import { fetchWithin } from "./fetch";
import { validateSnowpackPayload } from "./snow-validate";

/*
 * The snow payload carries a full water year of daily values for every site,
 * about seven times the reservoir file. The reservoir deadline is sized for
 * that smaller file, so this one waits longer before declaring the fetch
 * dead -- but it still has a deadline, because a spinner that cannot resolve
 * is an error the reader is not being told about.
 */
export const SNOW_TIMEOUT_MS = 30000;

export async function loadSnowpack(
  url = import.meta.env.DEV ? "./snowpack.json" : "./data/snowpack.json"
): Promise<SnowpackPayload> {
  const response = await fetchWithin(url, SNOW_TIMEOUT_MS);
  return validateSnowpackPayload(await response.json() as unknown);
}
