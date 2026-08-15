export interface ChartTooltipRow {
  label: string;
  value: string;
}

/**
 * Builds the small HTML fragment the charts SDK places under the pointer.
 *
 * The SDK interprets returned strings as HTML, while reservoir and drainage
 * area names come from the runtime payload. Escape every value at this one
 * boundary so custom tooltips can name a mark without turning data into
 * markup. A deliberately simple line layout also stays readable in the
 * narrow tooltip box the SDK uses near a chart edge.
 */
export function chartTooltip(title: string, rows: readonly ChartTooltipRow[]): string {
  const escape = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);

  const details = rows.map((row) =>
    `<br><b>${escape(row.label)}:</b> ${escape(row.value)}`).join("");
  return `<b>${escape(title)}</b>${details}`;
}
