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
  /** Drainage-area background text symbols, one per area. */
  drainageLabels: number;
  /** True while drainage-area text is below the reservoir symbols. */
  drainageLabelsUnderReservoirs: boolean;
  /** The drainage area the filter is narrowed to, or null for every area.
   * Not `drainageAreas`, which counts the boundaries the map drew. */
  areaFilter: string | null;
  listItems: number;
  /** True when the reader has narrowed the map with the analysis controls. */
  filtered: boolean;
  /** Reservoirs the current filter includes. The rest stay on the map, greyed. */
  shown: number;
  /** True while the selection ring is drawn over the reservoirs, on the
   * first draw and on every redraw the scope control causes. */
  selectionOnTop: boolean;
  /** Rows the table under the map is holding. Not `shown`: that counts what
   * the map effect includes, and the two surfaces answer separately. */
  tableRows: number;
  /** The table's order, as the column and the direction it is sorted by. */
  tableSort: string;
  /** True while the reader has the table open under the map. */
  tableOpen: boolean;
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
  /* The methods page settles whether or not the payload can be read: the
   * rules on it do not depend on the data. This reports that it finished,
   * which is the fact a test needs to know the page is not still waiting. */
  __methodsReady?: { published: boolean };
  /** The public data page rendered its three file cards and every field
   * group. These counts distinguish a loaded shell from complete reference
   * documentation. */
  __dataDocsReady?: { files: number; groups: number };
}
