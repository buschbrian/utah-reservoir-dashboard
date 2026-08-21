/*
 * How much drier or wetter each drainage area got in a week, ranked.
 *
 * ## Why a bar here, when the gap chart refuses one
 *
 * `drought-gap.ts` explains at length why it draws two dots and a line rather
 * than one diverging bar: the two figures it compares divide by different
 * things, so their difference is not a quantity and a bar from a zero
 * baseline would assert that it is.
 *
 * This chart is the case that refusal does not cover. Both numbers here are
 * the same measurement of the same land a week apart — the share of an area
 * at severe drought or worse — so the difference between them is a real
 * quantity in real units, points of land, and zero is a real place on the
 * axis rather than an invented one. A diverging bar from that zero is the
 * honest shape, and it is the one shape that shows direction, size and rank
 * in a single mark.
 *
 * ## Zero is drawn, and it is in the middle
 *
 * The axis is symmetric around zero even when the week is not. A week where
 * everything got wetter would otherwise draw its zero hard against the right
 * edge, and the next week's chart would put it somewhere else — so the same
 * bar length would mean a different number on two consecutive Thursdays. The
 * bound is the largest move in either direction, rounded up, applied both
 * ways.
 *
 * ## Colour
 *
 * From `CHANGE_CLASSES`, the same table the map fills with and the table
 * column reads, so a bar's colour means here exactly what it means there
 * (ADR-008, ADR-032, ADR-074). Nothing on this chart is coloured by anything
 * else: the drought classes are not on it, because this is not a chart about
 * how dry anywhere is.
 *
 * Hand-built SVG for the reasons the other three charts on this page give —
 * a few dozen rows need no chart SDK, and everything that is not data takes
 * its colour from CSS so both themes stay readable.
 */
import type { DroughtChange } from "../drought-model";
import { changeColor, changeLabel } from "./change-classes";

const SVG = "http://www.w3.org/2000/svg";

const WIDTH = 640;
/* The same row height the ranked gap chart uses, so the two charts on this
 * page read as one family rather than two. */
const ROW_HEIGHT = 21;
const PAD_TOP = 26;
const PAD_BOTTOM = 34;
/* The same measured lane the gap chart's names need: "Escalante
 * Desert-Sevier Lake" is the longest name this data carries. */
const PAD_LEFT = 162;
const PAD_RIGHT = 18;
const BAR_HEIGHT = 11;

/** The smallest half-width the axis will use, in points of land. A quiet week
 * where nothing moved more than a point would otherwise draw its two or three
 * tiny bars at full width and read as a dramatic one. */
const MIN_AXIS_POINTS = 5;

function element<K extends keyof SVGElementTagNameMap>(
  name: K, attributes: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

/**
 * The axis half-width: the largest move either way, rounded up to a multiple
 * of five, and never below `MIN_AXIS_POINTS`.
 *
 * Exported because the caption states it, and a caption reading a different
 * bound from the one the bars are drawn against would be worse than none.
 */
export function changeAxisBound(rows: readonly DroughtChange[]): number {
  const largest = rows.reduce(
    (most, row) => Math.max(most, Math.abs(row.points)), 0);
  return Math.max(MIN_AXIS_POINTS, Math.ceil(largest / 5) * 5);
}

export interface DroughtChangeOptions {
  ariaLabel: string;
  /** The class the change is measured at, for each row's own sentence. */
  changeLabelText: string;
  /** The area to draw with emphasis, from a cross-page link. */
  highlight?: string | null;
}

/**
 * Returns the number of rows drawn, and draws nothing for an empty list so
 * the caller says "there is no comparison yet" in words rather than framing
 * an empty box. That state is real: an archive holds one week the first time
 * it is written.
 */
export function renderDroughtChange(
  host: HTMLElement,
  rows: readonly DroughtChange[],
  options: DroughtChangeOptions
): number {
  host.replaceChildren();
  if (rows.length === 0) return 0;

  const height = PAD_TOP + rows.length * ROW_HEIGHT + PAD_BOTTOM;
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const bound = changeAxisBound(rows);
  const middle = PAD_LEFT + plotWidth / 2;
  const x = (points: number): number =>
    middle + (Math.min(bound, Math.max(-bound, points)) / bound) * (plotWidth / 2);

  const svg = element("svg", {
    viewBox: `0 0 ${WIDTH} ${height}`,
    class: "drought-change-chart",
    role: "img",
    "aria-label": options.ariaLabel
  });
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  /* Gridlines at the quarter points either side, and the axis labels under
   * them. The sign is carried by a word at the ends rather than by a minus,
   * because "wetter" and "drier" are what the numbers mean and a reader
   * should not have to remember which direction is positive. */
  const ticks = [-bound, -bound / 2, 0, bound / 2, bound];
  for (const tick of ticks) {
    svg.append(element("line", {
      x1: x(tick), x2: x(tick), y1: PAD_TOP - 8, y2: height - PAD_BOTTOM + 4,
      class: tick === 0 ? "drought-change-zero" : "drought-change-grid"
    }));
    const label = element("text", {
      x: x(tick), y: height - PAD_BOTTOM + 20, class: "drought-change-axis",
      "text-anchor": "middle"
    });
    label.textContent = tick === 0 ? "0" : `${Math.abs(tick)}`;
    svg.append(label);
  }
  for (const [at, word] of [[-bound, "wetter"], [bound, "drier"]] as const) {
    const end = element("text", {
      x: x(at), y: height - PAD_BOTTOM + 31, class: "drought-change-axis",
      "text-anchor": "middle"
    });
    end.textContent = word;
    svg.append(end);
  }

  rows.forEach((row, index) => {
    const y = PAD_TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2;
    /* One group per row with its own `title` inside it, for the reason the
     * gap chart records: a `title` on the root becomes the whole chart's
     * name and every later one is ignored. */
    const group = element("g", { class: "drought-change-row" });

    const start = Math.min(x(0), x(row.points));
    const width = Math.abs(x(row.points) - x(0));
    group.append(element("rect", {
      x: start, y: y - BAR_HEIGHT / 2,
      /* A move too small to see still gets a mark, so a reader can tell a
         row that held steady from a row that is missing. */
      width: Math.max(width, 1.5), height: BAR_HEIGHT,
      fill: changeColor(row.points) ?? "transparent",
      class: row.huc6 === options.highlight
        ? "drought-change-bar is-chosen" : "drought-change-bar"
    }));

    const name = element("text", {
      x: PAD_LEFT - 10, y: y + 4, class: "drought-change-name", "text-anchor": "end"
    });
    name.textContent = row.name;

    const title = element("title", {});
    title.textContent =
      `${row.name}: ${changeLabel(row.points)}. `
      + `${row.thenPercent.toFixed(1)}% of land ${options.changeLabelText} last week, `
      + `${row.nowPercent.toFixed(1)}% this week.`;
    group.prepend(title);
    group.append(name);
    svg.append(group);
  });

  host.append(svg);
  return rows.length;
}
