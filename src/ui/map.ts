import "@esri/calcite-components/components/calcite-notice";
import "@arcgis/map-components/components/arcgis-fullscreen";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scale-bar";

import { resolveBasemap } from "../arcgis/basemaps";
import { elementById } from "./dom";

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

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

export async function loadMap(): Promise<void> {
  const resolution = await resolveBasemap();
  if (!resolution.resource) {
    showMapMessage(
      "The map background is unavailable",
      "Reservoir data remains available in the summary and statewide overview.",
      "alert"
    );
    return;
  }

  const map = document.createElement("arcgis-map");
  map.setAttribute("center", "-111.7,39.4");
  map.setAttribute("zoom", "6");
  map.setAttribute("aria-label", "Interactive map of Utah and connected drainage areas");
  map.basemap = resolution.resource;
  map.animationsDisabled = reducedMotionQuery.matches;
  map.innerHTML = `
    <arcgis-home slot="top-left"></arcgis-home>
    <arcgis-fullscreen slot="top-right"></arcgis-fullscreen>
    <arcgis-scale-bar slot="bottom-left" unit="dual"></arcgis-scale-bar>`;
  map.addEventListener("arcgisViewReadyChange", () => {
    elementById("map-host").setAttribute("aria-busy", "false");
  }, { once: true });
  map.addEventListener("arcgisViewReadyError", () => {
    showMapMessage(
      "The map could not start",
      "Reservoir data remains available in the summary and statewide overview.",
      "alert"
    );
  }, { once: true });
  elementById("map-host").replaceChildren(map);
  if (resolution.degraded) showDegradedBasemap(resolution.name);
}
