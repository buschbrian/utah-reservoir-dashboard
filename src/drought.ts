/*
 * The drought view: the U.S. Drought Monitor's weekly classes, read by
 * drainage area beside the reservoirs that drain it.
 *
 * The monitor is consumed as data, never embedded: the polygons were
 * downloaded and verified by a tool, the coverage figures were computed and
 * committed by another, and this page renders those committed numbers in
 * the monitor's own colours with this project's vocabulary and freshness
 * handling. The one join no other product makes is on this page: land
 * conditions and banked storage for the same drainage area, side by side --
 * a full reservoir in extreme drought is a region living on savings, and a
 * reader should not need two websites to see it.
 */
import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-navigation";

import { installAnonymousAuthPolicy } from "./arcgis/basemaps";
import { loadReferenceBoundaries } from "./arcgis/reference-layers";

import { loadDrainageScope, loadOfferedLevels } from "./data/boundaries";
import { loadDroughtCoverage } from "./data/drought-load";
import { loadReservoirs } from "./data/load";
import { loadUsdmPolygons } from "./data/usdm-load";
import {
  areasAtOrWorse,
  coverageSegments,
  daysOld,
  DRYNESS_CLASS,
  isLateRelease,
  isMeasured,
  byStorageGap,
  orderUnits,
  regionWorst,
  storageAgainstDrought,
  storageByArea,
  unitsAtOrWorse,
  worstClass,
  worstClassCounts,
  type DroughtSort,
  type StorageContext
} from "./drought-model";
import {
  droughtStateFromSearch,
  writeDroughtUrl,
  type DroughtUrlState
} from "./state/drought-url";
import { levelFromSearch, writeLevel } from "./state/level";
import { createLevelControl } from "./ui/level-control";
import { renderDroughtScatter } from "./viz/drought-scatter";
import { renderDroughtGap } from "./viz/drought-gap";
import { renderDroughtSeverity } from "./viz/drought-severity";
import type { DroughtCoveragePayload, Reservoir } from "./types";
import { createDroughtMap } from "./ui/drought-map";
import type { ReservoirReference } from "./ui/layers";
import { createViewMap, mapStatusNote } from "./ui/view-map";
import { brandMarkup, pageLinksMarkup, updatePageLinks } from "./ui/page-header";
import { wireTheme } from "./ui/theme";
import { DROUGHT_CLASSES, NO_DROUGHT_LABEL } from "./viz/drought-classes";
import { formatDate, formatPercent } from "./viz/format";
import "./styles/overview.css";
import "./styles/drought.css";

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#drought-app");
if (!root) throw new Error("Missing #drought-app root");

root.innerHTML = `
  <calcite-navigation class="overview-nav" aria-label="Primary navigation">
    ${brandMarkup(1, "drought")}
    ${pageLinksMarkup("drought", window.location.search)}
    <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
      icon="brightness" label="Change color theme"></calcite-action>
  </calcite-navigation>
  <main class="overview-main">
    <header class="overview-intro">
      <p>How dry the land is, area by area, from the U.S. Drought Monitor's weekly national map. Each drainage area also shows its reservoir storage, because the two can disagree. A full reservoir in a dry basin is a region that draws on saved water.</p>
    </header>
    <section id="drought-content" aria-live="polite"><calcite-loader label="Loading drought conditions"></calcite-loader></section>
  </main>`;
wireTheme();

function renderDrought(
  payload: DroughtCoveragePayload,
  storage: Map<string, StorageContext> | null,
  /* The reservoirs themselves, not only their per-area rollup: the map
   * places and names each one, and the rollup has already thrown away where
   * they are. Empty when the payload could not be read, which the rows
   * below already say in words. */
  reservoirs: readonly ReservoirReference[]
): void {
  const content = document.querySelector<HTMLElement>("#drought-content");
  if (!content) return;

  const today = new Date();
  const age = daysOld(payload.release_date, today);
  const late = isLateRelease(payload.release_date, today);
  const worst = regionWorst(payload.units);
  const extremeAreas = areasAtOrWorse(payload.units, "d3");

  const dryness = DROUGHT_CLASSES.find((entry) => entry.key === DRYNESS_CLASS)!;

  content.innerHTML = `
    <section class="dashboard-filterbar" aria-labelledby="drought-filter-heading">
      <div class="filterbar-head">
        <div class="filterbar-title"><p class="eyebrow">Land conditions</p><h2 id="drought-filter-heading">Narrow the drainage areas</h2></div>
        <div class="filterbar-head-actions"><calcite-button id="drought-reset" class="reset-button" appearance="outline" scale="s" kind="neutral">Show every area</calcite-button></div>
      </div>
      <div class="filterbar-controls">
        <label>Show areas with<select id="drought-worse">
          <option value="">Any conditions</option>
          ${DROUGHT_CLASSES.map((entry) => `<option value="${entry.key}">${entry.label} (${entry.code}) or worse</option>`).join("")}
        </select></label>
        <label>Order by<select id="drought-sort">
          <option value="severity">Most severe first</option>
          <option value="storage">Emptiest reservoirs first</option>
          <option value="name">Drainage area name</option>
        </select></label>
      </div>
    </section>
    <p id="drought-status" class="filter-status" role="status"></p>
    <section class="overview-kpis" aria-label="Drought summary">
      <article class="overview-kpi overview-kpi-primary"><span>Worst conditions</span><strong>${worst ? worst.label : "None"}</strong><small>${worst ? `The most severe class with land in it (${worst.code})` : "No drainage area has land in a drought class"}</small></article>
      <article class="overview-kpi"><span>Areas in extreme drought or worse</span><strong>${extremeAreas} of ${payload.unit_count}</strong><small>Any land at the extreme (D3) or exceptional (D4) class</small></article>
      <article class="overview-kpi"><span>Map week</span><strong>${formatDate(payload.map_date)}</strong><small>Published ${formatDate(payload.release_date)}</small></article>
      <article class="overview-kpi"><span>Map age</span><strong${late ? ' class="late-badge"' : ""}>${age} ${age === 1 ? "day" : "days"}</strong><small>${late ? "Late data: a new weekly map has been missed" : "A new map is published each Thursday"}</small></article>
    </section>
    <section class="overview-card" aria-labelledby="drought-map-heading">
      <div class="card-heading">
        <div><h2 id="drought-map-heading">The drought map</h2><p>The monitor's weekly national map in its own colours, for the week of ${formatDate(payload.map_date)}. The outlined shapes are the ${payload.unit_count} drainage areas the figures below describe. Drought does not stop at their edges, so the map draws the wider pattern too.</p></div>
        <span class="sdk-badge">ArcGIS map</span>
      </div>
      <div id="drought-map-host" class="view-map-host has-inset-legend" aria-busy="true"
        aria-label="A map of drought classes over the drainage areas. The bars and table on this page carry the same shares as text."></div>
    </section>
    <section class="overview-card" aria-labelledby="drought-severity-heading">
      <div class="card-heading">
        <div><h2 id="drought-severity-heading">How the areas are divided</h2><p>Every drainage area counted once, at the most severe class with land in it. The tile above says how many are at extreme drought or worse. This says where all ${payload.unit_count} sit, which is a different question. Nine clear areas and nine areas one class below the line give the same count, and they are not the same week. Levels with no areas in them are still drawn, so one week can be compared with another.</p></div>
      </div>
      <div id="drought-severity-host" class="drought-severity-host"></div>
      <ul class="overlay-key" id="drought-severity-key" aria-label="What each severity level is called"></ul>
    </section>
    <section class="overview-card" aria-labelledby="drought-join-heading">
      <div class="card-heading">
        <div><h2 id="drought-join-heading">Dry land against banked water</h2><p>Each drainage area is one point. How much of its land is in ${dryness.label.toLowerCase()} (${dryness.code}) or worse goes across the bottom. How full its reservoirs are goes up the side. The colour is the most severe class with land in it. The two do not have to agree, and where they disagree is the point. An area far to the right and high up draws on water banked in better years. One far to the right and low has neither the rain nor the savings.</p></div>
      </div>
      <div id="drought-scatter-host" class="drought-scatter-host"></div>
    </section>
    <section class="overview-card" aria-labelledby="drought-gap-heading">
      <div class="card-heading">
        <div><h2 id="drought-gap-heading">The same comparison, in order</h2><p>One row for each drainage area, worst first. The left dot is the share of land in ${dryness.label.toLowerCase()} (${dryness.code}) or worse, in the class colours. The right dot is how full that area's reservoirs are, in the storage colours. The line between them is the distance, and it is only a distance. The two shares divide by different things, one by land and one by reservoir capacity, so the site never states their difference as a number. Rows where the water dot sits left of the dry dot are areas with dry ground and little banked to draw on.</p></div>
      </div>
      <div id="drought-gap-host" class="drought-gap-host"></div>
    </section>
    <section class="overview-card table-card" aria-labelledby="drought-areas-heading">
      <div class="card-heading"><div><h2 id="drought-areas-heading">Each drainage area</h2><p>The bar is the share of the area's land in each class, in the same colours as the map above. The figure beside the name is the combined reservoir storage in that area, as a percent of the combined full level.</p></div></div>
      <div class="drought-rows"></div>
      <details class="snow-month-details"><summary>Exact values for every class</summary>
        <div class="table-scroll" tabindex="0" role="region" aria-label="Drought class table, scrolls sideways"><table class="overview-table"><thead><tr><th>Drainage area</th><th>No drought</th><th>D0</th><th>D1</th><th>D2</th><th>D3</th><th>D4</th><th>Extreme or worse</th></tr></thead><tbody id="drought-table-rows"></tbody></table></div>
      </details>
      <p class="drought-attribution">${payload.attribution}. Read the full national map at <a href="https://droughtmonitor.unl.edu/" target="_blank" rel="noreferrer">droughtmonitor.unl.edu</a>.</p>
    </section>`;

  /* Filter state, read from the address bar so a shared link opens on the
   * same view. The map is deliberately not filtered with the rows: it draws
   * the national sweep, and hiding drainage outlines from it would leave a
   * pattern with nothing to locate it against. */
  const wanted = droughtStateFromSearch(window.location.search);
  let state: DroughtUrlState = { ...wanted };

  const worseSelect = content.querySelector<HTMLSelectElement>("#drought-worse");
  const sortSelect = content.querySelector<HTMLSelectElement>("#drought-sort");
  const statusLine = content.querySelector<HTMLElement>("#drought-status");
  const resetButton = content.querySelector<HTMLElement>("#drought-reset");
  const scatterHost = content.querySelector<HTMLElement>("#drought-scatter-host");
  const gapHost = content.querySelector<HTMLElement>("#drought-gap-host");
  const severityHost = content.querySelector<HTMLElement>("#drought-severity-host");
  const severityKey = content.querySelector<HTMLElement>("#drought-severity-key");
  if (worseSelect) worseSelect.value = state.worse ?? "";
  if (sortSelect) sortSelect.value = state.sort;

  /* The legend lives inside the map rather than above it. A key belongs
   * beside the thing it explains: over the map the reader's eye moves inches
   * between a colour and its name instead of leaving the picture entirely,
   * and the card reclaims the band the key used to occupy.
   *
   * Built here with the rest of the figures, but *attached* only once the map
   * exists. `createViewMap` calls `replaceChildren` on the host, so a legend
   * appended before that is silently thrown away -- which is exactly what
   * happened on the first attempt. It is attached either way: if the map
   * cannot start, the key still belongs with the note that explains why. */
  const legend = document.createElement("div");
  legend.className = "drought-legend map-inset-legend";
  legend.setAttribute("role", "list");
  legend.setAttribute("aria-label", "Drought classes and their map colours");
  if (legend) {
    const entries = [
      { label: NO_DROUGHT_LABEL, color: null },
      ...DROUGHT_CLASSES.map((entry) => ({
        label: `${entry.label} (${entry.code})`, color: entry.color as string | null
      }))
    ];
    legend.replaceChildren(...entries.map((entry) => {
      const item = document.createElement("span");
      item.className = "drought-legend-item";
      item.setAttribute("role", "listitem");
      const swatch = document.createElement("span");
      swatch.className = "drought-swatch" + (entry.color ? "" : " drought-segment-none");
      if (entry.color) swatch.style.background = entry.color;
      const label = document.createElement("span");
      label.textContent = entry.label;
      item.append(swatch, label);
      return item;
    }));
  }

  const rows = content.querySelector<HTMLElement>(".drought-rows");
  const tableBody = content.querySelector<HTMLTableSectionElement>("#drought-table-rows");

  /**
   * Everything the filter controls change, in one place.
   *
   * The rows, the exact-values table, the scatter and the sentence that
   * reports what is being shown all describe the same chosen set, so they are
   * rebuilt together. Splitting them is how one surface ends up describing a
   * filter another surface is no longer applying.
   */
  function draw(): void {
    const chosen = unitsAtOrWorse(payload.units, state.worse as never);
    const ordered = orderUnits(chosen, storage, state.sort);

    if (rows) {
    rows.replaceChildren(...ordered.map((unit) => {
      const row = document.createElement("article");
      row.className = "drought-row overview-kpi";

      const head = document.createElement("div");
      head.className = "drought-row-head";
      const name = document.createElement("h3");
      name.textContent = unit.huc6_name;
      head.append(name);
      const context = storage?.get(unit.huc6);
      const aside = document.createElement("span");
      aside.className = "drought-row-storage";
      aside.textContent = context
        ? `Reservoirs: ${formatPercent(context.percent)} full across ${context.reservoirCount}`
        : "Reservoir storage is not available just now";
      head.append(aside);

      const bar = document.createElement("div");
      bar.className = "drought-bar";
      const segments = coverageSegments(unit);
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label",
        `${unit.huc6_name}: ` + segments.map((segment) =>
          `${segment.label} ${formatPercent(segment.percent)}`).join(", ") +
        ". The table below lists every value.");
      for (const segment of segments) {
        const piece = document.createElement("span");
        piece.className = "drought-segment" + (segment.color ? "" : " drought-segment-none");
        piece.style.flexGrow = String(segment.percent);
        if (segment.color) piece.style.background = segment.color;
        piece.title = `${segment.label}: ${formatPercent(segment.percent)} of the land`;
        bar.append(piece);
      }

      const reading = document.createElement("p");
      reading.className = "drought-row-reading";
      const rowWorst = worstClass(unit);
      /* Three sentences for three facts: some drought, none measured as in
       * drought, and not measured at all -- the last is never the second
       * (ADR-059). */
      reading.textContent = !isMeasured(unit)
        ? "The drought monitor does not measure land in this area."
        : rowWorst
          ? `${formatPercent(unit.percent_of_area_at_least.d0)} of the land is in a ` +
            `drought class or abnormally dry. Worst class: ${rowWorst.label} ` +
            `(${rowWorst.code}), covering ${formatPercent(unit.percent_of_area[rowWorst.key])}.`
          : "No land in this area is in a drought class this week.";

      const links = document.createElement("p");
      links.className = "drought-row-links";
      const mapLink = document.createElement("a");
      mapLink.href = `./?area=${unit.huc6}`;
      mapLink.textContent = "Open on the storage map";
      const snowLink = document.createElement("a");
      snowLink.href = `./snow.html?area=${unit.huc6}`;
      snowLink.textContent = "Open the snowpack view";
      links.append(mapLink, snowLink);

      row.append(head, bar, reading, links);
      return row;
    }));
  }

    if (tableBody) {
    tableBody.replaceChildren(...ordered.map((unit) => {
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = unit.huc6_name;
      row.append(name);
      if (!isMeasured(unit)) {
        /* One spanning sentence, never a row of zeros: zeros here would
         * read as "no drought" about land the monitor cannot see. */
        const cell = document.createElement("td");
        cell.colSpan = 7;
        cell.textContent = "The drought monitor does not measure land in this area.";
        row.append(cell);
        return row;
      }
      const values = [
        unit.percent_of_area.none, unit.percent_of_area.d0,
        unit.percent_of_area.d1, unit.percent_of_area.d2,
        unit.percent_of_area.d3, unit.percent_of_area.d4,
        unit.percent_of_area_at_least.d3
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = formatPercent(value);
        row.append(cell);
      }
      return row;
    }));
    }

    /* The join, as a picture. Areas with no reservoir reading are left out
     * rather than plotted at zero -- an area with no reservoirs in it is not
     * an area whose reservoirs are empty -- and the count of what was left
     * out is stated under the chart rather than silently dropped. */
    const points = storageAgainstDrought(ordered, storage);
    if (scatterHost) {
      const chart = renderDroughtScatter(points, {
        drynessLabel: `${dryness.label.toLowerCase()} (${dryness.code})`,
        ariaLabel: `Each drainage area by how much of its land is in ` +
          `${dryness.label.toLowerCase()} or worse and how full its reservoirs ` +
          `are. The table below carries both numbers for every area.`,
        highlight: state.area
      });
      const missing = ordered.length - points.length;
      const note = document.createElement("p");
      note.className = "drought-chart-note";
      note.textContent = missing > 0
        ? `${points.length} of ${ordered.length} areas are plotted. ` +
          `${missing} ${missing === 1 ? "has" : "have"} no reservoir reading to ` +
          "compare against."
        : `All ${points.length} areas shown have a reservoir reading.`;
      if (chart) scatterHost.replaceChildren(chart, note);
      else {
        scatterHost.replaceChildren(mapStatusNote(
          "No area in view has a reservoir reading to compare against."));
      }
    }

    /* The same points the scatter drew, ranked. Built from `points` rather
     * than recomputed, so the two charts cannot disagree about which areas
     * have a reservoir reading. */
    let gapRows = 0;
    if (gapHost) {
      const ranked = byStorageGap(points);
      gapRows = renderDroughtGap(gapHost, ranked, {
        drynessLabel: `in ${dryness.label.toLowerCase()} (${dryness.code}) or worse`,
        ariaLabel: `Each drainage area, worst first, showing the share of its ` +
          `land in ${dryness.label.toLowerCase()} or worse beside how full its ` +
          "reservoirs are. The table below carries both numbers for every area."
      });
      if (gapRows === 0) {
        gapHost.replaceChildren(mapStatusNote(
          "No area in view has a reservoir reading to compare against."));
      }
    }

    /* Counted over every published area, not the filtered view. This chart
     * is the shape of the whole week; narrowing it to a chosen severity
     * would make it a picture of the filter instead. */
    let severityAreas = 0;
    if (severityHost) {
      const counts = worstClassCounts(payload.units, NO_DROUGHT_LABEL);
      severityAreas = renderDroughtSeverity(severityHost, counts,
        "How many drainage areas are at each drought severity, counted at the " +
        "most severe class with land in them.");
      if (severityKey) {
        severityKey.replaceChildren(...counts.map((entry) => {
          const item = document.createElement("li");
          const swatch = document.createElement("span");
          swatch.className = "drought-swatch"
            + (entry.color ? "" : " drought-segment-none");
          if (entry.color) swatch.style.background = entry.color;
          const text = document.createElement("span");
          text.textContent = entry.label;
          item.append(swatch, text);
          return item;
        }));
      }
    }

    if (statusLine) {
      const chosenClass = DROUGHT_CLASSES.find((entry) => entry.key === state.worse);
      const order = state.sort === "storage" ? "emptiest reservoirs first"
        : state.sort === "name" ? "by name" : "most severe first";
      statusLine.textContent = chosenClass
        ? `${ordered.length} of ${payload.unit_count} drainage areas have land in ` +
          `${chosenClass.label.toLowerCase()} (${chosenClass.code}) or worse, ${order}.`
        : `All ${ordered.length} drainage areas, ${order}.`;
    }

    window.__droughtReady = {
      ...(window.__droughtReady ?? {}),
      /* Two facts, two fields. Rows in the ranked comparison is not areas in
       * the severity chart: the first counts areas with a reservoir reading,
       * the second counts every published area. */
      gapRows,
      severityAreas,
      units: payload.unit_count,
      rows: ordered.length,
      level,
      worstClass: worst ? worst.code : null,
      mapDate: payload.map_date,
      daysOld: age,
      lateData: late,
      storageJoined: storage
        ? ordered.filter((unit) => storage.has(unit.huc6)).length
        : 0,
      severityFilter: state.worse,
      sort: state.sort,
      scatterPoints: points.length
    } as NonNullable<typeof window.__droughtReady>;
  }

  function update(next: Partial<DroughtUrlState>): void {
    state = { ...state, ...next };
    writeDroughtUrl(state);
    /* The write is a `replaceState`; there is no navigation to re-render the
     * bar, so its links are brought up to date here or not at all. */
    updatePageLinks(window.location.search);
    draw();
  }

  /* The level control arrives with the reference export rather than with the
   * page, because which levels are on offer is the export's answer to give
   * (ADR-064) and it is the same request the map below already makes. A
   * reader who never waits for it sees the page they asked for. */
  void loadOfferedLevels().then((offered) => {
    const control = createLevelControl(offered, level, (chosen) => {
      /* A full navigation rather than a re-render: the level changes which
       * file this page fetches and every figure computed from it, so the
       * honest implementation is the one a shared link already takes. Replace
       * rather than push, like every other control here -- the back button
       * leaves the site rather than unwinding filter changes one at a time. */
      const params = new URLSearchParams(window.location.search);
      writeLevel(params, chosen);
      const query = params.toString();
      window.location.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
      /* Large, because the native selects it sits beside are a third taller
       * than a Calcite control at the default scale. */
    }, { scale: "l" });
    if (control) content.querySelector(".filterbar-controls")?.append(control.element);
    window.__droughtReady = {
      ...(window.__droughtReady ?? {}), levelsOffered: offered.length || 1
    } as NonNullable<typeof window.__droughtReady>;
  }).catch((error: unknown) => {
    /* No control rather than a broken one. The page is drawn at the level it
     * was asked for either way. */
    console.warn("The area-size control could not be built:", error);
  });

  worseSelect?.addEventListener("change", () => {
    update({ worse: worseSelect.value === "" ? null : worseSelect.value });
  });
  sortSelect?.addEventListener("change", () => {
    update({ sort: sortSelect.value as DroughtSort });
  });
  resetButton?.addEventListener("click", () => {
    if (worseSelect) worseSelect.value = "";
    if (sortSelect) sortSelect.value = "severity";
    update({ worse: null, sort: "severity" });
  });

  draw();

  /* The map starts after the figures are on screen, from its own two
   * fetches: the national polygons the coverage was computed from, and the
   * drainage boundaries. Either failing costs the picture only; the note
   * says so and every share stays in the bars and table. */
  void (async () => {
    const mapHost = content.querySelector<HTMLElement>("#drought-map-host");
    if (!mapHost) return;
    const failed = (): void => {
      mapHost.setAttribute("aria-busy", "false");
      mapHost.replaceChildren(mapStatusNote(
        "The map could not start. The bars and table carry the same shares."));
      /* The key still describes the bars below, so it is kept even when
       * there is no map to put it over. */
      legend.classList.remove("map-inset-legend");
      mapHost.append(legend);
      window.__droughtReady = {
        ...(window.__droughtReady ?? {}), mapClassesDrawn: 0, mapOutlines: 0
      } as NonNullable<typeof window.__droughtReady>;
    };
    try {
      installAnonymousAuthPolicy();
      /* Three fetches, one wait. The boundaries are the only optional one
       * -- they come from hosted services and resolve to null rather than
       * throwing, so a slow or missing state layer costs outlines and never
       * the map. */
      const [scope, usdm, boundaries] = await Promise.all(
        [loadDrainageScope(level), loadUsdmPolygons(), loadReferenceBoundaries()]);
      if (scope.areas.length === 0) throw new Error("no drainage boundaries");
      if (usdm.mapDate !== payload.map_date) {
        /* Two committed files describing two different weeks is a pipeline
         * fault the reader must not have to notice on their own. */
        throw new Error(
          `polygon week ${usdm.mapDate} does not match coverage week ${payload.map_date}`);
      }
      /* Framed, controlled and constrained exactly like the storage map,
       * with the hover card already beside it in the host. */
      const { element: mapElement, card } = createViewMap(mapHost, {
        label: "A map of drought classes over the drainage areas and reservoirs",
        cardId: "drought-map-hover"
      });
      const mapStatus = await createDroughtMap(
        mapElement, card, scope, usdm, reservoirs,
        { units: payload.units, storage: storage ?? new Map() }, boundaries);
      // After the component has claimed the host, never before.
      mapHost.append(legend);
      mapHost.setAttribute("aria-busy", "false");
      if (!mapStatus.basemap) {
        mapHost.append(mapStatusNote("The map background is unavailable. " +
          "Drought classes, outlines and reservoirs are still drawn from local data."));
      } else if (mapStatus.basemapDegraded) {
        mapHost.append(mapStatusNote(
          "The preferred map background was unavailable. An alternate is shown."));
      }
      window.__droughtReady = {
        ...(window.__droughtReady ?? {}),
        mapClassesDrawn: mapStatus.classesDrawn,
        mapOutlines: mapStatus.outlines,
        mapAreaLabels: mapStatus.areaLabels,
        mapAreaLabelsDeconflicted: mapStatus.areaLabelsDeconflicted,
        mapReservoirs: mapStatus.reservoirs,
        mapReservoirLabels: mapStatus.reservoirLabels,
        mapStateBoundaries: mapStatus.stateBoundaries,
        mapCountyBoundaries: mapStatus.countyBoundaries,
        mapBasemap: mapStatus.basemap,
        mapViewReady: mapStatus.viewReady
      } as NonNullable<typeof window.__droughtReady>;
    } catch (error) {
      console.warn("The drought map could not start:", error);
      failed();
    }
  })();
}

const level = levelFromSearch(window.location.search);

try {
  const drought = await loadDroughtCoverage(level);
  /* Storage is context, not the subject: if the reservoir payload cannot be
   * read the drought figures still render, each row saying the storage
   * comparison is missing rather than the page failing whole. */
  let storage: Map<string, StorageContext> | null = null;
  let reservoirs: readonly Reservoir[] = [];
  try {
    reservoirs = (await loadReservoirs()).reservoirs;
    storage = storageByArea(reservoirs, level);
  } catch (error) {
    console.warn("Reservoir storage could not be joined to the drought view:", error);
  }
  renderDrought(drought, storage, reservoirs);
} catch (error) {
  console.error("Drought view failed:", error);
  const content = document.querySelector<HTMLElement>("#drought-content");
  if (content) content.innerHTML = `<div class="overview-error" role="alert"><strong>The drought conditions could not load.</strong><p>Try again later or return to the storage map.</p></div>`;
}
