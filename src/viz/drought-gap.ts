/*
 * Dry land against banked water, as a ranked list rather than a cloud.
 *
 * The scatter beside this answers the same question and answers it as a
 * relationship: fourteen points, two axes, and the reading a viewer is meant
 * to take is each point's distance from the diagonal where the two shares are
 * equal. That diagonal is not drawn, and even if it were, judging
 * perpendicular distance by eye is a poor way to rank anything. The scatter
 * is kept because a cloud shows the shape of the relationship; this shows the
 * order, which is what a reader who wants a list actually needs.
 *
 * ## Two dots and a line, not one bar
 *
 * The obvious chart here is a diverging bar of `storage - dryness`. It is
 * also wrong, and the reason is worth stating: those two percentages divide
 * by different things. One is a share of land, the other a share of reservoir
 * capacity. Their difference is not a quantity -- there is no such thing as
 * "fifteen points of cushion" -- and a bar drawn from a zero baseline asserts
 * that it is.
 *
 * So both figures are drawn as their own dot on one 0 to 100 axis, with a
 * line joining them. The gap is still the thing the eye reads, because it is
 * the length of the line, but nothing on the chart claims it is a measurement
 * and both real values stay legible and separately labelled.
 *
 * ## Colour
 *
 * The dry dot takes the area's worst class colour from `DROUGHT_CLASSES`, and
 * the water dot takes its storage class colour from the same table the map
 * circles use, so each dot means on this chart exactly what its colour means
 * everywhere else on the site (ADR-008, ADR-032). The joining line is
 * neutral: it is a distance, not a third value, and giving it a colour of its
 * own would invent a category.
 *
 * Hand-built SVG for the same reasons as the scatter and the snow curve --
 * fourteen rows need no chart SDK, and everything that is not data takes its
 * colour from CSS so both themes stay readable.
 */
import type { StorageGap } from "../drought-model";
import { storageColor } from "./classes";

const SVG = "http://www.w3.org/2000/svg";

const WIDTH = 640;
const ROW_HEIGHT = 26;
const PAD_TOP = 26;
const PAD_BOTTOM = 34;
/* Wide enough for the longest drainage-area name this data carries.
 *
 * Measured, not guessed: the viewBox is 640 units across and renders about
 * 1200 pixels wide, so a unit is nearly two pixels and an 11-unit font is a
 * 20-pixel one. "Escalante Desert-Sevier Lake" needs about 142 units at the
 * size below, and at 140 it started 19 units left of the canvas and had its
 * first word cut off. */
const PAD_LEFT = 162;
const PAD_RIGHT = 18;

/** Both values are percentages and both run the whole way, so no week can be
 * flattered by cropping the axis to the values it happens to have. */
const AXIS_MAX = 100;

const DOT_RADIUS = 5.5;

/** The grey a dry dot takes when its area has no land in any class. */
const NO_CLASS_COLOR = "#9aa5ad";

function element<K extends keyof SVGElementTagNameMap>(
  name: K, attributes: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

export interface DroughtGapOptions {
  /** What the dry dot measures, for the key and the accessible description. */
  drynessLabel: string;
  ariaLabel: string;
}

/**
 * Draws the ranked comparison, or an empty note when nothing can be joined.
 *
 * Returns how many rows were drawn, which the page reports in its readiness
 * signal: a chart that quietly drew none looks the same as one that was never
 * asked to.
 */
export function renderDroughtGap(
  host: HTMLElement,
  rows: readonly StorageGap[],
  options: DroughtGapOptions
): number {
  host.replaceChildren();
  if (rows.length === 0) return 0;

  const height = PAD_TOP + rows.length * ROW_HEIGHT + PAD_BOTTOM;
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const svg = element("svg", {
    viewBox: `0 0 ${WIDTH} ${height}`,
    class: "drought-gap-chart",
    role: "img",
    "aria-label": options.ariaLabel
  });
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const x = (percent: number): number =>
    PAD_LEFT + (Math.min(AXIS_MAX, Math.max(0, percent)) / AXIS_MAX) * plotWidth;

  /* Gridlines every 25 points, and the axis labels under them. Drawn first so
   * every dot and line sits over them. */
  for (const tick of [0, 25, 50, 75, 100]) {
    svg.append(element("line", {
      x1: x(tick), x2: x(tick), y1: PAD_TOP - 8, y2: height - PAD_BOTTOM + 4,
      class: "drought-gap-grid"
    }));
    const label = element("text", {
      x: x(tick), y: height - PAD_BOTTOM + 20, class: "drought-gap-axis",
      "text-anchor": "middle"
    });
    label.textContent = `${tick}%`;
    svg.append(label);
  }

  rows.forEach((row, index) => {
    const y = PAD_TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2;
    /* One group per row, and the row's own `title` inside it. A `title`
     * appended to the root instead becomes the whole chart's accessible name
     * and every later one is ignored, so fourteen rows would carry one
     * description between them. */
    const group = element("g", { class: "drought-gap-row" });

    const name = element("text", {
      x: PAD_LEFT - 10, y: y + 4, class: "drought-gap-name", "text-anchor": "end"
    });
    name.textContent = row.name;

    /* The line first, so both dots draw over its ends. */
    group.append(element("line", {
      x1: x(row.dryPercent), x2: x(row.storagePercent), y1: y, y2: y,
      class: "drought-gap-link"
    }));

    group.append(element("circle", {
      cx: x(row.dryPercent), cy: y, r: DOT_RADIUS,
      fill: row.worst ? row.worst.color : NO_CLASS_COLOR,
      class: "drought-gap-dot"
    }));
    group.append(element("circle", {
      cx: x(row.storagePercent), cy: y, r: DOT_RADIUS,
      fill: storageColor(row.storagePercent),
      class: "drought-gap-dot"
    }));

    /* Every row is also a sentence, because a chart a screen reader cannot
     * read is a chart half the point of this page is missing. Both figures
     * and never their difference -- see the note at the top of this file. */
    const title = element("title", {});
    title.textContent =
      `${row.name}: ${row.dryPercent.toFixed(1)}% of land ${options.drynessLabel}, ` +
      `reservoirs ${row.storagePercent.toFixed(1)}% full ` +
      `across ${row.reservoirCount} ${row.reservoirCount === 1 ? "reservoir" : "reservoirs"}.`;
    /* The description first inside the group, which is where assistive
     * technology looks for it. */
    group.prepend(title);
    group.append(name);
    svg.append(group);
  });

  host.append(svg);
  return rows.length;
}
