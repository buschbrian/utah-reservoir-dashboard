/* Planned Phase 2 SDK import surface.
 *
 * This file is a bundle-budget fixture, not an application entry point. Keep
 * it aligned with the shell until the real shell replaces it as the budget
 * input. Individual imports are intentional: package barrels/loaders register
 * far more custom elements than the dashboard uses.
 */
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-legend";
import "@arcgis/map-components/components/arcgis-basemap-toggle";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-scale-bar";
import "@arcgis/map-components/components/arcgis-fullscreen";
import "@arcgis/map-components/components/arcgis-expand";
import "@esri/calcite-components/components/calcite-shell";
import "@esri/calcite-components/components/calcite-navigation";
import "@esri/calcite-components/components/calcite-navigation-logo";
import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-notice";
import "@esri/calcite-components/components/calcite-sheet";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Graphic from "@arcgis/core/Graphic";
import { basemapCandidates, installAnonymousAuthPolicy } from "./basemaps";

// Referencing the constructors and seams keeps Rollup from pruning the core
// API modules that the Phase 2 shell will actually exercise.
export function plannedShellSdkSurface(): unknown[] {
  return [
    FeatureLayer,
    Graphic,
    basemapCandidates,
    installAnonymousAuthPolicy
  ];
}
