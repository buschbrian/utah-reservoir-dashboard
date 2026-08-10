import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-navigation";
import "@esri/calcite-components/components/calcite-navigation-logo";
import * as Plot from "@observablehq/plot";

import { loadReservoirs } from "./data/load";
import { statewideRollup } from "./data/rollup";
import { filterAndSort, overviewScope, type OverviewSort } from "./overview-model";
import { wireTheme } from "./ui/theme";
import type { Reservoir } from "./types";
import { storageColor } from "./viz/classes";
import { formatAcreFeet, formatDate, formatPercent } from "./viz/format";
import "./styles/overview.css";

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#overview-app");
if (!root) throw new Error("Missing #overview-app root");

root.innerHTML = `
  <calcite-navigation class="overview-nav" aria-label="Primary navigation">
    <calcite-navigation-logo slot="logo" heading="Utah Reservoir Dashboard"
      description="Reservoir overview" heading-level="2" icon="water-drop"></calcite-navigation-logo>
    <calcite-button slot="content-end" href="./modern.html" appearance="transparent"
      kind="neutral" icon-start="home" label="Return to map"><span class="overview-link-text">Map</span></calcite-button>
    <calcite-button slot="content-end" href="./explore.html" appearance="transparent"
      kind="neutral" label="Open legacy overview"><span class="overview-link-text">Legacy overview</span></calcite-button>
    <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
      icon="brightness" label="Change color theme"></calcite-action>
  </calcite-navigation>
  <main class="overview-main">
    <header class="overview-intro">
      <p class="eyebrow">Current conditions</p><h1>Reservoir table and charts</h1>
      <p>Compare current storage for waterbodies that intersect Utah. Lake Powell remains a separate scope so one very large reservoir does not hide local conditions.</p>
    </header>
    <section id="overview-content" aria-live="polite"><calcite-loader label="Loading reservoir data"></calcite-loader></section>
  </main>`;
wireTheme();

function renderRows(tbody: HTMLTableSectionElement, reservoirs: readonly Reservoir[]): void {
  tbody.replaceChildren(...reservoirs.map((reservoir) => {
    const row = document.createElement("tr");
    const cells = [reservoir.name, reservoir.huc6_name ?? "Not assigned",
      formatPercent(reservoir.pct_of_capacity), formatAcreFeet(reservoir.current_storage_af),
      formatAcreFeet(reservoir.capacity_af), formatDate(reservoir.as_of)];
    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 5 && reservoir.is_stale) cell.className = "late-badge";
      row.append(cell);
    });
    return row;
  }));
}

function renderOverview(reservoirs: Reservoir[], generatedAt: string): void {
  const content = document.querySelector<HTMLElement>("#overview-content");
  if (!content) return;
  const rollup = statewideRollup(reservoirs, { geography: "utah", lakePowell: "exclude" });
  content.innerHTML = `
    <section class="overview-kpis" aria-label="Storage summary">
      <div class="overview-kpi"><span>Combined storage</span><strong>${formatPercent(rollup.percentFull)}</strong><small>${formatAcreFeet(rollup.storageAf)} of ${formatAcreFeet(rollup.capacityAf)} acre-feet</small></div>
      <div class="overview-kpi"><span>Reservoirs</span><strong>${rollup.count}</strong><small>Waterbodies that intersect Utah, excluding Lake Powell</small></div>
      <div class="overview-kpi"><span>Data published</span><strong>${formatDate(generatedAt.slice(0, 10))}</strong><small>Individual observation dates appear in the table</small></div>
    </section>
    <div class="overview-grid">
      <section class="overview-card" aria-labelledby="capacity-heading"><h2 id="capacity-heading">Largest reservoirs by capacity</h2><p>Current percent of conservation capacity. Exact values are repeated in the table.</p><div id="capacity-chart"></div></section>
      <section class="overview-card" aria-labelledby="table-heading"><h2 id="table-heading">All reservoirs</h2><p>Search and sort without changing which reservoirs the summary counts.</p>
        <div class="overview-toolbar"><label>Search <input id="reservoir-search" type="search" placeholder="Reservoir or drainage area" /></label><label>Sort <select id="reservoir-sort"><option value="name">Name</option><option value="capacity">Capacity</option><option value="storage">Current storage</option><option value="percent">Percent full</option><option value="updated">Observation date</option></select></label><span id="result-count" class="result-count"></span></div>
        <div class="table-scroll"><table class="overview-table"><thead><tr><th>Reservoir</th><th>Drainage area</th><th>Full</th><th>Storage (acre-feet)</th><th>Capacity (acre-feet)</th><th>Observed</th></tr></thead><tbody id="reservoir-rows"></tbody></table></div>
      </section>
    </div>`;

  const chartData = [...reservoirs]
    .filter((item) => item.capacity_af !== null && item.pct_of_capacity !== null)
    .sort((a, b) => (b.capacity_af ?? 0) - (a.capacity_af ?? 0)).slice(0, 15)
    .map((item) => ({ name: item.name, percent: item.pct_of_capacity ?? 0,
      color: storageColor(item.pct_of_capacity) }));
  const chart = Plot.plot({ ariaLabel: "Current percent full for the fifteen largest reservoirs",
    marginLeft: 150, marginRight: 40, height: 440,
    x: { label: "Percent of capacity", grid: true, domain: [0, 110] },
    y: { label: null, domain: chartData.map((item) => item.name) },
    marks: [Plot.ruleX([0]), Plot.barX(chartData, { x: "percent", y: "name", fill: "color" }),
      Plot.text(chartData, { x: "percent", y: "name", text: (item) => `${item.percent.toFixed(0)}%`, dx: 5, textAnchor: "start" })] });
  document.querySelector("#capacity-chart")?.append(chart);

  const tbody = document.querySelector<HTMLTableSectionElement>("#reservoir-rows");
  const search = document.querySelector<HTMLInputElement>("#reservoir-search");
  const sort = document.querySelector<HTMLSelectElement>("#reservoir-sort");
  const count = document.querySelector<HTMLElement>("#result-count");
  if (!tbody || !search || !sort || !count) return;
  const update = (): void => {
    const visible = filterAndSort(reservoirs, search.value, sort.value as OverviewSort);
    renderRows(tbody, visible);
    count.textContent = `${visible.length} of ${reservoirs.length}`;
  };
  search.addEventListener("input", update);
  sort.addEventListener("change", update);
  update();
}

try {
  const payload = await loadReservoirs();
  renderOverview(overviewScope(payload.reservoirs), payload.generated_at);
} catch (error) {
  console.error("Reservoir overview failed:", error);
  const content = document.querySelector<HTMLElement>("#overview-content");
  if (content) content.innerHTML = `<div class="overview-error" role="alert"><strong>The reservoir overview could not load.</strong><p>Try again later or return to the map.</p></div>`;
}
