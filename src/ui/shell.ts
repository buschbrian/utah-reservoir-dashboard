import type { DetailView } from "../state/detail";
import { describeDataState, type DataState } from "../state/shell";
import { elementById } from "./dom";

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
        <a href="./explore.html">reservoir overview</a>.</p>
    </main>`;
}

function setOpen(element: ToggleSurface, open: boolean): void {
  if ("open" in element) element.open = open;
  else element.collapsed = !open;
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
  elementById("controls-toggle").toggleAttribute("text-enabled", !mobileQuery.matches);
  elementById("detail-toggle").toggleAttribute("text-enabled", !mobileQuery.matches);
  if (mobileQuery.matches) {
    setOpen(startPanel, false);
    setOpen(detailPanel, false);
    setOpen(startSheet, true);
  } else {
    setOpen(startSheet, false);
    setOpen(detailSheet, false);
    setOpen(startPanel, true);
  }
}

export function wirePanels(): void {
  const startSheet = elementById<ToggleSurface>("start-sheet");
  const detailSheet = elementById<ToggleSurface>("detail-sheet");
  startSheet.addEventListener("calciteSheetClose", () => {
    void elementById<CalciteFocusable>("controls-toggle").setFocus();
  });
  detailSheet.addEventListener("calciteSheetClose", () => {
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
    const surface = activeSurface("start");
    setOpen(surface, !isOpen(surface));
  });
  elementById("detail-toggle").addEventListener("click", () => {
    const surface = activeSurface("detail");
    setOpen(surface, !isOpen(surface));
  });
  elementById("start-sheet-close").addEventListener("click", () => setOpen(startSheet, false));
  elementById("detail-sheet-close").addEventListener("click", () => setOpen(detailSheet, false));
  mobileQuery.addEventListener("change", syncResponsiveShell);
  syncResponsiveShell();
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
export function setFilterControls(
  storage: readonly FilterOption[],
  reporting: readonly FilterOption[],
  onChange: (kind: "storage" | "reporting", value: string) => void,
  onReset: () => void
): void {
  const fill = (kind: "storage" | "reporting", options: readonly FilterOption[]): void => {
    document.querySelectorAll<CalciteSelect>(`[data-filter="${kind}"]`).forEach((select) => {
      select.replaceChildren(...options.map((option) => {
        const element = document.createElement("calcite-option");
        element.setAttribute("value", option.value);
        element.textContent = option.label;
        return element;
      }));
      select.addEventListener("calciteSelectChange", () => onChange(kind, select.value));
    });
  };
  fill("storage", storage);
  fill("reporting", reporting);
  document.querySelectorAll<HTMLElement>('[data-filter="reset"]').forEach((button) => {
    button.addEventListener("click", onReset);
  });
}

/**
 * The scope control, which is not one of the filters.
 *
 * The filters grey reservoirs the map still draws; this changes which
 * reservoirs the map has at all, so it redraws rather than dims (ADR-011).
 * Both surfaces carry a copy and both are kept at one value.
 */
export function setScopeControl(onChange: (value: string) => void): void {
  document.querySelectorAll<CalciteSelect>('[data-filter="scope"]').forEach((select) => {
    select.addEventListener("calciteSelectChange", () => onChange(select.value));
  });
}

export function setScopeValue(value: string): void {
  document.querySelectorAll<CalciteSelect>('[data-filter="scope"]')
    .forEach((select) => { select.value = value; });
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
    slider.addEventListener("calciteSliderChange", () => onChange(slider.value));
    // Dragging fires input continuously; the map redraw is cheap enough to
    // follow it, and a slider that only acts on release does not read as a
    // slider at all.
    slider.addEventListener("calciteSliderInput", () => onChange(slider.value));
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
  values: { storage: string; reporting: string },
  summary: string,
  filtered: boolean
): void {
  document.querySelectorAll<CalciteSelect>('[data-filter="storage"]')
    .forEach((select) => { select.value = values.storage; });
  document.querySelectorAll<CalciteSelect>('[data-filter="reporting"]')
    .forEach((select) => { select.value = values.reporting; });
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

export function setDetail(view: DetailView | null): void {
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
    const value = document.createElement("strong");
    value.textContent = view.percent;
    value.style.color = view.color;
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
      rows.append(term, definition);
    }

    const children: HTMLElement[] = [heading, headline, rows];
    if (view.late) {
      const late = document.createElement("p");
      late.className = "detail-late";
      late.textContent = view.late;
      children.splice(2, 0, late);
    }
    host.replaceChildren(...children);
  });
}

/** Brings the details into view where the reader is: panel or sheet. */
export function revealDetail(): void {
  setOpen(activeSurface("detail"), true);
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
