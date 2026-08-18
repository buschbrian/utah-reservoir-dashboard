import type { DetailView } from "../state/detail";
import { copyViewUrl } from "../state/share";
import { describeDataState, type DataState } from "../state/shell";
import { renderTrendChart, renderTrendTable } from "../viz/trend";
import { elementById } from "./dom";
import { formatSplit, parseSplit, splitHeight } from "../state/split";
import { nameSliderHandle } from "./slider-label";

const mobileQuery = window.matchMedia("(max-width: 47.99rem)");

type ToggleSurface = HTMLElement & { collapsed?: boolean; open?: boolean };
type CalciteFocusable = HTMLElement & { setFocus(options?: FocusOptions): Promise<void> };

export function browserCapabilities() {
  const canvas = document.createElement("canvas");
  return {
    customElements: "customElements" in window,
    resizeObserver: "ResizeObserver" in window,
    // ArcGIS Maps SDK 5.1 supports WebGL2 only. Accepting a WebGL1 context
    // lets the shell start a renderer that cannot succeed, which Safari can
    // leave looking like a map that is still loading.
    webgl2: Boolean(canvas.getContext("webgl2"))
  };
}

export function renderUnsupported(root: HTMLElement): void {
  root.innerHTML = `
    <main class="unsupported" role="alert">
      <p class="eyebrow">Browser support</p>
      <h1>This browser cannot display the reservoir map.</h1>
      <p>Use a current browser with WebGL 2 enabled, or open the accessible
        <a href="./overview.html">storage charts and table</a>.</p>
    </main>`;
}

function setOpen(element: ToggleSurface, open: boolean): void {
  if ("open" in element) element.open = open;
  else element.collapsed = !open;
}

/**
 * The header action that opens a surface, reporting whether it is open.
 *
 * All three panel toggles do this now. Two of them did not: the table's
 * toggle reported its state and the other two did not, and the storage
 * summary's `active` was written into the template as a literal -- so it was
 * lit from first paint and stayed lit whether the panel was open or shut.
 * Reporting a surface's state has to come from the surface, or it is a
 * decoration that happens to be right once.
 *
 * `active` is what a reader sees; `aria-pressed` is the same fact for a
 * reader who cannot see it. Both, always, or the header lies to one of them.
 */
function reportToggle(id: string, open: boolean): void {
  const toggle = document.getElementById(id);
  if (!toggle) return;
  toggle.toggleAttribute("active", open);
  toggle.setAttribute("aria-pressed", String(open));
}

/** The toggle that belongs to each surface, whichever width is in play. */
const SURFACE_TOGGLES: Record<"start" | "detail", string> = {
  start: "controls-toggle",
  detail: "detail-toggle"
};

/** Opens or closes a surface and puts its header action at the same state. */
function setSurfaceOpen(kind: "start" | "detail", open: boolean): void {
  setOpen(activeSurface(kind), open);
  reportToggle(SURFACE_TOGGLES[kind], open);
}

function isOpen(element: ToggleSurface): boolean {
  return "open" in element ? Boolean(element.open) : !element.collapsed;
}

function activeSurface(kind: "start" | "detail"): ToggleSurface {
  return elementById<ToggleSurface>(`${kind}-${mobileQuery.matches ? "sheet" : "panel"}`);
}

/* The navigation bar is a fixed height and lays its contents out in one row,
 * clipping whatever does not fit rather than scrolling -- so an overflowing
 * header does not widen the page, it silently amputates the controls on the
 * end of it. Everything optional in the bar is hidden below 48rem in CSS;
 * see `#header-facts` in app.css. */
function syncResponsiveShell(): void {
  const startPanel = elementById<ToggleSurface>("start-panel");
  const detailPanel = elementById<ToggleSurface>("detail-panel");
  const startSheet = elementById<ToggleSurface>("start-sheet");
  const detailSheet = elementById<ToggleSurface>("detail-sheet");
  /* The two panel toggles are icon-only at every width now. With their text
   * they measured 152px and 145px in a bar that has to fit inside the
   * viewport, spent on words the panel each one opens repeats as its own
   * heading. Their label attributes carry the same words to a screen
   * reader, which is where they were doing real work. */
  if (mobileQuery.matches) {
    setOpen(startPanel, false);
    setOpen(detailPanel, false);
    setOpen(startSheet, true);
  } else {
    setOpen(startSheet, false);
    setOpen(detailSheet, false);
    setOpen(startPanel, true);
  }
  /* Crossing the width changes which surface each toggle drives, and closes
   * the pair belonging to the other width. The header has to follow, or a
   * rotation leaves two actions describing surfaces that are no longer
   * there. */
  reportToggle(SURFACE_TOGGLES.start, isOpen(activeSurface("start")));
  reportToggle(SURFACE_TOGGLES.detail, isOpen(activeSurface("detail")));
}

export function wirePanels(): void {
  const startSheet = elementById<ToggleSurface>("start-sheet");
  const detailSheet = elementById<ToggleSurface>("detail-sheet");
  startSheet.addEventListener("calciteSheetClose", () => {
    reportToggle(SURFACE_TOGGLES.start, false);
    void elementById<CalciteFocusable>("controls-toggle").setFocus();
  });
  detailSheet.addEventListener("calciteSheetClose", () => {
    reportToggle(SURFACE_TOGGLES.detail, false);
    /* On a phone, details open over the still-open storage summary. Return
     * to the selected reservoir in that sheet, not to navigation behind the
     * modal surface. Calcite restores focus on its own too, so wait until its
     * close event has finished before choosing the application-level target. */
    requestAnimationFrame(() => {
      const selected = document.querySelector<HTMLButtonElement>(
        '#start-sheet .list-btn[aria-pressed="true"]');
      if (mobileQuery.matches && selected) selected.focus({ preventScroll: true });
      else void elementById<CalciteFocusable>("detail-toggle").setFocus();
    });
  });
  elementById("controls-toggle").addEventListener("click", () => {
    setSurfaceOpen("start", !isOpen(activeSurface("start")));
  });
  elementById("detail-toggle").addEventListener("click", () => {
    setSurfaceOpen("detail", !isOpen(activeSurface("detail")));
  });
  elementById("start-sheet-close").addEventListener("click", () => {
    setOpen(startSheet, false);
    reportToggle(SURFACE_TOGGLES.start, false);
  });
  elementById("detail-sheet-close").addEventListener("click", () => {
    setOpen(detailSheet, false);
    reportToggle(SURFACE_TOGGLES.detail, false);
  });
  mobileQuery.addEventListener("change", syncResponsiveShell);
  syncResponsiveShell();
}

/**
 * The bottom row.
 *
 * A shell panel like the two beside the map, so it opens and closes through
 * the same `collapsed` property they do rather than through a second
 * mechanism that would have to be kept in step with them.
 */
export function wireTableRow(onToggle: (open: boolean) => void): void {
  const row = (): ToggleSurface => elementById<ToggleSurface>("table-row");
  const toggle = (open: boolean): void => {
    setTableRowOpen(open);
    onToggle(open);
  };
  elementById("table-toggle").addEventListener("click", () => {
    toggle(!isOpen(row()));
  });
  elementById("table-close").addEventListener("click", () => {
    toggle(false);
    void elementById<CalciteFocusable>("table-toggle").setFocus();
  });
  wireTableRowSplit(row());
}

/* Still the old repository name on purpose -- see the note on
 * THEME_STORAGE_KEY in `theme.ts`. Renaming a storage key throws away the
 * reader's saved split position and shows them nothing in return. */
const SPLIT_STORAGE_KEY = "utah-reservoir-dashboard-split";

/* Storage can throw rather than answer -- a browser with cookies blocked, or
 * a private window at quota. A page that cannot remember a divider still has
 * to draw one. */
function readStoredSplit(): number | null {
  try {
    return parseSplit(localStorage.getItem(SPLIT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStoredSplit(fraction: number): void {
  const value = formatSplit(fraction);
  try {
    if (value === null) localStorage.removeItem(SPLIT_STORAGE_KEY);
    else localStorage.setItem(SPLIT_STORAGE_KEY, value);
  } catch {
    // A reader who cannot store a preference keeps the one on screen.
  }
}


/**
 * Keeps the divider where the reader put it.
 *
 * The component owns the drag and the keyboard, and reports neither: it emits
 * collapse and expand and nothing at all for a resize. So the size has to be
 * taken rather than received.
 *
 * **Taken when a gesture ends, not while it runs.** The obvious approach is a
 * `ResizeObserver`, and it was tried twice -- on the host, which never fires
 * because the host is a flex box sized by its child, and then on the
 * component's own `.content`, which is the element that really changes. That
 * second one is correct and still unusable: `ResizeObserver` callbacks are
 * delivered with the rendering steps, so in any environment that is not
 * compositing -- a hidden pane, headless CI -- they never arrive at all,
 * while `getBoundingClientRect` happily reports the new size. Persisting from
 * a lifecycle the tests cannot run is persisting nothing.
 *
 * Reading at the end of the gesture is better on its own terms anyway. There
 * is one write per drag instead of one per frame, and the two events that end
 * a resize -- a pointer released anywhere, a key released on the separator --
 * both cross the shadow boundary because they are composed.
 *
 * Restoring goes the other way, through the height custom property on the
 * host: that is the component's documented surface, and it applies before
 * there is any rendered content to measure.
 */
function wireTableRowSplit(row: HTMLElement): void {
  const shell = document.querySelector("calcite-shell") ?? document.body;

  const stored = readStoredSplit();
  if (stored !== null) {
    row.style.setProperty("--calcite-shell-panel-height", splitHeight(stored));
  }

  let last = stored ?? -1;
  const remember = (): void => {
    if (row.hasAttribute("collapsed")) return;
    const available = shell.getBoundingClientRect().height;
    const height = row.getBoundingClientRect().height;
    if (available <= 0 || height <= 0) return;
    const fraction = height / available;
    /* A hundredth of the shell is below anything a reader aimed at, and this
     * runs on every pointer release on the page. */
    if (Math.abs(fraction - last) < 0.01) return;
    last = fraction;
    writeStoredSplit(fraction);
  };

  /* On the window for the pointer, because a drag can end anywhere including
   * outside the row, and on the row for the key, because that is where the
   * separator lives and a composed event reaches its host. */
  window.addEventListener("pointerup", remember);
  window.addEventListener("pointercancel", remember);
  row.addEventListener("keyup", remember);
}

export function setTableRowOpen(open: boolean): void {
  setOpen(elementById<ToggleSurface>("table-row"), open);
  /* The header action reports its own state. It is the only way back to a
   * closed row, so a reader using a screen reader has to be able to tell
   * which way pressing it goes. */
  const toggle = elementById("table-toggle");
  toggle.setAttribute("aria-pressed", String(open));
  toggle.toggleAttribute("active", open);
}

export function setTableCaption(caption: string): void {
  document.querySelectorAll<HTMLElement>('[data-table="caption"]')
    .forEach((element) => { element.textContent = caption; });
}

/** The ranking chart's caption. Not a live region: the table caption beside
 * it already announces every change to the same filtered set, and a second
 * announcement of the same fact is noise, not information. */
export function setRankingCaption(caption: string): void {
  document.querySelectorAll<HTMLElement>('[data-ranking="caption"]')
    .forEach((element) => { element.textContent = caption; });
}

export function wireTableExport(onExport: () => void): void {
  document.querySelectorAll<HTMLElement>('[data-table="export"]')
    .forEach((button) => { button.addEventListener("click", onExport); });
}

/** Copies the address after every control has written the current state.
 * Confirmation replaces the button's own text, so it is visible and
 * keyboard-accessible without adding another live region to the two copies
 * of the storage panel. */
export function wireCopyViewLinks(): void {
  let resetTimer = 0;
  const buttons = [...document.querySelectorAll<HTMLElement>('[data-share="copy"]')];
  const setText = (text: string): void => {
    for (const button of buttons) button.textContent = text;
  };
  for (const button of buttons) {
    button.addEventListener("click", async () => {
      const copied = await copyViewUrl(window.location.href, navigator.clipboard);
      setText(copied ? "Link copied" : "Link could not be copied");
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => setText("Copy link to this view"), 2500);
    });
  }
}

/**
 * The one place the data state is written, in words and in markup.
 *
 * The loading copy used to be hard-coded in the template as well, which
 * meant `describeDataState`'s own `loading` branch was unreachable -- two
 * statements of one fact, one of them dead and free to drift from the
 * other.
 */
export function setDataState(state: DataState): void {
  const description = describeDataState(state);
  document.querySelectorAll<HTMLElement>(".data-state").forEach((element) => {
    /* A successful load needs no announcement. The panel is for reading the
     * reservoirs, and a permanent "data ready" receipt above them is a row
     * of furniture that pushes the actual numbers down. A problem still
     * gets the space -- that is what this element is for. */
    if (state.kind === "ready") {
      element.hidden = true;
      element.replaceChildren();
      return;
    }
    element.hidden = false;
    element.setAttribute("role", description.role);
    const children: HTMLElement[] = [];
    /* A spinner only while something is actually in flight. On an error it
     * would be a promise the page cannot keep. */
    if (state.kind === "loading") {
      const loader = document.createElement("calcite-loader");
      loader.setAttribute("inline", "");
      loader.setAttribute("scale", "s");
      loader.setAttribute("label", description.heading);
      children.push(loader);
    }
    const heading = document.createElement("strong");
    heading.textContent = description.heading;
    const detail = document.createElement("span");
    detail.textContent = description.detail;
    children.push(heading, detail);
    element.replaceChildren(...children);
  });
}

export interface ReservoirListEntry {
  name: string;
  percent: string;
  color: string;
  late: boolean;
}

/**
 * The keyboard half of selection, and the map's alternative: every drawn
 * reservoir as a real button, in both the desktop panel and the phone sheet.
 * A canvas cannot be tabbed through, and `hitTest` never settles in a hidden
 * browser pane, so this is also the only selection path a test can exercise.
 */
export function setReservoirList(
  entries: readonly ReservoirListEntry[],
  onSelect: (name: string) => void
): void {
  document.querySelectorAll<HTMLElement>('[data-list="reservoirs"]').forEach((host) => {
    const buttons = entries.map((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "list-btn";
      button.dataset.reservoir = entry.name;
      button.setAttribute("aria-pressed", "false");

      const swatch = document.createElement("span");
      swatch.className = "list-swatch";
      swatch.style.background = entry.color;
      const name = document.createElement("span");
      name.className = "list-name";
      name.textContent = entry.name;
      const percent = document.createElement("span");
      percent.className = "list-percent";
      percent.textContent = entry.percent;

      button.append(swatch, name, percent);
      if (entry.late) {
        const late = document.createElement("span");
        late.className = "list-late";
        late.textContent = "Late";
        button.append(late);
      }
      button.addEventListener("click", () => onSelect(entry.name));
      return button;
    });
    host.replaceChildren(...buttons);
  });
}

type CalciteSelect = HTMLElement & { value: string };

export interface FilterOption { value: string; label: string }

/**
 * The analysis controls, built once per surface -- the desktop panel and the
 * phone sheet each hold a copy, and both are kept at the same value. A
 * reader who filters on a phone, rotates, and finds the desktop panel
 * showing something else is looking at two answers to one question.
 */
export type FilterKind = "storage" | "reporting" | "drainage";

function fillFilter(kind: FilterKind, options: readonly FilterOption[]): void {
  document.querySelectorAll<CalciteSelect>(`[data-filter="${kind}"]`).forEach((select) => {
    const chosen = select.value;
    select.replaceChildren(...options.map((option) => {
      const element = document.createElement("calcite-option");
      element.setAttribute("value", option.value);
      element.textContent = option.label;
      return element;
    }));
    // Keeps a choice that still exists. Refilling is how the drainage areas
    // follow a scope change, and a reader who has chosen one should not lose
    // it because the list around it was rebuilt.
    if (options.some((option) => option.value === chosen)) select.value = chosen;
  });
}

export function setFilterControls(
  storage: readonly FilterOption[],
  reporting: readonly FilterOption[],
  drainage: readonly FilterOption[],
  onChange: (kind: FilterKind, value: string) => void,
  onReset: () => void
): void {
  const wire = (kind: FilterKind, options: readonly FilterOption[]): void => {
    fillFilter(kind, options);
    document.querySelectorAll<CalciteSelect>(`[data-filter="${kind}"]`).forEach((select) => {
      select.addEventListener("calciteSelectChange", () => onChange(kind, select.value));
    });
  };
  wire("storage", storage);
  wire("reporting", reporting);
  wire("drainage", drainage);
  document.querySelectorAll<HTMLElement>('[data-filter="reset"]').forEach((button) => {
    button.addEventListener("click", onReset);
  });
}

/**
 * The drainage-area choices, after the scope has changed which areas the map
 * has. The listener is registered once by `setFilterControls`; this only
 * replaces the options under it, so the control keeps working.
 */
export function setDrainageAreaOptions(options: readonly FilterOption[]): void {
  fillFilter("drainage", options);
}

/**
 * The baseline control, and the sentence under it.
 *
 * Both copies of the control -- desktop panel and phone sheet -- are filled
 * and kept at one value for the same reason the filters are: two surfaces
 * showing different periods would be two answers to one question, and this is
 * the question the rest of the panel's numbers are answers to.
 *
 * The note is not decoration. The two periods measure genuinely different
 * things, and the difference is not visible in the number they produce, so
 * the words have to carry it.
 */
export function setBaselineControl(
  options: readonly FilterOption[],
  value: string,
  note: string,
  onChange?: (value: string) => void
): void {
  document.querySelectorAll<CalciteSelect>('[data-baseline="period"]').forEach((select) => {
    if (options.length) {
      select.replaceChildren(...options.map((option) => {
        const element = document.createElement("calcite-option");
        element.setAttribute("value", option.value);
        element.textContent = option.label;
        return element;
      }));
    }
    select.value = value;
    if (onChange) {
      select.addEventListener("calciteSelectChange", () => onChange(select.value));
    }
    /* One period on offer is not a choice. The control is hidden rather than
     * shown disabled, because a disabled control asks the reader to work out
     * why it is disabled. */
    const label = select.closest("calcite-label");
    if (label) (label as HTMLElement).hidden = options.length < 2;
  });
  document.querySelectorAll<HTMLElement>('[data-baseline="note"]').forEach((element) => {
    element.textContent = note;
    element.hidden = note.length === 0;
  });
}

type CalciteSwitch = HTMLElement & { checked: boolean };

export interface ScopeControls {
  geography: string;
  lakePowell: boolean;
}

/**
 * The scope controls, which are not filters.
 *
 * The filters grey reservoirs the map still draws; these change which
 * reservoirs the map has at all, so they redraw rather than dim (ADR-011).
 * Lake Powell is a switch rather than a select because it is one yes-or-no
 * question, and a two-option dropdown makes a reader open a menu to answer
 * it. Both surfaces carry a copy and both are kept at one value.
 */
export function setScopeControl(onChange: (scope: ScopeControls) => void): void {
  const read = (): ScopeControls => ({
    geography: document.querySelector<CalciteSelect>('[data-scope="geography"]')?.value ?? "utah",
    lakePowell: document.querySelector<CalciteSwitch>('[data-scope="powell"]')?.checked ?? false
  });
  document.querySelectorAll<CalciteSelect>('[data-scope="geography"]').forEach((select) => {
    select.addEventListener("calciteSelectChange", () => onChange({
      ...read(), geography: select.value
    }));
  });
  document.querySelectorAll<CalciteSwitch>('[data-scope="powell"]').forEach((toggle) => {
    toggle.addEventListener("calciteSwitchChange", () => onChange({
      ...read(), lakePowell: toggle.checked
    }));
  });
}

export function setScopeValue(scope: ScopeControls): void {
  document.querySelectorAll<CalciteSelect>('[data-scope="geography"]')
    .forEach((select) => { select.value = scope.geography; });
  document.querySelectorAll<CalciteSwitch>('[data-scope="powell"]')
    .forEach((toggle) => { toggle.checked = scope.lakePowell; });
}

type CalciteSlider = HTMLElement & { value: number; max: number };

/**
 * The month slider, on both surfaces.
 *
 * The rightmost position is the newest reading rather than a month, because
 * that is what the map opens on and what every other number on the page is
 * about. Months occupy the positions before it, oldest at the left, so the
 * handle travels forward in time the way a reader expects.
 */
export function setMonthControl(
  months: readonly string[],
  onChange: (index: number) => void,
  onNow: () => void
): void {
  document.querySelectorAll<CalciteSlider>('[data-month="slider"]').forEach((slider) => {
    slider.max = months.length;
    slider.value = months.length;
    /* The focusable control is the handle inside the component's shadow
     * root, and Calcite 5.1 leaves it unnamed whatever the host carries. */
    nameSliderHandle(slider, "Month to show on the map");
    slider.addEventListener("calciteSliderChange", () => onChange(slider.value));
    /* Dragging fires input continuously -- faster than the screen can show
     * it. One redraw per animation frame, with the last value winning, so a
     * drag is smooth without queueing work nobody will ever see. */
    let frame = 0;
    slider.addEventListener("calciteSliderInput", () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        onChange(slider.value);
      });
    });
  });
  document.querySelectorAll<HTMLElement>('[data-month="now"]').forEach((button) => {
    button.addEventListener("click", onNow);
  });
}

/** Puts every copy of the slider, its caption and its reset at one state. */
export function setMonthState(index: number, months: readonly string[], caption: string): void {
  document.querySelectorAll<CalciteSlider>('[data-month="slider"]')
    .forEach((slider) => { slider.value = index; });
  document.querySelectorAll<HTMLElement>('[data-month="label"]')
    .forEach((element) => { element.textContent = caption; });
  document.querySelectorAll<HTMLElement>('[data-month="now"]')
    .forEach((button) => { button.hidden = index >= months.length; });
}

/** Puts every copy of the controls, the summary and the reset at one state. */
export function setFilterState(
  values: { storage: string; reporting: string; drainage: string },
  summary: string,
  filtered: boolean
): void {
  document.querySelectorAll<CalciteSelect>('[data-filter="storage"]')
    .forEach((select) => { select.value = values.storage; });
  document.querySelectorAll<CalciteSelect>('[data-filter="reporting"]')
    .forEach((select) => { select.value = values.reporting; });
  document.querySelectorAll<CalciteSelect>('[data-filter="drainage"]')
    .forEach((select) => { select.value = values.drainage; });
  document.querySelectorAll<HTMLElement>('[data-filter="summary"]')
    .forEach((element) => { element.textContent = summary; });
  document.querySelectorAll<HTMLElement>('[data-filter="reset"]')
    .forEach((button) => { button.hidden = !filtered; });
}

/**
 * Dims the reservoirs the filter excludes, and leaves them operable.
 *
 * The map greys excluded reservoirs rather than removing them, so removing
 * them from the list here would make the two surfaces disagree about what
 * exists -- and would take away the keyboard path to a reservoir that is
 * still visible on the map and still clickable with a pointer.
 */
export function markFilteredInList(excluded: (name: string) => boolean): void {
  document.querySelectorAll<HTMLElement>(".list-btn").forEach((button) => {
    const name = button.dataset.reservoir ?? "";
    button.classList.toggle("list-btn-excluded", excluded(name));
  });
}

export function markSelectedInList(name: string | null): void {
  document.querySelectorAll<HTMLElement>(".list-btn").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.reservoir === name));
  });
}

export function setDetail(view: DetailView | null, onExport?: () => void): void {
  document.querySelectorAll<HTMLElement>("[data-detail]").forEach((host) => {
    const suffix = host.dataset.detail ?? "desktop";
    if (!view) {
      const placeholder = document.createElement("div");
      placeholder.className = "detail-placeholder";
      const eyebrow = document.createElement("p");
      eyebrow.className = "eyebrow";
      eyebrow.textContent = "Reservoir details";
      const heading = document.createElement("h2");
      heading.id = `detail-${suffix}`;
      heading.textContent = "No reservoir selected";
      const copy = document.createElement("p");
      copy.textContent = "Choose a reservoir on the map, or in the list in the storage summary.";
      placeholder.append(eyebrow, heading, copy);
      host.replaceChildren(placeholder);
      return;
    }

    const heading = document.createElement("h2");
    heading.id = `detail-${suffix}`;
    heading.textContent = view.name;

    const headline = document.createElement("p");
    headline.className = "detail-headline";
    headline.style.setProperty("--detail-class-color", view.color);
    const value = document.createElement("strong");
    value.textContent = view.percent;
    const basis = document.createElement("span");
    basis.textContent = view.basis;
    headline.append(value, basis);

    const rows = document.createElement("dl");
    rows.className = "detail-rows";
    for (const row of view.rows) {
      const term = document.createElement("dt");
      term.textContent = row.label;
      const definition = document.createElement("dd");
      definition.textContent = row.value;
      if (row.negative) definition.classList.add("detail-down");
      rows.append(term, definition);
    }

    const children: (HTMLElement | SVGElement)[] = [heading, headline, rows];
    if (view.late) {
      const late = document.createElement("p");
      late.className = "detail-late";
      late.textContent = view.late;
      children.splice(2, 0, late);
    }

    if (onExport) {
      const exportButton = document.createElement("calcite-button");
      exportButton.className = "detail-export";
      exportButton.dataset.exportReservoir = view.name;
      exportButton.setAttribute("appearance", "outline");
      exportButton.setAttribute("icon-start", "export");
      exportButton.setAttribute("width", "full");
      exportButton.textContent = "Download this reservoir (CSV file)";
      exportButton.addEventListener("click", onExport);
      children.push(exportButton);
    }

    /* The history the legacy popup carried and this panel did not. Both
     * pieces return null when the reservoir has no monthly values, so a
     * reservoir that has only ever reported once gets no empty chart frame
     * and no heading over nothing. */
    const chart = renderTrendChart(view.months, view.name);
    const table = renderTrendTable(view.months);
    if (chart || table) {
      const heading12 = document.createElement("h3");
      heading12.className = "detail-subhead";
      heading12.textContent = "The last 12 months";
      children.push(heading12);
      if (chart) {
        children.push(chart);
        /* Each mark and its words are one element, so a wrap puts the whole
         * pair on the next line. Flat children wrapped between the dash and
         * "Normal value", which reads as a bar chart with a stray dash. */
        const key = document.createElement("p");
        key.className = "trend-key";
        for (const [markClass, text] of [
          ["trend-key-bar", "Average storage for each month"],
          ["trend-key-line", "Normal value"]
        ] as const) {
          const entry = document.createElement("span");
          entry.className = "trend-key-entry";
          const mark = document.createElement("span");
          mark.className = markClass;
          const words = document.createElement("span");
          words.textContent = text;
          entry.append(mark, words);
          key.append(entry);
        }
        children.push(key);
      }
      if (table) children.push(table);
    }

    const note = document.createElement("p");
    note.className = "detail-note";
    note.textContent = view.note;
    children.push(note);

    host.replaceChildren(...children);
  });
}

/** Brings the details into view where the reader is: panel or sheet. */
export function revealDetail(): void {
  setSurfaceOpen("detail", true);
}

export function setSummary(
  values: Record<"percent" | "storage" | "count" | "updated" | "scope", string>
): void {
  for (const [name, value] of Object.entries(values)) {
    document.querySelectorAll<HTMLElement>(`[data-value="${name}"]`)
      .forEach((element) => { element.textContent = value; });
  }
  document.querySelectorAll<HTMLElement>(".summary")
    .forEach((element) => { element.hidden = false; });
}
