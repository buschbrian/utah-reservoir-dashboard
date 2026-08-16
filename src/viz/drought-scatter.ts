/*
 * Land conditions against banked water: one point per drainage area, dry land
 * across, stored water up.
 *
 * This is the chart the whole drought view exists to make possible, and the
 * survey found no other product in this category that draws it. Drought maps
 * say how dry the ground is. Reservoir dashboards say how much water is in
 * the bank. Neither says the thing a reader actually wants, which is whether
 * those two agree -- and they routinely do not. An area can be almost
 * entirely in severe drought while its reservoirs are three-quarters full,
 * which is a region living on water it banked in better years, and it can be
 * the other way around after one dry winter following a wet decade.
 *
 * Hand-built SVG like the snow curve and the storage trend, for the same
 * reasons: fourteen points need no chart SDK, the page stays light enough to
 * open on a phone, and everything that is not data takes its colour from CSS
 * so the dark theme keeps the axes readable. Point colours come from
 * `DROUGHT_CLASSES` -- the monitor's own palette, the same one the map and
 * the bars use -- so a point's colour means on this chart exactly what it
 * means everywhere else on the page.
 *
 * The reference lines are drawn at the middle of each axis and are not a
 * judgment: they are there so the four corners can be read as combinations
 * rather than the reader having to hold two numbers in their head. The words
 * for the corners live on the page beside the chart, not in the picture.
 */
import type { StorageAgainstDrought } from "../drought-model";

const SVG = "http://www.w3.org/2000/svg";

const WIDTH = 640;
const HEIGHT = 340;
const PAD_LEFT = 46;
const PAD_RIGHT = 14;
const PAD_TOP = 14;
const PAD_BOTTOM = 42;

/** Both axes are percentages and both run the whole way, so the chart never
 * flatters a bad year by cropping to the data it happens to have. */
const AXIS_MAX = 100;

const POINT_RADIUS = 6;

function element<K extends keyof SVGElementTagNameMap>(
  name: K, attributes: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

/** The grey a point takes when its area has no land in any drought class. */
const NO_CLASS_COLOR = "#9aa5ad";

export interface DroughtScatterOptions {
  /** The class the horizontal axis measures, for the axis title. */
  drynessLabel: string;
  ariaLabel: string;
  /** The area to draw with emphasis, from a cross-page link. */
  highlight?: string | null;
}

/**
 * Returns null when there is nothing to plot, so the caller says so in words
 * rather than drawing axes around an empty box. That happens for real: the
 * reservoir payload is allowed to fail without failing this page.
 */
export function renderDroughtScatter(
  points: readonly StorageAgainstDrought[],
  options: DroughtScatterOptions
): SVGSVGElement | null {
  if (points.length === 0) return null;

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (percent: number): number =>
    PAD_LEFT + (Math.min(AXIS_MAX, Math.max(0, percent)) / AXIS_MAX) * plotWidth;
  const y = (percent: number): number =>
    PAD_TOP + plotHeight - (Math.min(AXIS_MAX, Math.max(0, percent)) / AXIS_MAX) * plotHeight;

  const svg = element("svg", {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    class: "drought-scatter",
    role: "img",
    "aria-label": options.ariaLabel
  });

  /* Gridlines every 25 points on both axes, plus the tick labels. Drawn
   * first so every point sits over them. */
  for (let value = 0; value <= AXIS_MAX; value += 25) {
    svg.append(element("line", {
      class: "drought-grid",
      x1: PAD_LEFT, x2: WIDTH - PAD_RIGHT, y1: y(value), y2: y(value)
    }));
    svg.append(element("line", {
      class: "drought-grid",
      x1: x(value), x2: x(value), y1: PAD_TOP, y2: PAD_TOP + plotHeight
    }));
    const left = element("text", {
      class: "drought-axis", x: PAD_LEFT - 8, y: y(value) + 4, "text-anchor": "end"
    });
    left.textContent = `${value}%`;
    svg.append(left);
    const bottom = element("text", {
      class: "drought-axis", x: x(value), y: PAD_TOP + plotHeight + 16, "text-anchor": "middle"
    });
    bottom.textContent = `${value}%`;
    svg.append(bottom);
  }

  /* The halfway lines, so the corners read as combinations. Dashed and in
   * the same muted colour as the grid: they are scaffolding, not data. */
  svg.append(element("line", {
    class: "drought-guide", x1: x(50), x2: x(50), y1: PAD_TOP, y2: PAD_TOP + plotHeight
  }));
  svg.append(element("line", {
    class: "drought-guide", x1: PAD_LEFT, x2: WIDTH - PAD_RIGHT, y1: y(50), y2: y(50)
  }));

  const axisX = element("text", {
    class: "drought-axis-title",
    x: PAD_LEFT + plotWidth / 2,
    y: HEIGHT - 8,
    "text-anchor": "middle"
  });
  axisX.textContent = `Share of land in ${options.drynessLabel} or worse`;
  svg.append(axisX);

  const axisY = element("text", {
    class: "drought-axis-title",
    x: 12,
    y: PAD_TOP + plotHeight / 2,
    "text-anchor": "middle",
    transform: `rotate(-90 12 ${PAD_TOP + plotHeight / 2})`
  });
  axisY.textContent = "Reservoirs full";
  svg.append(axisY);

  /* Largest circles last would bury the small ones, but every point here is
   * the same size -- the reservoir count is in the card, not the radius,
   * because sizing by it would make this a third quantity to decode. Sorted
   * so the emphasised area is drawn last and cannot be covered. */
  const ordered = [...points].sort((a, b) =>
    Number(a.huc6 === options.highlight) - Number(b.huc6 === options.highlight));

  for (const point of ordered) {
    const emphasised = point.huc6 === options.highlight;
    const group = element("g", { class: "drought-scatter-point" });
    group.append(element("circle", {
      cx: x(point.dryPercent),
      cy: y(point.storagePercent),
      r: emphasised ? POINT_RADIUS + 3 : POINT_RADIUS,
      fill: point.worst ? point.worst.color : NO_CLASS_COLOR,
      class: emphasised ? "is-chosen" : ""
    }));
    /* Every point carries its own name for a screen reader and a native
     * tooltip: fourteen labels drawn on the chart would overlap, and the
     * table under it already lists all of them in full. */
    const title = element("title", {});
    title.textContent = `${point.name}: ${point.storagePercent.toFixed(1)}% full ` +
      `across ${point.reservoirCount} ` +
      `${point.reservoirCount === 1 ? "reservoir" : "reservoirs"}, ` +
      `${point.dryPercent.toFixed(1)}% of land in ${options.drynessLabel} or worse`;
    group.append(title);
    svg.append(group);
  }

  return svg;
}
