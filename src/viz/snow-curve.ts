/*
 * The seasonal snow curve: mean percent of the normal median, day by day
 * across the water year, with a dashed line at 100 for normal.
 *
 * Hand-built SVG like the storage trend chart, and for the same reasons: a
 * daily percent line needs no chart SDK, the page stays light enough to open
 * on a phone, and the colours that are not data come from CSS so the dark
 * theme keeps the axis readable. The line breaks where the reporting floor
 * is not met rather than bridging the gap -- a drawn segment claims there
 * was a value there.
 */
import type { CurvePoint } from "../snow-model";

const SVG = "http://www.w3.org/2000/svg";

const WIDTH = 640;
const HEIGHT = 240;
const PAD_LEFT = 40;
const PAD_RIGHT = 10;
const PAD_TOP = 10;
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

/**
 * Returns null when no day meets the reporting floor, so the caller can say
 * so in words rather than render axes around nothing.
 */
export function renderSnowCurve(
  points: readonly CurvePoint[], ariaLabel: string
): SVGSVGElement | null {
  const drawable = points.filter((point) => point.percent !== null);
  if (drawable.length < 2 || points.length < 2) return null;

  const first = dayNumber(points[0]!.date);
  const span = Math.max(1, dayNumber(points[points.length - 1]!.date) - first);
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  /* The axis always reaches 150 so "just under normal" cannot fill the
   * frame and read as a good year; a genuinely big year extends it. */
  const top = Math.max(150, Math.ceil(
    Math.max(...drawable.map((point) => point.percent as number)) * 1.08 / 50) * 50);
  const x = (date: string): number =>
    PAD_LEFT + ((dayNumber(date) - first) / span) * plotWidth;
  const y = (value: number): number =>
    PAD_TOP + plotHeight - (value / top) * plotHeight;

  const svg = element("svg", {
    class: "snow-curve",
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    width: "100%",
    role: "img",
    "aria-label": ariaLabel
  });

  for (let level = 0; level <= top; level += 50) {
    const at = y(level);
    svg.append(element("line", {
      class: level === 100 ? "snow-normal-line" : "snow-grid",
      x1: PAD_LEFT, y1: at.toFixed(1), x2: WIDTH - PAD_RIGHT, y2: at.toFixed(1)
    }));
    const label = element("text", {
      class: "snow-axis", x: PAD_LEFT - 6, y: (at + 3.5).toFixed(1),
      "text-anchor": "end"
    });
    label.textContent = level === 100 ? "Normal" : String(level);
    svg.append(label);
  }

  // A month tick on the first of each month in the series.
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

  /* One polyline per unbroken run of values. A null is a day the floor was
   * not met, and the line must not invent a reading across it. */
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 1) {
      svg.append(element("polyline", { class: "snow-line", points: run.join(" ") }));
    } else if (run.length === 1) {
      const [pointX, pointY] = run[0]!.split(",");
      svg.append(element("circle", {
        class: "snow-line-dot", cx: pointX!, cy: pointY!, r: 1.5
      }));
    }
    run = [];
  };
  for (const point of points) {
    if (point.percent === null) { flush(); continue; }
    run.push(`${x(point.date).toFixed(1)},${y(point.percent).toFixed(1)}`);
  }
  flush();

  // The newest reading gets a marker and a spoken value.
  const latest = [...points].reverse().find((point) => point.percent !== null);
  if (latest) {
    const marker = element("circle", {
      class: "snow-latest",
      cx: x(latest.date).toFixed(1),
      cy: y(latest.percent as number).toFixed(1),
      r: 3.5
    });
    const title = document.createElementNS(SVG, "title");
    title.textContent = `Newest value: ${latest.percent}% of normal, ` +
      `from ${latest.reportingSites} sites.`;
    marker.append(title);
    svg.append(marker);
  }

  return svg;
}
