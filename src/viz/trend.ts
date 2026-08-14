/*
 * The twelve-month storage chart in the details panel.
 *
 * The legacy popup drew this as a string of concatenated SVG with `#e6e6e6`
 * gridlines and a `#31527a` normal line written into the markup. This build
 * has a dark theme, so the colours that are not data come from CSS instead
 * and the axis stays readable in both. The colours that *are* data still come
 * from the class table through `DetailMonth.color` (ADR-008).
 *
 * Real elements rather than an HTML string: the panel sets `textContent` on
 * everything else it renders, and one `innerHTML` path through a payload
 * fetched at runtime would be the only place on the page where a reservoir
 * name is parsed as markup.
 */
import type { DetailMonth } from "../state/detail";
import { formatAcreFeet, formatPercent } from "./format";

const SVG = "http://www.w3.org/2000/svg";

const WIDTH = 300;
const HEIGHT = 132;
const PAD_LEFT = 38;
const PAD_RIGHT = 6;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;

function element<K extends keyof SVGElementTagNameMap>(
  name: K, attributes: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

/** Thousands and millions, so a 38px axis gutter holds the label. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

function readingOf(month: DetailMonth): string {
  if (month.storageAf === null) return `${month.label}: no data.`;
  const share = month.percent === null ? "" : `, ${formatPercent(month.percent)} of the full level`;
  const normal = month.normalAf === null
    ? "" : `. Normal for this month: ${formatAcreFeet(month.normalAf)} acre-feet`;
  return `${month.label}: ${formatAcreFeet(month.storageAf)} acre-feet${share}${normal}.`;
}

/**
 * Returns null when there is nothing to draw, so the caller can leave the
 * section out entirely rather than render an empty frame with axes on it.
 */
export function renderTrendChart(months: readonly DetailMonth[], name: string): SVGSVGElement | null {
  const values = months
    .map((month) => month.storageAf)
    .filter((value): value is number => value !== null);
  if (!values.length) return null;

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  /* The axis starts at zero and is never truncated: ordinary seasonal
   * drawdown on a cut axis looks like a cliff, and this chart sits next to a
   * number that says the reservoir is two thirds full. */
  const top = (Math.max(...values, ...months.map((month) => month.normalAf ?? 0)) * 1.12) || 1;
  const x = (index: number): number =>
    PAD_LEFT + (index + 0.5) * (plotWidth / months.length);
  const y = (value: number): number => PAD_TOP + plotHeight - (value / top) * plotHeight;

  const svg = element("svg", {
    class: "trend-chart",
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    width: "100%",
    role: "img",
    "aria-label": `Storage for ${name} during the last ${months.length} months. ` +
      `The bars show the average storage for each month. ` +
      `The dashed line shows the normal value. The table below lists every value.`
  });

  for (const fraction of [0, 0.5, 1]) {
    const at = y(top * fraction);
    svg.append(element("line", {
      class: "trend-grid", x1: PAD_LEFT, y1: at.toFixed(1), x2: WIDTH - PAD_RIGHT, y2: at.toFixed(1)
    }));
    const label = element("text", {
      class: "trend-axis", x: PAD_LEFT - 5, y: (at + 3.5).toFixed(1), "text-anchor": "end"
    });
    label.textContent = compact(top * fraction);
    svg.append(label);
  }

  const barWidth = Math.max(3, (plotWidth / months.length) - 4);
  months.forEach((month, index) => {
    if (month.storageAf === null) return;
    const barTop = y(month.storageAf);
    const bar = element("rect", {
      x: (x(index) - barWidth / 2).toFixed(1),
      y: barTop.toFixed(1),
      width: barWidth.toFixed(1),
      height: Math.max(0, PAD_TOP + plotHeight - barTop).toFixed(1),
      fill: month.color,
      rx: 1
    });
    /* A title element, not an aria-label: the bars are not focusable here
     * because the table below carries every one of these numbers as text,
     * and a tab stop per month would put twelve stops between the chart and
     * that table for a reader who cannot see either. */
    const title = document.createElementNS(SVG, "title");
    title.textContent = readingOf(month);
    bar.append(title);
    svg.append(bar);
  });

  const normalPoints = months
    .map((month, index) => month.normalAf === null
      ? null : `${x(index).toFixed(1)},${y(month.normalAf).toFixed(1)}`)
    .filter((point): point is string => point !== null);
  if (normalPoints.length > 1) {
    svg.append(element("polyline", { class: "trend-normal", points: normalPoints.join(" ") }));
  }

  // Every third month, and always the last: twelve labels collide at 300px.
  months.forEach((month, index) => {
    if (index % 3 !== 0 && index !== months.length - 1) return;
    const label = element("text", {
      class: "trend-axis", x: x(index).toFixed(1), y: HEIGHT - 7, "text-anchor": "middle"
    });
    const [year, at] = month.key.split("-");
    label.textContent = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul",
      "Aug", "Sep", "Oct", "Nov", "Dec"][Number(at) - 1] ?? month.key} ${(year ?? "").slice(2)}`;
    svg.append(label);
  });

  return svg;
}

/** The numbers behind the chart, collapsed so the panel stays a panel. */
export function renderTrendTable(months: readonly DetailMonth[]): HTMLElement | null {
  if (!months.some((month) => month.storageAf !== null)) return null;

  const wrapper = document.createElement("details");
  wrapper.className = "trend-details";
  const summary = document.createElement("summary");
  summary.textContent = "Values for each month";
  wrapper.append(summary);

  const scroller = document.createElement("div");
  scroller.className = "trend-table-scroll";
  const table = document.createElement("table");
  table.className = "trend-table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const [label, numeric] of [["Month", false], ["Acre-feet", true],
    ["Of full level", true], ["Change from normal", true]] as const) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    if (numeric) cell.className = "trend-num";
    headRow.append(cell);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  // Newest first: the reader arrived here from a number about today.
  for (const month of [...months].reverse()) {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = month.label;
    const storage = document.createElement("td");
    storage.className = "trend-num";
    storage.textContent = formatAcreFeet(month.storageAf);
    const share = document.createElement("td");
    share.className = "trend-num";
    share.textContent = formatPercent(month.percent);
    const change = document.createElement("td");
    change.className = "trend-num";
    if (month.changeFromNormal === null) change.textContent = "—";
    else {
      change.textContent = `${month.changeFromNormal > 0 ? "+" : ""}${
        month.changeFromNormal.toFixed(0)}%`;
      change.classList.add(month.changeFromNormal < 0 ? "trend-down" : "trend-up");
    }
    row.append(name, storage, share, change);
    body.append(row);
  }

  table.append(head, body);
  scroller.append(table);
  const note = document.createElement("p");
  note.className = "trend-note";
  note.textContent = "Normal is the middle value for the same month in earlier years. " +
    "The earliest years have no earlier values to compare with.";
  wrapper.append(scroller, note);
  return wrapper;
}
