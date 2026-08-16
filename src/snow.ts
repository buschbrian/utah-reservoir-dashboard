/*
 * The snowpack view (ADR-021): its own page, never a layer on the reservoir
 * map. Snow water equivalent has no capacity and no percent full, so it gets
 * its own reading -- percent of the normal median for the same day -- and
 * its core rendering is the seasonal curve, not a single current value,
 * because a summer number compares little snow with little normal snow and
 * describes nothing.
 *
 * The map half: drainage areas filled by their mean for one chosen day,
 * sites as points on the same scale, and a day control across the water
 * year. The map is context; every number it colours is also in the chart
 * and tables, so a failed basemap or boundary file costs the reader a
 * picture, never a value.
 */
import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-navigation";
import "@esri/calcite-components/components/calcite-slider";

import { installAnonymousAuthPolicy } from "./arcgis/basemaps";
import { loadDrainageAreas } from "./data/boundaries";
import { loadSnowpack } from "./data/snow-load";
import {
  basinChoices,
  basinCurve,
  defaultMapDay,
  headlineFloor,
  mapDayValues,
  monthReadings,
  newestHeadline,
  normalPeriodLabel,
  regionCurve,
  seasonHighPoint,
  seasonLabel,
  siteRows,
  type CurvePoint
} from "./snow-model";
import { snowStateFromSearch, writeSnowUrl } from "./state/snow-url";
import type { SnowpackPayload } from "./types";
import { brandMarkup, pageLinksMarkup } from "./ui/page-header";
import { createSnowMap, type SnowMapController } from "./ui/snow-map";
import { wireTheme } from "./ui/theme";
import { NO_VALUE_LABEL, SNOW_CLASSES } from "./viz/snow-classes";
import { formatDate, formatPercent } from "./viz/format";
import { renderSnowCurve } from "./viz/snow-curve";
import "./styles/overview.css";
import "./styles/snow.css";

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#snow-app");
if (!root) throw new Error("Missing #snow-app root");

root.innerHTML = `
  <calcite-navigation class="overview-nav" aria-label="Primary navigation">
    ${brandMarkup(1)}
    ${pageLinksMarkup("snow")}
    <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
      icon="brightness" label="Change color theme"></calcite-action>
  </calcite-navigation>
  <main class="overview-main">
    <header class="overview-intro">
      <p>Snow that falls on the mountains melts into the reservoirs, so this winter's snow is next summer's storage. This page shows snow water equivalent: the depth of water the snow would make if it melted. The Natural Resources Conservation Service measures it every day at automatic mountain sites.</p>
    </header>
    <section id="snow-content" aria-live="polite"><calcite-loader label="Loading snow measurements"></calcite-loader></section>
  </main>`;
wireTheme();

function formatFeet(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatInches(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function renderSnow(payload: SnowpackPayload): void {
  const content = document.querySelector<HTMLElement>("#snow-content");
  if (!content) return;
  const choices = basinChoices(payload);
  const regionPoints = regionCurve(payload);
  const days = regionPoints.map((point) => point.date);
  content.innerHTML = `
    <section class="dashboard-filterbar" aria-labelledby="snow-filter-heading">
      <div class="filterbar-head">
        <div class="filterbar-title"><p class="eyebrow">Mountain snow</p><h2 id="snow-filter-heading">Choose a drainage area</h2></div>
      </div>
      <div class="filterbar-controls">
        <label>Drainage area<select id="snow-area"><option value="all">The whole region</option></select></label>
      </div>
    </section>
    <p id="snow-status" class="filter-status" role="status"></p>
    <section class="overview-kpis" aria-label="Snow measurement summary">
      <article class="overview-kpi overview-kpi-primary"><span>Newest value</span><strong data-snow-kpi="now">—</strong><small data-snow-kpi="now-note">—</small></article>
      <article class="overview-kpi"><span>Season high point</span><strong data-snow-kpi="peak">—</strong><small data-snow-kpi="peak-note">—</small></article>
      <article class="overview-kpi"><span>Measurement sites</span><strong data-snow-kpi="sites">—</strong><small>Measured every day</small></article>
      <article class="overview-kpi"><span>Late data</span><strong data-snow-kpi="late">—</strong><small>More than two days without a new value</small></article>
      <article class="overview-kpi"><span>Data published</span><strong>${formatDate(payload.as_of)}</strong><small>Snow season ${seasonLabel(payload)}</small></article>
    </section>
    <section class="overview-card" aria-labelledby="snow-map-heading">
      <div class="card-heading">
        <div><h2 id="snow-map-heading">Where the snow is</h2><p>Each drainage area is coloured by its mean percent of normal for the day shown, and each measurement site is a point on the same scale. Areas and sites without a fair value for that day stay grey.</p></div>
        <span class="sdk-badge">ArcGIS map</span>
      </div>
      <div class="drought-legend snow-map-legend" role="list" aria-label="Snow map classes and their colours"></div>
      <div id="snow-map-host" class="snow-map-host" aria-busy="true"
        aria-label="A map of the drainage areas and snow measurement sites. The chart and tables on this page carry the same values as text."></div>
      <div class="snow-day-row">
        <label class="snow-day-label" for="snow-day">Day shown</label>
        <calcite-slider id="snow-day" min="0" max="${Math.max(0, days.length - 1)}"
          step="1" snap label-handles="false" aria-label="Day of the snow season shown on the map"></calcite-slider>
        <span id="snow-day-reading" class="snow-day-reading">—</span>
      </div>
    </section>
    <section class="overview-card" aria-labelledby="snow-curve-heading">
      <div class="card-heading">
        <div><h2 id="snow-curve-heading">The snow season, day by day</h2><p data-snow-curve-caption>The line is the mean of the site values, as a percent of normal for each day. The dashed line marks normal: the middle value for the same day in the years ${normalPeriodLabel(payload)}. Gaps are days with too few reporting sites to give a fair mean.</p></div>
        <span class="sdk-badge">Line chart</span>
      </div>
      <div id="snow-curve-host" aria-busy="true"></div>
      <details class="snow-month-details"><summary>Values on the first day of each month</summary>
        <div class="table-scroll"><table class="overview-table"><thead><tr><th>Month</th><th>Of normal</th><th>Reporting sites</th></tr></thead><tbody id="snow-month-rows"></tbody></table></div>
      </details>
    </section>
    <section class="overview-card table-card" aria-labelledby="snow-table-heading">
      <div class="card-heading"><div><h2 id="snow-table-heading">Measurement sites</h2><p>The newest value at each site, ordered by drainage area and name. A summer value near zero is normal: the snow has melted.</p></div></div>
      <div class="table-scroll"><table class="overview-table"><thead><tr><th>Site</th><th>Drainage area</th><th>Elevation (feet)</th><th>Snow water (inches)</th><th>Normal (inches)</th><th>Of normal</th><th>Observed</th></tr></thead><tbody id="snow-site-rows"></tbody></table></div>
    </section>`;

  const area = document.querySelector<HTMLSelectElement>("#snow-area");
  const status = document.querySelector<HTMLElement>("#snow-status");
  const curveHost = document.querySelector<HTMLElement>("#snow-curve-host");
  const monthRows = document.querySelector<HTMLTableSectionElement>("#snow-month-rows");
  const siteRowsBody = document.querySelector<HTMLTableSectionElement>("#snow-site-rows");
  const mapHost = document.querySelector<HTMLElement>("#snow-map-host");
  const daySlider = document.querySelector<HTMLElement & { value?: number }>("#snow-day");
  const dayReading = document.querySelector<HTMLElement>("#snow-day-reading");
  if (!area || !status || !curveHost || !monthRows || !siteRowsBody
    || !mapHost || !daySlider || !dayReading) return;

  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.code;
    option.textContent = `${choice.label} (${choice.siteCount} sites)`;
    area.append(option);
  }

  const legend = document.querySelector<HTMLElement>(".snow-map-legend");
  if (legend) {
    const entries = [
      ...SNOW_CLASSES.map((entry) => ({ label: entry.label, color: entry.color as string | null })),
      { label: NO_VALUE_LABEL, color: null }
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

  const setKpi = (name: string, value: string): void => {
    const element = document.querySelector<HTMLElement>(`[data-snow-kpi="${name}"]`);
    if (element) element.textContent = value;
  };

  /* Map state. The map arrives after the numbers; every publish of the
   * readiness signal reads whatever it has so far, adding fields and never
   * removing one. */
  let map: SnowMapController | null = null;
  const fallbackDay = days.length > 0 ? days[days.length - 1]! : null;
  const startDay = defaultMapDay(payload) ?? fallbackDay;
  let currentDay = startDay;
  let currentArea: string | null = null;
  let lastCurvePoints = 0;

  const publishReady = (): void => {
    const rows = siteRows(payload, currentArea);
    window.__snowReady = {
      sites: payload.site_count,
      late: payload.late_site_count,
      basins: payload.rollups.length,
      curvePoints: lastCurvePoints,
      tableRows: rows.length,
      area: currentArea,
      ...(map ? {
        mapBasins: map.status.basins,
        mapSites: map.status.sites,
        mapBasinsWithValues: map.status.basinsWithValues,
        mapSitesWithValues: map.status.sitesWithValues,
        mapDay: map.status.day,
        mapBasemap: map.status.basemap,
        mapViewReady: map.status.viewReady
      } : {})
    };
  };

  const describeDay = (day: string): string => {
    const point = regionPoints.find((entry) => entry.date === day);
    const sitesNote = point ? `, ${point.reportingSites} sites reporting` : "";
    return `${formatDate(day)}${sitesNote}`;
  };

  const applyDay = (day: string): void => {
    currentDay = day;
    dayReading.textContent = describeDay(day);
    if (daySlider.value !== undefined) daySlider.value = Math.max(0, days.indexOf(day));
    if (map) map.setDay(mapDayValues(payload, day), day);
    writeSnowUrl({ area: currentArea, day: day === startDay ? null : day });
    publishReady();
  };

  const update = (): void => {
    const chosen = area.value === "all" ? null : area.value;
    currentArea = chosen;
    const chosenLabel = chosen === null
      ? "the whole region"
      : choices.find((choice) => choice.code === chosen)?.label ?? "the whole region";
    const curve: CurvePoint[] = (chosen === null
      ? regionPoints
      : basinCurve(payload, chosen)) ?? regionPoints;
    const rows = siteRows(payload, chosen);

    /* Headlines hold to a stronger floor than the curve: at least half the
     * sites in view. Without it, October's first flurries and June's last
     * two unmelted stations become the page's largest numbers. */
    const floor = headlineFloor(rows.length, 2);
    const latest = newestHeadline(curve, floor);
    setKpi("now", latest ? formatPercent(latest.percent) : "—");
    setKpi("now-note", latest
      ? `Of normal on ${formatDate(latest.date)}, the newest day when at ` +
        `least half the sites gave a value (${latest.reportingSites} of ${rows.length})`
      : "Too few sites have values yet this season");
    const peak = seasonHighPoint(curve, floor);
    setKpi("peak", peak ? formatPercent(peak.percent) : "—");
    setKpi("peak-note", peak
      ? `Of normal, on ${formatDate(peak.date)}, from ${peak.reportingSites} sites`
      : "Too few sites have values yet this season");
    setKpi("sites", String(rows.length));
    setKpi("late", String(rows.filter((row) => row.late).length));

    const chart = renderSnowCurve(curve,
      `Mean snow water for ${chosenLabel} as a percent of normal, day by day ` +
      `for the season ${seasonLabel(payload)}. The dashed line marks normal. ` +
      `The table below lists the value on the first day of each month.`);
    let curvePoints = 0;
    if (chart) {
      curveHost.replaceChildren(chart);
      curvePoints = curve.filter((point) => point.percent !== null).length;
    } else {
      const empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent =
        "Too few sites have reported this season to draw a fair mean.";
      curveHost.replaceChildren(empty);
    }
    curveHost.setAttribute("aria-busy", "false");

    monthRows.replaceChildren(...monthReadings(curve).map((month) => {
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = month.label;
      const percent = document.createElement("td");
      percent.textContent = month.point ? formatPercent(month.point.percent) : "—";
      const sites = document.createElement("td");
      sites.textContent = month.point ? String(month.point.reportingSites) : "—";
      row.append(name, percent, sites);
      return row;
    }));

    siteRowsBody.replaceChildren(...rows.map((site) => {
      const row = document.createElement("tr");
      const cells = [site.name, site.basinName, formatFeet(site.elevationFeet),
        formatInches(site.inches), formatInches(site.normalInches),
        formatPercent(site.percent), formatDate(site.latestDate)];
      cells.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (index === 6 && site.late) cell.className = "late-badge";
        row.append(cell);
      });
      return row;
    }));

    status.textContent = `${rows.length} of ${payload.site_count} sites shown · ` +
      (chosen === null ? "The whole region" : chosenLabel);
    if (map) map.setArea(chosen);
    writeSnowUrl({
      area: chosen,
      day: currentDay === startDay ? null : currentDay
    });
    lastCurvePoints = curvePoints;
    publishReady();
  };

  area.addEventListener("change", update);
  daySlider.addEventListener("calciteSliderInput", () => {
    const index = Number(daySlider.value ?? 0);
    const day = days[Math.max(0, Math.min(days.length - 1, index))];
    if (day) applyDay(day);
  });

  const wanted = snowStateFromSearch(window.location.search);
  area.value = wanted.area !== null
    && choices.some((choice) => choice.code === wanted.area)
    ? wanted.area : "all";
  if (wanted.day !== null && days.includes(wanted.day)) currentDay = wanted.day;
  update();
  if (currentDay) {
    dayReading.textContent = describeDay(currentDay);
    if (daySlider.value !== undefined) daySlider.value = Math.max(0, days.indexOf(currentDay));
  }

  /* The map starts after the figures are on screen. Boundaries or basemap
   * failing costs the picture only; the note says so and the page keeps
   * every number. */
  void (async () => {
    try {
      installAnonymousAuthPolicy();
      const areas = await loadDrainageAreas();
      if (areas.length === 0) throw new Error("no drainage boundaries");
      const mapElement = document.createElement("arcgis-map");
      /* Framed to the fourteen units: roughly -114 to -105.6 east-west and
       * 35.6 to 44 north-south. Zoom 5 at this card width spans Oregon to
       * Minnesota; 5.7 holds the region with a small margin. */
      mapElement.setAttribute("center", "-110.3,39.8");
      mapElement.setAttribute("zoom", "5.7");
      const zoom = document.createElement("arcgis-zoom");
      zoom.setAttribute("position", "top-right");
      mapElement.append(zoom);
      mapHost.replaceChildren(mapElement);
      const firstDay = currentDay
        ? { values: mapDayValues(payload, currentDay), day: currentDay }
        : null;
      map = await createSnowMap(mapElement, areas, payload.sites, firstDay);
      map.setArea(currentArea);
      mapHost.setAttribute("aria-busy", "false");
      if (!map.status.basemap) {
        const note = document.createElement("p");
        note.className = "chart-empty";
        note.setAttribute("role", "status");
        note.textContent =
          "The map background is unavailable. Areas and sites are still drawn from local data.";
        mapHost.append(note);
      }
      publishReady();
    } catch (error) {
      console.warn("The snow map could not start:", error);
      mapHost.setAttribute("aria-busy", "false");
      const note = document.createElement("p");
      note.className = "chart-empty";
      note.setAttribute("role", "status");
      note.textContent =
        "The map could not start. The chart and tables carry the same values.";
      mapHost.replaceChildren(note);
      publishReady();
    }
  })();
}

try {
  const payload = await loadSnowpack();
  renderSnow(payload);
} catch (error) {
  console.error("Snowpack view failed:", error);
  const content = document.querySelector<HTMLElement>("#snow-content");
  if (content) content.innerHTML = `<div class="overview-error" role="alert"><strong>The snow measurements could not load.</strong><p>Try again later or return to the storage map.</p></div>`;
}
