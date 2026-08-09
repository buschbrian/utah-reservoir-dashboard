import type { ReservoirPayload } from "../types";
import { validateReservoirPayload } from "./validate";

export async function loadReservoirs(
  url = import.meta.env.DEV ? "./reservoirs.json" : "./data/reservoirs.json"
): Promise<ReservoirPayload> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
  return validateReservoirPayload(await response.json() as unknown);
}
