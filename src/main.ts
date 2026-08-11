import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";

import { installAnonymousAuthPolicy } from "./arcgis/basemaps";
import { loadDrainageAreas, loadUtahBoundary } from "./data/boundaries";
import { loadReservoirs } from "./data/load";
import { isLate, statewideRollup, type LakePowellChoice } from "./data/rollup";
import { overviewScope } from "./overview-model";
import { describeReservoir } from "./state/detail";
import {
  ALL_RESERVOIRS,
  describeFilter,
  filterWhere,
  isFiltered,
  matchesFilter,
  reportingLabel,
  storageLabel,
  type FilterState
} from "./state/filters";
import { createSelectionStore, findReservoir } from "./state/selection";
import { connectSelectionToUrl, selectionFromSearch } from "./state/url";
import { supportsDashboard } from "./state/shell";
import { loadMap, type MapController } from "./ui/map";
import {
  browserCapabilities,
  markFilteredInList,
  markSelectedInList,
  renderUnsupported,
  revealDetail,
  setDataState,
  setDetail,
  setFilterControls,
  setFilterState,
  setReservoirList,
  setScopeControl,
  setScopeValue,
  setSummary,
  wirePanels
} from "./ui/shell";
import { renderShell } from "./ui/shell-template";
import { wireTheme } from "./ui/theme";
import type { Reservoir } from "./types";
import { STORAGE_CLASSES, storageColor } from "./viz/classes";
import { formatAcreFeet, formatDate, formatPercent } from "./viz/format";
import { headlinePercent } from "./viz/symbols";
import "./styles/app.css";

// Vite emits this entry inside /assets; using its parent makes Calcite's
// `assets/...` requests resolve to the small, versioned subset in public/assets.
setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);

const rootCandidate = document.querySelector<HTMLElement>("#app");
if (!rootCandidate) throw new Error("Missing #app root");
const root: HTMLElement = rootCandidate;

const selection = createSelectionStore();

/* What the filter currently shows. The readiness signal is written after the
 * first draw and the filter keeps changing after that, so this is the one
 * place the answer lives and both readers take it from here. */
const filterStatus = { filtered: false, shown: 0 };

/* The reservoir a shared link asked for, once it has been matched against
 * the reservoirs actually in scope. Null both when there was no link and
 * when the link named something this page does not draw -- those are the
 * same outcome for the reader, and the readiness signal reports the
 * resolved name so a test can tell a working link from a silently ignored
 * one. */
let deepLink: Reservoir | null = null;

/** Everything published, before the scope control narrows it. */
let published: readonly Reservoir[] = [];
/** Everything the map is currently drawing. */
let inScope: readonly Reservoir[] = [];
/** ADR-011: a deliberate comparison control, not a geographic filter. */
let lakePowell: LakePowellChoice = "exclude";
let publishedAt = "";

async function loadData(): Promise<readonly Reservoir[] | null> {
  try {
    const data = await loadReservoirs();
    if (data.reservoirs.length === 0) {
      setDataState({ kind: "empty" });
      return null;
    }
    publishedAt = data.generated_at.slice(0, 10);
    setDataState({ kind: "ready", count: data.reservoir_count });
    return data.reservoirs;
  } catch (error) {
    console.error("Reservoir data failed validation or could not load:", error);
    setDataState({ kind: "error" });
    return null;
  }
}

/** The headline, recomputed for whatever the scope control now includes. */
function updateSummary(): void {
  const rollup = statewideRollup(inScope, {
    geography: "utah",
    // `inScope` already answered the Lake Powell question; asking it twice
    // here would make the control unable to add the reservoir back.
    lakePowell: "include"
  });
  setSummary({
    percent: formatPercent(rollup.percentFull),
    storage: `${formatAcreFeet(rollup.storageAf)} acre-feet stored`,
    count: String(rollup.count),
    updated: `Published ${formatDate(publishedAt)}`,
    // Written from the control rather than fixed in the markup: it read
    // "excluding Lake Powell" whatever the reader had chosen.
    scope: lakePowell === "include"
      ? "Utah waterbodies, including Lake Powell"
      : "Utah waterbodies, excluding Lake Powell"
  });
}

/* The boundaries are context and are loaded on their own path: a missing or
 * malformed file leaves the reservoirs exactly where they are. */
async function loadContext(map: MapController): Promise<void> {
  try {
    map.drawDrainageAreas(await loadDrainageAreas());
  } catch (error) {
    console.warn("Drainage-area boundaries are unavailable:", error);
  }
}

/**
 * The analysis controls, and the one rule they drive.
 *
 * The map greys what is excluded and the list dims it, both from the same
 * `FilterState`: the panel's sentence, the dimmed rows and the greyed
 * circles are three renderings of one answer, not three answers.
 */
let filterState: FilterState = ALL_RESERVOIRS;
let applyFilter: () => void = () => undefined;

function wireFilters(map: MapController): void {
  const apply = (): void => {
    // Reads the current scope rather than the one that existed when the
    // controls were built: changing the scope has to re-answer the filter.
    const shown = inScope.filter((reservoir) => matchesFilter(reservoir, filterState));
    map.setFilter(filterWhere(filterState));
    markFilteredInList((name) => !shown.some((reservoir) => reservoir.name === name));
    setFilterState(
      { storage: String(filterState.storageClass ?? "all"), reporting: filterState.reporting },
      describeFilter(filterState, shown.length, inScope.length),
      isFiltered(filterState)
    );
    filterStatus.filtered = isFiltered(filterState);
    filterStatus.shown = shown.length;
    if (window.__dashboardReady) {
      window.__dashboardReady.filtered = filterStatus.filtered;
      window.__dashboardReady.shown = filterStatus.shown;
    }
  };

  setFilterControls(
    [{ value: "all", label: storageLabel(null) },
      ...STORAGE_CLASSES.map((_, index) => ({
        value: String(index), label: storageLabel(index)
      }))],
    (["all", "late", "current"] as const).map((reporting) => ({
      value: reporting, label: reportingLabel(reporting)
    })),
    (kind, value) => {
      filterState = kind === "storage"
        ? { ...filterState, storageClass: value === "all" ? null : Number(value) }
        : { ...filterState, reporting: value as FilterState["reporting"] };
      apply();
    },
    () => { filterState = ALL_RESERVOIRS; apply(); }
  );
  applyFilter = apply;
  apply();
}

/** The list is rebuilt whenever the scope changes; its buttons are new. */
function renderReservoirList(): void {
  setReservoirList(
    inScope.map((reservoir) => ({
      name: reservoir.name,
      percent: formatPercent(headlinePercent(reservoir)),
      color: storageColor(headlinePercent(reservoir)),
      late: isLate(reservoir)
    })),
    (name) => selection.set(name, { source: "list" })
  );
  markSelectedInList(selection.get());
}

/** Registered once. It reads the live scope, so it survives a redraw. */
function wireSelection(): void {
  selection.subscribe((name) => {
    const reservoir = findReservoir(inScope, name);
    markSelectedInList(reservoir?.name ?? null);
    setDetail(reservoir
      ? describeReservoir(reservoir, storageColor(headlinePercent(reservoir)))
      : null);
    if (reservoir) revealDetail();
    // The readiness signal is written once, after the first draw; the
    // selection keeps changing after that, so the field is kept current
    // rather than left reporting the state the page loaded in.
    if (window.__dashboardReady) window.__dashboardReady.selected = reservoir?.name ?? null;
  });
}

if (!supportsDashboard(browserCapabilities())) {
  renderUnsupported(root);
} else {
  // This policy must precede renderShell and loadMap. It turns secured-resource
  // challenges into failures the basemap fallback can handle without a prompt.
  installAnonymousAuthPolicy((error) => {
    console.warn("Secured map resource refused:", error.url);
  });
  renderShell(root);
  wirePanels();
  wireTheme();

  const boundary = loadUtahBoundary().catch((error: unknown) => {
    console.warn("The authoritative Utah boundary is unavailable; using the fallback mask:", error);
    return null;
  });
  const [reservoirs, map] = await Promise.all([loadData(), loadMap(selection, boundary)]);
  if (reservoirs) {
    published = reservoirs;

    /**
     * Redraws everything for the current Lake Powell choice.
     *
     * The scope is not a filter, so nothing here dims: the map gets a new
     * layer, the list gets new rows, and the headline is recomputed. A
     * selected reservoir that leaves the scope is cleared, because leaving
     * the details panel open on a reservoir the map no longer draws is the
     * panel describing something nobody can see.
     */
    const applyScope = (): void => {
      inScope = overviewScope(published, lakePowell);
      updateSummary();
      renderReservoirList();
      map.drawReservoirs(inScope);
      if (selection.get() && !findReservoir(inScope, selection.get())) {
        selection.set(null, { source: "scope" });
      }
      applyFilter();
      if (window.__dashboardReady) {
        window.__dashboardReady.reservoirs = inScope.length;
        window.__dashboardReady.drawn = map.status.reservoirsDrawn;
        window.__dashboardReady.symbols = map.status.reservoirSymbols;
        window.__dashboardReady.late = inScope.filter(isLate).length;
        window.__dashboardReady.lakePowell = lakePowell;
        window.__dashboardReady.listItems =
          document.querySelectorAll("#start-panel .list-btn").length;
      }
    };

    wireSelection();
    wireFilters(map);
    setScopeControl((value) => {
      lakePowell = value === "include" ? "include" : "exclude";
      applyScope();
    });
    setScopeValue(lakePowell);
    applyScope();

    /* The address bar is connected before the link is read, so restoring a
     * selection writes the same URL back rather than a differently-spelled
     * one -- "?reservoir=deer creek" typed by hand becomes the canonical
     * "?reservoir=Deer%20Creek" the moment it resolves. */
    connectSelectionToUrl(selection);
    deepLink = findReservoir(inScope, selectionFromSearch(window.location.search));
    if (deepLink) selection.set(deepLink.name, { source: "url" });
  }
  await loadContext(map);

  /* One fact per field, and fields are only ever added (never removed or
   * re-pointed at an expression another field already reads): two fields
   * reading one expression is how a whole map layer was deleted without a
   * test noticing. */
  window.__dashboardReady = {
    engine: "arcgis-5",
    reservoirs: inScope.length,
    drawn: map.status.reservoirsDrawn,
    symbols: map.status.reservoirSymbols,
    late: inScope.filter(isLate).length,
    lakePowell,
    basemap: map.status.basemap,
    basemapDegraded: map.status.basemapDegraded,
    masked: map.status.masked,
    boundaryPoints: map.status.boundaryPoints,
    drainageAreas: map.status.drainageAreas,
    listItems: document.querySelectorAll("#start-panel .list-btn").length,
    filtered: filterStatus.filtered,
    shown: filterStatus.shown,
    navigationBounds: map.status.navigationBounds,
    minZoom: map.status.minZoom,
    deepLink: deepLink?.name ?? null,
    selected: selection.get()
  };
}
