/*
 * The reservoir page's aerial image: one small satellite view, centred on
 * the water.
 *
 * Every other surface here draws its own subject over a background chosen
 * to stay out of the way. This card is the opposite: the imagery *is* the
 * subject -- the dam, the shore, the water's actual extent against the land
 * around it -- so it asks for Esri's World Imagery directly rather than for
 * a themed canvas. The tile service it reaches is already named in every
 * page's content policy (`*.arcgisonline.com`), because the basemaps the
 * other maps draw are painted from the same hosts.
 *
 * Deliberately little machinery:
 *
 * - **One point, no layers of meaning.** The marker says where the
 *   reservoir's published point sits; the picture answers everything else.
 *   A card this size carrying drainage outlines and class colours would be
 *   the storage map again, smaller and worse.
 * - **No themed background and no fallback chain.** The basemaps module's
 *   ladder exists so a data map never falls to a blank frame. Here,
 *   anything other than imagery defeats the card's whole purpose, so the
 *   honest failure is a sentence saying the image did not arrive -- the
 *   same bargain the chart cards make.
 * - **A deadline, because the page does not wait on it.** `finish()` has
 *   already cleared `aria-busy` and signalled readiness before this module
 *   is even imported; the card carries its own busy flag until the view
 *   resolves or the deadline passes.
 */
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-fullscreen";
import "@arcgis/map-components/components/arcgis-scale-bar";

import ArcGISMap from "@arcgis/core/Map";
import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

export interface ReservoirImageryElement extends HTMLElement {
  map?: ArcGISMap | null | undefined;
  center?: unknown;
  zoom?: number;
  constraints?: unknown;
  view?: {
    ready?: boolean;
    container?: HTMLElement | null | undefined;
  } | null | undefined;
}

/** How long the image may take before the card says it did not arrive. */
const IMAGERY_READY_TIMEOUT_MS = 20000;

/**
 * The failure note, written here rather than imported from view-map.
 *
 * The shared builder lives beside the gallery of map components it serves,
 * and importing it for six lines would pull arcgis-basemap-gallery,
 * arcgis-home and their kin into this page's bundle to sit unused. The
 * wording matches; if the sentence ever changes, this is one of its homes.
 */
function imageryNote(text: string): HTMLParagraphElement {
  const note = document.createElement("p");
  note.className = "chart-empty";
  note.setAttribute("role", "status");
  note.textContent = text;
  return note;
}

function readyWithin(element: ReservoirImageryElement): Promise<void> {
  return new Promise((resolve) => {
    if (element.view?.ready) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, IMAGERY_READY_TIMEOUT_MS);
    element.addEventListener("arcgisViewReadyChange", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * Mounts the aerial view into `host`, which must be positioned and sized by
 * the caller's stylesheet.
 *
 * Resolves after the view is live or the deadline has passed; either way the
 * host stops claiming to be busy, and a failed image leaves a sentence
 * instead of an empty box.
 */
export async function mountReservoirImagery(
  host: HTMLElement,
  options: { label: string; lon: number; lat: number }
): Promise<void> {
  /* One mark, and nothing about it opens: no popup template is set, so the
     facts stay in the rows above instead of repeating over a smaller
     picture. */
  const markerLayer = new GraphicsLayer();
  /* Two marks for one point: a wide translucent halo so the site reads
     against imagery of any season, and the solid dot inside it. */
  markerLayer.addMany([
    new Graphic({
      geometry: { type: "point", longitude: options.lon, latitude: options.lat },
      symbol: {
        type: "simple-marker", style: "circle", size: 22,
        color: [255, 255, 255, 0.35], outline: { width: 0 }
      }
    }),
    new Graphic({
      geometry: { type: "point", longitude: options.lon, latitude: options.lat },
      symbol: {
        type: "simple-marker", style: "circle", size: 11,
        color: [255, 255, 255, 0.95],
        outline: { color: [15, 23, 42, 0.9], width: 2 }
      }
    })
  ]);

  const element = document.createElement("arcgis-map") as ReservoirImageryElement;
  element.setAttribute("aria-label",
    `Aerial image showing ${options.label} and the land around it`);
  /* Centred and framed before the map arrives, so the reader never sees a
     continental default ease into place. Zoom 13 puts roughly a mile across
     half the card -- close enough to read a shoreline, far enough that most
     full pools still fit. */
  element.center = { type: "point", longitude: options.lon, latitude: options.lat };
  element.zoom = 13;
  element.constraints = { snapToZoom: false };
  element.innerHTML = `
    <arcgis-zoom slot="top-right"></arcgis-zoom>
    <arcgis-fullscreen slot="top-left" text="Full screen"></arcgis-fullscreen>
    <arcgis-scale-bar slot="bottom-right" unit="dual"></arcgis-scale-bar>`;
  element.map = new ArcGISMap({ basemap: "satellite", layers: [markerLayer] });

  host.replaceChildren(element);
  await readyWithin(element);
  if (!element.view?.ready) {
    host.replaceChildren(imageryNote(
      "The aerial image could not be loaded just now."));
  }
  host.removeAttribute("aria-busy");
}
