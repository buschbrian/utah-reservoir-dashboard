import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-navigation";
import "@esri/calcite-components/components/calcite-navigation-logo";

import { loadReservoirs } from "./data/load";
import { isLate, statewideRollup, type LakePowellChoice } from "./data/rollup";
import { renderArcgisBarChart, storageLegendEntries } from "./overview-charts";
import {
  filterAndSort,
  filterOverview,
  largestReservoirRecords,
  overviewScope,
  watershedOptions,
  watershedRecords,
  type OverviewCadence,
  type OverviewSort
} from "./overview-model";
import type { Reservoir } from "./types";
import { wireTheme } from "./ui/theme";
import { formatAcreFeet, formatDate, formatPercent } from "./viz/format";
import "./styles/overview.css";

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#overview-app");
if (!root) throw new Error("Missing #overview-app root");

root.innerHTML = `
  <calcite-navigation class="overview-nav" aria-label="Primary navigation">
    <calcite-navigation-logo slot="logo" heading="Utah Reservoir Dashboard"
      description="ArcGIS Maps SDK for JavaScript" heading-level="2" icon="water-drop"></calcite-navigation-logo>
    <calcite-button slot="content-end" href="./modern.html" appearance="transparent"
      kind="neutral" icon-start="home" label="Return to ArcGIS map"><span class="overview-link-text">Map</span></calcite-button>
    <calcite-button slot="content-end" href="./explore.html" appearance="transparent"
      kind="neutral" label="Open legacy comparison"><span class="overview-link-text">Legacy comparison</span></calcite-button>
    <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
      icon="brightness" label="Change color theme"></calcite-action>
  </calcite-navigation>
  <main class="overview-main">
    <header class="overview-intro">
      <div><p class="eyebrow">Decision workspace</p><h1>Utah reservoir conditions</h1></div>
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
   * not apply a second Lake Powell filter on top of it -- "include" here
   * means "do not filter again", which is what makes the toggle work. */
  const rollup = statewideRollup(reservoirs, { geography: "connected", lakePowell: "include" });
  const values: Record<string, string> = {
    percent: formatPercent(rollup.percentFull),
    volume: `${formatAcreFeet(rollup.storageAf)} of ${formatAcreFeet(rollup.capacityAf)}`,
    count: String(rollup.count),
    change: `${rollup.change30dAf >= 0 ? "+" : ""}${formatAcreFeet(rollup.change30dAf)}`,
    late: String(rollup.stale)
  };
  for (const [name, value] of Object.entries(values)) {
    const element = document.querySelector<HTMLElement>(`[data-kpi="${name}"]`);
    if (element) element.textContent = value;
  }
}

async function renderOverview(allReservoirs: Reservoir[], generatedAt: string): Promise<void> {
  const content = document.querySelector<HTMLElement>("#overview-content");
  if (!content) return;
  // Built from the widest scope so the list of drainage areas does not
  // change shape when Lake Powell is toggled.
  const watershedChoices = watershedOptions(overviewScope(allReservoirs, "include"));
  content.innerHTML = `
    <section class="dashboard-filterbar" aria-labelledby="filter-heading">
      <div class="filterbar-title"><p class="eyebrow">Cross-filter dashboard</p><h2 id="filter-heading">Focus the analysis</h2></div>
      <label>Find a reservoir<input id="reservoir-search" type="search" placeholder="Name or drainage area" autocomplete="off" /></label>
      <label>Drainage area<select id="watershed-filter"><option value="all">All drainage areas</option></select></label>
      <label>Reporting<select id="cadence-filter"><option value="all">All reporting</option><option value="daily">Daily</option><option value="monthly">Monthly</option><option value="late">Late or unavailable</option></select></label>
      <label>Lake Powell<select id="lake-powell-filter"><option value="exclude">Excluded</option><option value="include">Included</option></select></label>
      <button id="reset-filters" class="reset-button" type="button">Reset filters</button>
    </section>
    <p id="filter-status" class="filter-status" role="status"></p>
    <section class="overview-kpis" aria-label="Filtered storage summary">
      <article class="overview-kpi overview-kpi-primary"><span>Combined storage</span><strong data-kpi="percent">—</strong><small data-kpi="volume">—</small></article>
      <article class="overview-kpi"><span>Reservoirs in view</span><strong data-kpi="count">—</strong><small>Utah-intersecting waterbodies</small></article>
      <article class="overview-kpi"><span>30-day volume change</span><strong data-kpi="change">—</strong><small>Net change across the current view</small></article>
      <article class="overview-kpi"><span>Late or unavailable</span><strong data-kpi="late">—</strong><small>Evaluated against each source update schedule</small></article>
      <article class="overview-kpi"><span>Data published</span><strong>${formatDate(generatedAt.slice(0, 10))}</strong><small>Observation dates vary by reservoir</small></article>
    </section>
    <div class="overview-chart-grid">
      <section class="overview-card" aria-labelledby="capacity-heading"><div class="card-heading"><div><h2 id="capacity-heading">Largest reservoirs</h2><p>Percent of conservation capacity for the 15 largest reservoirs in the current view.</p></div><span class="sdk-badge">ArcGIS Chart</span></div><div id="capacity-chart" class="chart-host" aria-busy="true"></div><div class="chart-legend" data-legend></div></section>
      <section class="overview-card" aria-labelledby="watershed-heading"><div class="card-heading"><div><h2 id="watershed-heading">Drainage-area conditions</h2><p>Combined storage divided by the combined full level within each drainage area.</p></div><span class="sdk-badge">ArcGIS Chart</span></div><div id="watershed-chart" class="chart-host" aria-busy="true"></div><div class="chart-legend" data-legend></div></section>
    </div>
    <section class="overview-card table-card" aria-labelledby="table-heading">
      <div class="card-heading"><div><h2 id="table-heading">Reservoir detail</h2><p>Exact values for the same filtered records shown above.</p></div><label class="sort-control">Sort rows<select id="reservoir-sort"><option value="capacity">Capacity</option><option value="name">Name</option><option value="storage">Current storage</option><option value="percent">Percent full</option><option value="updated">Observation date</option></select></label></div>
      <div class="table-scroll"><table class="overview-table"><thead><tr><th>Reservoir</th><th>Drainage area</th><th>Full</th><th>Storage (acre-feet)</th><th>Capacity (acre-feet)</th><th>Observed</th></tr></thead><tbody id="reservoir-rows"></tbody></table></div>
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

  const watershed = document.querySelector<HTMLSelectElement>("#watershed-filter");
  for (const choice of watershedChoices) {
    const option = document.createElement("option");
    option.value = choice.code;
    option.textContent = choice.label;
    watershed?.append(option);
  }

  const tbody = document.querySelector<HTMLTableSectionElement>("#reservoir-rows");
  const search = document.querySelector<HTMLInputElement>("#reservoir-search");
  const cadence = document.querySelector<HTMLSelectElement>("#cadence-filter");
  const sort = document.querySelector<HTMLSelectElement>("#reservoir-sort");
  const lakePowell = document.querySelector<HTMLSelectElement>("#lake-powell-filter");
  const reset = document.querySelector<HTMLButtonElement>("#reset-filters");
  const status = document.querySelector<HTMLElement>("#filter-status");
  const capacityHost = document.querySelector<HTMLElement>("#capacity-chart");
  const watershedHost = document.querySelector<HTMLElement>("#watershed-chart");
  if (!tbody || !search || !watershed || !cadence || !sort || !reset || !status
      || !capacityHost || !watershedHost || !lakePowell) return;

  let revision = 0;
  const update = async (): Promise<void> => {
    const currentRevision = ++revision;
    const scoped = overviewScope(allReservoirs, lakePowell.value as LakePowellChoice);
    const visible = filterOverview(scoped, {
      query: search.value,
      huc6: watershed.value,
      cadence: cadence.value as OverviewCadence
    });
    updateKpis(visible);
    renderRows(tbody, filterAndSort(visible, "", sort.value as OverviewSort));
    status.textContent = `${visible.length} of ${scoped.length} reservoirs shown · Lake Powell ` +
      `${lakePowell.value === "include" ? "included" : "excluded"}`;
    capacityHost.setAttribute("aria-busy", "true");
    watershedHost.setAttribute("aria-busy", "true");
    await Promise.all([
      renderArcgisBarChart(capacityHost, largestReservoirRecords(visible),
        "Percent full for the largest reservoirs in the filtered view",
        () => currentRevision === revision),
      renderArcgisBarChart(watershedHost, watershedRecords(visible),
        "Combined percent full by drainage area in the filtered view",
        () => currentRevision === revision)
    ]);
    if (currentRevision !== revision) return;
    capacityHost.setAttribute("aria-busy", "false");
    watershedHost.setAttribute("aria-busy", "false");
    window.__overviewReady = {
      reservoirs: scoped.length,
      visible: visible.length,
      charts: 2,
      lakePowellExcluded: !visible.some((reservoir) => reservoir.rise_item_id === 509)
    };
  };
  for (const control of [search, watershed, cadence, sort, lakePowell]) {
    control.addEventListener(control === sort || control instanceof HTMLSelectElement ? "change" : "input", () => void update());
  }
  reset.addEventListener("click", () => {
    search.value = "";
    watershed.value = "all";
    cadence.value = "all";
    sort.value = "capacity";
    lakePowell.value = "exclude";
    void update();
    search.focus();
  });
  await update();
}

try {
  const payload = await loadReservoirs();
  await renderOverview(payload.reservoirs, payload.generated_at);
} catch (error) {
  console.error("Reservoir overview failed:", error);
  const content = document.querySelector<HTMLElement>("#overview-content");
  if (content) content.innerHTML = `<div class="overview-error" role="alert"><strong>The reservoir dashboard could not load.</strong><p>Try again later or return to the map.</p></div>`;
}
