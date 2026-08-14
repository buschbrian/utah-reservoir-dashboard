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
  /** Symbols the reservoir renderer holds. One per feature by construction:
   * a smaller number means the renderer dropped some and drew an
   * approximation of the class table rather than the table. */
  symbols: number;
  late: number;
  basemap: boolean;
  basemapDegraded: boolean;
  masked: boolean;
  boundaryPoints: number;
  drainageAreas: number;
  /** The drainage area the filter is narrowed to, or null for every area.
   * Not `drainageAreas`, which counts the boundaries the map drew. */
  areaFilter: string | null;
  listItems: number;
  /** True when the reader has narrowed the map with the analysis controls. */
  filtered: boolean;
  /** Reservoirs the current filter includes. The rest stay on the map, greyed. */
  shown: number;
  /** True when the map refuses to navigate outside the region. */
  navigationBounds: boolean;
  /** The closest the reader is allowed to zoom out. */
  minZoom: number;
  /** The reservoir a shared link asked for, once resolved against the scope. */
  deepLink: string | null;
  /** Whether Lake Powell is in scope: a comparison control, not a filter. */
  lakePowell: "include" | "exclude";
  /** Utah waterbodies, or every connected reservoir (ADR-011). */
  geography: "utah" | "connected";
  /** How many months the slider offers besides the newest reading. */
  months: number;
  /** The month on screen, or null while the map shows the newest reading. */
  month: string | null;
  selected: string | null;
}

interface Window {
  __dashboardReady?: DashboardReady;
  __overviewReady?: {
    reservoirs: number;
    visible: number;
    charts: number;
    lakePowellExcluded: boolean;
  };
}
