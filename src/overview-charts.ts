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
import { STORAGE_CLASSES } from "./viz/classes";

/** A percentage axis runs 0 to 100, always. */
const PERCENT_AXIS = { min: 0, max: 100 };
/** The value axis is the second one; the category axis is the first. */
const VALUE_AXIS = 1;

function chartLayer(records: readonly OverviewChartRecord[]): FeatureLayer {
  const source = records.map((record) => new Graphic({
    geometry: new Point({ longitude: -111, latitude: 39 }),
    attributes: {
      ObjectID: record.id,
      label: record.label,
      percent: record.percent,
      storage_af: record.storageAf,
      capacity_af: record.capacityAf,
      class_label: record.classLabel
    }
  }));
  return new FeatureLayer({
    title: "Filtered Utah reservoir conditions",
    source,
    objectIdField: "ObjectID",
    geometryType: "point",
    spatialReference: { wkid: 4326 },
    /* The chart takes its bar colours from this renderer, so the renderer is
     * keyed on the same field the bars are categorised by. One entry per
     * record, coloured by the storage class the record is in -- which is the
     * class the map draws that reservoir in (ADR-008). */
    renderer: {
      type: "unique-value",
      field: "label",
      uniqueValueInfos: records.map((record) => ({
        value: record.label,
        symbol: {
          type: "simple-marker",
          style: "circle",
          color: record.classColor,
          outline: { color: record.classColor, width: 0 }
        }
      }))
    },
    fields: [
      { name: "ObjectID", alias: "Object ID", type: "oid" },
      { name: "label", alias: "Reservoir or drainage area", type: "string" },
      { name: "percent", alias: "Percent full", type: "double" },
      { name: "storage_af", alias: "Current storage (acre-feet)", type: "double" },
      { name: "capacity_af", alias: "Capacity (acre-feet)", type: "double" },
      { name: "class_label", alias: "Storage level", type: "string" }
    ]
  });
}

type SeriesModel = {
  seriesLength: number;
  getSeriesName(index: number): string | undefined;
  setSeriesColor(color: [number, number, number, number], index: number): void;
};

/**
 * Waits for the split-by series the SDK builds from the field.
 *
 * `splitByField` is a plain setter and the work behind it is asynchronous
 * with nothing public to await, so this waits on the outcome instead: one
 * series per distinct class in the data, a count this file already knows.
 * Bounded, and it gives up rather than throwing -- a chart in the SDK's own
 * colours is worse than one in the class colours and better than no chart.
 */
async function seriesSettled(model: SeriesModel, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (model.seriesLength >= expected) return;
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
}

/** The legend the charts share with the map: the class table, in order. */
export function storageLegendEntries(): { label: string; color: string }[] {
  return STORAGE_CLASSES.map((entry) => ({ label: entry.label, color: entry.color }));
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
  // The class legend is rendered beside the chart from the same table.
  model.legendVisibility = false;
  model.setSortOrder(SerialChartDataSortingKinds.yAxisDesc);
  model.setAxisTitleText("Percent full", VALUE_AXIS);

  /* A percentage axis runs 0 to 100 whatever is on it. Left to scale itself
   * the axis fits the largest bar, so filtering down to one drainage area at
   * 6% drew a bar that filled the plot -- the length said "full" while the
   * label beside it said 6. */
  model.setMinBound(PERCENT_AXIS.min, VALUE_AXIS);
  model.setMaxBound(PERCENT_AXIS.max, VALUE_AXIS);

  /* Colour every bar by its storage class, from the same table the map is
   * drawn from (ADR-008). `colorMatch` takes the colours from the layer
   * renderer, which is keyed on the category field, so this stays one series
   * and one bar per category -- splitting by class instead produced a series
   * per class and reserved a row for every class in every category, which
   * left most of the plot empty. */
  model.setSeriesName("Percent full", 0);

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

  /* Colour every bar by its storage class, from the same table the map is
   * drawn from (ADR-008). `colorMatch` takes the colours from the layer
   * renderer, which is keyed on the category field, so this stays one
   * series and one bar per category -- splitting by class instead gave a
   * series per class and reserved a row for every class in every category,
   * which left most of the plot empty.
   *
   * Set after the first render, not before it: setting it on an unattached
   * model leaves the config mid-update and the chart never emits
   * `arcgisRenderingComplete`, so the page waits forever for a chart that
   * is on screen. */
  model.colorMatch = true;
}
