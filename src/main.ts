import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";

import { installAnonymousAuthPolicy } from "./arcgis/basemaps";
import { loadDrainageScope, loadOfferedLevels } from "./data/boundaries";
import { loadReservoirs } from "./data/load";
import { downloadCsv } from "./data/download";
import {
  overviewCsvFilename,
  reservoirCsvFilename,
  reservoirHistoryCsv,
  tableCsv
} from "./data/export";
import {
  monthKeys, monthLabel, monthPercent, monthlyRollup, type MonthlyRollup
} from "./data/months";
import {
  DEFAULT_OPENING_SELECTION,
  loadOpeningRosters,
  resolveOpeningScope,
  type OpeningRosters,
  type OpeningScope,
  type OpeningSelection,
  EMPTY_OPENING_ROSTERS,
  isOpeningScopeChosen
} from "./data/opening-scope";
import { readStoredPlace, resolveOpeningPlace, searchWithPlace } from "./state/opening-preference";
import { offeredStates } from "./data/state-vocabulary";
import { createOpeningSplash, shouldAskWhere, wasDismissed } from "./ui/opening-splash";
import {
  isLakeMead, isLakePowell, isLate, statewideRollup, WIDEST_SCOPE,
  type RollupCoverage
} from "./data/rollup";
import { stateName } from "./data/state-vocabulary";
import {
  DEFAULT_SCOPE,
  overviewScope,
  reservoirInState,
  subregionNames,
  watershedOptions,
  type ScopeChoice
} from "./overview-model";
import { describeReservoir } from "./state/detail";
import {
  ALL_RESERVOIRS,
  coversDrainageArea,
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
import { createSelectionStore, findReservoir, reservoirLabel } from "./state/selection";
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
import { levelFromSearch, writeLevel } from "./state/level";
import { supportsDashboard } from "./state/shell";
import { createLevelControl } from "./ui/level-control";
import { createWhereControl } from "./ui/where-control";
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
  setLargeReservoirAvailability,
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
import { updatePageLinks } from "./ui/page-header";
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

/**
 * The two cases the opening-scope rosters degrade to on this page: nothing
 * fetched yet (the placeholder `openingScope` below is built from it before
 * the real fetch has even started), and the fetch having failed (the
 * `.catch()` further down). Both mean the same thing to `resolveOpeningScope`
 * -- no rosters to narrow or name anything with -- and a shared constant is
 * what keeps them from drifting into two different empty shapes if
 * `OpeningRosters` ever grows a field. Local to this file rather than
 * exported from `data/opening-scope.ts`: that module is shared with the
 * other three surfaces, and this slice owns only `main.ts`.
 */

/** Everything published, before the scope control narrows it. */
let published: readonly Reservoir[] = [];
/** Everything the map is currently drawing. */
let inScope: readonly Reservoir[] = [];
/* The subregion names the payload publishes, for the one place this page can
 * be asked about a four-digit area: a shared link. `watersheds.subregions` is
 * in `reservoirs.json` rather than `reference.json` because one copy of a
 * roster is the point of having one (ADR-060, ADR-064). */
let subregionLabels: ReadonlyMap<string, string> = new Map();
/* The area a shared link opened on, when it is coarser than the basins this
 * control offers -- `?area=14` is a region and `?area=1401` a subregion, and
 * both filter correctly because `matchesFilter` prefix-matches. The control
 * lists basins, so without this the map would narrow while the select beside
 * it read "All drainage areas", and the reader would have no way back to what
 * the link opened on. Held for the session rather than only while it is
 * chosen, so looking at one basin is not a one-way door. */
let openingArea: string | null = null;
/* ADR-011's two dimensions, both the reader's to choose. Geography was
 * pinned to `utah`, which is why Fontenelle and Woodruff Narrows -- paid for
 * by the refresh every morning, connected to Utah by drainage but never
 * touching it -- were published and drawn nowhere. */
let scope: ScopeChoice = { ...DEFAULT_SCOPE };
/** Which exceptional controls make sense in the current geographic scope. */
let largeReservoirAvailability = { lakePowell: true, lakeMead: true };

/* `?state=` and `?area=`, resolved once at load (S3a,
 * docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md). Module-level, like `scope`
 * above, because both `applyScope` (a nested closure) and `wireFilters`'s
 * `apply` (a top-level function with no access to that closure) read it --
 * a parameter, not a second copy, would leave the two free to disagree.
 * The placeholder default resolves against no rosters and no selection, the
 * same empty state `resolveOpeningScope` degrades to when the rosters fetch
 * fails; the real value replaces it before the first draw. */
let openingScope: OpeningScope = resolveOpeningScope(
  DEFAULT_OPENING_SELECTION, EMPTY_OPENING_ROSTERS);
/* The reservoir a `?state=` narrowing was widened back for, because the
 * link also named it (see the widening logic below). Null when no widening
 * happened -- most loads. */
let widenedForReservoir: Reservoir | null = null;

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
    subregionLabels = subregionNames(data);
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

/** When the readings behind the current total were taken. */
function summaryCoverage(coverage: RollupCoverage): string {
  const { earliestDate, latestDate } = coverage;
  if (!earliestDate || !latestDate || earliestDate === latestDate) return "";
  const onTime = coverage.percentCapacityCurrent;
  const share = onTime === null ? ""
    : `, ${formatPercent(onTime)} of it read on time`;
  return `. Readings from ${formatDate(earliestDate)} to ${formatDate(latestDate)}${share}`;
}

/** How much of the scope actually reported the month on the slider. */
function monthlyCoverage(rollup: MonthlyRollup): string {
  const share = rollup.percentCapacityReporting;
  if (share === null) return "";
  return `. ${rollup.reporting} of ${rollup.scopeCount} reported this month, `
    + `${formatPercent(share)} of the combined full level`;
}

/** The headline, recomputed for whatever the scope control now includes. */
function updateSummary(): void {
  const month = selectedMonth();
  /* The headline follows the slider. A summary still reporting today while
   * the map draws last November is the page saying two things at once, and
   * the map is the louder one. */
  const current = month === null ? statewideRollup(inScope, {
    /* `inScope` has already answered every scope question -- geography,
     * Lake Powell and Lake Mead -- so this must not ask any of them a
     * second time. WIDEST_SCOPE is how a caller says that, and how the
     * storage charts have said it since ADR-062.
     *
     * Two of the three were asked twice here, and both answers were wrong.
     * `geography` was pinned to `utah`, so the headline counted the
     * reservoirs whose water touches Utah under a card reading "Every
     * reservoir": 59 of them, above a map drawing 196. `lakeMead` was
     * absent, and absent means excluded, so the reader's own switch could
     * not put Mead into a total the map had already drawn it into.
     *
     * The reader's baseline period and its minimum still travel, so the
     * total and the details panel below it cannot disagree about which
     * years "normal" means (ADR-041). */
    ...WIDEST_SCOPE,
    baseline: activeBaselineId,
    minimumBaselineYears: baselineMinimumYears
  }) : null;
  const monthly = month === null ? null : monthlyRollup(inScope, month);
  /* One shape from two, so the card below reads one set of fields whichever
   * the slider is on. `count` is the reservoirs the figure was made from,
   * which in month mode is the ones that reported that month. */
  const rollup = current
    ? { ...current, count: current.count }
    : {
      percentFull: monthly?.percentFull ?? null,
      storageAf: monthly?.storageAf ?? 0,
      count: monthly?.reporting ?? 0
    };
  setSummary({
    percent: formatPercent(rollup.percentFull),
    storage: `${formatAcreFeet(rollup.storageAf)} acre-feet stored`,
    count: String(rollup.count),
    updated: month === null
      ? `Published ${formatDate(publishedAt)}`
      : `Average through ${monthLabel(month)}`,
    // Written from the controls rather than fixed in the markup: it read
    // "excluding Lake Powell" whatever the reader had chosen. Every dominant
    // reservoir available in this place is named whatever its switch state,
    // because a total that silently holds 28 million acre-feet is what
    // ADR-011 and ADR-062 exist to prevent. A lake outside the selected place
    // is omitted; asking a California reader about Lake Mead is not context.
    scope: [
      scope.geography === "connected" ? "Every reservoir" : "Utah waterbodies only",
      ...(largeReservoirAvailability.lakePowell
        ? [`${scope.lakePowell === "include" ? "including" : "excluding"} Lake Powell`]
        : []),
      ...(largeReservoirAvailability.lakeMead
        ? [`${scope.lakeMead === "include" ? "including" : "excluding"} Lake Mead`]
        : [])
    ].join(", ") +
      /* What the total was added up from, in time. A combined percentage
       * looks like one moment's measurement and is not: the newest readings
       * span weeks, because some providers publish daily and some monthly.
       * In month mode the risk is the other one -- the population changes
       * from month to month, so a rise in the figure can be a rise in who
       * reported rather than in the water. */
      (current ? summaryCoverage(current.coverage)
        : monthly ? monthlyCoverage(monthly) : "")
  });
}

/* The boundaries are context and are loaded on their own path: a missing or
 * malformed file leaves the reservoirs exactly where they are. */
async function loadContext(map: MapController): Promise<void> {
  try {
    map.drawDrainageAreas(await loadDrainageScope(level));
  } catch (error) {
    console.warn("Drainage-area boundaries are unavailable:", error);
  }
}

/**
 * The control that picks how finely the ground is divided, built from what
 * the reference export offers (ADR-064).
 *
 * Appended after the panel exists rather than written into the template: the
 * levels are the export's answer to give, and a control listing one this site
 * has stopped publishing a roster for would empty the map.
 */
async function wireLevelControl(): Promise<number> {
  const offered = await loadOfferedLevels();
  for (const host of document.querySelectorAll<HTMLElement>(".filters")) {
    const control = createLevelControl(offered, level, (chosen) => {
      /* A full navigation rather than a re-render: the level changes which
       * areas the map draws and how every area figure is grouped, and it is
       * the path a shared link already takes. Replaced, not pushed, like
       * every other control on this page. */
      const params = new URLSearchParams(window.location.search);
      writeLevel(params, chosen);
      const query = params.toString();
      window.location.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
    });
    /* Above the reservoir list, like every other control: the list scrolls
     * inside its own box and anything after it is behind a nested scroller. */
    if (control) host.append(control.element);
  }
  return offered.length || 1;
}

/**
 * The control that picks where a reader is looking (S4): a state and a
 * region/subregion/drainage-area drill-down, built beside the level control
 * from the same rosters this page already fetched for `openingScope`.
 *
 * `current` is `openingScope.selection` at the point this is called, after
 * every widening this page does (the linked-reservoir override above) --
 * the control reflects the scope actually in force, not the raw address
 * bar. A full navigation, like the level control: `?state=` and `?area=`
 * are read once at initialization by this page and by the other three
 * surfaces (S3a-d), each with its own rule for what the area axis means
 * (D5), so a picked value takes the path a shared link already takes rather
 * than a re-render this page has no function for.
 */
function wireWhereControl(rosters: OpeningRosters, current: OpeningSelection): void {
  for (const host of document.querySelectorAll<HTMLElement>(".filters")) {
    const control = createWhereControl(rosters, current, (selection) => {
      /* `searchWithPlace` remembers the choice and writes "everywhere" out
       * loud rather than as an absent parameter -- see its own note for why
       * a cleared filter must not become a link that means "no answer". */
      const query = searchWithPlace(window.location.search, selection);
      window.location.replace(`${window.location.pathname}${query}`);
    });
    if (control) host.append(control.element);
  }
}

/**
 * The analysis controls, and the one rule they drive.
 *
 * The map greys what is excluded and the list dims it, both from the same
 * `FilterState`: the panel's sentence, the dimmed rows and the greyed
 * circles are three renderings of one answer, not three answers.
 */
/** How finely the ground is divided on this page, from the address bar
 * (ADR-064). Read once: changing it is a navigation. */
const level = levelFromSearch(window.location.search);

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
    lakeMead: scope.lakeMead ?? "exclude",
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
        writeUrl({ ...viewState(), reservoir: selection.get() });
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


/** Whether any drainage area the map currently has sits inside this code.
 * The one question both the control's choices and the surviving filter are
 * answered from, so a code cannot be offered and refused at once. */
function scopeHoldsArea(code: string): boolean {
  return watershedOptions(inScope).some((area) => coversDrainageArea(code, area.code));
}

/**
 * A region or a subregion, named so it cannot be read as a basin.
 *
 * Nineteen of the drawn basins carry their subregion's name exactly -- basin
 * 140100 and subregion 1401 are both "Colorado Headwaters" -- so the level
 * has to be in the words, or the control offers two identical rows meaning
 * different things. That is the county rule (ADR-058) in another geography:
 * key on the code, disambiguate the label.
 *
 * Region names are published nowhere, so a region is named by its code.
 */
function coarseAreaLabel(code: string): string {
  if (code.length <= 2) return `Region ${code}`;
  const name = subregionLabels.get(code);
  return name ? `${name} subregion` : `Subregion ${code}`;
}

/** The drainage areas the map currently has, as the control's choices. The
 * areas follow the scope: `connected` brings two more reservoirs, and one of
 * them may be the only reservoir in its area.
 *
 * A coarser area a shared link opened on is offered above them, when the
 * scope still holds basins inside it -- see `openingArea`. */
function drainageAreaChoices(): { value: string; label: string }[] {
  const areas = watershedOptions(inScope);
  const opening = openingArea;
  const coarser = opening !== null
    && !areas.some((area) => area.code === opening)
    && scopeHoldsArea(opening)
    ? [{ value: opening, label: coarseAreaLabel(opening) }]
    : [];
  return [{ value: "all", label: drainageAreaLabel(null) },
    ...coarser,
    ...areas.map((area) => ({ value: area.code, label: area.label }))];
}

/** The name of the chosen area, for the sentence under the controls. Read
 * from the list the control itself shows, so the sentence and the select
 * cannot name the same code differently. Null when nothing is chosen, and
 * also when the choice has left the scope. */
function drainageAreaName(): string | null {
  const chosen = filterState.drainageArea;
  if (chosen === null) return null;
  return drainageAreaChoices().find((area) => area.value === chosen)?.label ?? null;
}

/**
 * The place a reader's `?state=` opened this map on, in Simplified Technical
 * English (ADR-006) -- the summary sentence S3a owes
 * (docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md), prefixed onto the
 * existing filter-panel sentence below rather than given a second live
 * region: `[data-filter="summary"]` already reports what changed the view,
 * and a state choice is one more reason it did.
 *
 * `?area=` names no place here on purpose. The area already has its own
 * sentence, from this page's pre-existing drainage-area filter
 * (`describeFilter`, right below) -- naming it a second time in front of
 * that would be the same claim twice, in two different words.
 */
function openingPlaceSummary(): string {
  if (widenedForReservoir !== null) {
    /* Qualified against `inScope`, not `published`, the same set the list,
     * the selection store and the table already qualify a name against
     * (ADR-066). `published` is the wider, unnarrowed roster: a reservoir
     * whose name is shared by another only somewhere outside `inScope`
     * would read here as "Lost Creek, OR" while the list beside it plainly
     * says "Lost Creek" -- one reservoir, two names, on one page. Safe to
     * read here because widening has already run by the time this is
     * called: `inScope` is rebuilt by `applyScope` before `wireFilters`'s
     * `apply` (this function's only caller) is ever invoked with the
     * widened scope in effect. */
    return `Showing every state so the linked reservoir, ` +
      `${reservoirLabel(widenedForReservoir, inScope)}, is included. `;
  }
  const state = openingScope.selection.state;
  /* "Showing X for PLACE", which is the shape the snow and drought pages
   * already use. Two of the four surfaces had it and two described the
   * operation instead -- "Narrowed to..." here and "Storage narrowed to..."
   * on the charts -- and a reader carrying a choice across the navigation
   * met a different sentence on each page for the same fact. The majority
   * shape wins rather than the newer one. */
  return state === "all" ? "" : `Showing reservoir storage for ${stateName(state)}. `;
}

function wireFilters(map: MapController): void {
  const apply = (): void => {
    // Reads the current scope rather than the one that existed when the
    // controls were built: changing the scope has to re-answer the filter.
    const shown = inScope.filter((reservoir) => matchesFilter(reservoir, filterState));
    map.setFilter(filterWhere(filterState));
    markFilteredInList((label) =>
      !shown.some((reservoir) => reservoirLabel(reservoir, inScope) === label));
    setFilterState(
      { storage: String(filterState.storageClass ?? "all"),
        reporting: filterState.reporting,
        drainage: filterState.drainageArea ?? "all" },
      openingPlaceSummary() +
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
      writeUrl({ ...viewState(), reservoir: selection.get() });
    },
    () => {
      filterState = ALL_RESERVOIRS;
      apply();
      writeUrl({ ...viewState(), reservoir: selection.get() });
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
      writeUrl({ ...viewState(), reservoir: selection.get() });
    }
  );
}

/** The list is rebuilt whenever the scope changes; its buttons are new. */
function renderReservoirList(): void {
  setReservoirList(
    inScope.map((reservoir) => ({
      /* The label, not the bare name: it is what the reader reads *and* what
       * the selection carries, so two reservoirs sharing a name are two rows
       * a reader can tell apart and select separately (ADR-066). Qualified
       * only where it has to be. */
      name: reservoirLabel(reservoir, inScope),
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
      reservoirHistoryCsv(reservoir, reservoirLabel(reservoir, inScope)),
      reservoirCsvFilename(reservoirLabel(reservoir, inScope), publishedAt)
    ) : undefined
  );
}

/**
 * Every in-place address-bar write goes through here, so the navigation
 * bar's links are brought up to date in the same breath. `writeUrlState`
 * uses `replaceState` deliberately -- no navigation, no re-render -- which
 * is exactly the path `updatePageLinks` exists for: without it the bar
 * carries whatever the URL held at first paint, and a reader who narrows
 * the map and then clicks "Snowpack" loses the area they just chose.
 */
function writeUrl(state: Partial<DashboardUrlState>): void {
  writeUrlState(state);
  updatePageLinks(window.location.search);
}

/** Registered once. It reads the live scope, so it survives a redraw. */
function wireSelection(): void {
  selection.subscribe((name) => {
    const reservoir = findReservoir(inScope, name);
    /* The list and table rows are keyed by the qualified label (ADR-066), so
     * the highlight must be asked for by the same spelling -- the bare name
     * matches nothing the moment two reservoirs share it. */
    const label = reservoir ? reservoirLabel(reservoir, inScope) : null;
    markSelectedInList(label);
    markSelectedInTable(label);
    renderDetail();
    if (reservoir) revealDetail();
    // The readiness signal is written once, after the first draw; the
    // selection keeps changing after that, so the field is kept current
    // rather than left reporting the state the page loaded in.
    if (window.__dashboardReady) window.__dashboardReady.selected = label;
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

  /* The opening-scope rosters are fetched alongside the reservoir payload
   * and the map itself, not after either -- the owner's requirement is that
   * the filters are "super good on the initialization", which means the
   * narrowing below has to be ready before the first draw, never corrected
   * once a fetch resolves after it (CLAUDE.md's "a gutter cannot be late",
   * applied here to a filter and an opening extent). A rosters fetch that
   * fails costs the reader the state narrowing's box and name, not the page:
   * `resolveOpeningScope` against an empty roster still applies `state`
   * (`state` is never checked against the rosters, only `area`'s aliveness
   * is) and falls back to the wide default box. */
  const [reservoirs, map, openingRosters] = await Promise.all([
    loadData(),
    loadMap(selection),
    loadOpeningRosters().catch((error: unknown): OpeningRosters => {
      console.warn("The opening-scope rosters could not load; the map opens " +
        "with no state narrowing.", error);
      return EMPTY_OPENING_ROSTERS;
    })
  ]);

  /*
   * S3a (docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md): `?state=` and
   * `?area=` together, resolved once before anything below reads either.
   *
   * `?area=` is deliberately left alone here. This page already has its own
   * drainage-area filter (`filterState.drainageArea`, read from the same
   * `drainage=`/`area=` alias in `state/url.ts`, and already prefix-matched
   * through `matchesFilter`/`filterWhere` below) -- the snow slice's own
   * finding is that applying the opening scope on top of a filter a page
   * already handles exactly collapses that filter's own "N of M" total and
   * removes the reader's way to clear it. So only `state` is new on this
   * page: `applyScope` above narrows `inScope` by it (ADR-060,
   * `reservoirInState`), and `openingScope.selection.area` is read only for
   * the box below -- never for a second reservoir filter.
   *
   * Decision D5 is the other half of why this page differs from the other
   * three: the drainage areas are context here, not the subject, so nothing
   * below narrows which of the 75 `loadContext` draws. `?area=` still
   * narrows the opening view (through `openingScope.box`) and the reader's
   * own drainage-area filter, same as always -- just never the drawn
   * boundaries.
   */
  /* The address bar wins where it answered, the reader's remembered place
   * otherwise, and everywhere when neither did (`resolveOpeningPlace`). The
   * stored choice is never written back into the address bar: what a reader
   * copies should be what they are looking at, not what they prefer. */
  const openingPlace = resolveOpeningPlace(window.location.search, readStoredPlace());
  const openingSelection = openingPlace.selection;
  const scopeChosen = isOpeningScopeChosen(openingSelection);
  // Module-level (declared beside `scope`, above): `applyScope` and
  // `wireFilters`'s `apply` both read it, and a local shadow here would
  // leave that second reader looking at the placeholder default forever.
  openingScope = resolveOpeningScope(openingSelection, openingRosters);

  /*
   * A linked reservoir outranks a state choice -- the same rule the snow
   * slice applies to a linked measurement site. `?reservoir=` names one
   * specific waterbody, a stronger and narrower signal than `?state=`, and a
   * state link paired with a reservoir outside it must not silently drop the
   * reservoir the link was actually for.
   *
   * Checked once, against a trial geography-scoped set, before `applyScope`
   * (and before the extent override just below) ever runs -- not discovered
   * after a narrow paint and corrected with a second one. `findReservoir` is
   * what does the matching, and it never resolves a bare name two
   * reservoirs share (ADR-066: the roster now holds two Lost Creeks and two
   * Clear Lakes) -- only a station id or a qualified label, or a bare name
   * that happens to be unique. Widening falls all the way back to "all"
   * rather than trying to keep half the reader's choice: a summary that said
   * "narrowed to Idaho" while the map plainly held an Oregon reservoir too
   * would be worse than naming the whole region and saying why.
   */
  const wanted = stateFromSearch(window.location.search);
  /* Set here, once, rather than rebuilt as a second literal for this check
   * and a third time below for the scope the map actually draws with: the
   * widening decision has to be made against the same geography scope the
   * reader ends up looking at, or a field `ScopeChoice` gains later could go
   * into one copy and not the other, and the two would disagree about
   * whether a linked reservoir survives. `wireFilters`, `applyScope` and
   * everything else below already read the module-level `scope`, so setting
   * it here rather than after this check is what lets this check use it
   * too, instead of a fourth hand-built copy. */
  scope = { geography: wanted.geography, lakePowell: wanted.lakePowell, lakeMead: wanted.lakeMead };
  if (reservoirs && openingScope.selection.state !== "all" && wanted.reservoir !== null) {
    const geographyScoped = overviewScope(reservoirs, scope);
    const linked = findReservoir(geographyScoped, wanted.reservoir);
    if (linked && !reservoirInState(linked, openingScope.selection.state)) {
      widenedForReservoir = linked;
      openingScope = resolveOpeningScope(
        { state: "all", area: openingSelection.area }, openingRosters);
    }
  }

  /*
   * The opening view follows the chosen scope (S3a, item 2), overriding the
   * fixed `regionExtent()` `loadMap` already set the map to a moment ago --
   * only when a reader actually asked for a place. `scopeChosen` is read
   * from the raw selection rather than the possibly-widened `openingScope`
   * above, the same gate the drought slice uses: an unchosen page keeps its
   * existing framing exactly, rather than every ordinary visit suddenly
   * opening on a box a widening decision just changed.
   *
   * `MapController.setOpeningExtent` (`ui/map.ts`) is what does the actual
   * assignment, so this file never reaches past the controller for the
   * element it wraps. No `await` separates `loadMap` resolving from this
   * call (`Promise.all` above is the only one), so both run in the same
   * synchronous turn: nothing -- no paint, no part of the component's own
   * async view construction -- can observe the element's default extent in
   * between.
   */
  if (scopeChosen) map.setOpeningExtent(openingScope.box);

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
      /* `openingScope.selection.state` narrows here, the water-touches rule
       * ADR-060 already names (`reservoirInState`). `?area=` deliberately
       * does not narrow `inScope` a second time -- see the comment where
       * `openingScope` is resolved, below: this page's own `drainageArea`
       * filter already reads the same parameter and already prefix-matches
       * it, through `matchesFilter`/`filterWhere` further down. Narrowing
       * `inScope` by area as well would double-filter the one axis this
       * page already had, and would collapse "N of M" to the narrowed
       * count with no way for a reader to see the wider total again. */
      const possibleInPlace = overviewScope(published, {
        ...scope, lakePowell: "include", lakeMead: "include"
      }).filter((reservoir) =>
        reservoirInState(reservoir, openingScope.selection.state));
      largeReservoirAvailability = {
        lakePowell: possibleInPlace.some(isLakePowell),
        lakeMead: possibleInPlace.some(isLakeMead)
      };
      setLargeReservoirAvailability(largeReservoirAvailability);
      inScope = overviewScope(published, scope)
        .filter((reservoir) => reservoirInState(reservoir, openingScope.selection.state));
      updateSummary();
      renderReservoirList();
      map.drawReservoirs(inScope, percentShown);
      if (selection.get() && !findReservoir(inScope, selection.get())) {
        selection.set(null, { source: "scope" });
      }
      /* The areas the map has changed with the scope. A chosen area that no
       * longer holds one of them would leave every reservoir dimmed with a
       * control offering no way back, so it falls back to all of them --
       * the same rule the selection above follows.
       *
       * Held by prefix and not by equality, because the reader's choice is
       * not always one of the codes on the list. A link may carry a region or
       * a subregion (`?area=14`, `?area=1401`), which `matchesFilter` and the
       * `where` clause both handle; compared for equality against six-digit
       * basins, every such link was reset to "all drainage areas" here,
       * before it ever reached the filter it was written for. A code finer
       * than a basin still falls away, which is right: nothing published sits
       * inside it. */
      setDrainageAreaOptions(drainageAreaChoices());
      const chosenArea = filterState.drainageArea;
      if (chosenArea !== null && !scopeHoldsArea(chosenArea)) {
        filterState = { ...filterState, drainageArea: null };
      }
      applyFilter();
      if (window.__dashboardReady) {
        window.__dashboardReady.reservoirs = inScope.length;
        window.__dashboardReady.drawn = map.status.reservoirsDrawn;
        window.__dashboardReady.symbols = map.status.reservoirSymbols;
        window.__dashboardReady.late = inScope.filter(isLate).length;
        window.__dashboardReady.lakePowell = scope.lakePowell;
        window.__dashboardReady.lakeMead = scope.lakeMead ?? "exclude";
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
      writeUrl({ ...viewState(), reservoir: selection.get() });
    };

    wireSelection();
    wireTableRow((open) => {
      tableOpen = open;
      if (window.__dashboardReady) window.__dashboardReady.tableOpen = open;
      writeUrl({ ...viewState(), reservoir: selection.get() });
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
        lakePowell: chosen.lakePowell ? "include" : "exclude",
        lakeMead: chosen.lakeMead ? "include" : "exclude"
      };
      applyScope();
      applyMonth();
      writeUrl({ ...viewState(), reservoir: selection.get() });
    });

    /* Restore the whole view a link describes, not just its selection: a
     * filtered, Lake-Powell-included link that opened on an unfiltered
     * dashboard would show numbers that do not match the words around it.
     * `wanted` and `scope` were both already read and set above -- before
     * the opening scope and the deep-link widening it feeds -- rather than
     * a second time here. */
    filterState = {
      storageClass: wanted.storageClass,
      reporting: wanted.reporting,
      drainageArea: wanted.drainageArea
    };
    /* Read before the first `applyScope`, which is what fills the control. */
    openingArea = wanted.drainageArea;
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
      lakePowell: scope.lakePowell === "include",
      lakeMead: scope.lakeMead === "include"
    });
    applyScope();
    applyMonth();

    /* The address bar is connected before the link is read, so restoring a
     * selection writes the same URL back rather than a differently-spelled
     * one -- "?reservoir=deer creek" typed by hand becomes the canonical
     * "?reservoir=Deer%20Creek" the moment it resolves. */
    connectSelectionToUrl(selection, viewState);
    deepLink = findReservoir(inScope, wanted.reservoir);
    /* Stored as the qualified label, not the bare name: a link that resolved
     * "Lost Creek, OR" and was re-stored as "Lost Creek" would be ambiguous
     * again on the very next read (ADR-066). */
    if (deepLink) selection.set(reservoirLabel(deepLink, inScope), { source: "url" });
  }
  wireBaseline();
  applyBaseline();
  await loadContext(map);
  const levelsOffered = await wireLevelControl();
  wireWhereControl(openingRosters, openingScope.selection);
  /* The splash asks only when nothing else answered -- never over a shared
   * link, never over a remembered place, never twice. Built from the rosters
   * already fetched, so it costs no request and cannot arrive late. */
  if (shouldAskWhere(openingPlace.source, wasDismissed(), window.location.search)) {
    const splash = createOpeningSplash({
      states: offeredStates({
        reservoirStates: published.map((reservoir) => reservoir.waterbody_states ?? reservoir.state),
        drainageAreaStates: openingRosters.areas.map((area) => area.states)
      }).map((option) => option.code),
      regions: openingRosters.regions
    });
    if (splash) {
      document.body.append(splash.element);
      splash.open();
    }
  }

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
    /* Its own field beside Powell's, because it is its own question: a
     * total with Mead and one without are both true and are not the same
     * measurement (ADR-062). */
    lakeMead: scope.lakeMead ?? "exclude",
    geography: scope.geography,
    months: months.length,
    month: selectedMonth(),
    basemap: map.status.basemap,
    basemapDegraded: map.status.basemapDegraded,
    basemapReferenceSunk: map.status.basemapReferenceSunk,
    /* Not read from `map.status`: ADR-067 retired the mask itself, so there
     * is no live layer left for the map controller to report on. The field
     * stays rather than being deleted (see its declaration in global.d.ts)
     * and is now permanently the retired value. */
    masked: false,
    boundaryPoints: 0,
    drainageAreas: map.status.drainageAreas,
    drainageLabels: map.status.drainageLabels,
    drainageLabelsUnderReservoirs: map.status.drainageLabelsUnderReservoirs,
    drainageLabelsDeconflicted: map.status.drainageLabelsDeconflicted,
    drainageLevel: map.status.drainageLevel,
    /* What the reader chose, and how many choices there were. Two facts, two
     * fields -- `drainageLevel` is what the map drew, which is the same
     * number by a different route and stays its own field (ADR-064). */
    level,
    levelsOffered,
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
    selected: selection.get(),
    /* S3a. Always the *requested* state, whether or not it could be
     * honoured -- distinct from `openingScope.selection.state` above, which
     * may have been widened back to "all" for a linked reservoir, and
     * distinct from `openingScopeResolved` below, which is "could this be
     * acted on at all" rather than "what was asked for". Not `?area=`: this
     * page's own `areaFilter`, right above, already answers that question,
     * and a second field reading a value close to but not quite the same as
     * the first is worse than no second field. */
    stateFilter: openingSelection.state,
    /* Whether the opening-scope roster actually loaded roster data, as
     * opposed to the empty fallback a failed fetch leaves `state` narrowing
     * to run against with no boxes or place names behind it. */
    openingScopeResolved: openingRosters.areas.length > 0
  };
}
