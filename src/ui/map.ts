import "@esri/calcite-components/components/calcite-notice";
import "@arcgis/map-components/components/arcgis-fullscreen";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scale-bar";

import ArcGISMap from "@arcgis/core/Map";
import type GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import { resolveBasemap } from "../arcgis/basemaps";
import type { DrainageArea } from "../data/boundaries";
import { findReservoir, type SelectionStore } from "../state/selection";
import type { Reservoir } from "../types";
import { elementById } from "./dom";
import {
  NAME_FIELD,
  createDrainageLayer,
  createHighlightLayer,
  createMaskLayer,
  createReservoirLayer,
  showHighlight
} from "./layers";

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

/** What the readiness signal reports about the map. Each field is one fact. */
export interface MapStatus {
  basemap: boolean;
  /** True when a preferred background failed and a later candidate served. */
  basemapDegraded: boolean;
  masked: boolean;
  drainageAreas: number;
  reservoirsDrawn: number;
}

export interface MapController {
  status: MapStatus;
  drawReservoirs(reservoirs: readonly Reservoir[]): void;
  drawDrainageAreas(areas: readonly DrainageArea[]): void;
}

type MapElement = HTMLElement & {
  map?: ArcGISMap | null;
  basemap?: unknown;
  animationsDisabled?: boolean;
  hitTest(target: { x: number; y: number }): Promise<{
    results: { type: string; graphic?: { attributes?: Record<string, unknown> } }[];
  }>;
};

function showMapMessage(heading: string, detail: string, role: "status" | "alert"): void {
  const host = elementById<HTMLElement>("map-host");
  host.setAttribute("aria-busy", "false");
  const state = document.createElement("div");
  state.className = role === "alert" ? "map-state map-state-error" : "map-state";
  state.setAttribute("role", role);
  const title = document.createElement("strong");
  title.textContent = heading;
  const copy = document.createElement("p");
  copy.textContent = detail;
  state.append(title, copy);
  host.replaceChildren(state);
}

function showDegradedBasemap(name: string | null): void {
  const notice = document.createElement("calcite-notice");
  notice.setAttribute("kind", "warning");
  notice.setAttribute("open", "");
  notice.setAttribute("icon", "");
  const title = document.createElement("div");
  title.slot = "title";
  title.textContent = "Alternate map background";
  const message = document.createElement("div");
  message.slot = "message";
  message.textContent = `The preferred background was unavailable. Using ${name ?? "an alternate"}.`;
  notice.append(title, message);
  elementById("map-host").append(notice);
}

/* The pointer half of selection. The keyboard half is the reservoir list in
 * the storage summary, which is a real focusable control rather than a
 * keyboard trap over a canvas -- and it works in the one environment the
 * canvas does not, a hidden or headless browser, where `hitTest` never
 * settles because the render loop that resolves it never runs. */
function wirePointerSelection(element: MapElement, selection: SelectionStore): void {
  element.addEventListener("arcgisViewClick", (event) => {
    const detail = (event as CustomEvent<{ screenPoint?: { x: number; y: number } }>).detail;
    const screenPoint = detail?.screenPoint;
    if (!screenPoint) return;
    void element.hitTest(screenPoint).then((response) => {
      const hit = response.results.find((result) =>
        typeof result.graphic?.attributes?.[NAME_FIELD] === "string");
      const name = hit?.graphic?.attributes?.[NAME_FIELD];
      // Clicking the basemap clears the selection: the reader pointed at
      // something that is not a reservoir, and leaving the old details open
      // makes the panel describe a reservoir nobody is looking at.
      selection.set(typeof name === "string" ? name : null, { source: "map" });
    }).catch((error: unknown) => {
      console.warn("The map could not answer a pointer selection:", error);
    });
  });
}

export async function loadMap(selection: SelectionStore): Promise<MapController | null> {
  const resolution = await resolveBasemap();
  if (!resolution.resource) {
    showMapMessage(
      "The map background is unavailable",
      "Reservoir data remains available in the summary and statewide overview.",
      "alert"
    );
    return null;
  }

  /* The SDK's `basemap` property is typed as basemap *properties*, and an
   * already-constructed Basemap does not satisfy that shape under
   * `exactOptionalPropertyTypes`: its own optional members are
   * `T | null | undefined` where the property type accepts only `T | null`.
   * The SDK passes an instance straight through at runtime, so the one
   * assignment is narrowed here rather than the whole map being untyped. */
  const map = new ArcGISMap();
  (map as { basemap: unknown }).basemap = resolution.resource;
  const maskLayer = createMaskLayer();
  const highlightLayer = createHighlightLayer();
  map.add(maskLayer);

  const element = document.createElement("arcgis-map") as MapElement;
  element.setAttribute("center", "-111.7,39.4");
  element.setAttribute("zoom", "6");
  element.setAttribute("aria-label", "Interactive map of Utah and connected drainage areas");
  element.map = map;
  element.animationsDisabled = reducedMotionQuery.matches;
  element.innerHTML = `
    <arcgis-home slot="top-left"></arcgis-home>
    <arcgis-fullscreen slot="top-right"></arcgis-fullscreen>
    <arcgis-scale-bar slot="bottom-left" unit="dual"></arcgis-scale-bar>`;
  element.addEventListener("arcgisViewReadyChange", () => {
    elementById("map-host").setAttribute("aria-busy", "false");
  }, { once: true });
  element.addEventListener("arcgisViewReadyError", () => {
    showMapMessage(
      "The map could not start",
      "Reservoir data remains available in the summary and statewide overview.",
      "alert"
    );
  }, { once: true });
  wirePointerSelection(element, selection);
  elementById("map-host").replaceChildren(element);
  if (resolution.degraded) showDegradedBasemap(resolution.name);

  const status: MapStatus = {
    basemap: true,
    basemapDegraded: resolution.degraded,
    masked: map.layers.includes(maskLayer),
    drainageAreas: 0,
    reservoirsDrawn: 0
  };
  let drainageLayer: GraphicsLayer | null = null;
  let drawn: readonly Reservoir[] = [];

  selection.subscribe((name) => {
    showHighlight(highlightLayer, findReservoir(drawn, name), drawn);
  });

  return {
    status,
    drawReservoirs(reservoirs) {
      const result = createReservoirLayer(reservoirs);
      drawn = reservoirs;
      map.add(result.layer);
      // Added after the points so a selected reservoir is not covered by
      // the reservoir drawn next to it.
      map.add(highlightLayer);
      status.reservoirsDrawn = result.drawn;
    },
    drawDrainageAreas(areas) {
      if (drainageLayer) map.remove(drainageLayer);
      drainageLayer = createDrainageLayer(areas);
      // Under the reservoirs and over the basemap: outlines are context.
      map.add(drainageLayer, 1);
      status.drainageAreas = areas.length;
    }
  };
}
