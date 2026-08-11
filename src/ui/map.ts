import "@esri/calcite-components/components/calcite-notice";
import "@arcgis/map-components/components/arcgis-fullscreen";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scale-bar";
import "@arcgis/map-components/components/arcgis-zoom";

import ArcGISMap from "@arcgis/core/Map";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import type GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import { resolveBasemap } from "../arcgis/basemaps";
import type { DrainageArea, UtahBoundary } from "../data/boundaries";
import { findReservoir, type SelectionStore } from "../state/selection";
import type { NullableNumber, Reservoir } from "../types";
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, regionExtent, selectionTarget } from "../viz/extent";
import { formatDate, formatPercent } from "../viz/format";
import { headlinePercent } from "../viz/symbols";
import { elementById } from "./dom";
import { hoverPosition } from "./hover";
import {
  NAME_FIELD,
  createDrainageLayer,
  createHighlightLayer,
  createMaskLayer,
  createReservoirLayer,
  showHighlight,
  updateReservoirPercents
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
  /** True when navigation is held inside the region (ADR-009). */
  navigationBounds: boolean;
  /** The closest the reader is allowed to zoom out. */
  minZoom: number;
}

export interface MapController {
  status: MapStatus;
  /** `percentOf` decides what each fill shows -- today's reading, or a
   * month the reader has moved the slider to. */
  drawReservoirs(
    reservoirs: readonly Reservoir[],
    percentOf?: (reservoir: Reservoir) => NullableNumber
  ): void;
  drawDrainageAreas(areas: readonly DrainageArea[]): void;
  /**
   * Greys the reservoirs a `where` clause excludes, and leaves them on the
   * map. Pass null to clear. Set on the layer rather than on the layer view:
   * the layer view inherits it, and the layer exists before the view that
   * draws it does -- so a filter chosen while the map is still starting is
   * applied rather than dropped.
   */
  setFilter(where: string | null): void;
  /**
   * Redraws at new percentages without replacing the layer. Use this for
   * anything that changes what a reservoir shows; `drawReservoirs` is for
   * changing *which* reservoirs there are.
   */
  setPercents(percentOf: (reservoir: Reservoir) => NullableNumber): void;
}

/** What excluded reservoirs look like: present, readable, clearly not chosen. */
const EXCLUDED_EFFECT = "grayscale(100%) opacity(35%)";

type HitGraphic = { attributes?: Record<string, unknown> };

type LayerView = { highlight(target: unknown, options?: { name?: string }): { remove(): void } };

interface GoToTarget { center: [number, number]; zoom: number }

interface ViewPadding { top: number; right: number; bottom: number; left: number }

/**
 * How much of the map each shell panel is covering.
 *
 * The shell draws its panels *over* the map (`content-behind`), so the map's
 * centre is the centre of a rectangle whose left third is behind the storage
 * summary. Without this the reservoirs sit under the panel and everything
 * that frames the view -- the starting extent, Home, and the ease toward a
 * selected reservoir -- centres on a point the reader cannot see.
 */
function panelPadding(): ViewPadding {
  const stage = document.querySelector(".map-stage")?.getBoundingClientRect();
  const overlap = (id: string): number => {
    const panel = document.getElementById(id)?.getBoundingClientRect();
    if (!stage || !panel || panel.width === 0) return 0;
    // Only the part actually over the map counts; a collapsed panel is zero
    // wide and a sheet is at the bottom, which the map does not centre on.
    return Math.max(0, Math.min(panel.right, stage.right) - Math.max(panel.left, stage.left));
  };
  return { top: 0, right: overlap("detail-panel"), bottom: 0, left: overlap("start-panel") };
}

type MapElement = HTMLElement & {
  map?: ArcGISMap | null;
  basemap?: unknown;
  animationsDisabled?: boolean;
  constraints?: unknown;
  zoom?: number;
  goTo?(target: GoToTarget, options?: { animate?: boolean; duration?: number; easing?: string }):
    Promise<unknown>;
  extent?: unknown;
  view?: {
    whenLayerView(layer: unknown): Promise<unknown>;
    ready?: boolean;
    zoom?: number;
    padding?: ViewPadding;
    goTo?(target: GoToTarget, options?: { animate?: boolean; duration?: number; easing?: string }):
      Promise<unknown>;
  };
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

/**
 * How long the map may claim to be starting before it has to say something.
 *
 * Generous: this is a WebGL view fetching a basemap, not a JSON file. The
 * point is that there is a terminal state at all, not that it is prompt.
 */
const VIEW_READY_TIMEOUT_MS = 25000;

/** The notice the watchdog raises, so a later ready can take it back down. */
const SLOW_NOTICE_ID = "map-slow-notice";

function showSlowMap(): void {
  if (document.getElementById(SLOW_NOTICE_ID)) return;
  const notice = document.createElement("calcite-notice");
  notice.id = SLOW_NOTICE_ID;
  notice.setAttribute("kind", "warning");
  notice.setAttribute("open", "");
  notice.setAttribute("icon", "");
  const title = document.createElement("div");
  title.slot = "title";
  title.textContent = "The map is slow to start";
  const message = document.createElement("div");
  message.slot = "message";
  message.textContent =
    "Storage figures are in the summary. The map appears when it is ready.";
  notice.append(title, message);
  elementById("map-host").append(notice);
}

function clearSlowMap(): void {
  document.getElementById(SLOW_NOTICE_ID)?.remove();
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
  const stage = card.parentElement;
  if (!stage) return;
  const position = hoverPosition(point,
    { width: stage.clientWidth, height: stage.clientHeight },
    { width: card.offsetWidth, height: card.offsetHeight });
  card.style.left = `${position.left}px`;
  card.style.top = `${position.top}px`;
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
  /* The opening view is the derived region: one zoom level out from the
   * drainage-area polygons, the same box the two production pages open at.
   * Set here rather than eased into after the layer loads -- the target is a
   * fixed box, not something that has to be measured from the data, so
   * there is nothing to wait for and no race to lose. */
  element.extent = { type: "extent", ...regionExtent() };
  /* Both production maps already refuse to leave this region. Without it a
   * reader could pan a Utah dashboard into the middle of the Pacific and
   * find an empty basemap with no way back except reloading. `snapToZoom`
   * off so an eased `goTo` lands where it was asked to rather than at the
   * nearest whole level. */
  element.constraints = {
    snapToZoom: false,
    minZoom: MAP_MIN_ZOOM,
    // Deep enough to read an individual dam.
    maxZoom: MAP_MAX_ZOOM,
    geometry: { type: "extent", ...regionExtent() }
  };
  element.setAttribute("aria-label", "Interactive map of Utah and connected drainage areas");
  element.map = map;
  element.animationsDisabled = reducedMotionQuery.matches;
  /* Every tool on the right. The left of the map is the storage summary's
   * lane: the shell draws its panels over the map (`content-behind`), so a
   * control at the top left sat underneath the panel and only the fullscreen
   * button was reachable. Zoom is included because the component set does
   * not add one -- `view.ui.components` is empty for a map component, so
   * without this there is no way to zoom but the scroll wheel. */
  element.innerHTML = `
    <arcgis-zoom slot="top-right"></arcgis-zoom>
    <arcgis-home slot="top-right"></arcgis-home>
    <arcgis-fullscreen slot="top-right"></arcgis-fullscreen>
    <arcgis-scale-bar slot="bottom-right" unit="dual"></arcgis-scale-bar>`;
  element.addEventListener("arcgisViewReadyChange", () => {
    /* Not `{ once: true }` any more, and guarded on the view's own `ready`
     * flag: this event also fires for the transition *out* of ready, which
     * is what once-only listening quietly turned into "the first thing that
     * happened", whatever it was. */
    if (!element.view?.ready) return;
    settleMapHost();
    syncPadding();
    if (pendingSelection) easeToSelection(pendingSelection);
  });
  element.addEventListener("arcgisViewReadyError", () => {
    settleMapHost();
    showMapMessage(
      "The map could not start",
      "Reservoir data remains available in the summary and statewide overview.",
      "alert"
    );
  }, { once: true });

  /* `aria-busy` reports one fact -- the map is still starting -- so every
   * way of no longer starting has to clear it. It used to be cleared only
   * on ready, and the visible loader is replaced by the map element before
   * that, so a view that neither readied nor errored left a screen reader
   * told "busy" indefinitely with nothing to read. */
  const watchdog = setTimeout(() => {
    if (element.view?.ready) return;
    elementById("map-host").setAttribute("aria-busy", "false");
    showSlowMap();
  }, VIEW_READY_TIMEOUT_MS);

  function settleMapHost(): void {
    clearTimeout(watchdog);
    clearSlowMap();
    elementById("map-host").setAttribute("aria-busy", "false");
  }
  let drainageLayer: GraphicsLayer | null = null;
  let reservoirLayer: FeatureLayer | null = null;
  let reservoirLayerView: LayerView | null = null;
  let pendingFilter: string | null = null;
  let pendingSelection: Reservoir | null = null;
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
    filtered: false,
    navigationBounds: (element.constraints as { geometry?: unknown } | undefined)
      ?.geometry !== undefined,
    minZoom: MAP_MIN_ZOOM
  };
  /**
   * Eases the view toward the selected reservoir.
   *
   * Skipped entirely under reduced motion -- not shortened, skipped: the
   * view still moves, it just arrives. `animationsDisabled` already tells
   * the component the same thing, and this says it at the call as well so
   * the behaviour does not depend on which of the two the SDK honours.
   *
   * A failed `goTo` is swallowed. It rejects when it is interrupted by the
   * next one, which is exactly what happens when a reader clicks down the
   * list, and an interrupted animation is not an error worth a console.
   */
  function easeToSelection(reservoir: Reservoir | null): void {
    /* Held rather than dropped. A shared link selects its reservoir as soon
     * as the data resolves, which is routinely before the view is ready --
     * and `goTo` on a view that is not ready rejects, which this swallows,
     * so the link silently opened the details panel and left the map where
     * it started. The ready handler replays whatever is pending. */
    pendingSelection = reservoir;
    if (!reservoir) return;
    const view = element.view;
    if (!view?.ready) return;
    const move = element.goTo?.bind(element) ?? view.goTo?.bind(view);
    if (!move) return;
    const target = selectionTarget(reservoir, view?.zoom ?? element.zoom);
    const animate = !reducedMotionQuery.matches;
    void Promise.resolve(move(target, animate ? { animate: true, duration: 550, easing: "ease-in-out" } : { animate: false }))
      .catch(() => undefined);
  }

  selection.subscribe((name) => {
    const reservoir = findReservoir(drawn, name);
    showHighlight(highlightLayer, reservoir, drawn);
    easeToSelection(reservoir);
  });

  /* Kept current: the panels open and close, and the window resizes. A
   * padding that is right only at load frames the map around a panel that
   * is no longer there. */
  function syncPadding(): void {
    const view = element.view;
    if (!view?.ready) return;
    view.padding = panelPadding();
  }

  const shellResize = new ResizeObserver(() => syncPadding());
  for (const id of ["start-panel", "detail-panel"]) {
    const panel = document.getElementById(id);
    if (panel) shellResize.observe(panel);
  }

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
    drawReservoirs(reservoirs, percentOf) {
      // Replaced, not added to. The scope control redraws, and a second
      // call used to leave the first layer underneath the new one: the map
      // then showed reservoirs that were no longer in scope, drawn by a
      // renderer nothing could reach to filter or grey.
      if (reservoirLayer) map.remove(reservoirLayer);
      reservoirLayerView = null;
      const result = createReservoirLayer(reservoirs, percentOf);
      drawn = reservoirs;
      reservoirLayer = result.layer;
      map.add(result.layer);
      // Added after the points so a selected reservoir is not covered by
      // the reservoir drawn next to it.
      if (!map.layers.includes(highlightLayer)) map.add(highlightLayer);
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
    setPercents(percentOf) {
      if (!reservoirLayer) return;
      updateReservoirPercents(reservoirLayer, drawn, percentOf);
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
