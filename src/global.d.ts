/* The readiness signal both production map pages already publish, extended
 * to the modern shell. The browser smoke test reads it: a page that loads,
 * paints a basemap and draws no reservoirs at all looks fine in a
 * screenshot, and only a counted field catches it.
 *
 * Every field reports one fact, and fields are added, never removed. */
interface DashboardReady {
  engine: string;
  /** Reservoirs in the connected scope, as the data provided them. */
  reservoirs: number;
  /** Reservoirs the map actually drew. */
  drawn: number;
  late: number;
  basemap: boolean;
  basemapDegraded: boolean;
  masked: boolean;
  boundaryPoints: number;
  drainageAreas: number;
  listItems: number;
  selected: string | null;
}

interface Window {
  __dashboardReady?: DashboardReady;
}
