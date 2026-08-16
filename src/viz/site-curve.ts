/*
 * One measurement site's water year: inches of snow water, day by day,
 * against the normal median for the same days, with the site's published
 * normal season marked -- when snow usually starts, when it is usually
 * highest and how high, and when it usually melts out.
 *
 * Hand-built SVG like the seasonal percent curve and for the same reasons.
 * Unlike that curve this one is in inches, because a single site needs no
 * cross-site denominator: the honest comparison is this year's line against
 * the normal line, on the same axis.
 */
import type { SitePoint, SiteTiming } from "../snow-model";

const SVG = "http://www.w3.org/2000/svg";

const WIDTH = 640;
const HEIGHT = 240;
const PAD_LEFT = 40;
const PAD_RIGHT = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function element<K extends keyof SVGElementTagNameMap>(
  name: K, attributes: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

/** A readable step for the inches axis: about three to five gridlines. */
function axisStep(top: number): number {
  for (const step of [1, 2, 5, 10, 20, 50]) {
    if (top / step <= 5) return step;
  }
  return 100;
}

function polylineRuns(
  svg: SVGSVGElement,
  points: readonly SitePoint[],
  value: (point: SitePoint) => number | null,
  x: (date: string) => number,
  y: (inches: number) => number,
  className: string
): void {
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 1) {
      svg.append(element("polyline", { class: className, points: run.join(" ") }));
    }
    run = [];
  };
  for (const point of points) {
    const inches = value(point);
    if (inches === null) { flush(); continue; }
    run.push(`${x(point.date).toFixed(1)},${y(inches).toFixed(1)}`);
  }
  flush();
}

/**
 * Returns null when the site has nothing to draw, so the caller can say so
 * in words rather than render axes around nothing.
 */
export function renderSiteCurve(
  points: readonly SitePoint[], timing: SiteTiming, ariaLabel: string
): SVGSVGElement | null {
  if (points.length < 2) return null;
  const values = points.flatMap((point) =>
    [point.inches, point.normalInches].filter((value): value is number => value !== null));
  if (values.length === 0) return null;

  const first = dayNumber(points[0]!.date);
  const last = dayNumber(points[points.length - 1]!.date);
  const span = Math.max(1, last - first);
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const top = Math.max(1, Math.max(...values, timing.peakInches ?? 0) * 1.1);
  const x = (date: string): number =>
    PAD_LEFT + ((dayNumber(date) - first) / span) * plotWidth;
  const y = (inches: number): number =>
    PAD_TOP + plotHeight - (inches / top) * plotHeight;
  const inRange = (date: string | null): date is string =>
    date !== null && dayNumber(date) >= first && dayNumber(date) <= last;

  const svg = element("svg", {
    class: "snow-curve",
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    width: "100%",
    role: "img",
    "aria-label": ariaLabel
  });

  const step = axisStep(top);
  for (let level = 0; level <= top; level += step) {
    const at = y(level);
    svg.append(element("line", {
      class: "snow-grid",
      x1: PAD_LEFT, y1: at.toFixed(1), x2: WIDTH - PAD_RIGHT, y2: at.toFixed(1)
    }));
    const label = element("text", {
      class: "snow-axis", x: PAD_LEFT - 6, y: (at + 3.5).toFixed(1),
      "text-anchor": "end"
    });
    label.textContent = String(level);
    svg.append(label);
  }

  for (const point of points) {
    if (!point.date.endsWith("-01")) continue;
    const at = x(point.date);
    svg.append(element("line", {
      class: "snow-grid snow-month-tick",
      x1: at.toFixed(1), y1: PAD_TOP + plotHeight,
      x2: at.toFixed(1), y2: PAD_TOP + plotHeight + 4
    }));
    const label = element("text", {
      class: "snow-axis", x: at.toFixed(1), y: HEIGHT - 8, "text-anchor": "middle"
    });
    label.textContent = MONTH_SHORT[Number(point.date.slice(5, 7)) - 1] ?? "";
    svg.append(label);
  }

  // Normal first, so the season's line draws over it.
  polylineRuns(svg, points, (point) => point.normalInches, x, y, "site-curve-normal");
  polylineRuns(svg, points, (point) => point.inches, x, y, "snow-line");

  /* The published normal season. Each marker carries its words as a title;
   * the caption under the chart states the same dates as text. */
  if (inRange(timing.peakDate) && timing.peakInches !== null) {
    const marker = element("circle", {
      class: "site-timing-peak",
      cx: x(timing.peakDate).toFixed(1),
      cy: y(Math.min(timing.peakInches, top)).toFixed(1),
      r: 3.5
    });
    const title = document.createElementNS(SVG, "title");
    title.textContent =
      `Normal highest value: ${timing.peakInches} inches.`;
    marker.append(title);
    svg.append(marker);
  }
  for (const [date, words] of [
    [timing.onset, "Snow usually starts to build near this day."],
    [timing.meltout, "The snow has usually melted by this day."]
  ] as const) {
    if (!inRange(date)) continue;
    const at = x(date);
    const tick = element("line", {
      class: "site-timing-tick",
      x1: at.toFixed(1), y1: (PAD_TOP + plotHeight - 8).toFixed(1),
      x2: at.toFixed(1), y2: (PAD_TOP + plotHeight).toFixed(1)
    });
    const title = document.createElementNS(SVG, "title");
    title.textContent = words;
    tick.append(title);
    svg.append(tick);
  }

  // The newest reading gets a marker and a spoken value.
  const latest = [...points].reverse().find((point) => point.inches !== null);
  if (latest) {
    const marker = element("circle", {
      class: "snow-latest",
      cx: x(latest.date).toFixed(1),
      cy: y(latest.inches as number).toFixed(1),
      r: 3.5
    });
    const title = document.createElementNS(SVG, "title");
    title.textContent = `Newest value: ${latest.inches} inches.`;
    marker.append(title);
    svg.append(marker);
  }

  return svg;
}
