import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-navigation";

import { loadReservoirs } from "./data/load";
import { isLate, statewideRollup, type ReservoirGeography } from "./data/rollup";
import { classIndexOf } from "./state/filters";
import { STORAGE_CLASSES } from "./viz/classes";
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
import { brandMarkup, pageLinksMarkup } from "./ui/page-header";
import { wireTheme } from "./ui/theme";
import { formatAcreFeet, formatDate, formatPercent } from "./viz/format";
import "./styles/overview.css";

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#overview-app");
if (!root) throw new Error("Missing #overview-app root");

root.innerHTML = `
  <calcite-navigation class="overview-nav" aria-label="Primary navigation">
    ${brandMarkup(2)}
    ${pageLinksMarkup("overview")}
    <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
      icon="brightness" label="Change color theme"></calcite-action>
  </calcite-navigation>
  <main class="overview-main">
    <header class="overview-intro">
      <div><p class="eyebrow">Decision workspace</p><h1>Utah reservoir conditions</h1></div>
      <p>Explore current storage for waterbodies that intersect Utah. Lake Powell is large enough to hide local conditions in a combined total, so it starts excluded and can be added back at any time.</p>
    </header>
    <!-- These three pages are published on every deploy, and until now the
         only way to reach any of them was to already know its address. They
         are not in the navigation bar because that bar clips rather than
         scrolls: four links plus the theme control measured 408px against a
         360px viewport, which does not shorten the row, it amputates the end
         of it. Here they also get to say what they are for, which is what
         ADR-007 actually asks of a comparison. -->
    <nav class="overview-views" aria-label="Other views of this data">
      <h2>Other views</h2>
      <ul>
        <li><a id="legacy-link" href="./legacy/"><b>Legacy map</b>
          <span>The same reservoirs drawn by ArcGIS Maps SDK 4.34, kept for comparison.</span></a></li>
        <li><a id="maplibre-link" href="./maplibre/"><b>MapLibre map</b>
          <span>The second rendering engine, and the view to use if the Esri services are unreachable.</span></a></li>
        <li><a id="explore-link" href="./explore.html"><b>Statewide overview</b>
          <span>Charts and rankings for every reservoir, without a map.</span></a></li>
      </ul>
    </nav>
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

async function renderOverview(allReservoirs: Reservoir[], generatedAt: string): Promise<void> {
  const content = document.querySelector<HTMLElement>("#overview-content");
  if (!content) return;
  // Built from the widest scope so the list of drainage areas does not
  // change shape when Lake Powell is toggled.
  const watershedChoices = watershedOptions(
    overviewScope(allReservoirs, { geography: "connected", lakePowell: "include" }));
  content.innerHTML = `
    <section class="dashboard-filterbar" aria-labelledby="filter-heading">
      <div class="filterbar-title"><p class="eyebrow">Cross-filter dashboard</p><h2 id="filter-heading">Focus the analysis</h2></div>
      <label>Find a reservoir<input id="reservoir-search" type="search" placeholder="Name or drainage area" autocomplete="off" /></label>
      <label>Drainage area<select id="watershed-filter"><option value="all">All drainage areas</option></select></label>
      <label>Reporting<select id="cadence-filter"><option value="all">All reporting</option><option value="daily">Daily</option><option value="monthly">Monthly</option><option value="late">Late or unavailable</option></select></label>
      <label>Reservoirs<select id="geography-filter"><option value="utah">Utah waterbodies</option><option value="connected">All connected</option></select></label>
      <label class="switch-label" for="lake-powell-toggle">Include Lake Powell<input id="lake-powell-toggle" type="checkbox" role="switch" /></label>
      <button id="reset-filters" class="reset-button" type="button">Reset filters</button>
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

  const tbody = document.querySelector<HTMLTableSectionElement>("#reservoir-rows");
  const search = document.querySelector<HTMLInputElement>("#reservoir-search");
  const cadence = document.querySelector<HTMLSelectElement>("#cadence-filter");
  const sort = document.querySelector<HTMLSelectElement>("#reservoir-sort");
  const lakePowell = document.querySelector<HTMLInputElement>("#lake-powell-toggle");
  const geography = document.querySelector<HTMLSelectElement>("#geography-filter");
  const reset = document.querySelector<HTMLButtonElement>("#reset-filters");
  const status = document.querySelector<HTMLElement>("#filter-status");
  const capacityHost = document.querySelector<HTMLElement>("#capacity-chart");
  const watershedHost = document.querySelector<HTMLElement>("#watershed-chart");
  if (!tbody || !search || !watershed || !cadence || !sort || !reset || !status
      || !capacityHost || !watershedHost || !lakePowell || !geography) return;

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
    const rollup = statewideRollup(visible, { geography: "connected", lakePowell: "include" });
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

  let revision = 0;
  const update = async (): Promise<void> => {
    const currentRevision = ++revision;
    const scoped = overviewScope(allReservoirs, {
      geography: geography.value as ReservoirGeography,
      lakePowell: lakePowell.checked ? "include" : "exclude"
    });
    const matching = filterOverview(scoped, {
      query: search.value,
      huc6: watershed.value,
      cadence: cadence.value as OverviewCadence
    });
    /* The strip narrows what is below it, but the strip itself keeps showing
     * the whole spread of the other filters -- otherwise choosing a class
     * would collapse the very chart that offers the choice. */
    const visible = storageClassFilter === null
      ? matching
      : matching.filter((reservoir) => classIndexOf(reservoir) === storageClassFilter);
    updateKpis(visible);
    renderClassStrip(matching);
    renderRows(tbody, filterAndSort(visible, "", sort.value as OverviewSort));
    const chosenClass = storageClassFilter === null
      ? "" : ` · ${STORAGE_CLASSES[storageClassFilter]?.label ?? ""}`;
    status.textContent = `${visible.length} of ${scoped.length} reservoirs shown · ` +
      `${geography.value === "connected" ? "All connected" : "Utah waterbodies"} · Lake Powell ` +
      `${lakePowell.checked ? "included" : "excluded"}${chosenClass}`;
    capacityHost.setAttribute("aria-busy", "true");
    watershedHost.setAttribute("aria-busy", "true");
    try {
      await Promise.all([
        renderArcgisBarChart(capacityHost, largestReservoirRecords(visible),
          "Percent full for the largest reservoirs in the filtered view",
          () => currentRevision === revision),
        renderArcgisBarChart(watershedHost, watershedRecords(visible),
          "Combined percent full by drainage area in the filtered view",
          () => currentRevision === revision)
      ]);
    } catch (error) {
      /* A chart that throws used to leave both hosts reporting `aria-busy`
       * with nothing in them and no readiness signal -- an empty box that
       * announces itself as still loading, forever. Say what happened and
       * stop claiming to be busy; the table below still has every value. */
      console.error("A chart could not be drawn:", error);
      if (currentRevision === revision) {
        for (const host of [capacityHost, watershedHost]) {
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
    capacityHost.setAttribute("aria-busy", "false");
    watershedHost.setAttribute("aria-busy", "false");
    window.__overviewReady = {
      reservoirs: scoped.length,
      visible: visible.length,
      charts: 2,
      lakePowellExcluded: !visible.some((reservoir) => reservoir.rise_item_id === 509)
    };
  };
  for (const control of [search, watershed, cadence, sort, lakePowell, geography]) {
    const event = control instanceof HTMLSelectElement
      || (control instanceof HTMLInputElement && control.type === "checkbox")
      ? "change"
      : "input";
    control.addEventListener(event, () => void update());
  }
  reset.addEventListener("click", () => {
    search.value = "";
    watershed.value = "all";
    cadence.value = "all";
    sort.value = "capacity";
    lakePowell.checked = false;
    geography.value = "utah";
    storageClassFilter = null;
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
