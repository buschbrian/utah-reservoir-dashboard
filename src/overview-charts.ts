import "@arcgis/charts-components/main.css";
import "@arcgis/charts-components/components/arcgis-chart";
import "@arcgis/charts-components/components/arcgis-charts-action-bar";
import {
  ModelTypes,
  SerialChartDataSortingKinds,
  WebChartStatisticType
} from "@arcgis/charts-components";
import { createModel } from "@arcgis/charts-components/model/shared/setup-utils";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";

import type { OverviewChartRecord } from "./overview-model";

function chartLayer(records: readonly OverviewChartRecord[]): FeatureLayer {
  const source = records.map((record) => new Graphic({
    geometry: new Point({ longitude: -111, latitude: 39 }),
    attributes: {
      ObjectID: record.id,
      label: record.label,
      percent: record.percent,
      storage_af: record.storageAf,
      capacity_af: record.capacityAf
    }
  }));
  return new FeatureLayer({
    title: "Filtered Utah reservoir conditions",
    source,
    objectIdField: "ObjectID",
    geometryType: "point",
    spatialReference: { wkid: 4326 },
    fields: [
      { name: "ObjectID", alias: "Object ID", type: "oid" },
      { name: "label", alias: "Reservoir or drainage area", type: "string" },
      { name: "percent", alias: "Percent full", type: "double" },
      { name: "storage_af", alias: "Current storage (acre-feet)", type: "double" },
      { name: "capacity_af", alias: "Capacity (acre-feet)", type: "double" }
    ]
  });
}

export async function renderArcgisBarChart(
  host: HTMLElement,
  records: readonly OverviewChartRecord[],
  ariaLabel: string,
  isCurrent: () => boolean = () => true
): Promise<void> {
  host.replaceChildren();
  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = "No reservoirs match these filters.";
    host.append(empty);
    return;
  }

  const layer = chartLayer(records);
  await layer.load();
  const model = await createModel({ layer, chartType: ModelTypes.BarChart });
  if (!isCurrent()) return;
  model.xAxisField = "label";
  model.numericFields = ["percent"];
  model.aggregationType = WebChartStatisticType.NoAggregation;
  model.rotatedState = true;
  model.dataLabelsVisibility = true;
  model.chartTitleVisibility = false;
  model.legendVisibility = false;
  model.setSeriesName("Percent full", 0);
  model.setSeriesColor([167, 94, 66, 255], 0);
  model.setSortOrder(SerialChartDataSortingKinds.yAxisDesc);
  model.setAxisTitleText("Percent full", 1);

  const chart = document.createElement("arcgis-chart");
  chart.id = `${host.id || "overview"}-arcgis-chart`;
  // Cross-filter updates can replace both charts at once. Immediate rendering
  // avoids one chart appearing blank while the SDK animates the other.
  chart.animationEnabled = false;
  chart.actionMode = "zoom";
  chart.aria = {
    label: ariaLabel,
    description: "Use the chart toolbar to zoom, reset, download an image, or export CSV data."
  };
  const actions = document.createElement("arcgis-charts-action-bar");
  actions.id = `${chart.id}-actions`;
  actions.chartElement = chart;
  host.append(chart, actions);
  await Promise.all([chart.componentOnReady(), actions.componentOnReady()]);
  const rendered = new Promise<void>((resolve) => {
    chart.addEventListener("arcgisRenderingComplete", () => resolve(), { once: true });
  });
  chart.layer = layer;
  chart.model = model;
  await rendered;
}
