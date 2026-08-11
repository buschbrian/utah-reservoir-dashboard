import "@esri/calcite-components/components/calcite-notice";
import "@arcgis/map-components/components/arcgis-fullscreen";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scale-bar";

import ArcGISMap from "@arcgis/core/Map";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import type GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import { resolveBasemap } from "../arcgis/basemaps";
import type { DrainageArea, UtahBoundary } from "../data/boundaries";
import { findReservoir, type SelectionStore } from "../state/selection";
import type { Reservoir } from "../types";
import { formatDate, formatPercent } from "../viz/format";
import { headlinePercent } from "../viz/symbols";
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
  boundaryPoints: number;
  drainageAreas: number;
  reservoirsDrawn: number;
  /** Symbols the reservoir renderer holds -- see `ReservoirLayerResult`. */
  reservoirSymbols: number;
  /** True when the map is greying reservoirs the reader filtered out. */
  filtered: boolean;
}

export interface MapController {
  status: MapStatus;
  drawReservoirs(reservoirs: readonly Reservoir[]): void;
  drawDrainageAreas(areas: readonly DrainageArea[]): void;
  /**
   * Greys the reservoirs a `where` clause excludes, and leaves them on the
   * map. Pass null to clear. Set on the layer rather than on the layer view:
   * the layer view inherits it, and the layer exists before the view that
   * draws it does -- so a filter chosen while the map is still starting is
   * applied rather than dropped.
   */
  setFilter(where: string | null): void;
}

/** What excluded reservoirs look like: present, readable, clearly not chosen. */
const EXCLUDED_EFFECT = "grayscale(100%) opacity(35%)";

type HitGraphic = { attributes?: Record<string, unknown> };

type LayerView = { highlight(target: unknown, options?: { name?: string }): { remove(): void } };

type MapElement = HTMLElement & {
  map?: ArcGISMap | null;
  basemap?: unknown;
  animationsDisabled?: boolean;
  view?: { whenLayerView(layer: unknown): Promise<unknown> };
  hitTest(target: { x: number; y: number }, options?: { include?: unknown }): Promise<{
    results: { type: string; graphic?: HitGraphic }[];
  }>;
};

interface ScreenPoint { x: number; y: number }
interface PointerDetail extends ScreenPoint { screenPoint?: ScreenPoint }

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

function showMissingBasemap(): void {
  const notice = document.createElement("calcite-notice");
  notice.setAttribute("kind", "warning");
  notice.setAttribute("open", "");
  notice.setAttribute("icon", "");
  const title = document.createElement("div");
  title.slot = "title";
  title.textContent = "Map background is unavailable";
  const message = document.createElement("div");
  message.slot = "message";
  message.textContent = "Reservoirs and drainage areas are still shown from local data.";
  notice.append(title, message);
  elementById("map-host").append(notice);
}

/* The pointer half of selection. The keyboard half is the reservoir list in
 * the storage summary, which is a real focusable control rather than a
 * keyboard trap over a canvas -- and it works in the one environment the
 * canvas does not, a hidden or headless browser, where `hitTest` never
 * settles because the render loop that resolves it never runs. */
function eventPoint(event: Event): ScreenPoint | null {
  const detail = (event as CustomEvent<PointerDetail>).detail;
  const point = detail?.screenPoint ?? detail;
  return Number.isFinite(point?.x) && Number.isFinite(point?.y) ? point : null;
}

function hideMapHover(): void {
  const card = elementById<HTMLElement>("map-hover");
  card.hidden = true;
  card.replaceChildren();
}

function showMapHover(reservoir: Reservoir, point: ScreenPoint): void {
  const card = elementById<HTMLElement>("map-hover");
  const heading = document.createElement("strong");
  heading.textContent = reservoir.name;
  const summary = document.createElement("span");
  summary.textContent = `${formatPercent(headlinePercent(reservoir))} full · ` +
    `Reading ${formatDate(reservoir.as_of)}`;
  card.replaceChildren(heading, summary);
  card.hidden = false;

  requestAnimationFrame(() => {
    const stage = card.parentElement;
    if (!stage || card.hidden) return;
    const left = Math.max(8, Math.min(point.x + 12, stage.clientWidth - card.offsetWidth - 8));
    const top = Math.max(8, Math.min(point.y + 12, stage.clientHeight - card.offsetHeight - 8));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  });
}

function wirePointerSelection(element: MapElement, selection: SelectionStore): void {
  element.addEventListener("arcgisViewClick", (event) => {
    const screenPoint = eventPoint(event);
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

/** One hit test per animation frame, with stale async answers discarded. */
function wirePointerHover(
  element: MapElement,
  drawn: () => readonly Reservoir[],
  layerView: () => LayerView | null
): void {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  let queued: ScreenPoint | null = null;
  let frame = 0;
  let request = 0;
  let highlight: { remove(): void } | null = null;

  /* The SDK's own emphasis, on the layer view, rather than a fourth circle
   * drawn on a graphics layer: `temporary` is the named highlight the SDK
   * ships pre-configured for exactly this, so hover emphasis matches the
   * platform instead of being a second opinion about what hover looks like.
   * A hover card can be shown without it -- the highlight needs a layer
   * view, which never arrives in a hidden pane. */
  const emphasize = (graphic: HitGraphic | undefined): void => {
    highlight?.remove();
    highlight = null;
    const view = layerView();
    if (!view || !graphic) return;
    try {
      highlight = view.highlight(graphic, { name: "temporary" });
    } catch {
      // An emphasis the view refuses is not worth losing the hover card over.
      highlight = null;
    }
  };

  const clear = (): void => {
    emphasize(undefined);
    hideMapHover();
  };

  element.addEventListener("arcgisViewPointerMove", (event) => {
    queued = eventPoint(event);
    if (!queued || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const point = queued;
      queued = null;
      if (!point) return;
      const current = ++request;
      void element.hitTest(point).then((response) => {
        if (current !== request) return;
        const hit = response.results.find((result) =>
          typeof result.graphic?.attributes?.[NAME_FIELD] === "string");
        const name = hit?.graphic?.attributes?.[NAME_FIELD];
        const reservoir = typeof name === "string" ? findReservoir(drawn(), name) : null;
        emphasize(reservoir ? hit?.graphic : undefined);
        if (reservoir) showMapHover(reservoir, point);
        else hideMapHover();
      }).catch(() => clear());
    });
  });
  element.addEventListener("arcgisViewPointerLeave", () => {
    request += 1;
    queued = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    clear();
  });
  element.addEventListener("arcgisViewClick", clear);
}

export async function loadMap(
  selection: SelectionStore,
  boundary: Promise<UtahBoundary | null> = Promise.resolve(null)
): Promise<MapController> {
  const [resolution, utahBoundary] = await Promise.all([resolveBasemap(), boundary]);

  /* The SDK's `basemap` property is typed as basemap *properties*, and an
   * already-constructed Basemap does not satisfy that shape under
   * `exactOptionalPropertyTypes`: its own optional members are
   * `T | null | undefined` where the property type accepts only `T | null`.
   * The SDK passes an instance straight through at runtime, so the one
   * assignment is narrowed here rather than the whole map being untyped. */
  const map = new ArcGISMap();
  if (resolution.resource) {
    (map as { basemap: unknown }).basemap = resolution.resource;
  }
  const maskLayer = createMaskLayer(utahBoundary ?? undefined);
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
  let drainageLayer: GraphicsLayer | null = null;
  let reservoirLayer: FeatureLayer | null = null;
  let reservoirLayerView: LayerView | null = null;
  let pendingFilter: string | null = null;
  let drawn: readonly Reservoir[] = [];
  wirePointerSelection(element, selection);
  wirePointerHover(element, () => drawn, () => reservoirLayerView);
  elementById("map-host").replaceChildren(element);
  if (!resolution.resource) showMissingBasemap();
  else if (resolution.degraded) showDegradedBasemap(resolution.name);

  const status: MapStatus = {
    basemap: resolution.resource !== null,
    basemapDegraded: resolution.degraded,
    masked: map.layers.includes(maskLayer),
    boundaryPoints: (utahBoundary ?? []).reduce((sum, polygon) =>
      sum + (polygon[0]?.length ?? 0), 0),
    drainageAreas: 0,
    reservoirsDrawn: 0,
    reservoirSymbols: 0,
    filtered: false
  };
  selection.subscribe((name) => {
    showHighlight(highlightLayer, findReservoir(drawn, name), drawn);
  });

  function applyFilter(where: string | null): void {
    // Held until the layer exists rather than dropped: the reader can reach
    // the controls before the first draw finishes.
    pendingFilter = where;
    status.filtered = where !== null;
    if (!reservoirLayer) return;
    reservoirLayer.featureEffect = where === null
      ? null
      : { filter: { where }, excludedEffect: EXCLUDED_EFFECT };
  }

  return {
    status,
    drawReservoirs(reservoirs) {
      const result = createReservoirLayer(reservoirs);
      drawn = reservoirs;
      reservoirLayer = result.layer;
      map.add(result.layer);
      // Added after the points so a selected reservoir is not covered by
      // the reservoir drawn next to it.
      map.add(highlightLayer);
      status.reservoirsDrawn = result.drawn;
      status.reservoirSymbols = result.symbols;
      if (pendingFilter !== null) applyFilter(pendingFilter);
      /* The layer view is what the hover highlight needs, and it only ever
       * arrives in a browser that is actually painting: `whenLayerView` is
       * settled by the same render loop `hitTest` is, which does not run in
       * a hidden pane. Nothing else waits on it. */
      void element.view?.whenLayerView(result.layer).then((view) => {
        reservoirLayerView = view as LayerView;
      }).catch((error: unknown) => {
        console.warn("The map cannot emphasize a reservoir under the pointer:", error);
      });
    },
    setFilter: applyFilter,
    drawDrainageAreas(areas) {
      if (drainageLayer) map.remove(drainageLayer);
      drainageLayer = createDrainageLayer(areas);
      // Under the reservoirs and over the basemap: outlines are context.
      map.add(drainageLayer, 1);
      status.drainageAreas = areas.length;
    }
  };
}
