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

import { loadDrainageScope, loadOfferedLevels, type DrainageScope } from "./data/boundaries";
import { loadDroughtCoverage } from "./data/drought-load";
import { loadReservoirs } from "./data/load";
import { loadUsdmPolygons } from "./data/usdm-load";
import {
  areaAtLevel,
  loadOpeningRosters,
  resolveOpeningScope,
  withinOpeningArea,
  type OpeningRosters,
  type OpeningScope,
  type OpeningSelection,
  isOpeningScopeChosen
} from "./data/opening-scope";
import { readStoredPlace, resolveOpeningPlace, searchWithPlace } from "./state/opening-preference";
import { areaReachesState, stateName } from "./data/state-vocabulary";
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
  unitsInOpeningScope,
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
import { createWhereControl } from "./ui/where-control";
import { renderDroughtScatter } from "./viz/drought-scatter";
import { renderDroughtGap } from "./viz/drought-gap";
import { renderDroughtSeverity } from "./viz/drought-severity";
import type { DroughtCoveragePayload, Reservoir } from "./types";
import { createDroughtMap } from "./ui/drought-map";
import { RESERVOIR_REFERENCE_LAYER_ID } from "./ui/layers";
import type { ReservoirReference } from "./ui/layers";
import { createViewMap, mapStatusNote } from "./ui/view-map";
import { wireMobileFilterDisclosure } from "./ui/mobile-filter-disclosure";
import {
  mapExtentFromBox
} from "./viz/extent";
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
      <p>How dry the land is, area by area, from the U.S. Drought Monitor's weekly national map. That map is a weekly expert judgement rather than a single instrument reading: its authors weigh many kinds of evidence together, including water-supply records. Each drainage area also shows its reservoir storage, because the two can disagree. Storage and drought are related pictures rather than independent measurements. They diverge for ordinary reasons. A reservoir holds water that arrived in earlier years. It collects that water from land far upstream. It is filled and emptied by decisions as well as by weather.</p>
    </header>
    <section id="drought-content" aria-live="polite"><calcite-loader label="Loading drought conditions"></calcite-loader></section>
  </main>`;
wireTheme();

/**
 * What a reader's `?state=` and `?area=` selection resolved to (slice S3c,
 * docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md).
 *
 * `null` -- never an empty-but-present scope -- is how this page tells "the
 * reference export could not be read" apart from "nothing was chosen":
 * `unitsInOpeningScope` reads exactly that distinction, and the map, the
 * bars, the table and every chart on this page all narrow from the one set
 * of codes a resolved scope produces, so none of them can end up describing
 * a different set of areas than the others.
 */
interface OpeningContext {
  rosters: OpeningRosters;
  scope: OpeningScope;
}

/**
 * Fetches and resolves the opening scope for an already-read selection.
 *
 * Takes `selection` rather than reading `window.location.search` itself, so
 * the caller holds the *requested* selection independently of whether this
 * resolves -- a fetch failure must not cost a reader the fact that they
 * asked for something, only the ability to act on it (a readiness field
 * reports one fact, and "what was asked" and "could it be honoured" are two).
 */
async function resolveOpening(selection: OpeningSelection): Promise<OpeningContext | null> {
  try {
    const rosters = await loadOpeningRosters();
    return { rosters, scope: resolveOpeningScope(selection, rosters) };
  } catch (error) {
    /* No narrowing rather than a broken page: a reader who asked for one
     * state or area still gets every drainage area's figures, which is a
     * smaller loss than the whole view failing over a chooser it did not
     * ask to see. */
    console.warn("The opening scope could not be resolved:", error);
    return null;
  }
}

/**
 * The code widths a reader's `?area=` may resolve to: a region, a subregion
 * or a basin. `opening-scope.ts` keeps its own `REGION_WIDTH`/
 * `SUBREGION_WIDTH`/`AREA_WIDTH` private, so these are named again here
 * rather than reached for as bare `2`/`4` literals -- the point of naming a
 * width at all is that a reader of this file sees what it means without
 * cross-referencing the other module's source.
 */
const REGION_CODE_WIDTH = 2;
const SUBREGION_CODE_WIDTH = 4;

/**
 * The name of the region, subregion or basin a reader's `?area=` named, read
 * from the unnarrowed roster so it is found regardless of what state
 * narrowing left standing. Null when nothing was chosen or the code names
 * nothing this site's registry has (a dead link, already resolved to `null`
 * by `resolveOpeningScope` before this is ever called with it).
 */
function chosenAreaName(area: string | null, rosters: OpeningRosters): string | null {
  if (area === null) return null;
  const roster = area.length === REGION_CODE_WIDTH ? rosters.regions
    : area.length === SUBREGION_CODE_WIDTH ? rosters.subregions
    : rosters.areas;
  return roster.find((candidate) => candidate.huc6 === area)?.name ?? null;
}

/**
 * The sentence naming the chosen place, and -- only when a state is chosen
 * -- the honesty constraint this page owes for one (docs/OPENING-SCOPE-AND-
 * THE-WESTERN-ROSTER.md, "What a state selection is allowed to claim").
 *
 * A drainage area's `states` means "the water reaches this state", not
 * "the water is only in this state": an area whose water reaches two states
 * is drawn whole in both, because clipping to the state line needs polygon
 * geometry in the browser and ADR-048/049 refuse it. This page has no
 * points, only areas -- the reservoir map can say a point is "in" one state
 * and mean it exactly, this map cannot -- so it is the one that has to
 * print the inexact rule in words rather than let a reader assume a state
 * line was drawn that was not. Null when nothing was chosen, so a caller
 * renders no sentence rather than a wordy no-op.
 */
function openingScopeSentence(selection: OpeningScope["selection"], place: string | null): string | null {
  const stateChosen = selection.state !== "all";
  if (!stateChosen && place === null) return null;
  const named = place && stateChosen ? `${place}, in ${stateName(selection.state)}`
    : place ?? stateName(selection.state);
  let sentence = `Showing the drainage areas for ${named}.`;
  if (stateChosen) {
    sentence += ` Each one shown here has water that reaches ${stateName(selection.state)}. ` +
      "Some of them also reach other states, and each area is drawn whole here, not cut off " +
      "at the state line.";
  }
  return sentence;
}

function renderDrought(
  payload: DroughtCoveragePayload,
  storage: Map<string, StorageContext> | null,
  /* The reservoirs themselves, not only their per-area rollup: the map
   * places and names each one, and the rollup has already thrown away where
   * they are. Empty when the payload could not be read, which the rows
   * below already say in words. */
  reservoirs: readonly ReservoirReference[],
  opening: OpeningContext | null,
  /* What the reader actually typed, independent of whether `opening`
   * resolved -- a readiness field reports one fact, and "what was asked"
   * and "could it be honoured" are two different ones (see `stateFilter`/
   * `areaFilter`/`openingScopeResolved` below). */
  requested: OpeningSelection
): void {
  const content = document.querySelector<HTMLElement>("#drought-content");
  if (!content) return;

  /* The selection actually in force: the resolved, aliveness-checked one
   * when the opening scope loaded (a dead area code has already fallen back
   * to `null` there, by `resolveOpeningScope`'s own design -- a selection
   * that cannot be honoured yields a wider one rather than filtering to
   * nothing), or the raw request when it did not. Falling back to the raw
   * request rather than "nothing chosen" is what keeps a `?state=CA` link
   * from reporting itself as unscoped just because the reference export
   * happened to fail to load this one time. */
  const openingSelection = opening ? opening.scope.selection : requested;
  /* Whether a reader actually asked for a place, as opposed to a scope that
   * resolved but named nothing. Nothing on this page reads narrowed codes
   * (or overrides the map's opening box) unless this is true, so a reader
   * who chose nothing sees the page exactly as it drew before this slice --
   * unfiltered by construction, not merely by a narrowing that happens not
   * to remove anything. */
  const scopeChosen = isOpeningScopeChosen(openingSelection);
  /* `?area=` and `?level=` are independent parameters (a shared link from a
   * six-digit-basin page can land on a four-digit-subregion one), so the
   * selection is coarsened to what this page actually draws before it is
   * used to filter or to highlight anything -- `areaAtLevel`'s own doc is
   * the reasoning; left un-coarsened, a finer selection would silently
   * match nothing at a coarser level rather than the subregion it nests in. */
  const levelArea = scopeChosen ? areaAtLevel(openingSelection.area, level) : null;
  /* The codes a reader's `?state=` and `?area=` selection actually means, at
   * this page's own level (D4, D5): filters the page rather than only
   * opening a row, now that there are 75 areas rather than the fourteen the
   * old comment here was written against. Built from whichever published
   * roster tier this page is drawing -- subregions at level four, basins at
   * six -- rather than from `opening.scope.chosenAreas` (always the basin
   * tier): `DroughtUnit` carries no `states` of its own, so `areaReachesState`
   * has to run against the roster that does, at the width the units
   * themselves are published at, or a level-four unit would need to be
   * matched against six-digit codes it can never equal. `null` -- rather
   * than every published code -- both when the opening scope itself could
   * not be resolved and when nothing was chosen, which is what keeps
   * `unitsInOpeningScope` from narrowing a broken chooser (or an ordinary,
   * scope-free visit) into anything other than every published unit. */
  const chosenCodesAtLevel: ReadonlySet<string> | null = opening && scopeChosen
    ? new Set(
        (level === SUBREGION_CODE_WIDTH ? opening.rosters.subregions : opening.rosters.areas)
          .filter((area) => areaReachesState(area, openingSelection.state)
            && withinOpeningArea(area.huc6, levelArea))
          .map((area) => area.huc6))
    : null;
  /* Narrowed before the first line of markup is built below -- a reader who
   * arrived asking for Arizona sees Arizona's rows, bars and table on first
   * paint, never the full 75 first and then a correction. */
  const scopedUnits = unitsInOpeningScope(payload.units, chosenCodesAtLevel);
  const scopeSentence = opening
    ? openingScopeSentence(openingSelection, chosenAreaName(openingSelection.area, opening.rosters))
    /* The opening scope failed to load, but a reader still asked for a
     * place -- said so honestly rather than silently showing every area
     * with no explanation for why the choice did not take. */
    : scopeChosen
      ? "The chosen place could not be loaded right now. Showing every drainage area."
      : null;

  const today = new Date();
  const age = daysOld(payload.release_date, today);
  const late = isLateRelease(payload.release_date, today);
  const worst = regionWorst(scopedUnits);
  const extremeAreas = areasAtOrWorse(scopedUnits, "d3");

  const dryness = DROUGHT_CLASSES.find((entry) => entry.key === DRYNESS_CLASS)!;

  content.innerHTML = `
    ${scopeSentence ? `<p id="drought-scope-summary" class="filter-status">${scopeSentence}</p>` : ""}
    <section class="dashboard-filterbar mobile-filterbar" aria-labelledby="drought-filter-heading">
      <div class="filterbar-head">
        <div class="filterbar-title"><p class="eyebrow">Land conditions</p><h2 id="drought-filter-heading">Narrow the drainage areas</h2></div>
        <button id="drought-filter-toggle" class="mobile-filter-toggle" type="button"
          aria-controls="drought-filter-controls drought-filter-actions"
          aria-expanded="false">Show filters</button>
        <div id="drought-filter-actions" class="filterbar-head-actions"><calcite-button id="drought-reset" class="reset-button" appearance="outline" scale="s" kind="neutral">Show every area</calcite-button></div>
      </div>
      <div id="drought-filter-controls" class="filterbar-controls">
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
      <article class="overview-kpi"><span>Areas in extreme drought or worse</span><strong>${extremeAreas} of ${scopedUnits.length}</strong><small>Any land at the extreme (D3) or exceptional (D4) class</small></article>
      <article class="overview-kpi"><span>Map week</span><strong>${formatDate(payload.map_date)}</strong><small>Published ${formatDate(payload.release_date)}</small></article>
      <article class="overview-kpi"><span>Map age</span><strong${late ? ' class="late-badge"' : ""}>${age} ${age === 1 ? "day" : "days"}</strong><small>${late ? "Late data: a new weekly map has been missed" : "A new map is published each Thursday"}</small></article>
    </section>
    <section class="overview-card" aria-labelledby="drought-map-heading">
      <div class="card-heading">
        <div><h2 id="drought-map-heading">The drought map</h2><p>The monitor's weekly national map in its own colours, for the week of ${formatDate(payload.map_date)}. The outlined shapes are the ${scopedUnits.length} drainage areas the figures below describe. Drought does not stop at their edges, so the map draws the wider pattern too.</p></div>
        <span class="sdk-badge">ArcGIS map</span>
      </div>
      <div id="drought-map-host" class="view-map-host has-inset-legend" aria-busy="true"
        aria-label="A map of drought classes over the drainage areas. The bars and table on this page carry the same shares as text."></div>
    </section>
    <section class="overview-card" aria-labelledby="drought-severity-heading">
      <div class="card-heading">
        <div><h2 id="drought-severity-heading">How the areas are divided</h2><p>Every drainage area counted once, at the most severe class with land in it. The tile above says how many are at extreme drought or worse. This says where all ${scopedUnits.length} sit, which is a different question. Nine clear areas and nine areas one class below the line give the same count, and they are not the same week. Levels with no areas in them are still drawn, so one week can be compared with another.</p></div>
      </div>
      <div id="drought-severity-host" class="drought-severity-host"></div>
      <ul class="overlay-key" id="drought-severity-key" aria-label="What each severity level is called"></ul>
    </section>
    <section class="overview-card" aria-labelledby="drought-join-heading">
      <div class="card-heading">
        <div><h2 id="drought-join-heading">Dry land against banked water</h2><p>Each drainage area is one point. How much of its land is in ${dryness.label.toLowerCase()} (${dryness.code}) or worse goes across the bottom. How full its reservoirs are goes up the side. The colour is the most severe class with land in it. The two do not have to agree, and where they disagree is the point. An area far to the right and high up draws on water banked in better years. One far to the right and low has neither the rain nor the savings. Read this as a description of how the two line up. It is not a test of one against the other. The Drought Monitor already weighs water supply conditions. And a reservoir is placed here by the area holding its dam, not by the land that fills it.</p></div>
      </div>
      <div id="drought-scatter-host" class="drought-scatter-host"></div>
    </section>
    <section class="overview-card" aria-labelledby="drought-gap-heading">
      <div class="card-heading">
        <div><h2 id="drought-gap-heading">The same comparison, in order</h2><p>One row for each drainage area that has a reservoir reading. Both dots in a row sit on the same 0 to 100 scale, each one at its own value. Which dot is on the left therefore changes from row to row. The dot in the class colours is the share of land in ${dryness.label.toLowerCase()} (${dryness.code}) or worse. The dot in the storage colours is how full that area's reservoirs are. The line between them is the distance, and it is only a distance. The two shares divide by different things, one by land and one by reservoir capacity, so the site never states their difference as a number. The rows are ordered by that distance. The areas where the water dot sits furthest to the left of the dry dot lead the list. That is dry ground with little banked to draw on.</p></div>
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
  const filterbar = content.querySelector<HTMLElement>(".mobile-filterbar");
  const filterToggle = content.querySelector<HTMLButtonElement>("#drought-filter-toggle");
  if (filterbar && filterToggle) wireMobileFilterDisclosure(filterbar, filterToggle);
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
    const chosen = unitsAtOrWorse(scopedUnits, state.worse as never);
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
        /* D4: still opens the chosen row -- the emphasis a `?area=` naming
         * exactly one basin already had before this slice filtered on it
         * too. `levelArea` is already coarsened to this page's own level, so
         * this reads as a no-op unless the value equals a real plotted
         * point's own code -- exactly the areas `scopedUnits` already
         * narrowed to, never one selected before that narrowing and then
         * filtered away. */
        highlight: levelArea
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

    /* Counted over every area in scope, not the `worse=` filtered view. This
     * chart is the shape of the whole week for whichever place a reader
     * chose; narrowing it further to a chosen severity would make it a
     * picture of that filter instead. */
    let severityAreas = 0;
    if (severityHost) {
      const counts = worstClassCounts(scopedUnits, NO_DROUGHT_LABEL);
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
        ? `${ordered.length} of ${scopedUnits.length} drainage areas have land in ` +
          `${chosenClass.label.toLowerCase()} (${chosenClass.code}) or worse, ${order}.`
        : `All ${ordered.length} drainage areas, ${order}.`;
    }

    window.__droughtReady = {
      ...(window.__droughtReady ?? {}),
      /* Two facts, two fields. Rows in the ranked comparison is not areas in
       * the severity chart: the first counts areas with a reservoir reading,
       * the second counts every area in scope. */
      gapRows,
      severityAreas,
      /* The count this page is currently about -- narrowed by `?level=`
       * already, and now also by `?state=`/`?area=` (D5). Equal to the
       * published total exactly when nothing was chosen. */
      units: scopedUnits.length,
      rows: ordered.length,
      level,
      /* Added, not a replacement for `units`: which place, if any, narrowed
       * this page, so a reader (or a test) can tell "75 because nothing was
       * chosen" apart from "75 because the choice matched everything" --
       * distinct facts `units` alone cannot carry. Always the *requested*
       * selection, whether or not it could be resolved -- see the comment on
       * `openingSelection` above -- so a `?state=CA` link never reports
       * itself as "nothing was chosen" merely because the reference export
       * failed to load. */
      stateFilter: openingSelection.state,
      areaFilter: openingSelection.area,
      /* A third, distinct fact from the two above: whether the request
       * *could* be acted on at all. `stateFilter`/`areaFilter` alone cannot
       * tell a reader (or a test) "asked for California, got it" apart from
       * "asked for California, got everything because the export never
       * loaded" -- two very different pages that would otherwise report
       * identically. A readiness field reports one fact each; this is the
       * one those two do not carry, so it is its own field rather than
       * folded into either. */
      openingScopeResolved: opening !== null,
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

  /*
   * The control that picks where a reader is looking (S4): a state and a
   * region/subregion/drainage-area drill-down, beside the level control in
   * the same filter bar. `opening` carries the full, unnarrowed rosters
   * this needs (`OpeningContext.rosters`) -- `openingSelection` above is
   * already the resolved, aliveness-checked selection this page draws with,
   * which is exactly what a repopulated control should show as chosen.
   * Skipped, like the level control effectively is by its own `.catch`,
   * when the reference export never resolved: there is nothing published to
   * build either control's options from.
   *
   * A full navigation, the same choice and the same reason as the level
   * control just above: `?state=` and `?area=` are read once, here, before
   * `renderDrought` is ever called (see the comment on `resolveOpening`'s
   * caller), so a picked value takes the path a shared link already takes
   * rather than a re-render this page has no function for.
   */
  if (opening) {
    const control = createWhereControl(opening.rosters, openingSelection, (selection) => {
      /* `searchWithPlace` remembers the choice and writes "everywhere" out
       * loud rather than as an absent parameter -- see its own note for why
       * a cleared filter must not become a link that means "no answer". */
      const query = searchWithPlace(window.location.search, selection);
      window.location.replace(`${window.location.pathname}${query}`);
    }, { scale: "l" });
    if (control) content.querySelector(".filterbar-controls")?.append(control.element);
  }

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
      const [drainageScope, usdm, boundaries] = await Promise.all(
        [loadDrainageScope(level), loadUsdmPolygons(), loadReferenceBoundaries()]);
      /* A technical failure -- the export or the boundary service came back
       * empty -- checked against the *unnarrowed* roster, before a chosen
       * place ever gets a chance to explain an empty list honestly instead. */
      if (drainageScope.areas.length === 0) throw new Error("no drainage boundaries");
      /* D5: the drawn context follows the choice on drought -- the areas
       * are the subject here, unlike the storage map's where they are
       * context. `chosenCodesAtLevel` is already built at this page's own
       * level (`renderDrought`, above), so this is exact membership against
       * `drainageScope`'s own codes, not a prefix guess. */
      const scope: DrainageScope = chosenCodesAtLevel === null ? drainageScope : {
        level: drainageScope.level,
        areas: drainageScope.areas.filter((area) => chosenCodesAtLevel.has(area.huc6))
      };
      if (scope.areas.length === 0) {
        /* A resolved, narrowed-to-nothing answer -- a real state or area
         * with no drainage area on this roster -- not the technical failure
         * `failed()` describes below. Reported the same honest way the bars
         * and table already are for the same case (an empty `scopedUnits`),
         * rather than telling a reader the map "could not start" when
         * nothing actually broke. */
        mapHost.setAttribute("aria-busy", "false");
        mapHost.replaceChildren(mapStatusNote(
          "No drainage area matches the chosen place. The bars and table below say the same."));
        legend.classList.remove("map-inset-legend");
        mapHost.append(legend);
        window.__droughtReady = {
          ...(window.__droughtReady ?? {}), mapClassesDrawn: 0, mapOutlines: 0
        } as NonNullable<typeof window.__droughtReady>;
        return;
      }
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
      /* The opening box, overriding what `createViewMap` just set from the
       * fixed, unscoped `drainageExtent()` -- only when a reader actually
       * chose a place. An unchosen page keeps the existing framing exactly,
       * rather than every ordinary visit suddenly opening on the union of
       * all 75 areas' boxes, which is a real, load-bearing behaviour change
       * this slice does not own (the coupling section of docs/OPENING-
       * SCOPE-AND-THE-WESTERN-ROSTER.md gates that on the roster and the
       * chooser control landing together, not on this file alone).
       *
       * This is *not* the late-correction pattern CLAUDE.md warns a gutter
       * against ("the measurement happens after the data loads, and the
       * control sits under the card until then"). There is no `await`
       * between `createViewMap` returning and this assignment -- both run in
       * the same synchronous turn, so nothing (no paint, no microtask, no
       * part of the component's own async view construction, which is what
       * `viewReadyWithin` below exists to wait on in the first place) can
       * observe the component's own default value in between. The reader's
       * chosen extent is in place before the view the element eventually
       * constructs is ever asked to go anywhere.
       *
       * Not expanded by an extra zoom-out level the way the storage map's
       * `regionExtent` is: `drainageExtent()`'s own comment is why -- these
       * cards are wide and short, an extent is a minimum, and asking a short
       * box to contain that much latitude already pushes the view out past
       * what an un-expanded box would on a full-height map. `extentFromBox`
       * is the one conversion every fixed and chosen extent on this site
       * goes through, so the corner order and spatial reference cannot drift
       * between them. */
      if (opening && scopeChosen) {
        mapElement.extent = mapExtentFromBox(opening.scope.box);
      }
      const mapStatus = await createDroughtMap(
        mapElement, card, scope, usdm, reservoirs,
        { units: scopedUnits, storage: storage ?? new Map() }, boundaries);
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
      /* The reservoir points are placed and hidden (see `drought-map.ts`).
       * This is the reader's way to ask for them: the whole roster of labelled
       * points over five broad classes is more ink than this map's one
       * question asks for, and about three times more of it than when that
       * balance was last judged -- but the join is still what the page is
       * built around, so it is one click away rather than gone.
       *
       * Not a parameter and not stored. It changes what is drawn over the
       * subject, not which subject is drawn, so it is not a scope and does
       * not belong in a shared link beside `?state=` and `?area=`. */
      const reservoirLayer = mapElement.map?.findLayerById(
        RESERVOIR_REFERENCE_LAYER_ID);
      /* A native checkbox, like the native selects it sits beside in this
       * bar. A Calcite switch was tried first and axe-core refused it: the
       * component's real control lives in a shadow root, so neither a
       * wrapping `<label>` nor the component's own `label` attribute gave it
       * an accessible name. The bar is already native, so this is the
       * consistent answer as well as the working one. */
      const reservoirToggle = document.createElement("label");
      reservoirToggle.className = "filterbar-toggle";
      const reservoirSwitch = document.createElement("input");
      reservoirSwitch.type = "checkbox";
      reservoirSwitch.id = "drought-show-reservoirs";
      reservoirSwitch.checked = false;
      reservoirSwitch.addEventListener("change", () => {
        const shown = reservoirSwitch.checked;
        if (reservoirLayer) reservoirLayer.visible = shown;
        window.__droughtReady = {
          ...(window.__droughtReady ?? {}), mapReservoirsShown: shown
        } as NonNullable<typeof window.__droughtReady>;
      });
      reservoirToggle.htmlFor = reservoirSwitch.id;
      reservoirToggle.append("Show reservoirs", reservoirSwitch);
      content.querySelector(".filterbar-controls")?.append(reservoirToggle);

      window.__droughtReady = {
        ...(window.__droughtReady ?? {}),
        mapClassesDrawn: mapStatus.classesDrawn,
        mapOutlines: mapStatus.outlines,
        mapAreaLabels: mapStatus.areaLabels,
        mapAreaLabelsDeconflicted: mapStatus.areaLabelsDeconflicted,
        mapReservoirs: mapStatus.reservoirs,
        mapReservoirLabels: mapStatus.reservoirLabels,
        mapReservoirsShown: mapStatus.reservoirsShown,
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
/* Read once, here, rather than inside `resolveOpening`: this is the
 * *requested* selection and stays available to `renderDrought` even when
 * resolving it against the reference export fails, which is what lets the
 * readiness fields and the on-page sentence tell "asked for nothing" apart
 * from "asked for California, could not load it" (see `resolveOpening`'s and
 * `renderDrought`'s own comments). */
/* The address bar wins where it answered, the reader's remembered place
   * otherwise, and everywhere when neither did (`resolveOpeningPlace`). The
   * stored choice is never written back into the address bar: what a reader
   * copies should be what they are looking at, not what they prefer. */
const requestedPlace = resolveOpeningPlace(window.location.search, readStoredPlace());
const requestedSelection = requestedPlace.selection;

try {
  /* The opening scope is fetched alongside the coverage payload rather than
   * after it: `resolveOpening` already swallows its own failure (returning
   * `null`), so this can never be what fails the page, and there is no
   * reason to make a reader who chose a place wait for two fetches in
   * series when neither depends on the other. Both are awaited before
   * `renderDrought` is ever called, so the very first paint of this page's
   * content already reflects the reader's narrowed scope -- there is no
   * intermediate render of all 75 areas for a chosen place to correct. */
  const [drought, opening] = await Promise.all(
    [loadDroughtCoverage(level), resolveOpening(requestedSelection)]);
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
  renderDrought(drought, storage, reservoirs, opening, requestedSelection);
} catch (error) {
  console.error("Drought view failed:", error);
  const content = document.querySelector<HTMLElement>("#drought-content");
  if (content) content.innerHTML = `<div class="overview-error" role="alert"><strong>The drought conditions could not load.</strong><p>Try again later or return to the storage map.</p></div>`;
}
