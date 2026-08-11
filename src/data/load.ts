import type { ReservoirPayload } from "../types";
import { fetchWithin } from "./fetch";
import { validateReservoirPayload } from "./validate";

export async function loadReservoirs(
  url = import.meta.env.DEV ? "./reservoirs.json" : "./data/reservoirs.json"
): Promise<ReservoirPayload> {
  const response = await fetchWithin(url);
  return validateReservoirPayload(await response.json() as unknown);
}
