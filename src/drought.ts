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

import { loadDrainageAreas } from "./data/boundaries";
import { loadDroughtCoverage } from "./data/drought-load";
import { loadReservoirs } from "./data/load";
import { loadUsdmPolygons } from "./data/usdm-load";
import {
  areasAtOrWorse,
  bySeverity,
  coverageSegments,
  daysOld,
  isLateRelease,
  regionWorst,
  storageByArea,
  worstClass,
  type StorageContext
} from "./drought-model";
import type { DroughtCoveragePayload } from "./types";
import { createDroughtMap } from "./ui/drought-map";
import { mapStatusNote } from "./ui/view-map";
import { brandMarkup, pageLinksMarkup } from "./ui/page-header";
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
    ${brandMarkup(1)}
    ${pageLinksMarkup("drought")}
    <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
      icon="brightness" label="Change color theme"></calcite-action>
  </calcite-navigation>
  <main class="overview-main">
    <header class="overview-intro">
      <p>How dry the land is, area by area, from the U.S. Drought Monitor's weekly national map. Reservoir storage is shown beside each drainage area because the two can disagree: a full reservoir in a dry basin is a region drawing on saved water.</p>
    </header>
    <section id="drought-content" aria-live="polite"><calcite-loader label="Loading drought conditions"></calcite-loader></section>
  </main>`;
wireTheme();

function renderDrought(
  payload: DroughtCoveragePayload,
  storage: Map<string, StorageContext> | null
): void {
  const content = document.querySelector<HTMLElement>("#drought-content");
  if (!content) return;

  const today = new Date();
  const age = daysOld(payload.release_date, today);
  const late = isLateRelease(payload.release_date, today);
  const worst = regionWorst(payload.units);
  const extremeAreas = areasAtOrWorse(payload.units, "d3");
  const ordered = bySeverity(payload.units);

  content.innerHTML = `
    <section class="overview-kpis" aria-label="Drought summary">
      <article class="overview-kpi overview-kpi-primary"><span>Worst conditions</span><strong>${worst ? worst.label : "None"}</strong><small>${worst ? `The most severe class with land in it (${worst.code})` : "No drainage area has land in a drought class"}</small></article>
      <article class="overview-kpi"><span>Areas in extreme drought or worse</span><strong>${extremeAreas} of ${payload.unit_count}</strong><small>Any land at the extreme (D3) or exceptional (D4) class</small></article>
      <article class="overview-kpi"><span>Map week</span><strong>${formatDate(payload.map_date)}</strong><small>Published ${formatDate(payload.release_date)}</small></article>
      <article class="overview-kpi"><span>Map age</span><strong${late ? ' class="late-badge"' : ""}>${age} ${age === 1 ? "day" : "days"}</strong><small>${late ? "Late data: a new weekly map has been missed" : "A new map is published each Thursday"}</small></article>
    </section>
    <section class="overview-card" aria-labelledby="drought-map-heading">
      <div class="card-heading">
        <div><h2 id="drought-map-heading">The drought map</h2><p>The monitor's weekly national map in its own colours, for the week of ${formatDate(payload.map_date)}. The outlined shapes are the fourteen drainage areas the figures below describe; drought does not stop at their edges, so the wider pattern is drawn too.</p></div>
        <span class="sdk-badge">ArcGIS map</span>
      </div>
      <div class="drought-legend" role="list" aria-label="Drought classes and their map colours"></div>
      <div id="drought-map-host" class="view-map-host" aria-busy="true"
        aria-label="A map of drought classes over the drainage areas. The bars and table on this page carry the same shares as text."></div>
    </section>
    <section class="overview-card table-card" aria-labelledby="drought-areas-heading">
      <div class="card-heading"><div><h2 id="drought-areas-heading">Each drainage area, most severe first</h2><p>The bar is the share of the area's land in each class, in the same colours as the map above. The figure beside the name is the combined reservoir storage in that area, as a percent of the combined full level.</p></div></div>
      <div class="drought-rows"></div>
      <details class="snow-month-details"><summary>Exact values for every class</summary>
        <div class="table-scroll"><table class="overview-table"><thead><tr><th>Drainage area</th><th>No drought</th><th>D0</th><th>D1</th><th>D2</th><th>D3</th><th>D4</th><th>Extreme or worse</th></tr></thead><tbody id="drought-table-rows"></tbody></table></div>
      </details>
      <p class="drought-attribution">${payload.attribution}. Read the full national map at <a href="https://droughtmonitor.unl.edu/" target="_blank" rel="noreferrer">droughtmonitor.unl.edu</a>.</p>
    </section>`;

  const legend = content.querySelector<HTMLElement>(".drought-legend");
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
      reading.textContent = rowWorst
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

  const tableBody = content.querySelector<HTMLTableSectionElement>("#drought-table-rows");
  if (tableBody) {
    tableBody.replaceChildren(...ordered.map((unit) => {
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = unit.huc6_name;
      row.append(name);
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

  window.__droughtReady = {
    units: payload.unit_count,
    rows: ordered.length,
    worstClass: worst ? worst.code : null,
    mapDate: payload.map_date,
    daysOld: age,
    lateData: late,
    storageJoined: storage
      ? ordered.filter((unit) => storage.has(unit.huc6)).length
      : 0
  };

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
      window.__droughtReady = {
        ...(window.__droughtReady ?? {}), mapClassesDrawn: 0, mapOutlines: 0
      } as typeof window.__droughtReady;
    };
    try {
      installAnonymousAuthPolicy();
      const [areas, usdm] = await Promise.all(
        [loadDrainageAreas(), loadUsdmPolygons()]);
      if (areas.length === 0) throw new Error("no drainage boundaries");
      if (usdm.mapDate !== payload.map_date) {
        /* Two committed files describing two different weeks is a pipeline
         * fault the reader must not have to notice on their own. */
        throw new Error(
          `polygon week ${usdm.mapDate} does not match coverage week ${payload.map_date}`);
      }
      const mapElement = document.createElement("arcgis-map");
      const zoom = document.createElement("arcgis-zoom");
      zoom.setAttribute("position", "top-right");
      mapElement.append(zoom);
      mapHost.replaceChildren(mapElement);
      const mapStatus = await createDroughtMap(mapElement, areas, usdm);
      mapHost.setAttribute("aria-busy", "false");
      if (!mapStatus.basemap) {
        mapHost.append(mapStatusNote("The map background is unavailable. " +
          "Drought classes and outlines are still drawn from local data."));
      }
      window.__droughtReady = {
        ...(window.__droughtReady ?? {}),
        mapClassesDrawn: mapStatus.classesDrawn,
        mapOutlines: mapStatus.outlines,
        mapBasemap: mapStatus.basemap,
        mapViewReady: mapStatus.viewReady
      } as typeof window.__droughtReady;
    } catch (error) {
      console.warn("The drought map could not start:", error);
      failed();
    }
  })();
}

try {
  const drought = await loadDroughtCoverage();
  /* Storage is context, not the subject: if the reservoir payload cannot be
   * read the drought figures still render, each row saying the storage
   * comparison is missing rather than the page failing whole. */
  let storage: Map<string, StorageContext> | null = null;
  try {
    storage = storageByArea((await loadReservoirs()).reservoirs);
  } catch (error) {
    console.warn("Reservoir storage could not be joined to the drought view:", error);
  }
  renderDrought(drought, storage);
} catch (error) {
  console.error("Drought view failed:", error);
  const content = document.querySelector<HTMLElement>("#drought-content");
  if (content) content.innerHTML = `<div class="overview-error" role="alert"><strong>The drought conditions could not load.</strong><p>Try again later or return to the storage map.</p></div>`;
}
