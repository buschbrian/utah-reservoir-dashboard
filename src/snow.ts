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
import { loadDrainageScope, loadOfferedLevels } from "./data/boundaries";
import {
  areaAtLevel,
  DEFAULT_OPENING_SELECTION,
  loadOpeningRosters,
  openingSelectionFromSearch,
  resolveOpeningScope,
  withinOpeningArea,
  type OpeningRosters,
  type OpeningScope,
  type OpeningSelection,
  EMPTY_OPENING_ROSTERS
} from "./data/opening-scope";
import { stateName } from "./data/state-vocabulary";
import { loadSnowpack } from "./data/snow-load";
import {
  areaCanReport,
  basinChoices,
  basinCurve,
  defaultMapDay,
  headlineFloor,
  mapDayValues,
  monthReadings,
  newestHeadline,
  normalPeriodLabel,
  observedPeak,
  measuredScope,
  payloadAtLevel,
  payloadForSites,
  payloadForState,
  percentOfNormal,
  regionCurve,
  seasonHighPoint,
  seasonLabel,
  siteByStation,
  siteMonthReadings,
  sitePoints,
  siteRows,
  siteSpread,
  siteTiming,
  ELEVATION_BANDS,
  elevationBandLabel,
  filterSiteRows,
  isElevationBand,
  isSiteStatus,
  siteFilterActive,
  type CurvePoint,
  type ElevationBand,
  type SiteFilter,
  type SiteStatus
} from "./snow-model";
import { levelFromSearch, writeLevel } from "./state/level";
import { snowStateFromSearch, writeSnowUrl } from "./state/snow-url";
import type { SnowpackPayload } from "./types";
import { brandMarkup, pageLinksMarkup, updatePageLinks } from "./ui/page-header";
import { createLevelControl } from "./ui/level-control";
import { createWhereControl } from "./ui/where-control";
import { createSnowMap, type SnowMapController } from "./ui/snow-map";
import { createViewMap, mapStatusNote } from "./ui/view-map";
import { nameSliderHandle } from "./ui/slider-label";
import { wireTheme } from "./ui/theme";
import { NO_VALUE_LABEL, SNOW_CLASSES, snowClassIndex } from "./viz/snow-classes";
import {
  mapExtentFromBox
} from "./viz/extent";
import { formatDate, formatPercent } from "./viz/format";
import { renderSiteCurve } from "./viz/site-curve";
import { renderSnowCurve } from "./viz/snow-curve";
import "./styles/overview.css";
import "./styles/snow.css";

/*
 * Slice S3b (docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md): wiring the
 * opening-scope module (`data/opening-scope.ts`) to this page. The pure
 * functions below are kept free of `document` on purpose -- they are the
 * part of this file a reviewer can trace by hand -- but they are not
 * unit-tested in this change: `vitest.config.ts` runs in the Node
 * environment with no DOM shim installed, and every top-level statement
 * below this comment runs `document.querySelector` on import, the same as
 * `main.ts`, `drought.ts` and `overview.ts` already do. Those three page
 * scripts have no test files of their own for the same reason and are
 * exercised by `tests/smoke-modern.mjs` instead; this file follows that
 * existing convention rather than introducing a DOM-shimming dependency to
 * break it.
 */

/**
 * The payload narrowed by the reader's opening scope -- `?state=` and
 * `?area=` together, already resolved against the published rosters and
 * coarsest-first fallback rules (`resolveOpeningScope`).
 *
 * `level` is this page's own grouping (`?level=`, ADR-064), independent of
 * `selection.area` -- a shared link can carry a six-digit basin while this
 * page draws at level four, and `withinOpeningArea` refuses to test a
 * shorter code against a longer selection rather than silently answering
 * "no match" for every record. `areaAtLevel` is what keeps that refusal
 * from ever firing here: the reader named a place and (elsewhere) a
 * granularity, and the place survives at the granularity this page is
 * actually drawing, coarsened, never refined upward.
 *
 * State narrows first, through `payloadForState`, which is the one place
 * the honesty rule is written: it regroups every surviving area's mean from
 * that area's own surviving *sites*, never by re-averaging the published
 * basin means (ADR-064; the module doc's "honesty constraint" names this as
 * the reason `resolveOpeningScope`'s own `state` axis stops at drainage
 * areas and leaves reservoirs and snow sites to their own exact rules).
 *
 * Area narrows second and needs no recompute of its own. `payloadForState`
 * has already rebuilt every surviving area's mean from its own sites, and
 * `payloadAtLevel`/`payloadForState` both group sites by their own exact
 * drainage-area code -- so a site inside an area that survives this second,
 * prefix-matched pass was never partially excluded from it. Dropping whole
 * areas that do not match the chosen region, subregion or basin changes
 * *which* means are shown, never what any surviving one means. A basin
 * whose mean already read `null` below the reporting floor keeps reading
 * `null` here -- this pass only removes areas, it never touches a series.
 *
 * Skipped entirely when the level-coarsened code already names one of this
 * level's own areas exactly: this page's own drainage-area picker
 * (`choices`, `currentArea`, below) already narrows precisely to a code
 * like that, and collapsing the payload here as well would make
 * `payload.site_count` -- this page's own "of N sites" total -- equal the
 * one narrowed area's count permanently, with no way for the picker's
 * "whole region" option to widen back out again. That exact case is the
 * ordinary, long-supported single-basin link this page has always carried;
 * only a code coarser than this level's own grouping -- a region, or a
 * subregion when this level's own areas are basins -- has no representation
 * in `choices` at all, and that is the case this pass exists for.
 */
function payloadForOpeningScope(
  payload: SnowpackPayload, selection: OpeningSelection, level: number
): SnowpackPayload {
  const byState = payloadForState(payload, selection.state);
  const area = areaAtLevel(selection.area, level);
  if (area === null) return byState;
  if (byState.rollups.some((rollup) => rollup.huc6 === area)) return byState;
  const sites = byState.sites.filter((site) => withinOpeningArea(site.huc6, area));
  const rollups = byState.rollups.filter((rollup) => withinOpeningArea(rollup.huc6, area));
  return payloadForSites(byState, sites, rollups);
}

/**
 * The chosen region, subregion or basin's own published name, or `null`
 * when no area is chosen.
 *
 * Searches every level's option list rather than branching on the code's
 * own width, because the three lists never share a code and
 * `resolveOpeningScope` keeps each one level short of its own choice (its
 * own doc: "a subregion list narrowed down to the one subregion already
 * chosen would give a reader nothing to switch to"). So whichever list sits
 * at the width `selection.area` actually has is exactly the one still
 * carrying it as a sibling among its neighbours.
 */
function openingAreaName(scope: OpeningScope): string | null {
  const code = scope.selection.area;
  if (code === null) return null;
  const roster = [...scope.regions, ...scope.subregions, ...scope.areas];
  return roster.find((entry) => entry.huc6 === code)?.name ?? null;
}

/**
 * The summary sentence a reader sees once `?state=` or `?area=` has
 * narrowed the page -- Simplified Technical English (ADR-006): a place name
 * and nothing else, never the codes or the hydrologic vocabulary they come
 * from. `null` for the whole region, which already has its own wording on
 * the KPIs below ("the whole region") and does not need a second sentence
 * saying the same thing.
 *
 * `widenedForSite` overrides everything else: it carries a linked
 * measurement site's own name when that site would otherwise have been
 * dropped by the scope a `?state=`/`?area=` link asked for, which is
 * exactly the case the bootstrap below widens the whole scope back to "all"
 * for. A reader following a link to one site must not find it missing, and
 * a page that silently widened out from under a stated filter without
 * saying so would read as a bug even though it is the correct repair.
 */
function openingScopeSummary(scope: OpeningScope, widenedForSite: string | null): string | null {
  if (widenedForSite !== null) {
    return `Showing the whole region so the linked measurement site, ` +
      `${widenedForSite}, is included.`;
  }
  const state = scope.selection.state !== "all" ? stateName(scope.selection.state) : null;
  const area = openingAreaName(scope);
  if (state && area) return `Showing snow measurements for ${state}, in ${area}.`;
  if (state) return `Showing snow measurements for ${state}.`;
  if (area) return `Showing snow measurements for ${area}.`;
  return null;
}

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#snow-app");
if (!root) throw new Error("Missing #snow-app root");

root.innerHTML = `
  <calcite-navigation class="overview-nav" aria-label="Primary navigation">
    ${brandMarkup(1, "snow")}
    ${pageLinksMarkup("snow", window.location.search)}
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

/**
 * The control that picks where a reader is looking (S4): a state and a
 * region/subregion/drainage-area drill-down, beside the level control in the
 * same filter bar. Wired after `renderSnow` rather than inside it, because
 * it needs the full, unnarrowed rosters -- `renderSnow`'s own `openingScope`
 * parameter is already narrowed to what this page draws, which is right for
 * everything else that function does and wrong for this control's own
 * region and subregion option lists (`resolveOpeningScope`'s doc: "never
 * unioned directly" for that reason).
 *
 * A full navigation, like the level control just below: every figure on
 * this page is a mean over a different set of sites once the area or the
 * state narrows, so a picked value takes the path a shared link already
 * takes rather than a re-render this page has no function for.
 */
function wireWhereControl(rosters: OpeningRosters, current: OpeningSelection): void {
  const host = document.querySelector<HTMLElement>("#snow-content .filterbar-controls");
  if (!host) return;
  const control = createWhereControl(rosters, current, (selection) => {
    const params = new URLSearchParams(window.location.search);
    if (selection.state === "all") params.delete("state"); else params.set("state", selection.state);
    if (selection.area === null) params.delete("area"); else params.set("area", selection.area);
    const query = params.toString();
    window.location.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
    /* Large, because the native selects it sits beside are a third taller
     * than a Calcite control at the default scale. */
  }, { scale: "l" });
  if (control) host.append(control.element);
}

function renderSnow(
  payload: SnowpackPayload, openingScope: OpeningScope, widenedForSite: string | null
): void {
  const content = document.querySelector<HTMLElement>("#snow-content");
  if (!content) return;
  const choices = basinChoices(payload);
  const regionPoints = regionCurve(payload);
  const days = regionPoints.map((point) => point.date);
  content.innerHTML = `
    <p id="snow-scope-summary" class="filter-status" role="status" hidden></p>
    <section class="dashboard-filterbar" aria-labelledby="snow-filter-heading">
      <div class="filterbar-head">
        <div class="filterbar-title"><p class="eyebrow">Mountain snow</p><h2 id="snow-filter-heading">Choose a drainage area</h2></div>
        <!-- Beside the title rather than in the control row below: this search
             narrows the site table further down the page, not the drainage
             area the rest of the row is choosing among. -->
        <label class="filterbar-head-search">Site name or county<input id="snow-query" type="search" placeholder="Search sites" autocomplete="off"></label>
      </div>
      <div class="filterbar-controls">
        <label>Drainage area<select id="snow-area"><option value="all">The whole region</option></select></label>
        <label>Elevation<select id="snow-elev">${ELEVATION_BANDS.map((band) => `<option value="${band}">${elevationBandLabel(band)}</option>`).join("")}</select></label>
        <label>Reporting<select id="snow-reporting">
          <option value="all">Every site</option>
          <option value="reporting">Sending values</option>
          <option value="late">Late data only</option>
        </select></label>
      </div>
      <div class="filterbar-head-actions"><calcite-button id="snow-reset" class="reset-button" appearance="outline" scale="s" kind="neutral">Show every site</calcite-button></div>
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
        <div><h2 id="snow-map-heading">Where the snow is</h2><p>Each drainage area takes its colour from its mean percent of normal for the day shown. Each measurement site is a point on the same scale. The map opens on the day this season held the most snow, because the rest of the year measures against that day. Move the slider to see any other day. Areas and sites without a fair value for that day stay grey.</p></div>
        <span class="sdk-badge">ArcGIS map</span>
      </div>
      <div id="snow-map-host" class="view-map-host" aria-busy="true"
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
        <div class="table-scroll" tabindex="0" role="region" aria-label="First-of-month table, scrolls sideways"><table class="overview-table"><thead><tr><th>Month</th><th>Of normal</th><th>Reporting sites</th></tr></thead><tbody id="snow-month-rows"></tbody></table></div>
      </details>
    </section>
    <section class="overview-card" aria-labelledby="snow-basin-heading">
      <div class="card-heading">
        <div><h2 id="snow-basin-heading">One drainage area through the season</h2><p>The mean of the chosen area's site values as a percent of normal, day by day. The dashed line is the middle value for the same day in the years ${normalPeriodLabel(payload)}. Choose an area here, or select one on the map above.</p></div>
        <label class="sort-control">Drainage area<select id="snow-basin-pick"><option value="">Choose a drainage area</option></select></label>
      </div>
      <div id="snow-basin-detail"><p class="chart-empty">Choose a drainage area above, or select one on the map.</p></div>
    </section>
    <section class="overview-card" aria-labelledby="snow-site-heading">
      <div class="card-heading">
        <div><h2 id="snow-site-heading">One site through the season</h2><p>Snow water in inches at the chosen site, day by day, against the middle value for the same day in the years ${normalPeriodLabel(payload)}. The markers show the site's normal season: when snow usually starts to build, its usual highest value, and when it has usually melted.</p></div>
        <label class="sort-control">Measurement site<select id="snow-site"><option value="">Choose a site</option></select></label>
      </div>
      <div id="snow-site-detail"><p class="chart-empty">Choose a measurement site above, or select one in the table below.</p></div>
    </section>
    <section class="overview-card table-card" aria-labelledby="snow-table-heading">
      <div class="card-heading"><div><h2 id="snow-table-heading">Measurement sites</h2><p>The newest value at each site, ordered by drainage area and name. Select a site name to see its season. A summer value near zero is normal: the snow melts each summer.</p></div></div>
      <div class="snow-spread" id="snow-spread"></div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="Measurement site table, scrolls sideways"><table class="overview-table"><thead><tr><th>Site</th><th>Drainage area</th><th>Elevation (feet)</th><th>Snow water (inches)</th><th>Normal (inches)</th><th>Of normal</th><th>Observed</th></tr></thead><tbody id="snow-site-rows"></tbody></table></div>
    </section>`;

  const scopeSummaryEl = document.querySelector<HTMLElement>("#snow-scope-summary");
  if (scopeSummaryEl) {
    /* Real text, not markup: `openingScopeSummary` builds its sentence out
     * of a hardcoded state-name table and the reference export's own `name`
     * field, and this file's own discipline (see the site-detail comment
     * below) is that runtime-sourced words never pass through `innerHTML`.
     * Hidden rather than absent from the template when there is nothing to
     * say, so nothing else on the page has to shift to fill the gap. */
    const summary = openingScopeSummary(openingScope, widenedForSite);
    scopeSummaryEl.textContent = summary ?? "";
    scopeSummaryEl.hidden = summary === null;
  }

  const area = document.querySelector<HTMLSelectElement>("#snow-area");
  const status = document.querySelector<HTMLElement>("#snow-status");
  const curveHost = document.querySelector<HTMLElement>("#snow-curve-host");
  const monthRows = document.querySelector<HTMLTableSectionElement>("#snow-month-rows");
  const siteRowsBody = document.querySelector<HTMLTableSectionElement>("#snow-site-rows");
  const querybox = document.querySelector<HTMLInputElement>("#snow-query");
  const elevSelect = document.querySelector<HTMLSelectElement>("#snow-elev");
  const statusSelect = document.querySelector<HTMLSelectElement>("#snow-reporting");
  const resetButton = document.querySelector<HTMLElement>("#snow-reset");
  const spreadHost = document.querySelector<HTMLElement>("#snow-spread");
  const mapHost = document.querySelector<HTMLElement>("#snow-map-host");
  const daySlider = document.querySelector<HTMLElement & { value?: number }>("#snow-day");
  /* The focusable control is the handle inside the component's shadow root,
   * and Calcite 5.1 leaves it unnamed whatever the host carries. */
  nameSliderHandle(daySlider, "Day of the snow season shown on the map");
  const dayReading = document.querySelector<HTMLElement>("#snow-day-reading");
  const sitePicker = document.querySelector<HTMLSelectElement>("#snow-site");
  const siteDetail = document.querySelector<HTMLElement>("#snow-site-detail");
  const basinPicker = document.querySelector<HTMLSelectElement>("#snow-basin-pick");
  const basinDetail = document.querySelector<HTMLElement>("#snow-basin-detail");
  if (!area || !status || !curveHost || !monthRows || !siteRowsBody
    || !mapHost || !daySlider || !dayReading || !sitePicker || !siteDetail
    || !basinPicker || !basinDetail) return;

  /* Every site, grouped by drainage area, in the payload's own order. The
   * picker always offers all of them: the area filter narrows the table,
   * and a reader following a link to one site must not find it missing
   * because a filter happens to exclude its basin. */
  {
    let group: HTMLOptGroupElement | null = null;
    for (const site of payload.sites) {
      if (!group || group.label !== site.huc6_name) {
        group = document.createElement("optgroup");
        group.label = site.huc6_name;
        sitePicker.append(group);
      }
      const option = document.createElement("option");
      option.value = site.station;
      option.textContent = site.name;
      group.append(option);
    }
  }

  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.code;
    option.textContent = `${choice.label} (${choice.siteCount} sites)`;
    area.append(option);
  }

  /* The season card's own picker carries the same fourteen areas as the
   * filter above, and is deliberately not that filter: the filter narrows
   * the whole page, this names the one area whose season is drawn in full
   * -- the same relationship the site picker has to the site table. */
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.code;
    option.textContent = choice.label;
    basinPicker.append(option);
  }

  /*
   * The key belongs on the map it explains.
   *
   * It sat in a band above the map, which is the arrangement the drought
   * page already moved away from: a reader matching a colour to a class had
   * to look away from the pattern to do it, and the band cost a strip of
   * height from a card whose whole job is the map.
   *
   * Attached only once the map exists -- `createViewMap` calls
   * `replaceChildren` on the host, so a key appended before that is silently
   * thrown away. If the map cannot start it is attached anyway, without the
   * inset class, because the same colours describe the chart below.
   */
  const legend = document.createElement("div");
  legend.className = "drought-legend map-inset-legend snow-map-legend";
  legend.setAttribute("role", "list");
  legend.setAttribute("aria-label", "Snow map classes and their colours");
  {
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
  let currentSite: string | null = null;
  let currentBasin: string | null = null;
  /* The three controls that narrow only the site table. Held together so
   * every writer of the address bar carries all of them -- the reason the
   * whole state is written at once rather than per control. */
  let siteFilter: SiteFilter = { query: "", band: "all", status: "all" };
  /* True once the reader has *chosen* "The whole region" from the drainage-
   * area picker, as opposed to that being the picker's own starting value
   * because a coarser opening-scope code (a region, or a subregion this
   * level does not group at) is not one of `choices` -- see the comment on
   * `writeUrl` below. Only a `change` event sets this, never the initial
   * `area.value = ...` assignment near the bottom of this function, which
   * is exactly the distinction that lets a shared `?area=14` link survive
   * first paint while still leaving the reader a real way to clear it. */
  let openingAreaCleared = false;

  /** The complete address-bar state. One builder, so a control that forgets
   * a field cannot quietly drop another control's choice from a shared
   * link. */
  function urlState(): {
    area: string | null; day: string | null; site: string | null;
    basin: string | null;
    query: string; band: ElevationBand; status: SiteStatus;
  } {
    return {
      area: currentArea,
      day: currentDay === startDay ? null : currentDay,
      site: currentSite,
      basin: currentBasin,
      query: siteFilter.query,
      band: siteFilter.band,
      status: siteFilter.status
    };
  }

  /** Writes the bar's links in the same breath as the address bar: the write
   * is a `replaceState`, so there is no navigation to re-render them, and a
   * narrowed `?area=` would otherwise sit in the URL while the links carried
   * the one from first paint. */
  function writeUrl(): void {
    writeSnowUrl(urlState());
    /*
     * `?area=` is one parameter shared with the opening scope (D2/S3b), but
     * `writeSnowUrl` above only knows this page's own drainage-area picker
     * (`currentArea`), which is exact-match against `choices` -- the basins
     * and subregions this page's own level actually groups sites into. A
     * region, or a subregion narrower than this level's own grouping, is
     * never one of `choices`, so it is never `currentArea` either, and the
     * write above would otherwise silently delete the reader's `?area=14`
     * on the very first render.
     *
     * Reasserted only while the picker itself is at "the whole region" --
     * `currentArea === null` -- because any basin the reader *does* pick
     * from `choices` is already a member of the narrowed payload
     * (`payloadForOpeningScope` ran before this page ever built `choices`),
     * so it is always at least as specific as the opening scope's own area
     * and the write above already carries it correctly. Picking a basin
     * must be able to replace a coarser opening-scope code in the address
     * bar; only "nothing more specific chosen" should fall back to it.
     *
     * And never once `openingAreaCleared` -- a reader who explicitly picks
     * "The whole region" is asking to see past the coarser scope a link
     * arrived with, and a write that puts the code straight back would
     * leave no way to do that at all.
     */
    if (currentArea === null && !openingAreaCleared && openingScope.selection.area !== null) {
      const params = new URLSearchParams(window.location.search);
      params.set("area", openingScope.selection.area);
      const query = params.toString();
      history.replaceState(null, "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
    updatePageLinks(window.location.search);
  }
  let levelsOffered = 1;
  let lastCurvePoints = 0;
  let lastSiteCurvePoints = 0;
  let lastBasinCurvePoints = 0;

  const publishReady = (): void => {
    const rows = siteRows(payload, currentArea);
    window.__snowReady = {
      sites: payload.site_count,
      late: payload.late_site_count,
      /* Areas this page can speak for, not every rollup the payload carries.
       * A rollup below its own reporting floor publishes no mean, so the map
       * does not draw it and the picker does not offer it (`areaCanReport`);
       * counting it here would be a third answer to a question that has
       * one. */
      basins: payload.rollups.filter(areaCanReport).length,
      curvePoints: lastCurvePoints,
      tableRows: rows.length,
      area: currentArea,
      site: currentSite,
      siteCurvePoints: lastSiteCurvePoints,
      basin: currentBasin,
      basinCurvePoints: lastBasinCurvePoints,
      level,
      levelsOffered,
      ...(map ? {
        mapBasins: map.status.basins,
        mapSites: map.status.sites,
        mapBasinsWithValues: map.status.basinsWithValues,
        mapSitesWithValues: map.status.sitesWithValues,
        mapDay: map.status.day,
        mapBasemap: map.status.basemap,
        mapViewReady: map.status.viewReady,
        /* The areas carry their names now, placed by the label engine.
         * Published so the browser suite can hold the map to it -- an
         * unlabelled basin layer looks like a working map. */
        mapBasinLabels: map.status.basinLabels,
        mapBasinLabelsDeconflicted: map.status.basinLabelsDeconflicted,
        /* The class table's own length, published so the browser suite can
         * hold the legend to it rather than to a number written twice. */
        mapClasses: SNOW_CLASSES.length
      } : {})
    };
  };

  /* The one site the reader is studying. Real elements throughout: every
   * word here except the fixed prompts comes from the payload, and one
   * innerHTML path through runtime data would be the only place on the page
   * where a site name is parsed as markup. */
  const renderSiteDetail = (station: string | null): void => {
    const site = station ? siteByStation(payload, station) : null;
    currentSite = site ? site.station : null;
    sitePicker.value = site ? site.station : "";
    if (!site) {
      lastSiteCurvePoints = 0;
      const prompt = document.createElement("p");
      prompt.className = "chart-empty";
      prompt.textContent =
        "Choose a measurement site above, or select one in the table below.";
      siteDetail.replaceChildren(prompt);
    } else {
      const points = sitePoints(site);
      const timing = siteTiming(site, payload.water_year);

      const stats = document.createElement("p");
      stats.className = "snow-site-stats";
      stats.textContent = `${site.name} · ${site.huc6_name} · ` +
        `${formatFeet(site.elevation_feet)} feet · ${site.county} County, ` +
        `${site.state} · Records begin ${formatDate(site.begins)}`;

      const chart = renderSiteCurve(points, timing,
        `Snow water for ${site.name}, in inches, day by day for the season ` +
        `${seasonLabel(payload)}, with the normal middle value as a second ` +
        `line. The table below lists the value on the first day of each month.`);
      lastSiteCurvePoints = chart
        ? points.filter((point) => point.inches !== null).length : 0;

      const reading = document.createElement("p");
      reading.className = "snow-site-reading";
      const latest = [...points].reverse().find((point) => point.inches !== null);
      const peak = observedPeak(points);
      const parts: string[] = [];
      if (latest) {
        const percent = percentOfNormal(latest.inches, latest.normalInches);
        parts.push(`Newest value: ${formatInches(latest.inches)} inches` +
          `${percent === null ? "" : ` (${formatPercent(percent)} of normal)`}` +
          ` on ${formatDate(latest.date)}.`);
      }
      if (site.late) parts.push("This site has late data.");
      if (peak) {
        parts.push(`Season high point: ${formatInches(peak.inches)} inches ` +
          `on ${formatDate(peak.date)}.`);
      }
      reading.textContent = parts.join(" ");

      const timingLine = document.createElement("p");
      timingLine.className = "snow-site-timing";
      const clauses: string[] = [];
      if (timing.onset) {
        clauses.push(`snow usually starts to build near ${formatDate(timing.onset)}`);
      }
      if (timing.peakDate) {
        clauses.push(`the usual highest value is ` +
          `${timing.peakInches === null ? "reached" : `${formatInches(timing.peakInches)} inches`} ` +
          `near ${formatDate(timing.peakDate)}`);
      }
      if (timing.meltout) {
        clauses.push(`the snow has usually melted by ${formatDate(timing.meltout)}`);
      }
      timingLine.textContent = clauses.length > 0
        ? `The normal season at this site: ${clauses.join("; ")}.`
        : "The data service does not publish normal season timing for this site.";

      const table = document.createElement("details");
      table.className = "snow-month-details";
      const summary = document.createElement("summary");
      summary.textContent = "Values on the first day of each month";
      const scroller = document.createElement("div");
      scroller.className = "table-scroll";
      const tableElement = document.createElement("table");
      tableElement.className = "overview-table";
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const label of ["Month", "Snow water (inches)", "Normal (inches)"]) {
        const cell = document.createElement("th");
        cell.textContent = label;
        headRow.append(cell);
      }
      head.append(headRow);
      const body = document.createElement("tbody");
      for (const month of siteMonthReadings(points)) {
        const row = document.createElement("tr");
        const name = document.createElement("th");
        name.scope = "row";
        name.textContent = month.label;
        const inches = document.createElement("td");
        inches.textContent = month.point ? formatInches(month.point.inches) : "—";
        const normal = document.createElement("td");
        normal.textContent = month.point ? formatInches(month.point.normalInches) : "—";
        row.append(name, inches, normal);
        body.append(row);
      }
      tableElement.append(head, body);
      scroller.append(tableElement);
      table.append(summary, scroller);

      const children: Node[] = [stats];
      if (chart) children.push(chart);
      else {
        const empty = document.createElement("p");
        empty.className = "chart-empty";
        empty.textContent = "This site has no values to draw this season.";
        children.push(empty);
      }
      children.push(reading, timingLine, table);
      siteDetail.replaceChildren(...children);
    }
    writeUrl();
    publishReady();
  };

  /* The one drainage area the reader is studying, mirroring the site card
   * above it: same construction, same discipline. Real elements throughout
   * -- every word except the fixed prompts comes from the payload. */
  const renderBasinDetail = (huc6: string | null): void => {
    const rollup = huc6
      ? payload.rollups.find((entry) => entry.huc6 === huc6) ?? null
      : null;
    currentBasin = rollup ? rollup.huc6 : null;
    basinPicker.value = rollup ? rollup.huc6 : "";
    if (!rollup) {
      lastBasinCurvePoints = 0;
      const prompt = document.createElement("p");
      prompt.className = "chart-empty";
      prompt.textContent =
        "Choose a drainage area above, or select one on the map.";
      basinDetail.replaceChildren(prompt);
    } else {
      const points = basinCurve(payload, rollup.huc6) ?? [];

      const stats = document.createElement("p");
      stats.className = "snow-site-stats";
      stats.textContent = `${rollup.huc6_name} · ${rollup.site_count} ` +
        `measurement sites · A day's mean needs at least ` +
        `${rollup.minimum_reporting_sites} sites with a value`;

      const chart = renderSnowCurve(points,
        `Mean snow water for ${rollup.huc6_name} as a percent of normal, ` +
        `day by day for the season ${seasonLabel(payload)}. The dashed line ` +
        `marks normal. The table below lists the value on the first day of ` +
        `each month.`);
      lastBasinCurvePoints = chart
        ? points.filter((point) => point.percent !== null).length : 0;

      /* The same floor the page's headlines hold to: at least half the
       * area's sites, so October's first flurries cannot headline the
       * card. */
      const floor = headlineFloor(rollup.site_count, rollup.minimum_reporting_sites);
      const reading = document.createElement("p");
      reading.className = "snow-site-reading";
      const parts: string[] = [];
      const latest = newestHeadline(points, floor);
      if (latest) {
        parts.push(`Newest value: ${formatPercent(latest.percent)} of normal ` +
          `on ${formatDate(latest.date)}, from ${latest.reportingSites} of ` +
          `${rollup.site_count} sites.`);
      }
      const peak = seasonHighPoint(points, floor);
      if (peak) {
        parts.push(`Season high point: ${formatPercent(peak.percent)} of ` +
          `normal on ${formatDate(peak.date)}.`);
      }
      reading.textContent = parts.length > 0 ? parts.join(" ")
        : "Too few sites in this area have values yet this season.";

      const table = document.createElement("details");
      table.className = "snow-month-details";
      const summary = document.createElement("summary");
      summary.textContent = "Values on the first day of each month";
      const scroller = document.createElement("div");
      scroller.className = "table-scroll";
      const tableElement = document.createElement("table");
      tableElement.className = "overview-table";
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const label of ["Month", "Of normal", "Reporting sites"]) {
        const cell = document.createElement("th");
        cell.textContent = label;
        headRow.append(cell);
      }
      head.append(headRow);
      const body = document.createElement("tbody");
      for (const month of monthReadings(points)) {
        const row = document.createElement("tr");
        const name = document.createElement("th");
        name.scope = "row";
        name.textContent = month.label;
        const percent = document.createElement("td");
        percent.textContent = month.point ? formatPercent(month.point.percent) : "—";
        const sites = document.createElement("td");
        sites.textContent = month.point ? String(month.point.reportingSites) : "—";
        row.append(name, percent, sites);
        body.append(row);
      }
      tableElement.append(head, body);
      scroller.append(tableElement);
      table.append(summary, scroller);

      const children: Node[] = [stats];
      if (chart) children.push(chart);
      else {
        const empty = document.createElement("p");
        empty.className = "chart-empty";
        empty.textContent = "This area has no values to draw this season.";
        children.push(empty);
      }
      children.push(reading, table);
      basinDetail.replaceChildren(...children);
    }
    writeUrl();
    publishReady();
  };

  /* The day the map opened on, kept so the reading can say when the reader is
   * back on it. Moving the slider away and back should not lose the fact that
   * this one day is the season's high point. */
  const peakDay = startDay;
  const describeDay = (day: string): string => {
    const point = regionPoints.find((entry) => entry.date === day);
    const sitesNote = point ? `, ${point.reportingSites} sites reporting` : "";
    const peakNote = day === peakDay ? " · season high point" : "";
    return `${formatDate(day)}${sitesNote}${peakNote}`;
  };

  const applyDay = (day: string): void => {
    currentDay = day;
    dayReading.textContent = describeDay(day);
    if (daySlider.value !== undefined) daySlider.value = Math.max(0, days.indexOf(day));
    if (map) map.setDay(mapDayValues(payload, day), day);
    writeUrl();
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

    /* The area choice picks which sites exist; these three narrow which of
     * them are listed. Kept in that order so the chart, the map and the KPIs
     * above keep describing the area rather than the table's search box. */
    const shown = filterSiteRows(rows, siteFilter);

    siteRowsBody.replaceChildren(...shown.map((site) => {
      const row = document.createElement("tr");
      /* The name is the way into the site's own season: a real button, so
       * the keyboard path is the same one the pointer takes. */
      const nameCell = document.createElement("td");
      const nameButton = document.createElement("button");
      nameButton.type = "button";
      nameButton.className = "site-name-button";
      nameButton.textContent = site.name;
      nameButton.setAttribute("aria-label",
        `Show the season for ${site.name}`);
      nameButton.addEventListener("click", () => {
        renderSiteDetail(site.station);
        siteDetail.closest("section")?.scrollIntoView({ block: "start" });
      });
      nameCell.append(nameButton);
      row.append(nameCell);
      const cells = [site.basinName, formatFeet(site.elevationFeet),
        formatInches(site.inches), formatInches(site.normalInches),
        formatPercent(site.percent), formatDate(site.latestDate)];
      cells.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (index === 5 && site.late) cell.className = "late-badge";
        row.append(cell);
      });
      return row;
    }));

    const where = chosen === null ? "The whole region" : chosenLabel;
    status.textContent = siteFilterActive(siteFilter)
      ? `${shown.length} of ${rows.length} sites listed · ${where} · ` +
        `${describeSiteFilter(siteFilter)}`
      : `${shown.length} of ${payload.site_count} sites shown · ${where}`;

    drawSpread();
    if (map) map.setArea(chosen);
    writeUrl();
    lastCurvePoints = curvePoints;
    publishReady();
  };

  /** The narrowing, in words, for the live region under the controls. */
  function describeSiteFilter(filter: SiteFilter): string {
    const parts: string[] = [];
    if (filter.query.trim()) parts.push(`matching “${filter.query.trim()}”`);
    if (filter.band !== "all") parts.push(elevationBandLabel(filter.band).toLowerCase());
    if (filter.status === "late") parts.push("late data only");
    if (filter.status === "reporting") parts.push("still sending values");
    return parts.join(", ");
  }

  /**
   * How the chosen day's readings are spread across the classes.
   *
   * The mean the curve and the map draw is one number over two hundred
   * stations, and it cannot tell a region uniformly at 70% of normal from one
   * where half the sites are bare and half are near normal. Those are
   * different winters. The bar is the same shape and the same colours as the
   * drought view's coverage bars, so a reader who has learned one has learned
   * both.
   */
  function drawSpread(): void {
    /* No chosen day means no day met the reporting floor -- out of season,
     * or a payload too thin to headline. The curve and the map already say
     * so; a bar of nothing would be a third empty box. */
    if (!spreadHost || currentDay === null) return;
    const day = currentDay;
    const values = mapDayValues(payload, day).sites;
    const spread = siteSpread(values, SNOW_CLASSES.length, snowClassIndex);
    const total = spread.reporting + spread.noValue;
    if (total === 0) {
      spreadHost.replaceChildren();
      return;
    }
    const segments = [
      ...SNOW_CLASSES.map((entry, index) => ({
        label: entry.label,
        color: entry.color as string | null,
        count: spread.counts[index] ?? 0
      })),
      { label: NO_VALUE_LABEL, color: null, count: spread.noValue }
    ].filter((segment) => segment.count > 0);

    const bar = document.createElement("div");
    bar.className = "drought-bar";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label",
      `Sites by class on ${formatDate(day)}: ` +
      segments.map((segment) => `${segment.label} ${segment.count}`).join(", ") +
      ". The table below lists every site.");
    for (const segment of segments) {
      const piece = document.createElement("span");
      piece.className = "drought-segment" + (segment.color ? "" : " drought-segment-none");
      piece.style.flexGrow = String(segment.count);
      if (segment.color) piece.style.background = segment.color;
      piece.title = `${segment.label}: ${segment.count} of ${total} sites`;
      bar.append(piece);
    }

    const caption = document.createElement("p");
    caption.className = "snow-spread-note";
    caption.textContent = `How the ${total} sites were spread on ` +
      `${formatDate(day)}: ${spread.reporting} with a fair value, ` +
      `${spread.noValue} without one. The mean above is one number over all of them.`;
    spreadHost.replaceChildren(bar, caption);
  }

  function applyFilter(next: Partial<SiteFilter>): void {
    siteFilter = { ...siteFilter, ...next };
    update();
  }

  querybox?.addEventListener("input", () => applyFilter({ query: querybox.value }));
  elevSelect?.addEventListener("change", () => {
    if (isElevationBand(elevSelect.value)) applyFilter({ band: elevSelect.value });
  });
  statusSelect?.addEventListener("change", () => {
    if (isSiteStatus(statusSelect.value)) applyFilter({ status: statusSelect.value });
  });
  resetButton?.addEventListener("click", () => {
    if (querybox) querybox.value = "";
    if (elevSelect) elevSelect.value = "all";
    if (statusSelect) statusSelect.value = "all";
    applyFilter({ query: "", band: "all", status: "all" });
  });

  /* The level control arrives with the reference export, which the map below
   * fetches anyway, so the page a reader asked for is never waiting on it
   * (ADR-064). */
  void loadOfferedLevels().then((offered) => {
    const control = createLevelControl(offered, level, (chosen) => {
      /* A full navigation rather than a re-render: every figure on this page
       * is a mean over a different set of sites at the other level, so this
       * is the path a shared link already takes. Replaced, not pushed, like
       * every other control here. */
      const params = new URLSearchParams(window.location.search);
      writeLevel(params, chosen);
      const query = params.toString();
      window.location.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
      /* Large, because the native selects it sits beside are a third taller
       * than a Calcite control at the default scale. */
    }, { scale: "l" });
    if (control) content.querySelector(".filterbar-controls")?.append(control.element);
    levelsOffered = offered.length || 1;
    publishReady();
  }).catch((error: unknown) => {
    console.warn("The area-size control could not be built:", error);
  });

  area.addEventListener("change", () => {
    /* A real interaction, not the programmatic assignment near the bottom
     * of this function -- setting `.value` in code never fires `change`,
     * which is exactly what keeps a shared `?area=14` link's coarser code
     * from being treated as "the reader already cleared it" before they
     * have touched the control at all. */
    if (area.value === "all") openingAreaCleared = true;
    update();
  });
  sitePicker.addEventListener("change", () => {
    renderSiteDetail(sitePicker.value || null);
  });
  basinPicker.addEventListener("change", () => {
    renderBasinDetail(basinPicker.value || null);
  });
  daySlider.addEventListener("calciteSliderInput", () => {
    const index = Number(daySlider.value ?? 0);
    const day = days[Math.max(0, Math.min(days.length - 1, index))];
    if (day) applyDay(day);
  });

  const wanted = snowStateFromSearch(window.location.search);
  /* The table controls, restored before the first draw so a shared link
   * opens on the view it describes rather than flashing the whole table
   * and then narrowing it. */
  siteFilter = { query: wanted.query, band: wanted.band, status: wanted.status };
  if (querybox) querybox.value = wanted.query;
  if (elevSelect) elevSelect.value = wanted.band;
  if (statusSelect) statusSelect.value = wanted.status;
  area.value = wanted.area !== null
    && choices.some((choice) => choice.code === wanted.area)
    ? wanted.area : "all";
  if (wanted.day !== null && days.includes(wanted.day)) currentDay = wanted.day;
  update();
  if (currentDay) {
    dayReading.textContent = describeDay(currentDay);
    if (daySlider.value !== undefined) daySlider.value = Math.max(0, days.indexOf(currentDay));
  }
  // A linked site the payload does not carry falls back to none chosen.
  if (wanted.site !== null && siteByStation(payload, wanted.site)) {
    renderSiteDetail(wanted.site);
  }
  // Same rule for a linked drainage area's season card.
  if (wanted.basin !== null
    && payload.rollups.some((rollup) => rollup.huc6 === wanted.basin)) {
    renderBasinDetail(wanted.basin);
  }

  /* The map starts after the figures are on screen. Boundaries or basemap
   * failing costs the picture only; the note says so and the page keeps
   * every number. */
  void (async () => {
    try {
      installAnonymousAuthPolicy();
      /* The areas this payload has snow for, not every area drawn: see
       * `measuredScope`. */
      const scope = measuredScope(await loadDrainageScope(level), payload);
      if (scope.areas.length === 0) throw new Error("no drainage boundaries");
      /* Framed, controlled and constrained exactly like the storage map,
       * with the hover card already beside it in the host. */
      const { element: mapElement, card } = createViewMap(mapHost, {
        label: "A map of the drainage areas and snow measurement sites",
        cardId: "snow-map-hover"
      });
      /* The opening view follows the reader's chosen scope (S3b, item 2):
       * `createViewMap` framed the element on the fixed `drainageExtent()`
       * a moment ago, and this replaces it with the union of the chosen
       * areas' own published boxes before anything asynchronous below has
       * a chance to let the view start resolving -- the same "set before
       * the view resolves rather than eased into afterwards" rule
       * `view-map.ts`'s own comment states for its default. The navigation
       * bounds (`element.constraints.geometry`, `navigableExtent()`) are
       * left exactly as `createViewMap` set them: what a reader can pan to
       * covers every area any map on this site draws, chosen scope or not,
       * which is also what makes this override trustworthy rather than
       * clamped back to a narrower box the instant the view settles --
       * every published unit's box now fits inside it. */
      mapElement.extent = mapExtentFromBox(openingScope.box);
      const firstDay = currentDay
        ? { values: mapDayValues(payload, currentDay), day: currentDay }
        : null;
      map = await createSnowMap(mapElement, card, scope, payload.sites, firstDay, {
        /* A click inside a basin opens its season card below; the card's
         * own picker is the keyboard path to the same place. */
        onAreaChoose: (huc6) => {
          renderBasinDetail(huc6);
          basinDetail.closest("section")?.scrollIntoView({ block: "start" });
        }
      });
      map.setArea(currentArea);
      /* After the map claims the host, never before: see the note beside the
       * key's construction. */
      mapHost.append(legend);
      mapHost.classList.add("has-inset-legend");
      mapHost.setAttribute("aria-busy", "false");
      if (!map.status.basemap) {
        mapHost.append(mapStatusNote("The map background is unavailable. " +
          "Areas and sites are still drawn from local data."));
      } else if (map.status.basemapDegraded) {
        /* Said out loud, as the storage map says it: the reader is looking
         * at a different background from the one this page chose, and a map
         * that changes appearance without explanation reads as a fault. */
        mapHost.append(mapStatusNote(
          "The preferred map background was unavailable. An alternate is shown."));
      }
      publishReady();
    } catch (error) {
      console.warn("The snow map could not start:", error);
      mapHost.setAttribute("aria-busy", "false");
      mapHost.replaceChildren(mapStatusNote(
        "The map could not start. The chart and tables carry the same values."));
      /* The same colours describe the chart below, so the key is kept even
       * when there is no map to put it over. */
      legend.classList.remove("map-inset-legend");
      mapHost.append(legend);
      publishReady();
    }
  })();
}

const level = levelFromSearch(window.location.search);

try {
  /*
   * The payload and the opening-scope rosters are independent fetches --
   * `loadReference` (behind `loadOpeningRosters`) shares one in-flight
   * request per URL, so the level control and the map boundaries further
   * below cost nothing extra once this one has run -- and this page must
   * not paint the whole west and then narrow to what the reader asked for:
   * the narrowing happens once, here, before `renderSnow` is ever called,
   * the same way a written zoom constraint has to be in place before a view
   * opens rather than corrected once a fetch resolves (CLAUDE.md's rule for
   * the title card's zoom gutter -- "a gutter cannot be late" -- applies to
   * an opening extent for the same reason). Awaiting both together, rather
   * than the payload alone, is what makes that possible: nothing below this
   * point reads an unnarrowed payload.
   *
   * A rosters fetch that fails costs the reader the area narrowing and the
   * chosen-area name, not the page: `resolveOpeningScope` degrades on its
   * own when handed empty rosters (`state` is never checked against them,
   * only `area`'s aliveness is, so it falls back to "all" the same way a
   * dead code already does), and the fallback here is that same empty
   * roster rather than a second code path.
   */
  const [rawSnowpack, rosters] = await Promise.all([
    loadSnowpack(),
    loadOpeningRosters().catch((error: unknown): OpeningRosters => {
      console.warn("The opening-scope rosters could not load; the page " +
        "opens with no area narrowing.", error);
      return EMPTY_OPENING_ROSTERS;
    })
  ]);
  /* Regrouped before anything reads it, so the picker, the curves, the table,
   * the map and the `?basin=` link all describe the areas the reader asked
   * for and none of them has to know a level exists (ADR-064). */
  const levelPayload = payloadAtLevel(rawSnowpack, level);
  let openingScope = resolveOpeningScope(
    openingSelectionFromSearch(window.location.search), rosters);

  /*
   * A linked measurement site outranks the opening scope. `?site=` names one
   * specific station -- a stronger, narrower signal than `?state=`/`?area=`
   * -- and the site table's own construction below already promises that
   * "a reader following a link to one site must not find it missing." A
   * `?state=CO` link paired with `?site=` naming a Utah station would break
   * that promise silently: the station is real, but not in Colorado, so the
   * state-narrowed payload would never carry it and the site card would
   * just come up empty with no explanation.
   *
   * Checked once, against a trial narrowing, before the real one runs --
   * not discovered after painting the narrow view and widening a second
   * time, which is the double-render this page must not do. Widening falls
   * all the way back to the default scope rather than trying to keep
   * whichever half of the reader's choice still fits the site: a summary
   * that said "narrowed to Colorado" while the map and table plainly showed
   * Idaho too would be worse than naming the whole region and saying why.
   */
  const wantedSite = snowStateFromSearch(window.location.search).site;
  let widenedForSite: string | null = null;
  if (wantedSite !== null) {
    const linkedSite = siteByStation(levelPayload, wantedSite);
    if (linkedSite) {
      const trial = payloadForOpeningScope(levelPayload, openingScope.selection, level);
      if (!siteByStation(trial, wantedSite)) {
        openingScope = resolveOpeningScope(DEFAULT_OPENING_SELECTION, rosters);
        widenedForSite = linkedSite.name;
      }
    }
  }

  const payload = payloadForOpeningScope(levelPayload, openingScope.selection, level);
  renderSnow(payload, openingScope, widenedForSite);
  wireWhereControl(rosters, openingScope.selection);
} catch (error) {
  console.error("Snowpack view failed:", error);
  const content = document.querySelector<HTMLElement>("#snow-content");
  if (content) content.innerHTML = `<div class="overview-error" role="alert"><strong>The snow measurements could not load.</strong><p>Try again later or return to the storage map.</p></div>`;
}
