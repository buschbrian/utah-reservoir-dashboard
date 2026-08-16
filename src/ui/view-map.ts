/*
 * What every gallery-less view map shares: the element shape, the bounded
 * wait for a WebGL view, the exact fit to the fourteen drainage areas, and
 * the palette-to-fill conversion. Written once for the snow and drought
 * maps -- the fit especially, because a written zoom snaps to an integer
 * and one step out spans a continent, and that lesson should not need
 * relearning per map.
 */
import type ArcGISMap from "@arcgis/core/Map";
import Extent from "@arcgis/core/geometry/Extent";
import type { DrainageArea } from "../data/boundaries";

export interface ViewMapElement extends HTMLElement {
  map?: ArcGISMap | null | undefined;
  view?: {
    ready?: boolean;
    constraints?: { snapToZoom?: boolean };
    goTo?(target: unknown, options?: { animate?: boolean }): Promise<unknown>;
  } | null | undefined;
}

/** How long a view may claim to be starting before the page stops waiting
 * on it. The figures on these pages never wait on their map. */
export const VIEW_READY_TIMEOUT_MS = 25000;

/** Resolves when the component's view is ready, or after the deadline. */
export function viewReadyWithin(
  element: ViewMapElement, timeoutMs = VIEW_READY_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve) => {
    if (element.view?.ready) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    element.addEventListener("arcgisViewReadyChange", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** Frames the drainage areas exactly, with zoom snapping off. A no-op when
 * the view never became ready or the areas carry no coordinates. */
export async function fitToAreas(
  element: ViewMapElement, areas: readonly DrainageArea[]
): Promise<void> {
  const view = element.view;
  if (!view?.ready || !view.goTo) return;
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const area of areas) {
    for (const polygon of area.polygons) {
      for (const ring of polygon) {
        for (const [lon, lat] of ring) {
          if (lon < xmin) xmin = lon;
          if (lon > xmax) xmax = lon;
          if (lat < ymin) ymin = lat;
          if (lat > ymax) ymax = lat;
        }
      }
    }
  }
  if (!Number.isFinite(xmin)) return;
  if (view.constraints) view.constraints.snapToZoom = false;
  await view.goTo(
    new Extent({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } }),
    { animate: false }
  ).catch(() => undefined);
}

/** The status note a map host shows when its map cannot start or has no
 * background. One builder, because the snow and drought pages otherwise
 * each grow their own copy and the next accessibility change misses one. */
export function mapStatusNote(text: string): HTMLParagraphElement {
  const note = document.createElement("p");
  note.className = "chart-empty";
  note.setAttribute("role", "status");
  note.textContent = text;
  return note;
}

export type Rgba = [number, number, number, number];

export function hexRgba(hex: string, alpha: number): Rgba {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    alpha
  ];
}
