import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-navigation";

import { loadReservoirs } from "./data/load";
import { loadDroughtCoverage } from "./data/drought-load";
import { loadSnowpack } from "./data/snow-load";
import { weeklySummary } from "./weekly-model";
import { describeWeek } from "./viz/weekly-summary";
import { downloadCsv } from "./data/download";
import { overviewCsv, overviewCsvFilename } from "./data/export";
import {
  isLakeMead, isLakePowell, isLate, statewideRollup, WIDEST_SCOPE,
  type ReservoirGeography
} from "./data/rollup";
import { classIndexOf } from "./state/filters";
import {
  overviewStateFromSearch,
  writeOverviewUrl,
  type OverviewUrlState
} from "./state/overview-url";
import { STORAGE_CLASSES } from "./viz/classes";
import { contrastingTextColor } from "./viz/color";
import {
  distributionOverlayKey,
  renderArcgisBarChart,
  renderArcgisDistributionChart,
  renderArcgisNormalChart,
  renderArcgisSpreadChart,
  renderArcgisTrendChart,
  storageLegendEntries
} from "./overview-charts";
import {
  filterAndSort,
  filterOverview,
  distributionStats,
  largestReservoirRecords,
  monthlyTrend,
  normalComparison,
  overviewScope,
  percentFullValues,
  countyOptions,
  reservoirInState,
  stateOptions,
  subregionOf,
  subregionOptions,
  type FilterOption,
  watershedOptions,
  watershedRecords,
  type ChartMeasure,
  type ChartRank,
  type DistributionStats,
  type OverviewCadence,
  type OverviewSort
} from "./overview-model";
import type {
  DroughtCoveragePayload, Reservoir, SnowpackPayload
} from "./types";
import { brandMarkup, pageLinksMarkup, updatePageLinks } from "./ui/page-header";
import { THEME_CHANGE_EVENT, wireTheme } from "./ui/theme";
import { formatAcreFeet, formatDate, formatPercent } from "./viz/format";
import "./styles/overview.css";

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#overview-app");
if (!root) throw new Error("Missing #overview-app root");

root.innerHTML = `
  <calcite-navigation class="overview-nav" aria-label="Primary navigation">
    <!-- The brand is this page's only heading of the first rank. The page
         used to carry its own "Utah reservoir conditions" below the bar,
         which said the same thing twice at two sizes; with that gone the
         bar has to be the h1, or the page has none at all. The map shell
         has always done it this way. -->
    ${brandMarkup(1, "overview")}
    ${pageLinksMarkup("overview", window.location.search)}
    <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
      icon="brightness" label="Change color theme"></calcite-action>
  </calcite-navigation>
  <main class="overview-main">
    <header class="overview-intro">
      <p>Explore current storage for waterbodies that intersect Utah. Lake Powell is large enough to hide local conditions in a combined total, so it starts excluded and can be added back at any time.</p>
    </header>
    <section id="overview-content" aria-live="polite"><calcite-loader label="Loading reservoir data"></calcite-loader></section>
  </main>`;
wireTheme();

function renderRows(tbody: HTMLTableSectionElement, reservoirs: readonly Reservoir[]): void {
  tbody.replaceChildren(...reservoirs.map((reservoir) => {
    const row = document.createElement("tr");
    row.dataset.reservoir = reservoir.name;
    const cells = [reservoir.name, reservoir.huc6_name ?? "Not assigned",
      formatPercent(reservoir.pct_of_capacity), formatAcreFeet(reservoir.current_storage_af),
      formatAcreFeet(reservoir.capacity_af), formatDate(reservoir.as_of)];
    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 5 && isLate(reservoir)) cell.className = "late-badge";
      row.append(cell);
    });
    return row;
  }));
}

function updateKpis(reservoirs: readonly Reservoir[]): void {
  /* The rows handed in are already the scope the reader chose, so this must
   * not apply a second dominant-reservoir filter on top of it -- WIDEST_SCOPE
   * means "do not filter again", which is what makes the toggles work. */
  const rollup = statewideRollup(reservoirs, WIDEST_SCOPE);
  const signed = (value: number): string =>
    `${value >= 0 ? "+" : ""}${formatAcreFeet(value)}`;
  const values: Record<string, string> = {
    percent: formatPercent(rollup.percentFull),
    volume: `${formatAcreFeet(rollup.storageAf)} of ${formatAcreFeet(rollup.capacityAf)}`,
    count: String(rollup.count),
    /* How full against how full it usually is on this date. The headline
     * percentage cannot answer that on its own: a reservoir at 60% in April
     * and one at 60% in September are not the same news, and this is the
     * number a drought reader is actually looking for. */
    normal: formatPercent(rollup.percentOfNormal),
    "normal-note": rollup.normalCovers === rollup.count
      ? "Of the usual storage for this date"
      : `Of the usual storage for this date, for ${rollup.normalCovers} of ${rollup.count}`,
    year: signed(rollup.change365dAf),
    change: `30 days: ${signed(rollup.change30dAf)}`,
    late: String(rollup.stale)
  };
  for (const [name, value] of Object.entries(values)) {
    const element = document.querySelector<HTMLElement>(`[data-kpi="${name}"]`);
    if (element) element.textContent = value;
  }
}

async function renderOverview(
  allReservoirs: Reservoir[], generatedAt: string,
  subregions: readonly { huc4: string; name: string }[]
): Promise<void> {
  const content = document.querySelector<HTMLElement>("#overview-content");
  if (!content) return;
  // Built from the widest scope so the list of drainage areas does not
  // change shape when Lake Powell is toggled.
  const countyChoices = countyOptions(allReservoirs);
  const stateChoices = stateOptions(allReservoirs);
  const widestScope = overviewScope(allReservoirs, WIDEST_SCOPE);
  const watershedChoices = watershedOptions(widestScope);
  content.innerHTML = `
    <!-- Two rows, and each row is one kind of thing: what this section is
         and how to undo it, then the controls themselves. They used to share
         a single wrapping flex line, so the heading competed with the four
         selects for the same space and "Reset view" was pushed wherever
         the last control left room -- a different place at every width. -->
    <section class="overview-card weekly-card" id="weekly-summary"
      aria-labelledby="weekly-heading" aria-busy="true">
      <div class="card-heading">
        <div>
          <h2 id="weekly-heading">What moved this week</h2>
          <p>The last seven days, worked out from the same files the rest of this site draws. The storage figures follow the reservoirs the scope includes, so a change to the Lake Powell control changes them. The snow and drought figures describe the whole region and cannot follow a reservoir scope, which each of them says. Nothing here is a forecast.</p>
          <p class="weekly-scope" data-weekly="scope" role="status" aria-live="polite"></p>
        </div>
      </div>
      <div class="weekly-sections"></div>
    </section>
    <section class="dashboard-filterbar" aria-labelledby="filter-heading">
      <!-- Lake Powell rides with the heading rather than in the row of
           selects below it. It is not the same kind of question they are:
           they narrow the set the reader is studying, and this one decides
           whether a single reservoir big enough to move every headline
           number on the page is in the total at all. Sat fifth in the row
           it read as one more narrowing filter. -->
      <div class="filterbar-head">
        <div class="filterbar-title"><p class="eyebrow">Cross-filter dashboard</p><h2 id="filter-heading">Focus the analysis</h2></div>
        <div class="filterbar-head-actions">
          <label class="switch-label" for="lake-powell-toggle"><span>Include Lake Powell</span><input id="lake-powell-toggle" type="checkbox" role="switch" /></label>
          <label class="switch-label" for="lake-mead-toggle"><span>Include Lake Mead</span><input id="lake-mead-toggle" type="checkbox" role="switch" /></label>
          <button id="reset-filters" class="reset-button" type="button">Reset view</button>
        </div>
      </div>
      <div class="filterbar-controls">
        <label>Find a reservoir<input id="reservoir-search" type="search" placeholder="Name, drainage area or county" autocomplete="off" /></label>
        <label>State<select id="state-filter"><option value="all">All states</option></select></label>
        <label>Subregion<select id="subregion-filter"><option value="all">All subregions</option></select></label>
        <label>Drainage area<select id="watershed-filter"><option value="all">All drainage areas</option></select></label>
        <label id="county-field" hidden>County<select id="county-filter"><option value="all">All counties</option></select></label>
        <label>Reporting<select id="cadence-filter"><option value="all">All reporting</option><option value="daily">Daily</option><option value="monthly">Monthly</option><option value="late">Late or unavailable</option></select></label>
        <label>Reservoirs<select id="geography-filter"><option value="utah">Utah waterbodies</option><option value="connected">All connected</option></select></label>
      </div>
    </section>
    <p id="filter-status" class="filter-status" role="status"></p>
    <section class="overview-kpis" aria-label="Filtered storage summary">
      <article class="overview-kpi overview-kpi-primary"><span>Combined storage</span><strong data-kpi="percent">—</strong><small data-kpi="volume">—</small></article>
      <article class="overview-kpi"><span>Reservoirs in view</span><strong data-kpi="count">—</strong><small>Utah-intersecting waterbodies</small></article>
      <article class="overview-kpi"><span>Compared with normal</span><strong data-kpi="normal">—</strong><small data-kpi="normal-note">—</small></article>
      <article class="overview-kpi"><span>Change over the year</span><strong data-kpi="year">—</strong><small data-kpi="change">30 days: —</small></article>
      <article class="overview-kpi"><span>Late or unavailable</span><strong data-kpi="late">—</strong><small>Evaluated against each source update schedule</small></article>
      <article class="overview-kpi"><span>Data published</span><strong>${formatDate(generatedAt.slice(0, 10))}</strong><small>Observation dates vary by reservoir</small></article>
    </section>
    <section class="class-strip" aria-labelledby="class-heading">
      <div class="class-strip-head">
        <h2 id="class-heading">How the reservoirs are spread</h2>
        <p>Choose a level to filter everything below. The widths are the share of reservoirs in view.</p>
      </div>
      <div class="class-bar" data-classes role="group" aria-labelledby="class-heading"></div>
    </section>
    <section class="chart-settings" aria-labelledby="chart-settings-heading">
      <div class="chart-settings-copy">
        <p class="eyebrow">Chart display</p>
        <h2 id="chart-settings-heading">Choose how the charts show the filtered data</h2>
        <p>The filters above change every chart and the table. Each setting here says which charts it changes.</p>
      </div>
      <div class="chart-settings-controls">
        <label>Largest reservoirs shown<select id="chart-limit"><option value="10">Top 10</option><option value="15" selected>Top 15</option><option value="25">Top 25</option><option value="0">All</option></select></label>
        <label>Storage charts measure<select id="chart-measure"><option value="percent">Percent full</option><option value="storage">Acre-feet stored</option></select></label>
        <label>Largest reservoirs ordered by<select id="chart-rank"><option value="capacity">Capacity</option><option value="storage">Storage</option><option value="percent">Percent full</option><option value="name">Name</option></select></label>
      </div>
    </section>
    <div class="overview-chart-grid">
      <section class="overview-card" aria-labelledby="capacity-heading">
        <div class="card-heading">
          <div><h2 id="capacity-heading">Largest reservoirs</h2><p>Click a bar to narrow everything below to that reservoir. Your choice appears in the search box above, and clearing it brings the rest back.</p></div>
          <span class="sdk-badge">Bar chart</span>
        </div>
        <div id="capacity-chart" class="chart-host" aria-busy="true"></div>
        <div class="chart-legend" data-legend></div>
      </section>
      <section class="overview-card" aria-labelledby="watershed-heading">
        <div class="card-heading"><div><h2 id="watershed-heading">Drainage-area conditions</h2><p>Combined storage divided by the combined full level within each area. Click a bar to filter to it.</p></div><span class="sdk-badge">Bar chart</span></div>
        <div id="watershed-chart" class="chart-host" aria-busy="true"></div>
        <div class="chart-legend" data-legend></div>
      </section>
      <section class="overview-card" aria-labelledby="trend-heading">
        <div class="card-heading"><div><h2 id="trend-heading">The last 12 months</h2><p>Combined storage for the reservoirs in view, month by month. The only chart here that shows direction.</p></div><span class="sdk-badge">Bar and line chart</span></div>
        <div id="trend-chart" class="chart-host" aria-busy="true"></div>
      </section>
      <section class="overview-card" aria-labelledby="normal-heading">
        <div class="card-heading"><div><h2 id="normal-heading">Stored now against normal</h2><p>Each dot is a reservoir. Dots below the dashed line hold less than they usually do on this date. The reservoirs get larger to the right, in tenfold steps, so the small ones are as readable as Flaming Gorge.</p></div><span class="sdk-badge">Scatter plot</span></div>
        <div id="normal-chart" class="chart-host" aria-busy="true"></div>
        <div class="chart-legend" data-legend></div>
      </section>
      <section class="overview-card" aria-labelledby="distribution-heading">
        <div class="card-heading"><div><h2 id="distribution-heading">How full, across all of them</h2><p>Reservoirs sorted into ten equal bands of percent full, with the mean, the median, one standard deviation and a fitted normal curve.</p></div><span class="sdk-badge">Histogram</span></div>
        <div id="distribution-chart" class="chart-host" aria-busy="true"></div>
        <!-- Under the chart, not beside it. The histogram is the widest thing
             on this page and a key in a side rail would take width from the
             bars; a row underneath spreads across the full card and keeps the
             chart symmetrical. -->
        <ul class="overlay-key" id="distribution-key"
          aria-label="What the lines across the histogram mean"></ul>
      </section>
      <section class="overview-card" aria-labelledby="spread-heading">
        <div class="card-heading"><div><h2 id="spread-heading">Spread within each drainage area</h2><p>Median, quartiles and outliers. An area at 60% can be forty reservoirs near 60, or half full and half empty.</p></div><span class="sdk-badge">Box plot</span></div>
        <div id="spread-chart" class="chart-host" aria-busy="true"></div>
      </section>
    </div>
    <section class="overview-card table-card" aria-labelledby="table-heading">
      <div class="card-heading"><div><h2 id="table-heading">Reservoir detail</h2><p>Exact values for the same filtered records shown above.</p></div><div class="table-actions"><label class="sort-control">Sort rows<select id="reservoir-sort"><option value="capacity">Capacity</option><option value="name">Name</option><option value="storage">Current storage</option><option value="percent">Percent full</option><option value="updated">Observation date</option></select></label><calcite-button id="download-overview-csv" appearance="outline" icon-start="export" scale="s">Download filtered table (CSV file)</calcite-button></div></div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="Reservoir table, scrolls sideways"><table class="overview-table"><thead><tr><th>Reservoir</th><th>Drainage area</th><th>Full</th><th>Storage (acre-feet)</th><th>Capacity (acre-feet)</th><th>Observed</th></tr></thead><tbody id="reservoir-rows"></tbody></table></div>
    </section>`;

  /* One legend per chart, built from the class table rather than by the
   * chart SDK: the bars, the map circles and this all read the same rows, so
   * a break that moves moves in one place (ADR-008). */
  for (const host of document.querySelectorAll<HTMLElement>("[data-legend]")) {
    host.replaceChildren(...storageLegendEntries().map((entry) => {
      const item = document.createElement("span");
      item.className = "chart-legend-item";
      const swatch = document.createElement("span");
      swatch.className = "chart-legend-swatch";
      swatch.style.background = entry.color;
      const label = document.createElement("span");
      label.textContent = entry.label;
      item.append(swatch, label);
      return item;
    }));
    host.setAttribute("aria-label", "Storage levels, the same colours the map uses");
  }

  /* The class the reader has narrowed to, or null for all of them. Held
   * here rather than in a control because the strip *is* the control: the
   * distribution and the filter are one thing, so a reader cannot be
   * looking at a spread that does not match what is below it. */
  let storageClassFilter: number | null = null;

  const watershed = document.querySelector<HTMLSelectElement>("#watershed-filter");
  for (const choice of watershedChoices) {
    const option = document.createElement("option");
    option.value = choice.code;
    option.textContent = choice.label;
    watershed?.append(option);
  }

  /* The county control is offered only when the payload carries counties.
   * The assignment ships with a morning's refresh, so the published payload
   * has none until then -- and a filter whose every choice narrows to nothing
   * is worse than no filter. The field is hidden rather than absent so the
   * markup, and the tests that read it, stay one shape. */
  /* The subregion names travel in the payload's own envelope (ADR-048), so a
   * code the roster does not carry is labelled by its code rather than lost. */
  const subregionNames = new Map<string, string>(
    subregions.map((entry) => [entry.huc4, entry.name]));
  /* Built from the widest scope like the drainage-area list, and for the
   * same reason -- and so the full list exists before the link's choice is
   * restored, or a shared ?huc4= would be discarded against an empty
   * control. */
  const subregionChoices = subregionOptions(widestScope, subregionNames);

  /* Repopulating a `<select>` has to preserve the reader's choice when it is
   * still on offer. Rebuilding blind resets the control on every keystroke,
   * which is the bug this exists to not have. */
  function fillOptions(
    element: HTMLSelectElement, options: FilterOption[], allLabel: string
  ): void {
    const wanted = element.value;
    element.replaceChildren();
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = allLabel;
    element.append(all);
    for (const choice of options) {
      const option = document.createElement("option");
      option.value = choice.code;
      option.textContent = choice.label;
      element.append(option);
    }
    element.value = options.some((choice) => choice.code === wanted) ? wanted : "all";
  }

  const state = document.querySelector<HTMLSelectElement>("#state-filter");
  const subregion = document.querySelector<HTMLSelectElement>("#subregion-filter");
  const county = document.querySelector<HTMLSelectElement>("#county-filter");
  const countyField = document.querySelector<HTMLElement>("#county-field");
  for (const choice of countyChoices) {
    const option = document.createElement("option");
    option.value = choice.code;
    option.textContent = choice.label;
    county?.append(option);
  }
  if (countyField) countyField.hidden = countyChoices.length === 0;
  /* The state list is built once from the widest scope, like the county list:
   * it is the coarsest control, so nothing above it can narrow it. */
  for (const choice of stateChoices) {
    const option = document.createElement("option");
    option.value = choice.code;
    option.textContent = choice.label;
    state?.append(option);
  }
  /* The subregion list starts at its widest; the first update() narrows it
   * to the chosen state. It must exist before the URL restore below, so a
   * link's subregion has an option to land on. */
  if (subregion) fillOptions(subregion, subregionChoices, "All subregions");

  const tbody = document.querySelector<HTMLTableSectionElement>("#reservoir-rows");
  const search = document.querySelector<HTMLInputElement>("#reservoir-search");
  const cadence = document.querySelector<HTMLSelectElement>("#cadence-filter");
  const sort = document.querySelector<HTMLSelectElement>("#reservoir-sort");
  const lakePowell = document.querySelector<HTMLInputElement>("#lake-powell-toggle");
  const lakeMead = document.querySelector<HTMLInputElement>("#lake-mead-toggle");
  const geography = document.querySelector<HTMLSelectElement>("#geography-filter");
  const reset = document.querySelector<HTMLButtonElement>("#reset-filters");
  const status = document.querySelector<HTMLElement>("#filter-status");
  const capacityHost = document.querySelector<HTMLElement>("#capacity-chart");
  const watershedHost = document.querySelector<HTMLElement>("#watershed-chart");
  const trendHost = document.querySelector<HTMLElement>("#trend-chart");
  const normalHost = document.querySelector<HTMLElement>("#normal-chart");
  const distributionHost = document.querySelector<HTMLElement>("#distribution-chart");
  const distributionKey = document.querySelector<HTMLElement>("#distribution-key");
  /* The only legend the histogram has, so it is rebuilt whenever the chart
   * is: the four lines mean the same thing whatever is in view, but the
   * three values they sit at follow the filters. It used to be written once,
   * which was right when the numbers lived in the SDK's own rail inside the
   * chart -- and that rail is what made two legends of one. */
  const renderDistributionKey = (stats: DistributionStats | null): void => {
    if (!distributionKey) return;
    distributionKey.replaceChildren(...distributionOverlayKey(stats).map((entry) => {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = `overlay-key-line overlay-key-${entry.style}`;
      swatch.style.setProperty("--overlay-key-color", entry.color);
      const text = document.createElement("span");
      text.textContent = entry.label;
      item.append(swatch, text);
      return item;
    }));
  };
  renderDistributionKey(null);
  const spreadHost = document.querySelector<HTMLElement>("#spread-chart");
  const chartLimit = document.querySelector<HTMLSelectElement>("#chart-limit");
  const chartMeasure = document.querySelector<HTMLSelectElement>("#chart-measure");
  const chartRank = document.querySelector<HTMLSelectElement>("#chart-rank");
  const exportButton = document.querySelector<HTMLElement>("#download-overview-csv");
  if (!tbody || !search || !state || !subregion || !watershed || !county
      || !cadence || !sort || !reset || !status
      || !capacityHost || !watershedHost || !trendHost || !normalHost
      || !distributionHost || !spreadHost
      || !chartLimit || !chartMeasure || !chartRank
      || !lakePowell || !lakeMead || !geography || !exportButton) return;

  let exportRows: readonly Reservoir[] = [];
  exportButton.addEventListener("click", () => {
    downloadCsv(overviewCsv(exportRows), overviewCsvFilename(generatedAt));
  });

  /* Every chart host, so busy state and failure handling are written once.
   * Six hosts named individually in three places is five chances to add a
   * seventh chart and leave it announcing itself as loading forever. */
  const chartHosts = [capacityHost, watershedHost, trendHost, normalHost,
    distributionHost, spreadHost];

  /**
   * The distribution across the storage classes, drawn as one bar.
   *
   * Reads from `statewideRollup`, which has computed this since the port and
   * which the page has never shown -- so "is this a few empty reservoirs or
   * most of the state?" had no answer here. Each segment is a button: the
   * spread and the filter are the same control, which is what stops them
   * disagreeing.
   */
  const renderClassStrip = (visible: readonly Reservoir[]): void => {
    const host = document.querySelector<HTMLElement>("[data-classes]");
    if (!host) return;
    const rollup = statewideRollup(visible, WIDEST_SCOPE);
    const total = rollup.classes.reduce((sum, entry) => sum + entry.count, 0);
    host.replaceChildren(...rollup.classes.map((entry, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "class-seg";
      button.dataset.class = String(index);
      // A class nobody is in still gets a sliver, so the scale stays legible
      // and the button stays clickable.
      button.style.flexGrow = String(Math.max(entry.count, total === 0 ? 1 : 0.12));
      button.style.background = entry.color;
      /* Counts sit on the data colour. The red and dark-blue ends need white
       * text; the three pale middle classes need dark text. Compute it from
       * the same fill rather than maintaining a second five-item table. */
      button.style.color = contrastingTextColor(entry.color);
      button.setAttribute("aria-pressed", String(storageClassFilter === index));
      button.setAttribute("aria-label",
        `${entry.label}: ${entry.count} of ${total} reservoirs`);
      const count = document.createElement("span");
      count.className = "class-seg-count";
      count.textContent = String(entry.count);
      button.append(count);
      button.addEventListener("click", () => {
        storageClassFilter = storageClassFilter === index ? null : index;
        void update();
      });
      return button;
    }));
    const chosen = storageClassFilter === null ? null : rollup.classes[storageClassFilter];
    host.setAttribute("data-chosen", chosen ? chosen.label : "");
  };

  /* Everything the address bar carries, read from the controls themselves
   * rather than from a parallel copy. One function, so the writer cannot go
   * stale as controls are added -- the map shell keeps `viewState` for the
   * same reason. */
  const currentUrlState = (): OverviewUrlState => ({
    query: search.value,
    drainageArea: watershed.value,
    state: state.value,
    subregion: subregion.value,
    county: county.value,
    reporting: cadence.value as OverviewCadence,
    geography: geography.value as ReservoirGeography,
    lakePowell: lakePowell.checked ? "include" : "exclude",
    lakeMead: lakeMead.checked ? "include" : "exclude",
    storageClass: storageClassFilter,
    sort: sort.value as OverviewSort,
    measure: chartMeasure.value as ChartMeasure,
    limit: Number(chartLimit.value),
    rank: chartRank.value as ChartRank
  });

  let revision = 0;
  const update = async (): Promise<void> => {
    const currentRevision = ++revision;
    const scoped = overviewScope(allReservoirs, {
      geography: geography.value as ReservoirGeography,
      lakePowell: lakePowell.checked ? "include" : "exclude",
      lakeMead: lakeMead.checked ? "include" : "exclude"
    });
    /* Each geographic control is repopulated from what the ones above it
     * leave, so a reader who picks Wyoming is not then offered a subregion
     * Wyoming has none of. A selection that survives the narrowing is kept;
     * one that does not falls back to "all" rather than filtering to nothing
     * silently. */
    const byState = scoped.filter((item) => reservoirInState(item, state.value));
    fillOptions(subregion, subregionOptions(byState, subregionNames), "All subregions");
    const bySubregion = byState.filter((item) =>
      subregion.value === "all" || subregionOf(item) === subregion.value);
    fillOptions(watershed, watershedOptions(bySubregion), "All drainage areas");

    const matching = filterOverview(scoped, {
      query: search.value,
      state: state.value,
      huc4: subregion.value,
      huc6: watershed.value,
      county: county.value,
      cadence: cadence.value as OverviewCadence
    });
    /* The strip narrows what is below it, but the strip itself keeps showing
     * the whole spread of the other filters -- otherwise choosing a class
     * would collapse the very chart that offers the choice. */
    const visible = storageClassFilter === null
      ? matching
      : matching.filter((reservoir) => classIndexOf(reservoir) === storageClassFilter);
    updateKpis(visible);
    /* The digest follows the scope, not the filters.
     *
     * That is the same line the map draws (ADR-011): a scope changes which
     * reservoirs exist, a filter changes which of them are picked out. A
     * digest that answered the search box would be describing a text query;
     * one that ignores the Lake Powell switch is worse, because Powell is
     * 25 of the region's 34 million acre-feet and "the measured reservoirs
     * lost 69,480 acre-feet" is very nearly a sentence about Powell alone.
     * Turning it off has to change the sentence, or the switch is decorative
     * on this card. */
    void renderWeekly(scoped);
    renderClassStrip(matching);
    exportRows = filterAndSort(visible, "", sort.value as OverviewSort);
    renderRows(tbody, exportRows);
    const chosenClass = storageClassFilter === null
      ? "" : ` · ${STORAGE_CLASSES[storageClassFilter]?.label ?? ""}`;
    /* Both dominant reservoirs are named, whatever their state: a scope
     * that includes 28 million acre-feet without saying so is the silent
     * total ADR-011 and ADR-062 exist to prevent. */
    status.textContent = `${visible.length} of ${scoped.length} reservoirs shown · ` +
      `${geography.value === "connected" ? "All connected" : "Utah waterbodies"} · Lake Powell ` +
      `${lakePowell.checked ? "included" : "excluded"} · Lake Mead ` +
      `${lakeMead.checked ? "included" : "excluded"}${chosenClass}`;
    for (const host of chartHosts) host.setAttribute("aria-busy", "true");
    const still = (): boolean => currentRevision === revision;
    const measure = chartMeasure.value as ChartMeasure;
    const limit = Number(chartLimit.value) || visible.length;
    const values = percentFullValues(visible);
    /* Before the charts, not after: the key is the histogram's only legend
     * now, so a reader watching a filter change should see the three values
     * move with the bars rather than a step behind them. */
    renderDistributionKey(distributionStats(values));
    try {
      await Promise.all([
        renderArcgisBarChart(capacityHost,
          largestReservoirRecords(visible, {
            limit, measure, rank: chartRank.value as ChartRank
          }),
          measure === "storage"
            ? "Acre-feet stored by the largest reservoirs in the filtered view"
            : "Percent full for the largest reservoirs in the filtered view",
          still,
          {
            measure,
            categoryTitle: "Reservoir",
            /* The bar becomes the filter. Clearing the selection clears the
             * search rather than leaving the reader in a view they cannot
             * see the cause of. */
            onSelect: (labels) => {
              search.value = labels[0] ?? "";
              void update();
            }
          }),
        renderArcgisBarChart(watershedHost, watershedRecords(visible),
          "Combined percent full by drainage area in the filtered view", still, {
            categoryTitle: "Drainage area",
            onSelect: (labels) => {
              const chosen = watershedChoices.find((choice) => choice.label === labels[0]);
              watershed.value = chosen?.code ?? "all";
              void update();
            }
          }),
        renderArcgisTrendChart(trendHost, monthlyTrend(visible),
          "Combined storage for the filtered reservoirs over the last twelve months",
          still, measure),
        renderArcgisNormalChart(normalHost, normalComparison(visible),
          "Percent of the usual storage for this date against how large that usual "
          + "storage is, one point per reservoir",
          still),
        renderArcgisDistributionChart(distributionHost, values,
          "How many reservoirs fall in each of ten equal bands of percent full", still),
        renderArcgisSpreadChart(spreadHost, values,
          "The spread of percent full within each drainage area", still)
      ]);
    } catch (error) {
      /* A chart that throws used to leave both hosts reporting `aria-busy`
       * with nothing in them and no readiness signal -- an empty box that
       * announces itself as still loading, forever. Say what happened and
       * stop claiming to be busy; the table below still has every value. */
      console.error("A chart could not be drawn:", error);
      if (currentRevision === revision) {
        for (const host of chartHosts) {
          host.setAttribute("aria-busy", "false");
          if (host.childElementCount === 0) {
            const failed = document.createElement("p");
            failed.className = "chart-empty";
            failed.setAttribute("role", "alert");
            failed.textContent =
              "This chart could not be drawn. The table below has the same values.";
            host.replaceChildren(failed);
          }
        }
      }
      return;
    }
    // Only the winning revision owns these: a superseded run clearing them
    // would report "not busy" while its successor is still drawing.
    if (currentRevision !== revision) return;
    for (const host of chartHosts) host.setAttribute("aria-busy", "false");
    /* The address bar last, once the view it describes is actually on
     * screen: written earlier it would advertise a state the page was still
     * drawing, and a reader who copied it mid-render would send a link to
     * something they had not seen yet. */
    writeOverviewUrl(currentUrlState());
    /* The write is a `replaceState`; there is no navigation to re-render the
     * bar, so its links are brought up to date here or not at all. */
    updatePageLinks(window.location.search);
    window.__overviewReady = {
      reservoirs: scoped.length,
      visible: visible.length,
      charts: chartHosts.length,
      lakePowellExcluded: !visible.some(isLakePowell),
      lakeMeadExcluded: !visible.some(isLakeMead)
    };
  };
  for (const control of [search, state, subregion, watershed, county, cadence, sort,
    lakePowell, lakeMead, geography, chartLimit, chartMeasure, chartRank]) {
    const event = control instanceof HTMLSelectElement
      || (control instanceof HTMLInputElement && control.type === "checkbox")
      ? "change"
      : "input";
    control.addEventListener(event, () => void update());
  }
  /* Each chart reads the page's Calcite colours once, when it is built --
   * they are baked into the SDK's own chart config, not CSS the cascade can
   * re-theme on its own. Without this, flipping the theme toggle after the
   * charts have drawn leaves them in whichever theme was active at the time,
   * while the rest of the page has already moved on. */
  document.addEventListener(THEME_CHANGE_EVENT, () => void update());
  reset.addEventListener("click", () => {
    search.value = "";
    watershed.value = "all";
    state.value = "all";
    subregion.value = "all";
    county.value = "all";
    cadence.value = "all";
    sort.value = "capacity";
    lakePowell.checked = false;
    lakeMead.checked = false;
    geography.value = "utah";
    chartLimit.value = "15";
    chartMeasure.value = "percent";
    chartRank.value = "capacity";
    storageClassFilter = null;
    void update();
    search.focus();
  });

  /* Restore the whole view a link describes before the first draw, so the
   * page renders once into the state it was asked for rather than drawing
   * the default and then redrawing. Six charts make that difference
   * visible. A drainage area the current scope does not contain falls back
   * to every area, which is why this runs after the options are filled. */
  const wanted = overviewStateFromSearch(window.location.search);
  search.value = wanted.query;
  watershed.value = watershedChoices.some((choice) => choice.code === wanted.drainageArea)
    ? wanted.drainageArea : "all";
  /* A county in the link that this payload does not carry falls back to all,
   * the same way a drainage area does. A shared link outliving the roster it
   * was made from should show everything rather than nothing. */
  county.value = countyChoices.some((choice) => choice.code === wanted.county)
    ? wanted.county : "all";
  /* State first, then subregion: the update below repopulates the subregion
   * list from the chosen state, and a selection that survives that narrowing
   * is kept while one that does not falls back to "all". */
  state.value = stateChoices.some((choice) => choice.code === wanted.state)
    ? wanted.state : "all";
  subregion.value = subregionChoices.some((choice) => choice.code === wanted.subregion)
    ? wanted.subregion : "all";
  cadence.value = wanted.reporting;
  geography.value = wanted.geography;
  lakePowell.checked = wanted.lakePowell === "include";
  lakeMead.checked = wanted.lakeMead === "include";
  sort.value = wanted.sort;
  chartMeasure.value = wanted.measure;
  chartRank.value = wanted.rank;
  /* Only a limit the control actually offers. A link asking for the top 7
   * would otherwise leave the select showing nothing at all. */
  chartLimit.value = [...chartLimit.options].some((option) =>
    Number(option.value) === wanted.limit) ? String(wanted.limit) : "15";
  storageClassFilter = wanted.storageClass !== null
    && wanted.storageClass < STORAGE_CLASSES.length ? wanted.storageClass : null;

  await update();
}

/**
 * The weekly digest.
 *
 * Rendered after the page's own charts, from two extra fetches this page can
 * do without: the snow payload is 1.9 MB and the drought coverage is a
 * separate weekly file, and neither should delay the charts a reader came
 * for. Each section degrades on its own -- a failed snow fetch costs the snow
 * paragraph and nothing else -- which is why the model takes them as
 * nullable rather than requiring all three.
 */
/*
 * The two extra payloads, fetched once.
 *
 * The digest is redrawn whenever the reader changes the scope, and the snow
 * file is 1.9 MB. Refetching it to answer "what if Lake Powell were not
 * counted" would be a megabyte of network for a question about sixty-eight
 * other reservoirs.
 */
let weeklyContext: Promise<[SnowpackPayload | null, DroughtCoveragePayload | null]>
  | null = null;

function weeklyPayloads(): Promise<[SnowpackPayload | null, DroughtCoveragePayload | null]> {
  weeklyContext ??= Promise.all([
    loadSnowpack().catch((error: unknown) => {
      console.warn("The weekly summary has no snow measurements:", error);
      return null;
    }),
    loadDroughtCoverage().catch((error: unknown) => {
      console.warn("The weekly summary has no drought coverage:", error);
      return null;
    })
  ]);
  return weeklyContext;
}

async function renderWeekly(reservoirs: readonly Reservoir[]): Promise<void> {
  const card = document.querySelector<HTMLElement>("#weekly-summary");
  const host = card?.querySelector<HTMLElement>(".weekly-sections");
  if (!card || !host) return;

  const [snow, drought] = await weeklyPayloads();

  /* Which reservoirs these figures are about, in the card rather than only in
   * the controls that set it. A reader who arrives at the digest first should
   * not have to look elsewhere to find out what "the measured reservoirs"
   * means this time. */
  const scopeLine = document.querySelector<HTMLElement>('[data-weekly="scope"]');
  if (scopeLine) {
    /* Both dominant reservoirs, whatever their state. Read from the rows the
     * digest was handed rather than from the controls, so the sentence
     * describes the figures beside it even if the two ever disagree. Powell
     * is 25 million acre-feet and Mead 28, against about 34 for everything
     * else on the roster put together: a digest that names one and stays
     * quiet about the other invites the reader to assume it is in there
     * (ADR-011, ADR-062). */
    const hasPowell = reservoirs.some(isLakePowell);
    const hasMead = reservoirs.some(isLakeMead);
    scopeLine.textContent =
      `Storage covers ${reservoirs.length} reservoirs, Lake Powell ` +
      `${hasPowell ? "included" : "excluded"}, Lake Mead ` +
      `${hasMead ? "included" : "excluded"}.`;
  }

  const sections = describeWeek(weeklySummary(reservoirs, snow, drought));
  host.replaceChildren(...sections.map((section) => {
    const block = document.createElement("section");
    block.className = "weekly-section";
    const heading = document.createElement("h3");
    heading.textContent = section.heading;
    block.append(heading);
    for (const line of section.lines) {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      block.append(paragraph);
    }
    return block;
  }));
  card.setAttribute("aria-busy", "false");

  window.__overviewReady = {
    ...(window.__overviewReady ?? {}),
    weeklySections: sections.length,
    weeklyLines: sections.reduce((sum, section) => sum + section.lines.length, 0)
  } as NonNullable<typeof window.__overviewReady>;
}

try {
  const payload = await loadReservoirs();
  await renderOverview(payload.reservoirs, payload.generated_at,
    payload.watersheds?.subregions ?? []);
} catch (error) {
  console.error("Reservoir overview failed:", error);
  const content = document.querySelector<HTMLElement>("#overview-content");
  if (content) content.innerHTML = `<div class="overview-error" role="alert"><strong>The reservoir dashboard could not load.</strong><p>Try again later or return to the map.</p></div>`;
}
