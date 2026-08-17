import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";

import { installAnonymousAuthPolicy } from "./arcgis/basemaps";
import { loadDrainageAreas, loadUtahBoundary } from "./data/boundaries";
import { loadReservoirs } from "./data/load";
import { downloadCsv } from "./data/download";
import {
  overviewCsvFilename,
  reservoirCsvFilename,
  reservoirHistoryCsv,
  tableCsv
} from "./data/export";
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
import { describeRanking, rankingRecords } from "./state/ranking";
import { createSelectionStore, findReservoir } from "./state/selection";
import {
  DEFAULT_SORT,
  describeTable,
  nextSort,
  tableRows,
  type SortKey,
  type TableRow,
  type TableSort
} from "./state/table";
import {
  connectSelectionToUrl, stateFromSearch, writeUrlState, type DashboardUrlState
} from "./state/url";
import { baselineChoices, baselineCoverage, FALLBACK_CHOICES } from "./state/baseline";
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
  setBaselineControl,
  setFilterControls,
  setFilterState,
  setMonthControl,
  setMonthState,
  setRankingCaption,
  setReservoirList,
  setScopeControl,
  setScopeValue,
  setSummary,
  setTableCaption,
  setTableRowOpen,
  wireCopyViewLinks,
  wirePanels,
  wireTableExport,
  wireTableRow
} from "./ui/shell";
import { renderShell } from "./ui/shell-template";
import { markSelectedInTable, renderTable } from "./ui/table";
import { THEME_CHANGE_EVENT, wireTheme } from "./ui/theme";
import type { BaselineChoice, BaselineId, Reservoir } from "./types";
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
    /* The periods this payload can actually offer, and which one it opens on.
     * Both come from the data rather than from a constant here, so a change of
     * default in the pipeline reaches the page without a code change and a
     * payload that carries only one period simply does not show the control. */
    baselineMinimumYears = data.climate_normals?.minimum_years ?? 0;
    baselineOptions = baselineChoices(data);
    const preferred = data.default_baseline ?? "recent";
    activeBaselineId = baselineOptions.some((choice) => choice.id === preferred)
      ? preferred
      : baselineOptions[0]?.id ?? "recent";
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

/* The bottom row. Its order and its open state are the reader's, so both
 * reach the address bar; the rows themselves are derived and never stored
 * as a second opinion about what the filter matched. */
let tableSort: TableSort = { ...DEFAULT_SORT };
let tableOpen = false;
/** Exactly what the table is showing, and therefore exactly what the export
 * button writes -- one array, two readers. */
let shownRows: readonly TableRow[] = [];

/* Everything the address bar carries except the selection, which the store
 * owns. One function, so the writer cannot go stale as controls are added. */
function viewState(): Omit<DashboardUrlState, "reservoir"> {
  return {
    storageClass: filterState.storageClass,
    reporting: filterState.reporting,
    drainageArea: filterState.drainageArea,
    lakePowell: scope.lakePowell,
    geography: scope.geography,
    month: selectedMonth(),
    tableOpen,
    tableSort,
    /* Null until the reader picks one, so an untouched page produces no
     * parameter and a link carries a choice only when a choice was made. */
    baseline: chosenBaseline
  };
}

/* Which period the details panel measures against.
 *
 * Two variables rather than one, because they are two different facts: what
 * the reader picked (null until they pick), and what the page is currently
 * showing (always a real period). Folding them together would make "opened on
 * the payload's default" indistinguishable from "chose the payload's default",
 * and only the second belongs in a shared link. */
let chosenBaseline: BaselineId | null = null;
let activeBaselineId: BaselineId = "recent";
let baselineOptions: readonly BaselineChoice[] = FALLBACK_CHOICES;
/* How many years a period needs before a reservoir may be measured against
 * it. Published rather than decided here, so the pipeline and the page cannot
 * disagree about what counts as a normal. */
let baselineMinimumYears = 0;

/**
 * The table under the map, rebuilt from the state the map is already drawn
 * from.
 *
 * Called from the filter's `apply`, which the scope and the month both run
 * as well -- so there is one path to the table rather than three, and no
 * combination of controls that leaves it describing a different view from
 * the circles above it.
 */
function renderReservoirTable(): void {
  const month = selectedMonth();
  shownRows = tableRows({
    reservoirs: inScope,
    filter: filterState,
    sort: tableSort,
    month,
    percentOf: percentShown
  });
  const host = document.querySelector<HTMLElement>('[data-table="rows"]');
  if (host) {
    renderTable(host, shownRows, tableSort, selection.get(), {
      onSort: (key: SortKey) => {
        tableSort = nextSort(tableSort, key);
        renderReservoirTable();
        writeUrlState({ ...viewState(), reservoir: selection.get() });
        /* Focus is on the heading that was just pressed, and the rebuild
         * replaced it. Put it back on the same column, or a reader sorting
         * from the keyboard is returned to the top of the document. */
        document.querySelector<HTMLElement>(`.table-sort[data-sort="${key}"]`)?.focus();
      },
      onSelect: (name: string) => selection.set(name, { source: "table" })
    });
  }
  setTableCaption(describeTable(
    shownRows.length, inScope.length, month, month === null ? "" : monthLabel(month)));
  if (window.__dashboardReady) {
    window.__dashboardReady.tableRows = shownRows.length;
    window.__dashboardReady.tableSort = `${tableSort.key}-${tableSort.direction}`;
    window.__dashboardReady.tableOpen = tableOpen;
  }
}

/* Phase 4's ranking chart, beside the table in the bottom row. Drawn from
 * `shownRows`, so it honors the filter, the month and the scope by
 * construction -- the same rows, ranked instead of sorted. */
let rankingRevision = 0;
let rankingTimer = 0;
/** The records the chart last drew, as a key. Rebuilding an SDK chart takes
 * whole seconds, so a change that produces the same records -- a table sort,
 * a filter set and unset -- must not pay for one. */
let lastRankingKey: string | null = null;
/** Bars the ranking chart is holding. 0 until it has drawn: the row opens
 * closed, and the chart is not built until the reader opens it. */
let rankingBars = 0;

/**
 * Asks for a redraw, soon. Debounced because the month slider fires once per
 * animation frame while it is dragged, and the chart is the one surface here
 * that cannot be rebuilt at that rate. Skipped entirely while the row is
 * closed: a collapsed panel has no box for the chart to measure itself
 * against, and the row's open handler schedules a draw the moment that
 * changes.
 */
function scheduleRankingChart(): void {
  if (!tableOpen) return;
  window.clearTimeout(rankingTimer);
  rankingTimer = window.setTimeout(() => { void renderRankingChart(); }, 250);
}

async function renderRankingChart(): Promise<void> {
  const host = document.querySelector<HTMLElement>('[data-ranking="host"]');
  if (!host) return;
  const records = rankingRecords(shownRows);
  const key = JSON.stringify(records);
  if (key === lastRankingKey && host.querySelector("arcgis-chart")) return;
  const revision = ++rankingRevision;
  setRankingCaption(describeRanking(records.length, shownRows.length));
  /* Busy only while a draw is actually in flight, and every way out of the
   * draw -- drawn, superseded, failed -- has to clear it. `mountChart`'s own
   * deadline bounds the wait, so this cannot be announced forever. */
  host.setAttribute("aria-busy", "true");
  /* One readable bar per reservoir. The row is far shorter than the full
   * set, so the host takes the height the bars need and the region scrolls,
   * exactly the way the table beside it does. */
  host.style.blockSize = `${Math.max(272, records.length * 18 + 88)}px`;
  try {
    /* Loaded when the reader first opens the row, not with the page: the
     * charts package is the heaviest optional part of the application, and
     * the map must not wait on it. */
    const { renderArcgisBarChart } = await import("./overview-charts");
    if (revision !== rankingRevision) return;
    await renderArcgisBarChart(
      host,
      records,
      "Percent full for each reservoir the analysis controls match, lowest first",
      () => revision === rankingRevision,
      {
        measure: "percent",
        categoryTitle: "Reservoir",
        /* A bar is the reservoir it ranks: clicking one selects it, the same
         * selection the map, the list and the table set. Clearing the bar
         * clears the selection rather than leaving the details panel open on
         * something the chart no longer points at. */
        onSelect: (labels) => selection.set(labels[0] ?? null, { source: "chart" })
      }
    );
  } catch (error) {
    console.error("The ranking chart could not be drawn:", error);
    if (revision === rankingRevision) {
      host.setAttribute("aria-busy", "false");
      const failed = document.createElement("p");
      failed.className = "chart-empty";
      failed.setAttribute("role", "alert");
      failed.textContent =
        "This chart could not be drawn. The table beside it has the same values.";
      host.replaceChildren(failed);
    }
    return;
  }
  if (revision !== rankingRevision) return;
  host.setAttribute("aria-busy", "false");
  lastRankingKey = key;
  rankingBars = records.length;
  if (window.__dashboardReady) window.__dashboardReady.rankingBars = rankingBars;
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
    // The table lists what the filter matched, so it is rebuilt from the
    // same `apply` the map effect and the panel sentence are written by.
    renderReservoirTable();
    // And the ranking chart is redrawn from the rows the table just took,
    // so the row's two surfaces cannot answer the filter differently.
    scheduleRankingChart();
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

/**
 * The sentence under the baseline control.
 *
 * It says two things the number cannot: why a reader would pick this period,
 * and how many reservoirs can actually answer for it. The second matters most
 * when switching to the standard period, because a handful of reservoirs are
 * younger than 1991 and fall back to the other one -- better to know that
 * before reading the map than to find one row disagreeing with the rest.
 */
function baselineNote(): string {
  const choice = baselineOptions.find((entry) => entry.id === activeBaselineId);
  if (!choice) return "";
  const { covered, total } = baselineCoverage(
    published, activeBaselineId, baselineMinimumYears);
  const reach = covered >= total
    ? `All ${total} reservoirs have readings from ${choice.period_label}.`
    : `${covered} of the ${total} reservoirs on this site have enough years in ` +
      `${choice.period_label}. The others are newer than that, and each one says so.`;
  return `${choice.note} ${reach}`;
}

function baselineControlOptions(): { value: string; label: string }[] {
  return baselineOptions.map((choice) => ({
    value: choice.id, label: `${choice.label}, ${choice.period_label}`
  }));
}

/** Puts the control, its sentence and the open details panel at one period. */
function applyBaseline(): void {
  setBaselineControl(baselineControlOptions(), activeBaselineId, baselineNote());
  renderDetail();
  if (window.__dashboardReady) window.__dashboardReady.baseline = activeBaselineId;
}

/**
 * Registered once, like every other control here.
 *
 * `applyBaseline` deliberately does not pass a handler: it runs again every
 * time the period changes, and a listener added on each of those runs would
 * fire once more than the last time.
 */
function wireBaseline(): void {
  setBaselineControl(
    baselineControlOptions(), activeBaselineId, baselineNote(),
    (value) => {
      if (!baselineOptions.some((choice) => choice.id === value)) return;
      activeBaselineId = value as BaselineId;
      // Now an explicit choice, so it belongs in a shared link -- which is
      // the difference between this and the period the page opened on.
      chosenBaseline = activeBaselineId;
      applyBaseline();
      writeUrlState({ ...viewState(), reservoir: selection.get() });
    }
  );
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

/**
 * The details panel for whatever is selected now.
 *
 * Its own function because two different things change it: the selection, and
 * the period the reader is comparing against. The selection store refuses to
 * re-announce a name that has not changed -- which is what stops the map and
 * the list calling each other -- so a period change cannot go through it and
 * has to redraw the panel directly.
 */
function renderDetail(): void {
  const reservoir = findReservoir(inScope, selection.get());
  setDetail(
    reservoir ? describeReservoir(
      reservoir, storageColor(headlinePercent(reservoir)),
      activeBaselineId, baselineOptions, baselineMinimumYears) : null,
    reservoir ? () => downloadCsv(
      reservoirHistoryCsv(reservoir), reservoirCsvFilename(reservoir.name, publishedAt)
    ) : undefined
  );
}

/** Registered once. It reads the live scope, so it survives a redraw. */
function wireSelection(): void {
  selection.subscribe((name) => {
    const reservoir = findReservoir(inScope, name);
    markSelectedInList(reservoir?.name ?? null);
    markSelectedInTable(reservoir?.name ?? null);
    renderDetail();
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
  wireCopyViewLinks();
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
    wireTableRow((open) => {
      tableOpen = open;
      if (window.__dashboardReady) window.__dashboardReady.tableOpen = open;
      writeUrlState({ ...viewState(), reservoir: selection.get() });
      // The first open is what builds the chart; a later one redraws it only
      // if the rows changed while the row was closed.
      if (open) scheduleRankingChart();
    });
    /* The chart bakes the page's colors into its own config when it is
     * built, so a theme change has to rebuild it -- the cascade cannot
     * reach inside. The key is cleared or the rebuild would be skipped as
     * "the same records". */
    document.addEventListener(THEME_CHANGE_EVENT, () => {
      lastRankingKey = null;
      scheduleRankingChart();
    });
    /* Exactly the rows on screen, raw numbers -- the same array the renderer
     * was handed, so the file cannot hold a different set, order or month. */
    wireTableExport(() => downloadCsv(
      tableCsv(shownRows), overviewCsvFilename(publishedAt)));
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
    tableSort = wanted.tableSort;
    tableOpen = wanted.tableOpen;
    /* A link to a period this payload does not offer opens on the payload's
     * own default rather than on nothing -- the same rule the month and the
     * drainage area already follow. */
    if (wanted.baseline && baselineOptions.some((c) => c.id === wanted.baseline)) {
      activeBaselineId = wanted.baseline;
      chosenBaseline = wanted.baseline;
    }
    setTableRowOpen(tableOpen);
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
  wireBaseline();
  applyBaseline();
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
    reservoirLabels: map.status.reservoirLabels,
    late: inScope.filter(isLate).length,
    lakePowell: scope.lakePowell,
    geography: scope.geography,
    months: months.length,
    month: selectedMonth(),
    basemap: map.status.basemap,
    basemapDegraded: map.status.basemapDegraded,
    basemapReferenceSunk: map.status.basemapReferenceSunk,
    masked: map.status.masked,
    boundaryPoints: map.status.boundaryPoints,
    drainageAreas: map.status.drainageAreas,
    drainageLabels: map.status.drainageLabels,
    drainageLabelsUnderReservoirs: map.status.drainageLabelsUnderReservoirs,
    drainageLabelsDeconflicted: map.status.drainageLabelsDeconflicted,
    /* The chosen area, which is not `drainageAreas` -- that one counts the
     * boundaries the map drew. One fact per field. */
    areaFilter: filterStatus.drainageArea,
    /* Two facts, two fields: which period the panel is measuring against, and
     * how many periods the reader is being offered. The second is what tells
     * a test whether the control should be on screen at all. */
    baseline: activeBaselineId,
    baselineChoices: baselineOptions.length,
    listItems: document.querySelectorAll("#start-panel .list-btn").length,
    filtered: filterStatus.filtered,
    shown: filterStatus.shown,
    selectionOnTop: map.status.selectionOnTop,
    /* Three facts, three fields. `tableRows` counts the rows the table is
     * holding, which is `shown` today and would stop being `shown` the
     * moment either surface changed what it lists -- which is the whole
     * reason to report it separately rather than assume they agree. */
    tableRows: shownRows.length,
    tableSort: `${tableSort.key}-${tableSort.direction}`,
    tableOpen,
    /* Bars the ranking chart is holding, which is not `tableRows`: the chart
     * leaves out a reservoir with no readable percentage, and it is not
     * built at all until the reader opens the row. */
    rankingBars,
    navigationBounds: map.status.navigationBounds,
    minZoom: map.status.minZoom,
    deepLink: deepLink?.name ?? null,
    selected: selection.get()
  };
}
