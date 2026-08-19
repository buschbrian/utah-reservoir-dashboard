/*
 * What every gallery-less view map shares: the element shape, the control
 * set, the framing and navigation bounds, the bounded wait for a WebGL
 * view, and the palette-to-fill conversion. Written once for the snow and
 * drought maps -- the framing especially, because a written zoom snaps to
 * an integer and one step out spans a continent, and that lesson should not
 * need relearning per map.
 *
 * The framing is deliberately the storage map's own: the same region
 * extent, the same minimum and maximum zoom, and the same refusal to leave
 * the region. Three maps of the same drainage areas that each open
 * at a different box are three maps a reader cannot compare by flipping
 * between them, and a map that can be panned into the Pacific is one a
 * reader can only recover from by reloading the page.
 */
import "@arcgis/map-components/components/arcgis-fullscreen";
import "@arcgis/map-components/components/arcgis-basemap-gallery";
import "@arcgis/map-components/components/arcgis-compass";
import "@arcgis/map-components/components/arcgis-expand";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scale-bar";
import "@arcgis/map-components/components/arcgis-zoom";

import type ArcGISMap from "@arcgis/core/Map";
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, drainageExtent, regionExtent } from "../viz/extent";
import { createHoverCard, type HoverMapElement } from "./map-hover";

export interface ViewMapElement extends HoverMapElement {
  map?: ArcGISMap | null | undefined;
  extent?: unknown;
  constraints?: unknown;
  view?: {
    ready?: boolean;
    container?: HTMLElement | null | undefined;
    constraints?: { snapToZoom?: boolean };
    whenLayerView?(layer: unknown): Promise<unknown>;
    goTo?(target: unknown, options?: { animate?: boolean }): Promise<unknown>;
  } | null | undefined;
}

/**
 * A view map mounted in its host, framed and controlled like the storage
 * map, with its hover card already in the host beside it.
 *
 * The card is a sibling of the map rather than a child: the component owns
 * its own subtree and replaces it, and the host is the positioned box the
 * card is placed inside of. The host must therefore be `position: relative`
 * -- `.view-map-host` is, which is why this takes the host rather than
 * returning a loose element for the caller to place.
 */
export function createViewMap(
  host: HTMLElement,
  options: { label: string; cardId: string }
): { element: ViewMapElement; card: HTMLElement } {
  const element = document.createElement("arcgis-map") as ViewMapElement;
  element.setAttribute("aria-label", options.label);
  /* The opening box, set before the view resolves rather than eased into
   * afterwards. The target is a fixed rectangle, not something measured
   * from data that has to arrive first, so there is nothing to wait for --
   * and a written zoom could not do this anyway, because the component
   * snaps fractional zoom and one whole step out spans a continent.
   *
   * The drainage areas exactly, not the storage map's one-level-out box:
   * these cards are wide and short, an extent is a minimum, and asking a
   * short box to contain that much latitude pushes the view out past
   * 1:18,000,000. `drainageExtent` records the measurement. */
  element.extent = { type: "extent", ...drainageExtent() };
  element.constraints = {
    /* Off, so a framing that is not a whole zoom level survives being
     * applied. On, the component rounds it and the fourteen areas either
     * crowd the edges or lose half the region. */
    snapToZoom: false,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    /* The storage map's own bounds, unchanged: where a map opens depends on
     * the box, but where a reader is allowed to go should not. */
    geometry: { type: "extent", ...regionExtent() }
  };
  /* Two clusters, split by what the control does, because these cards do
   * not have the storage map's height. All six controls in one top-right
   * stack is the storage map's arrangement, and it measures about 240px --
   * fine down the edge of a full-viewport map, most of the height of a
   * 416px card, and past it once the phone layout shortens the card
   * further. A stack the card cannot hold does not scroll; it collides
   * with the scale bar in the corner below it.
   *
   * So the right edge keeps only navigation -- zoom, then home, then
   * compass, the things a reader lost in the map reaches for -- and the
   * appearance controls (the background gallery and fullscreen) take the
   * top-left corner, which on these cards nothing else owns: the legend
   * sits at the *bottom* left, and the two meet only if the card shrinks
   * below anything the suite tests. Zoom is included at all because a map
   * component adds none of its own: without it the only way to zoom is the
   * scroll wheel, which is no way at all on a trackpad inside a scrolling
   * page.
   *
   * Locate is deliberately not here. These views are constrained to the
   * drainage region -- a reader outside it (which is nearly every reader of
   * a public dashboard) taps it and the view either refuses or leaves the
   * region it cannot leave; an error with a button on it. The storage map
   * keeps it for the reader standing on a reservoir; a 416px context card
   * does not need to know where the reader is standing.
   *
   * The basemap gallery is here now, and was left out before for a reason
   * that has since been dealt with: these maps follow the page theme, so a
   * background the reader picks had to be protected from the next theme
   * swap. `followThemeBasemap` now holds the identity of what it last
   * assigned and stands down once the map is wearing something else -- the
   * same guard the storage map has always had. */
  element.innerHTML = `
    <arcgis-zoom slot="top-right"></arcgis-zoom>
    <arcgis-home slot="top-right"></arcgis-home>
    <arcgis-compass slot="top-right"></arcgis-compass>
    <arcgis-expand slot="top-left" close-on-esc
      expand-icon="basemap" expand-tooltip="Map background">
      <arcgis-basemap-gallery></arcgis-basemap-gallery>
    </arcgis-expand>
    <arcgis-fullscreen slot="top-left"></arcgis-fullscreen>
    <arcgis-scale-bar slot="bottom-right" unit="dual"></arcgis-scale-bar>`;
  const card = createHoverCard(options.cardId);
  host.replaceChildren(element, card);
  return { element, card };
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
