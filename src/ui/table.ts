/*
 * The reservoir table under the map.
 *
 * Real elements rather than an HTML string, for the same reason the details
 * panel is: a reservoir name comes from a payload fetched at runtime, and one
 * `innerHTML` path through it would be the only place on the page where that
 * name is parsed as markup.
 *
 * A real `<table>`, not a grid of divs. The column headings are the sort
 * control, so they are `<th>` elements carrying `aria-sort` with a button
 * inside -- which is what tells a screen reader both that the column is
 * sortable and which way it is currently sorted. A row is selectable, and the
 * name cell holds the button that does it, so the reachable target is the
 * reservoir's name rather than a whole row of numbers.
 */

import "@esri/calcite-components/components/calcite-button";

import { COLUMN_LABELS, SORT_KEYS, type SortKey, type TableRow, type TableSort }
  from "../state/table";
import { formatAcreFeet, formatDate, formatPercent } from "../viz/format";
import { monthLabel } from "../data/months";

/** Which columns hold numbers, so the cells and headings align right. */
const NUMERIC: ReadonlySet<SortKey> = new Set<SortKey>(["percent", "storage", "capacity"]);

const ARIA_SORT: Record<"asc" | "desc", "ascending" | "descending"> = {
  asc: "ascending",
  desc: "descending"
};

export interface TableCallbacks {
  onSort(key: SortKey): void;
  onSelect(name: string): void;
}

function readingText(reading: string): string {
  // A month key is what the slider puts here; anything else is an
  // observation date. Both are the reader's answer to "as of when".
  return /^\d{4}-\d{2}$/.test(reading) ? monthLabel(reading) : formatDate(reading);
}

function cellText(row: TableRow, key: SortKey): string {
  switch (key) {
    case "percent": return formatPercent(row.percent);
    case "storage": return `${formatAcreFeet(row.storageAf)} acre-feet`;
    case "capacity": return `${formatAcreFeet(row.capacityAf)} acre-feet`;
    case "area": return row.areaName;
    default: return row.name;
  }
}

function headingCell(key: SortKey, sort: TableSort, onSort: (key: SortKey) => void): HTMLElement {
  const cell = document.createElement("th");
  cell.scope = "col";
  if (NUMERIC.has(key)) cell.classList.add("table-number");
  /* `none` rather than the attribute being absent: a sortable column that
   * is not currently sorted still has to announce that it can be. */
  cell.setAttribute("aria-sort", sort.key === key ? ARIA_SORT[sort.direction] : "none");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "table-sort";
  button.dataset.sort = key;
  const label = document.createElement("span");
  label.textContent = COLUMN_LABELS[key];
  /* The arrow is decorative -- `aria-sort` on the cell is what carries the
   * fact -- but the button's own words have to say what pressing it does,
   * and "Reservoir" alone does not. */
  const action = document.createElement("span");
  action.className = "visually-hidden";
  action.textContent = sort.key === key && sort.direction === "asc"
    ? ": sorted lowest first, press to reverse"
    : sort.key === key
      ? ": sorted highest first, press to reverse"
      : ": press to sort by this column";
  const arrow = document.createElement("span");
  arrow.className = "table-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = sort.key === key ? (sort.direction === "asc" ? "▲" : "▼") : "";

  button.append(label, action, arrow);
  button.addEventListener("click", () => onSort(key));
  cell.append(button);
  return cell;
}

function bodyRow(row: TableRow, selected: string | null,
  onSelect: (name: string) => void): HTMLElement {
  const element = document.createElement("tr");
  element.dataset.reservoir = row.name;
  if (row.name === selected) element.classList.add("table-row-selected");

  for (const key of SORT_KEYS) {
    const cell = document.createElement(key === "name" ? "th" : "td");
    if (key === "name") {
      (cell as HTMLTableCellElement).scope = "row";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "table-name";
      button.dataset.reservoir = row.name;
      button.setAttribute("aria-pressed", String(row.name === selected));
      button.textContent = row.name;
      button.addEventListener("click", () => onSelect(row.name));
      cell.append(button);
      if (row.late) {
        const late = document.createElement("span");
        late.className = "table-late";
        late.textContent = "Late";
        cell.append(late);
      }
    } else {
      if (NUMERIC.has(key)) cell.classList.add("table-number");
      cell.textContent = cellText(row, key);
    }
    element.append(cell);
  }

  const reading = document.createElement("td");
  reading.className = "table-reading";
  reading.textContent = readingText(row.reading);
  element.append(reading);
  return element;
}

/**
 * Draws the table, or says why there is nothing to draw.
 *
 * An empty result is a state the analysis controls can reach -- one class
 * plus one drainage area is enough -- and an empty table with a caption
 * above it looks like a page that failed rather than a filter that matched
 * nothing.
 */
export function renderTable(
  host: HTMLElement,
  rows: readonly TableRow[],
  sort: TableSort,
  selected: string | null,
  callbacks: TableCallbacks
): void {
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "table-empty";
    empty.textContent = "No reservoir matches the current analysis controls.";
    host.replaceChildren(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "reservoir-table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const key of SORT_KEYS) headRow.append(headingCell(key, sort, callbacks.onSort));
  const reading = document.createElement("th");
  reading.scope = "col";
  /* Not sortable, and deliberately: it holds a date for the newest reading
   * and a month for every other slider position, so an order over it would
   * mean two different things depending on where the slider is. */
  reading.textContent = "Reading";
  headRow.append(reading);
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const row of rows) body.append(bodyRow(row, selected, callbacks.onSelect));

  table.append(head, body);
  host.replaceChildren(table);
}

/** Moves the pressed state without rebuilding the rows. */
export function markSelectedInTable(selected: string | null): void {
  document.querySelectorAll<HTMLElement>(".reservoir-table tr[data-reservoir]")
    .forEach((row) => {
      row.classList.toggle("table-row-selected", row.dataset.reservoir === selected);
    });
  document.querySelectorAll<HTMLElement>(".table-name").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.reservoir === selected));
  });
}
