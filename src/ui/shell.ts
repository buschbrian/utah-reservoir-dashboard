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
    webgl: Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"))
  };
}

export function renderUnsupported(root: HTMLElement): void {
  root.innerHTML = `
    <main class="unsupported" role="alert">
      <p class="eyebrow">Browser support</p>
      <h1>This browser cannot display the reservoir map.</h1>
      <p>Use a current browser with WebGL enabled, or open the accessible
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
    void elementById<CalciteFocusable>("detail-toggle").setFocus();
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

export function setDataState(state: DataState): void {
  const description = describeDataState(state);
  document.querySelectorAll<HTMLElement>(".data-state").forEach((element) => {
    element.setAttribute("role", description.role);
    const heading = document.createElement("strong");
    heading.textContent = description.heading;
    const detail = document.createElement("span");
    detail.textContent = description.detail;
    element.replaceChildren(heading, detail);
  });
}

export function setSummary(values: Record<"percent" | "storage" | "count" | "updated", string>): void {
  for (const [name, value] of Object.entries(values)) {
    document.querySelectorAll<HTMLElement>(`[data-value="${name}"]`)
      .forEach((element) => { element.textContent = value; });
  }
  document.querySelectorAll<HTMLElement>(".summary")
    .forEach((element) => { element.hidden = false; });
}
