import type { ReservoirPayload, UpstreamIndex } from "../types";
import { fetchWithin } from "./fetch";
import { validateReservoirPayload, validateUpstreamIndex } from "./validate";

export async function loadReservoirs(
  url = import.meta.env.DEV ? "./reservoirs.json" : "./data/reservoirs.json"
): Promise<ReservoirPayload> {
  const response = await fetchWithin(url);
  return validateReservoirPayload(await response.json() as unknown);
}

export async function loadUpstreamIndex(
  url = import.meta.env.DEV
    ? "./upstream_index.json"
    : "./data/upstream_index.json"
): Promise<UpstreamIndex> {
  const response = await fetchWithin(url);
  return validateUpstreamIndex(await response.json() as unknown);
}
