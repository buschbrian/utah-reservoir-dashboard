import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";

import { installAnonymousAuthPolicy } from "./arcgis/basemaps";
import { loadDrainageAreas, loadUtahBoundary } from "./data/boundaries";
import { loadReservoirs } from "./data/load";
import { monthKeys, monthLabel, monthPercent, monthlyRollup } from "./data/months";
import {
  isLate,
  statewideRollup,
  type LakePowellChoice,
  type ReservoirGeography
} from "./data/rollup";
import {
  DEFAULT_SCOPE,
  overviewScope,
  watershedOptions,
  type ScopeChoice
} from "./overview-model";
import { describeReservoir } from "./state/detail";
import {
  ALL_RESERVOIRS,
  describeFilter,
  drainageAreaLabel,
  filterWhere,
  isFiltered,
  matchesFilter,
  reportingLabel,
  storageLabel,
  type FilterState
} from "./state/filters";
import { createSelectionStore, findReservoir } from "./state/selection";
import { connectSelectionToUrl, stateFromSearch, writeUrlState } from "./state/url";
import { supportsDashboard } from "./state/shell";
import { renderLegend } from "./ui/legend";
import { loadMap, type MapController } from "./ui/map";
import {
  browserCapabilities,
  markFilteredInList,
  markSelectedInList,
  renderUnsupported,
  revealDetail,
  setDataState,
  setDetail,
  setDrainageAreaOptions,
  setFilterControls,
  setFilterState,
  setMonthControl,
  setMonthState,
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
const filterStatus: { filtered: boolean; shown: number; drainageArea: string | null } =
  { filtered: false, shown: 0, drainageArea: null };

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
/* ADR-011's two dimensions, both the reader's to choose. Geography was
 * pinned to `utah`, which is why Fontenelle and Woodruff Narrows -- paid for
 * by the refresh every morning, connected to Utah by drainage but never
 * touching it -- were published and drawn nowhere. */
let scope: ScopeChoice = { ...DEFAULT_SCOPE };

/* Which month the map is showing. Every month the payload carries, oldest
 * first, with the newest published reading one position past the end -- that
 * last position is what the page opens on and what the details panel and the
 * late-data badges are about. */
let months: readonly string[] = [];
let monthIndex = 0;

/** Null while the map shows the newest reading. */
function selectedMonth(): string | null {
  return monthIndex < months.length ? months[monthIndex] ?? null : null;
}

/** What each reservoir's fill shows right now: a month, or today. */
function percentShown(reservoir: Reservoir): ReturnType<typeof headlinePercent> {
  const month = selectedMonth();
  return month === null ? headlinePercent(reservoir) : monthPercent(reservoir, month);
}
let publishedAt = "";

async function loadData(): Promise<readonly Reservoir[] | null> {
  // The template no longer carries this copy, so the first state has to be
  // announced rather than assumed.
  setDataState({ kind: "loading" });
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
  const month = selectedMonth();
  /* The headline follows the slider. A summary still reporting today while
   * the map draws last November is the page saying two things at once, and
   * the map is the louder one. */
  const rollup = month === null
    ? statewideRollup(inScope, {
      geography: "utah",
      // `inScope` already answered the Lake Powell question; asking it twice
      // here would make the control unable to add the reservoir back.
      lakePowell: "include"
    })
    : { ...monthlyRollup(inScope, month), count: monthlyRollup(inScope, month).reporting };
  setSummary({
    percent: formatPercent(rollup.percentFull),
    storage: `${formatAcreFeet(rollup.storageAf)} acre-feet stored`,
    count: String(rollup.count),
    updated: month === null
      ? `Published ${formatDate(publishedAt)}`
      : `Average through ${monthLabel(month)}`,
    // Written from the control rather than fixed in the markup: it read
    // "excluding Lake Powell" whatever the reader had chosen.
    scope: `${scope.geography === "connected" ? "Connected reservoirs" : "Utah waterbodies"}, ` +
      `${scope.lakePowell === "include" ? "including" : "excluding"} Lake Powell`
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

/* Everything the address bar carries except the selection, which the store
 * owns. One function, so the writer cannot go stale as controls are added. */
function viewState(): {
  storageClass: number | null;
  reporting: FilterState["reporting"];
  drainageArea: string | null;
  lakePowell: LakePowellChoice;
  geography: ReservoirGeography;
  month: string | null;
} {
  return {
    storageClass: filterState.storageClass,
    reporting: filterState.reporting,
    drainageArea: filterState.drainageArea,
    lakePowell: scope.lakePowell,
    geography: scope.geography,
    month: selectedMonth()
  };
}


/** The drainage areas the map currently has, as the control's choices. The
 * areas follow the scope: `connected` brings two more reservoirs, and one of
 * them may be the only reservoir in its area. */
function drainageAreaChoices(): { value: string; label: string }[] {
  return [{ value: "all", label: drainageAreaLabel(null) },
    ...watershedOptions(inScope).map((area) => ({ value: area.code, label: area.label }))];
}

/** The name of the chosen area, for the sentence under the controls. Null
 * when nothing is chosen, and also when the choice has left the scope. */
function drainageAreaName(): string | null {
  if (filterState.drainageArea === null) return null;
  return watershedOptions(inScope)
    .find((area) => area.code === filterState.drainageArea)?.label ?? null;
}

function wireFilters(map: MapController): void {
  const apply = (): void => {
    // Reads the current scope rather than the one that existed when the
    // controls were built: changing the scope has to re-answer the filter.
    const shown = inScope.filter((reservoir) => matchesFilter(reservoir, filterState));
    map.setFilter(filterWhere(filterState));
    markFilteredInList((name) => !shown.some((reservoir) => reservoir.name === name));
    setFilterState(
      { storage: String(filterState.storageClass ?? "all"),
        reporting: filterState.reporting,
        drainage: filterState.drainageArea ?? "all" },
      describeFilter(filterState, shown.length, inScope.length, drainageAreaName()),
      isFiltered(filterState)
    );
    filterStatus.filtered = isFiltered(filterState);
    filterStatus.shown = shown.length;
    filterStatus.drainageArea = filterState.drainageArea;
    if (window.__dashboardReady) {
      window.__dashboardReady.filtered = filterStatus.filtered;
      window.__dashboardReady.shown = filterStatus.shown;
      window.__dashboardReady.areaFilter = filterStatus.drainageArea;
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
    drainageAreaChoices(),
    (kind, value) => {
      if (kind === "storage") {
        filterState = { ...filterState, storageClass: value === "all" ? null : Number(value) };
      } else if (kind === "reporting") {
        filterState = { ...filterState, reporting: value as FilterState["reporting"] };
      } else {
        filterState = { ...filterState, drainageArea: value === "all" ? null : value };
      }
      apply();
      writeUrlState({ ...viewState(), reservoir: selection.get() });
    },
    () => {
      filterState = ALL_RESERVOIRS;
      apply();
      writeUrlState({ ...viewState(), reservoir: selection.get() });
    }
  );
  applyFilter = apply;
  apply();
}

/** The list is rebuilt whenever the scope changes; its buttons are new. */
function renderReservoirList(): void {
  setReservoirList(
    inScope.map((reservoir) => ({
      name: reservoir.name,
      percent: formatPercent(percentShown(reservoir)),
      color: storageColor(percentShown(reservoir)),
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
  /* Before the data, not after it: the key describes the symbol table, which
   * is fixed, so it has no reason to wait on a fetch that may fail. A reader
   * looking at the loading state can already read what the map will mean. */
  document.querySelectorAll<HTMLElement>("[data-legend]").forEach(renderLegend);

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
      inScope = overviewScope(published, scope);
      updateSummary();
      renderReservoirList();
      map.drawReservoirs(inScope, percentShown);
      if (selection.get() && !findReservoir(inScope, selection.get())) {
        selection.set(null, { source: "scope" });
      }
      /* The areas the map has changed with the scope. A chosen area that is
       * no longer one of them would leave every reservoir dimmed with a
       * control offering no way back, so it falls back to all of them --
       * the same rule the selection above follows. */
      const areas = drainageAreaChoices();
      setDrainageAreaOptions(areas);
      if (filterState.drainageArea !== null
        && !areas.some((area) => area.value === filterState.drainageArea)) {
        filterState = { ...filterState, drainageArea: null };
      }
      applyFilter();
      if (window.__dashboardReady) {
        window.__dashboardReady.reservoirs = inScope.length;
        window.__dashboardReady.drawn = map.status.reservoirsDrawn;
        window.__dashboardReady.symbols = map.status.reservoirSymbols;
        window.__dashboardReady.late = inScope.filter(isLate).length;
        window.__dashboardReady.lakePowell = scope.lakePowell;
        window.__dashboardReady.geography = scope.geography;
        window.__dashboardReady.listItems =
          document.querySelectorAll("#start-panel .list-btn").length;
      }
    };

    months = monthKeys(published);
    monthIndex = months.length;

    /**
     * Redraws for the month the slider is on.
     *
     * The map, the list and the headline all take their percentage from
     * `percentShown`, so they cannot disagree about which month is on
     * screen. The details panel deliberately does not move: it reports a
     * reservoir's latest reading, its source and whether that reading is
     * late, none of which is a per-month fact.
     */
    const applyMonth = (): void => {
      const month = selectedMonth();
      updateSummary();
      renderReservoirList();
      // The layer already has these reservoirs; only what they show changes.
      map.setPercents(percentShown);
      applyFilter();
      setMonthState(monthIndex, months, month === null
        ? "Showing the newest reading from each reservoir."
        : `Showing the average through ${monthLabel(month)}.`);
      if (window.__dashboardReady) {
        window.__dashboardReady.month = month;
        window.__dashboardReady.drawn = map.status.reservoirsDrawn;
      }
      writeUrlState({ ...viewState(), reservoir: selection.get() });
    };

    wireSelection();
    wireFilters(map);
    setMonthControl(months, (index) => {
      monthIndex = Math.max(0, Math.min(months.length, index));
      applyMonth();
    }, () => {
      monthIndex = months.length;
      applyMonth();
    });
    setScopeControl((chosen) => {
      scope = {
        geography: chosen.geography === "connected" ? "connected" : "utah",
        lakePowell: chosen.lakePowell ? "include" : "exclude"
      };
      applyScope();
      applyMonth();
      writeUrlState({ ...viewState(), reservoir: selection.get() });
    });

    /* Restore the whole view a link describes, not just its selection: a
     * filtered, Lake-Powell-included link that opened on an unfiltered
     * dashboard would show numbers that do not match the words around it. */
    const wanted = stateFromSearch(window.location.search);
    scope = { geography: wanted.geography, lakePowell: wanted.lakePowell };
    filterState = {
      storageClass: wanted.storageClass,
      reporting: wanted.reporting,
      drainageArea: wanted.drainageArea
    };
    // A link to a month the payload no longer carries opens on the newest
    // reading rather than on nothing.
    const askedFor = wanted.month === null ? -1 : months.indexOf(wanted.month);
    monthIndex = askedFor >= 0 ? askedFor : months.length;
    setScopeValue({
      geography: scope.geography,
      lakePowell: scope.lakePowell === "include"
    });
    applyScope();
    applyMonth();

    /* The address bar is connected before the link is read, so restoring a
     * selection writes the same URL back rather than a differently-spelled
     * one -- "?reservoir=deer creek" typed by hand becomes the canonical
     * "?reservoir=Deer%20Creek" the moment it resolves. */
    connectSelectionToUrl(selection, viewState);
    deepLink = findReservoir(inScope, wanted.reservoir);
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
    lakePowell: scope.lakePowell,
    geography: scope.geography,
    months: months.length,
    month: selectedMonth(),
    basemap: map.status.basemap,
    basemapDegraded: map.status.basemapDegraded,
    masked: map.status.masked,
    boundaryPoints: map.status.boundaryPoints,
    drainageAreas: map.status.drainageAreas,
    /* The chosen area, which is not `drainageAreas` -- that one counts the
     * boundaries the map drew. One fact per field. */
    areaFilter: filterStatus.drainageArea,
    listItems: document.querySelectorAll("#start-panel .list-btn").length,
    filtered: filterStatus.filtered,
    shown: filterStatus.shown,
    navigationBounds: map.status.navigationBounds,
    minZoom: map.status.minZoom,
    deepLink: deepLink?.name ?? null,
    selected: selection.get()
  };
}
