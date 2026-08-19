/* The readiness signal both production map pages already publish, extended
 * to the modern shell. The browser smoke test reads it: a page that loads,
 * paints a basemap and draws no reservoirs at all looks fine in a
 * screenshot, and only a counted field catches it.
 *
 * Every field reports one fact, and fields are added, never removed. */
interface DashboardReady {
  engine: string;
  /** How finely the ground is divided, as the reader chose it (ADR-064).
   * `drainageLevel` is the same number by a different route -- what the map
   * drew -- and stays its own field. */
  level?: number;
  /** How many levels the reference export offers. One means the control is
   * absent because there is nothing to choose. */
  levelsOffered?: number;
  /** Reservoirs in the connected scope, as the data provided them. */
  reservoirs: number;
  /** Reservoirs the map actually drew. */
  drawn: number;
  /** Symbols the reservoir renderer holds. One per feature by construction:
   * a smaller number means the renderer dropped some and drew an
   * approximation of the class table rather than the table. */
  symbols: number;
  /** True while the reservoir layer is carrying its names. Not `drawn`: a
   * layer draws its points whether or not it labels them. */
  reservoirLabels: boolean;
  late: number;
  basemap: boolean;
  basemapDegraded: boolean;
  /** Basemap reference layers moved below this project's own layers. A
   * basemap's reference stack draws above every operational layer, so this
   * is what keeps a borrowed boundary off the reservoirs. */
  basemapReferenceSunk: number;
  masked: boolean;
  boundaryPoints: number;
  drainageAreas: number;
  /** Drainage-area names configured, one per area. */
  drainageLabels: number;
  /** True while drainage-area text this map placed itself is below the
   * reservoir symbols. False once the label engine places the names, which
   * draws them in its own pass above every layer -- see ADR-047. */
  drainageLabelsUnderReservoirs: boolean;
  /** True while the drainage names are placed by the label engine, which
   * drops a name it cannot fit rather than stacking it on its neighbour.
   * The guarantee that replaced fixed placement at western scale. */
  drainageLabelsDeconflicted: boolean;
  /** How big the drawn drainage areas are, as the length of their code.
   * Read from the published scope rather than assumed, so a scope change
   * that quietly drew the wrong size has somewhere to show up. One surface
   * reports it because all three read the same payload; a second field would
   * be a second assertion about one fact. */
  drainageLevel: number;
  /** The drainage area the filter is narrowed to, or null for every area.
   * Not `drainageAreas`, which counts the boundaries the map drew. */
  areaFilter: string | null;
  /** The period the details panel is currently measuring against. One fact:
   * what the reader would see, not what the payload prefers. */
  baseline: string;
  /** Periods the baseline control offers. Fewer than two hides it. */
  baselineChoices: number;
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
  /** Bars the ranking chart in the bottom row is holding. Not `tableRows`:
   * the chart leaves out a reservoir with no readable percentage, and it is
   * 0 until the reader first opens the row, which is what builds it. */
  rankingBars: number;
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
    /** Lake Mead's own control, reported beside Powell's (ADR-062). */
    lakeMeadExcluded: boolean;
    /* The weekly digest, added once its two extra fetches have settled one
     * way or the other. Optional because the charts publish this signal
     * before the digest has run, and a reader gets the charts either way.
     * `lines` as well as `sections`: a section that renders its heading and
     * no sentences is the failure a section count cannot see. */
    weeklySections?: number;
    weeklyLines?: number;
  };
  /** The snowpack view finished drawing. `sites` and `basins` are what the
   * payload provided; `tableRows` and `curvePoints` are what the page
   * actually rendered, which is what catches a page that loads its data and
   * draws none of it. `area` is the drainage-area narrowing, or null for the
   * whole region. */
  __snowReady?: {
    /** How finely the ground is divided on this page (ADR-064). */
    level?: number;
    /** How many levels the reference export offers. */
    levelsOffered?: number;
    sites: number;
    late: number;
    basins: number;
    curvePoints: number;
    tableRows: number;
    area: string | null;
    /* The map half, present once the map module has resolved. Added fields,
     * never replacements: the page's figures are complete without a map. */
    mapBasins?: number;
    mapSites?: number;
    /** Basins and sites holding a class colour on the shown day. */
    mapBasinsWithValues?: number;
    mapSitesWithValues?: number;
    mapDay?: string | null;
    mapBasemap?: boolean;
    mapViewReady?: boolean;
    /** Classes in the snow colour table. The legend draws one chip for each,
     * plus one for a day with no fair value. */
    mapClasses?: number;
    /** The measurement site whose season is open, or null for none. */
    site?: string | null;
    /** Days the open site's curve drew. 0 while no site is chosen. */
    siteCurvePoints?: number;
    /** The drainage area whose season card is open, or null for none.
     * Separate from `area`, which is the page-wide filter. */
    basin?: string | null;
    /** Days the open area's curve drew. 0 while no area is chosen. */
    basinCurvePoints?: number;
    /** Drainage areas carrying their name on the map, placed by the label
     * engine (ADR-047). */
    mapBasinLabels?: number;
    mapBasinLabelsDeconflicted?: boolean;
  };
  /** The drought view finished drawing. `units` is what the coverage file
   * provided; `rows` is what the page rendered; `storageJoined` counts the
   * areas whose reservoir context arrived, 0 when that payload failed. */
  __droughtReady?: {
    units: number;
    rows: number;
    /** How finely the ground is divided on this page: the digit count of the
     * codes every figure here is keyed at (ADR-064). */
    level?: number;
    /** How many levels the reference export offers. One means the control is
     * absent because there is nothing to choose. */
    levelsOffered?: number;
    worstClass: string | null;
    mapDate: string;
    daysOld: number;
    lateData: boolean;
    storageJoined: number;
    /** The drought class the reader narrowed to, or null for every area.
     * Not `units`, which counts what the file carried. */
    severityFilter?: string | null;
    /** The order the areas are listed in. */
    sort?: string;
    /** Areas plotted on the storage-against-drought chart. Fewer than `rows`
     * when an area in view has no reservoir reading to compare against. */
    scatterPoints?: number;
    /** Drainage areas carrying their name on the map. Every area in scope
     * since ADR-047 -- which of them fit is the label engine's answer, per
     * frame, and not a fact a readiness field can hold. */
    mapAreaLabels?: number;
    /** True while those names are placed by the label engine rather than at
     * fixed points (ADR-047). */
    mapAreaLabelsDeconflicted?: boolean;
    /** Rows in the ranked comparison: areas that have a reservoir reading. */
    gapRows?: number;
    /** Areas counted by the severity distribution: every published area. */
    severityAreas?: number;
    /* The map half, present once the map module has resolved or failed.
     * Added fields, never replacements. */
    /** Intensity classes the weekly file carried and the map drew. */
    mapClassesDrawn?: number;
    /** Drainage-area outlines drawn over the polygons. */
    mapOutlines?: number;
    /** Reservoirs drawn on the drought map for reference. They carry no
     * storage colour: the monitor's palette owns this map. */
    mapReservoirs?: number;
    /** True while those reference reservoirs are carrying their names. */
    mapReservoirLabels?: boolean;
    /** True when the hosted state boundaries answered and were drawn.
     * False is a supported outcome: they are optional context. */
    mapStateBoundaries?: boolean;
    /** True when the hosted county boundaries answered. They stay hidden
     * until the reader zooms in, so this is about the layer, not the view. */
    mapCountyBoundaries?: boolean;
    mapBasemap?: boolean;
    mapViewReady?: boolean;
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
