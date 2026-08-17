import "@esri/calcite-components/components/calcite-notice";
import "@arcgis/map-components/components/arcgis-basemap-gallery";
import "@arcgis/map-components/components/arcgis-compass";
import "@arcgis/map-components/components/arcgis-expand";
import "@arcgis/map-components/components/arcgis-locate";
import "@arcgis/map-components/components/arcgis-fullscreen";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scale-bar";
import "@arcgis/map-components/components/arcgis-zoom";

import ArcGISMap from "@arcgis/core/Map";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import type GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import { resolveBasemap } from "../arcgis/basemaps";
import { createWatershedLayer, WATERSHED_NAME_FIELD } from "../arcgis/watershed-layers";
import { followBasemapReference } from "../arcgis/basemap-reference";
import { THEME_CHANGE_EVENT, effectiveThemeNow } from "./theme";
import type { DrainageArea, UtahBoundary } from "../data/boundaries";
import { findReservoir, type SelectionStore } from "../state/selection";
import type { NullableNumber, Reservoir } from "../types";
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, regionExtent, selectionTarget } from "../viz/extent";
import { storageByArea } from "../drought-model";
import { elementById } from "./dom";
import { drainageAreaLines, storageReservoirLines } from "./hover-content";
import { reservoirFromHits, type GraphicHit, type HitGraphic } from "./hit";
import {
  eventPoint,
  wireMapHover,
  type HighlightView,
  type HoverResolution,
  type ScreenPoint
} from "./map-hover";

import {
  DRAINAGE_NAME_FIELD,
  createDrainageLayer,
  createHighlightLayer,
  drainageLabelingInfo,
  drainageRenderer,
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
  /* Added, never replacing `basemap`: that field says whether the map has a
   * background at all, this says which one, and one field cannot answer
   * both without the readiness signal making two claims about one word. */
  basemapName: string | null;
  /** Basemap reference layers moved below this project's own layers. */
  basemapReferenceSunk: number;

  masked: boolean;
  boundaryPoints: number;
  drainageAreas: number;
  /** Drainage-area background text symbols, one per HUC6. */
  drainageLabels: number;
  /** True while drainage-area text is below the reservoir symbols. */
  drainageLabelsUnderReservoirs: boolean;
  drainageLabelsDeconflicted: boolean;
  reservoirsDrawn: number;
  /** Symbols the reservoir renderer holds -- see `ReservoirLayerResult`. */
  reservoirSymbols: number;
  /** True while the reservoir layer is carrying its names. Separate from
   * `reservoirsDrawn`: a layer draws points whether or not it labels them. */
  reservoirLabels: boolean;
  /** True when the map is greying reservoirs the reader filtered out. */
  filtered: boolean;
  /* True while the selection ring is drawn over the reservoirs rather than
   * under them. A separate fact from `reservoirsDrawn`: the ring was added
   * to the map once, so it sat above the opening layer and below every
   * layer that replaced it, and nothing counted could tell. */
  selectionOnTop: boolean;
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
  padding?: ViewPadding;
  zoom?: number;
  goTo?(target: GoToTarget, options?: { animate?: boolean; duration?: number; easing?: string }):
    Promise<unknown>;
  extent?: unknown;
  view?: {
    whenLayerView(layer: unknown): Promise<unknown>;
    container?: HTMLElement | null;
    ready?: boolean;
    zoom?: number;
    padding?: ViewPadding;
    constraints?: {
      geometry?: unknown;
      effectiveMinZoom?: number;
    };
    goTo?(target: GoToTarget, options?: { animate?: boolean; duration?: number; easing?: string }):
      Promise<unknown>;
  };
  hitTest(target: { x: number; y: number }, options?: { include?: unknown }): Promise<{
    results: { type: string; graphic?: HitGraphic; layer?: { id?: string } | null }[];
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

function wirePointerSelection(
  element: MapElement,
  selection: SelectionStore,
  drawn: () => readonly Reservoir[],
  layer: () => FeatureLayer | null
): void {
  let request = 0;
  /* The immediate event is intended for direct feedback. Waiting for the
   * delayed click made the opening map feel inert, especially while the
   * component was still settling its own gesture recognizers. */
  element.addEventListener("arcgisViewImmediateClick", (event) => {
    const screenPoint = eventPoint(event);
    if (!screenPoint) return;
    const targetLayer = layer();
    if (!targetLayer) return;
    const current = ++request;
    void element.hitTest(screenPoint, { include: targetLayer }).then((response) => {
      if (current !== request || layer() !== targetLayer) return;
      const hit = reservoirFromHits(drawn(), response.results);
      // Clicking the basemap clears the selection: the reader pointed at
      // something that is not a reservoir, and leaving the old details open
      // makes the panel describe a reservoir nobody is looking at.
      selection.set(hit?.reservoir.name ?? null, { source: "map" });
    }).catch((error: unknown) => {
      console.warn("The map could not answer a pointer selection:", error);
    });
  });
}

export async function loadMap(
  selection: SelectionStore,
  boundary: Promise<UtahBoundary | null> = Promise.resolve(null)
): Promise<MapController> {
  const [resolution, utahBoundary] = await Promise.all(
    [resolveBasemap(effectiveThemeNow()), boundary]);

  /* The SDK's `basemap` property is typed as basemap *properties*, and an
   * already-constructed Basemap does not satisfy that shape under
   * `exactOptionalPropertyTypes`: its own optional members are
   * `T | null | undefined` where the property type accepts only `T | null`.
   * The SDK passes an instance straight through at runtime, so the one
   * assignment is narrowed here rather than the whole map being untyped. */
  const map = new ArcGISMap();
  /* The background this module chose last, as an object identity. The theme
   * listener below swaps the canvas with the theme only while this is still
   * what the map is wearing -- a background the reader picked from the
   * gallery is a choice, and a theme toggle must not overrule it. */
  let assignedBasemap: unknown = resolution.resource;
  if (resolution.resource) {
    (map as { basemap: unknown }).basemap = resolution.resource;
  }
  const maskLayer = createMaskLayer(utahBoundary ?? undefined);
  const highlightLayer = createHighlightLayer();
  map.add(maskLayer);
  /* The basemap's boundaries and place names belong under this project's
   * data, not over it. See `arcgis/basemap-reference.ts` -- this is the line
   * that stops a borrowed grey state line drawing through Flaming Gorge. */
  /* Watched, not applied once. This map has a basemap gallery, so the
   * reader can replace the basemap without going through any of the code
   * that resolved the first one. */
  /* Declared before the call: the callback runs synchronously during the
   * first application, so initialising from it reads both this and `status`
   * inside their temporal dead zones. */
  let referenceSunk = 0;
  let mapStatus: MapStatus | null = null;
  followBasemapReference(map, "sink", (count) => {
    referenceSunk = count;
    if (mapStatus) mapStatus.basemapReferenceSunk = count;
  });

  const element = document.createElement("arcgis-map") as MapElement;
  /* The comparison MapView supplies padding in its constructor, before its
   * opening extent is resolved. Do the same through the map component's
   * equivalent property: setting padding only after ready makes the SDK fit
   * the region behind the summary panel and then shift an already-resolved
   * view. */
  element.padding = panelPadding();
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
  /* The SDK's own basemap gallery, in the SDK's own expand, rather than a
   * select in the storage summary: the background belongs to the map, and a
   * second control panel inside the panel that holds the analysis controls
   * made the reader look in two places for map settings. The gallery also
   * brings its own list, so the four backgrounds this shell used to name by
   * hand are no longer a list that can go stale against the SDK. */
  element.innerHTML = `
    <arcgis-zoom slot="top-right"></arcgis-zoom>
    <arcgis-home slot="top-right"></arcgis-home>
    <arcgis-compass slot="top-right"></arcgis-compass>
    <arcgis-locate slot="top-right"></arcgis-locate>
    <arcgis-expand slot="top-right" id="basemap-expand" close-on-esc
      expand-icon="basemap" expand-tooltip="Map background">
      <arcgis-basemap-gallery></arcgis-basemap-gallery>
    </arcgis-expand>
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
    syncConstraintStatus();
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
  let drainageLayer: FeatureLayer | null = null;
  let drainageLabelLayer: GraphicsLayer | null = null;
  let reservoirLayer: FeatureLayer | null = null;
  let reservoirLayerView: HighlightView | null = null;
  let pendingFilter: string | null = null;
  let pendingSelection: Reservoir | null = null;
  let drawn: readonly Reservoir[] = [];
  /* Rebuilt with every draw rather than per hover: the hover path runs on
   * an animation frame, and rolling up every reservoir there would do the
   * same arithmetic sixty times a second to answer one question. */
  let areaStorage = storageByArea([]);
  wirePointerSelection(element, selection, () => drawn, () => reservoirLayer);
  /* Hover, on the shared wiring the snow and drought maps also use. The
   * card is the one the shell template already places inside `.map-stage`;
   * the include is the layer itself rather than an array, and the browser
   * gate asserts that identity -- a hit test that is not limited to the
   * reservoirs answers with drainage polygons the reader cannot select. */
  wireMapHover(element, {
    card: elementById<HTMLElement>("map-hover"),
    /* Both layers, reservoirs first, so a reservoir standing on a boundary
     * answers as a reservoir. Limited to these two: without an include, a
     * hit test also answers with the mask and the basemap, and the reader
     * would get a card for pointing at Nevada. */
    include: () => (reservoirLayer
      ? (drainageLayer ? [reservoirLayer, drainageLayer] : [reservoirLayer])
      : null),
    layerView: () => reservoirLayerView,
    resolve: (results: readonly GraphicHit[]): HoverResolution | null => {
      const hit = reservoirFromHits(drawn, results);
      if (hit) {
        return {
          content: {
            heading: hit.reservoir.name,
            lines: storageReservoirLines(hit.reservoir)
          },
          graphic: hit.graphic
        };
      }
      /* The drainage area under the pointer, when no reservoir is. The
       * outlines carried a name and nothing else until now; this is the one
       * number a reader wants from an area, and it is the same arithmetic
       * the drought view joins storage by. */
      for (const result of results) {
        const name = result.graphic?.attributes?.[DRAINAGE_NAME_FIELD];
        const huc6 = result.graphic?.attributes?.["huc6"];
        if (typeof name !== "string" || typeof huc6 !== "string") continue;
        return {
          content: {
            heading: name,
            lines: drainageAreaLines(areaStorage.get(huc6))
          }
          /* No `graphic`: the emphasis is the reservoir layer view's named
           * highlight, and lighting up a whole drainage polygon under the
           * pointer would be a much louder answer than the question. */
        };
      }
      return null;
    }
  });
  elementById("map-host").replaceChildren(element);
  if (!resolution.resource) showMissingBasemap();
  else if (resolution.degraded) showDegradedBasemap(resolution.name);

  /* The background re-resolves with the theme, unless the reader has chosen
   * one from the gallery -- detected by the map no longer wearing the one
   * this module assigned. Oceans leads both chains, so this normally lands
   * back on the same background; what it protects is the fallback, which is
   * still theme-aware a step down. Sequenced through one in-flight promise
   * so two quick toggles cannot race their resolutions into the wrong
   * order. */
  let themeSwap: Promise<void> = Promise.resolve();
  document.addEventListener(THEME_CHANGE_EVENT, () => {
    themeSwap = themeSwap.then(async () => {
      if (!assignedBasemap || map.basemap !== assignedBasemap) return;
      const next = await resolveBasemap(effectiveThemeNow());
      if (!next.resource || map.basemap !== assignedBasemap) return;
      (map as { basemap: unknown }).basemap = next.resource;
      assignedBasemap = next.resource;
      status.basemapName = next.name;
      status.basemapDegraded = next.degraded;
    });
  });

  const status: MapStatus = {
    basemap: resolution.resource !== null,
    basemapDegraded: resolution.degraded,
    basemapName: resolution.resource ? resolution.name : null,
    /* Reference layers moved out of the basemap and under this project's own
     * data. Its own field because a map that quietly stopped moving them
     * looks identical until someone sees a line through a reservoir. */
    basemapReferenceSunk: referenceSunk,
    masked: map.layers.includes(maskLayer),
    boundaryPoints: (utahBoundary ?? []).reduce((sum, polygon) =>
      sum + (polygon[0]?.length ?? 0), 0),
    drainageAreas: 0,
    drainageLabels: 0,
    drainageLabelsUnderReservoirs: false,
    drainageLabelsDeconflicted: false,
    reservoirsDrawn: 0,
    reservoirSymbols: 0,
    reservoirLabels: false,
    filtered: false,
    selectionOnTop: false,
    navigationBounds: (element.constraints as { geometry?: unknown } | undefined)
      ?.geometry !== undefined,
    minZoom: MAP_MIN_ZOOM
  };
  /* The callback above needs the status object, which does not exist until
   * here. Handing it over now keeps the field current on every later
   * basemap change without reading it before it is built. */
  mapStatus = status;

  function syncConstraintStatus(): void {
    const constraints = element.view?.constraints;
    if (!constraints) return;
    status.navigationBounds = constraints.geometry !== undefined
      && constraints.geometry !== null;
    if (Number.isFinite(constraints.effectiveMinZoom)) {
      status.minZoom = constraints.effectiveMinZoom as number;
    }
    if (window.__dashboardReady) {
      window.__dashboardReady.navigationBounds = status.navigationBounds;
      window.__dashboardReady.minZoom = status.minZoom;
    }
  }
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

  /* One fact, one formula, every reader. Both draw paths can reorder the
   * label and reservoir layers, so both go through here; computing it twice
   * is how the status field and the readiness field learn to disagree.
   *
   * Two facts now, because the guarantee changed rather than moved. The
   * first still asks the question ADR-030 asked -- is there drainage text
   * the map placed itself, below the reservoirs -- and answers no, because
   * the names come from the label engine. The second is the guarantee that
   * replaced it. Neither is derivable from the other: text symbols under
   * the reservoirs and engine placement are both ways of having names, and
   * a map with no names at all reports false to both. */
  function syncDrainageLabelOrder() {
    status.drainageLabelsUnderReservoirs = drainageLabelLayer !== null
      && reservoirLayer !== null
      && map.layers.indexOf(drainageLabelLayer) < map.layers.indexOf(reservoirLayer);
    status.drainageLabelsDeconflicted = drainageLayer !== null
      && drainageLabelLayer === null
      && (drainageLayer as { labelsVisible?: boolean }).labelsVisible === true;
    if (window.__dashboardReady) {
      window.__dashboardReady.drainageLabelsUnderReservoirs =
        status.drainageLabelsUnderReservoirs;
      window.__dashboardReady.drainageLabelsDeconflicted =
        status.drainageLabelsDeconflicted;
    }
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
      areaStorage = storageByArea(reservoirs);
      reservoirLayer = result.layer;
      map.add(result.layer);
      /* Added after the points so a selected reservoir is not covered by
       * the reservoir drawn next to it -- and re-added on every draw, not
       * only the first. Adding it once put it above the opening layer and
       * below every layer that replaced it, so the invariant this line
       * states held until the reader changed the scope and then silently
       * stopped holding. Removing a layer that is not on the map is a
       * no-op, and a graphics layer keeps its graphics across the move. */
      map.remove(highlightLayer);
      map.add(highlightLayer);
      status.reservoirsDrawn = result.drawn;
      status.reservoirSymbols = result.symbols;
      status.reservoirLabels = result.labelled;
      status.selectionOnTop =
        map.layers.indexOf(highlightLayer) > map.layers.indexOf(result.layer);
      if (window.__dashboardReady) {
        window.__dashboardReady.selectionOnTop = status.selectionOnTop;
      }
      syncDrainageLabelOrder();
      if (pendingFilter !== null) applyFilter(pendingFilter);
      /* The layer view is what the hover highlight needs, and it only ever
       * arrives in a browser that is actually painting: `whenLayerView` is
       * settled by the same render loop `hitTest` is, which does not run in
       * a hidden pane. Nothing else waits on it. */
      void element.view?.whenLayerView(result.layer).then((view) => {
        reservoirLayerView = view as HighlightView;
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
      if (drainageLabelLayer) map.remove(drainageLabelLayer);
      drainageLabelLayer = null;
      /*
       * Outlines and names from the hosted service, both placed by the label
       * engine. See `arcgis/watershed-layers.ts` for the transfer figures and
       * the new record for why this stops obeying ADR-030's layer order.
       *
       * The short of it: ADR-030 put the names in a text-symbol layer below
       * the reservoirs so a name could never cover a point, and recorded that
       * "a later denser geography would need a measured decluttering rule".
       * That geography is the reason this exists. Text symbols have no
       * deconfliction, so past a couple of dozen areas the names stop
       * covering reservoirs and start covering each other, which is worse.
       *
       * Counted from the mask rather than from zero: the basemap's own
       * reference layers are sunk to the bottom of this stack (ADR-042).
       */
      drainageLayer = createWatershedLayer({
        level: 6,
        codes: areas.map((area) => area.huc6),
        renderer: drainageRenderer(),
        labelingInfo: drainageLabelingInfo(WATERSHED_NAME_FIELD),
        labelsVisible: true
      });
      const base = map.layers.indexOf(maskLayer) + 1;
      map.add(drainageLayer, base);
      status.drainageAreas = areas.length;
      status.drainageLabels = areas.length;
      syncDrainageLabelOrder();
    }
  };
}
