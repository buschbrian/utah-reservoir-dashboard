import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";

import { installAnonymousAuthPolicy } from "./arcgis/basemaps";
import { loadDrainageAreas, loadUtahBoundary } from "./data/boundaries";
import { loadReservoirs } from "./data/load";
import { isLate, statewideRollup } from "./data/rollup";
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

async function loadData(): Promise<Reservoir[] | null> {
  try {
    const data = await loadReservoirs();
    if (data.reservoirs.length === 0) {
      setDataState({ kind: "empty" });
      return null;
    }
    const rollup = statewideRollup(data.reservoirs, {
      geography: "utah",
      lakePowell: "exclude"
    });
    setSummary({
      percent: formatPercent(rollup.percentFull),
      storage: `${formatAcreFeet(rollup.storageAf)} acre-feet stored`,
      count: String(rollup.count),
      updated: `Published ${formatDate(data.generated_at.slice(0, 10))}`
    });
    setDataState({ kind: "ready", count: data.reservoir_count });
    return overviewScope(data.reservoirs);
  } catch (error) {
    console.error("Reservoir data failed validation or could not load:", error);
    setDataState({ kind: "error" });
    return null;
  }
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
function wireFilters(reservoirs: readonly Reservoir[], map: MapController): void {
  let state: FilterState = ALL_RESERVOIRS;

  const apply = (): void => {
    const shown = reservoirs.filter((reservoir) => matchesFilter(reservoir, state));
    map.setFilter(filterWhere(state));
    markFilteredInList((name) => !shown.some((reservoir) => reservoir.name === name));
    setFilterState(
      { storage: String(state.storageClass ?? "all"), reporting: state.reporting },
      describeFilter(state, shown.length, reservoirs.length),
      isFiltered(state)
    );
    filterStatus.filtered = isFiltered(state);
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
      state = kind === "storage"
        ? { ...state, storageClass: value === "all" ? null : Number(value) }
        : { ...state, reporting: value as FilterState["reporting"] };
      apply();
    },
    () => { state = ALL_RESERVOIRS; apply(); }
  );
  apply();
}

function wireSelection(reservoirs: readonly Reservoir[]): void {
  setReservoirList(
    reservoirs.map((reservoir) => ({
      name: reservoir.name,
      percent: formatPercent(headlinePercent(reservoir)),
      color: storageColor(headlinePercent(reservoir)),
      late: isLate(reservoir)
    })),
    (name) => selection.set(name, { source: "list" })
  );

  selection.subscribe((name) => {
    const reservoir = findReservoir(reservoirs, name);
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
    wireSelection(reservoirs);
    map.drawReservoirs(reservoirs);
    // After the list exists: the filter dims rows the map greys.
    wireFilters(reservoirs, map);
    /* The address bar is connected before the link is read, so restoring a
     * selection writes the same URL back rather than a differently-spelled
     * one -- "?reservoir=deer creek" typed by hand becomes the canonical
     * "?reservoir=Deer%20Creek" the moment it resolves. */
    connectSelectionToUrl(selection);
    deepLink = findReservoir(reservoirs, selectionFromSearch(window.location.search));
    if (deepLink) selection.set(deepLink.name, { source: "url" });
  }
  await loadContext(map);

  /* One fact per field, and fields are only ever added (never removed or
   * re-pointed at an expression another field already reads): two fields
   * reading one expression is how a whole map layer was deleted without a
   * test noticing. */
  window.__dashboardReady = {
    engine: "arcgis-5",
    reservoirs: reservoirs?.length ?? 0,
    drawn: map.status.reservoirsDrawn,
    symbols: map.status.reservoirSymbols,
    late: reservoirs?.filter(isLate).length ?? 0,
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
