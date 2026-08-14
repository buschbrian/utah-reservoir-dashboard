import "@arcgis/charts-components/main.css";
import "@arcgis/charts-components/components/arcgis-chart";
import "@arcgis/charts-components/components/arcgis-charts-action-bar";
import {
  ActionModes,
  ModelTypes,
  SerialChartDataSortingKinds,
  WebChartStatisticType
} from "@arcgis/charts-components";
import { createModel } from "@arcgis/charts-components/model/shared/setup-utils";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";

import type {
  ChartMeasure,
  NormalPoint,
  OverviewChartRecord,
  TrendPoint
} from "./overview-model";
import { STORAGE_CLASSES } from "./viz/classes";
import { hexToRgb } from "./viz/color";

export interface BarChartOptions {
  measure?: ChartMeasure;
  /**
   * What the category axis is a list of.
   *
   * The two bar charts are drawn from one layer builder, so both took their
   * axis title from that layer's field alias and both announced "Reservoir
   * or drainage area" -- the name of a column, offered to a reader as the
   * name of an axis. Each chart says which of the two it is showing.
   */
  categoryTitle?: string;
  /** Given the labels the reader clicked. Turns the chart into a filter. */
  onSelect?: (labels: string[]) => void;
}

/**
 * A colour from the class table, as channels the renderer keeps.
 *
 * The renderer used to be handed the hex string and let the SDK decide the
 * alpha. Bar *fills* are painted at the series alpha of 70% whatever this
 * says -- that is the SDK's, and setting the series colour to full alpha
 * before colour matching does not survive the match -- but outlines and
 * scatter markers are drawn at the alpha they are given. So the class colour
 * is stated exactly once per mark, at full strength, and a reader can hold a
 * bar's edge or a dot against the key without the two disagreeing (ADR-008).
 */
function classColorRgba(hex: string): [number, number, number, number] {
  const [red, green, blue] = hexToRgb(hex);
  return [red, green, blue, 255];
}

/**
 * The colours for the marks that are *not* a storage class.
 *
 * A count of reservoirs, a month of history and a quartile box are not
 * levels, and the SDK drew all three in its default orange -- the same
 * orange the class table gives to 50-75%. A reader comparing a histogram
 * bar against the key below it was being invited to read a frequency as a
 * storage level. Teal is the app's accent and appears nowhere in the class
 * ramp, so it can only mean "this mark is not a class".
 *
 * These are fixed rather than read from the theme: the values are chosen to
 * hold their contrast on both the light and the dark page, and a chart
 * redrawn on every theme change would be a second, slower way for the
 * palette to drift.
 */
const CHART_INK = {
  /** Counts, history and quartile boxes. */
  measure: [63, 138, 143, 255] as [number, number, number, number],
  /** The same, translucent, for a box that has whiskers drawn through it. */
  measureSoft: [63, 138, 143, 150] as [number, number, number, number],
  mean: [166, 93, 67, 235] as [number, number, number, number],
  median: [92, 79, 140, 235] as [number, number, number, number],
  guide: [128, 122, 110, 190] as [number, number, number, number],
  /** Neutral edge that keeps the pale yellow and blue visible on white. */
  edge: [55, 65, 70, 230] as [number, number, number, number]
} as const;

/**
 * How long to wait for the SDK to say it finished drawing.
 *
 * `arcgisRenderingComplete` is the signal we want, but it is not
 * guaranteed: the charts have been observed fully drawn -- bars measured in
 * the shadow root -- with the event never arriving, which left the page
 * awaiting it forever, both chart hosts announcing `aria-busy`, and the
 * readiness signal never published. The chart being on screen is the fact
 * that matters; the event is only how we hoped to learn it.
 */
const RENDER_SETTLE_MS = 8000;

/* The package exports only `setup-utils` from its model tree, so the model
 * type is taken from the element that consumes it rather than imported from
 * a path that is not public. */
type ChartElement = HTMLElementTagNameMap["arcgis-chart"];
type ChartModel = NonNullable<ChartElement["model"]>;

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
          color: classColorRgba(record.classColor),
          /* The SDK paints the body at 70% alpha. A neutral full-strength
           * edge keeps the pale centre of the ramp visible on its white
           * chart surface; the fill and direct value still state the class. */
          outline: { color: [...CHART_INK.edge], width: 1.2 }
        }
      }))
    },
    fields: [
      { name: "ObjectID", alias: "Object ID", type: "oid" },
      /* The axis title is set per chart from `BarChartOptions.categoryTitle`,
       * because one alias cannot be true of both charts that read this. */
      { name: "label", alias: "Name", type: "string" },
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

/**
 * Puts a chart and its action bar on the page and waits for it to draw.
 *
 * Shared by all four charts. The action bar is what gives every one of them
 * zoom, reset, "download as image" and "export data" without this file
 * implementing any of them -- it is the SDK's own toolbar, wired to the
 * chart element.
 */
async function mountChart(
  host: HTMLElement,
  layer: FeatureLayer,
  model: ChartModel,
  ariaLabel: string,
  actionMode: ActionModes
): Promise<ChartElement> {
  const chart = document.createElement("arcgis-chart");
  chart.id = `${host.id || "overview"}-arcgis-chart`;
  // Cross-filter updates can replace every chart at once. Immediate
  // rendering avoids one appearing blank while the SDK animates another.
  chart.animationEnabled = false;
  chart.actionMode = actionMode;
  /* Off by default, and the selection payload is empty without it. This is
   * what made the two filtering charts inert: a click selected the bar, the
   * SDK reported the selection with no object ids in it, and the handler had
   * nothing to map back to a reservoir. The ids are the only thing that
   * connects a bar to the record it was drawn from. */
  chart.returnSelectionOIDs = true;
  chart.aria = {
    label: ariaLabel,
    description: "Use the chart toolbar to zoom, reset, download an image, or export the data."
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
  /* Whichever comes first. `arcgisRenderingComplete` has been observed never
   * to arrive on a chart that is fully drawn, so proceeding on the deadline
   * can only mean the page stops claiming to be busy slightly early --
   * waiting for the event alone means it never stops claiming it at all. */
  let settle: ReturnType<typeof setTimeout>;
  await Promise.race([
    rendered,
    new Promise<void>((resolve) => { settle = setTimeout(resolve, RENDER_SETTLE_MS); })
  ]).finally(() => clearTimeout(settle));
  return chart;
}

/** The same empty state for every chart, so a filter that matches nothing
 * reads the same way wherever the reader is looking. */
function showEmpty(host: HTMLElement, message: string): void {
  const empty = document.createElement("p");
  empty.className = "chart-empty";
  empty.textContent = message;
  host.append(empty);
}

export async function renderArcgisBarChart(
  host: HTMLElement,
  records: readonly OverviewChartRecord[],
  ariaLabel: string,
  isCurrent: () => boolean = () => true,
  options: BarChartOptions = {}
): Promise<void> {
  host.replaceChildren();
  if (records.length === 0) {
    showEmpty(host, "No reservoirs match these filters.");
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
  model.setAxisTitleText(options.categoryTitle ?? "Name", 0);

  if (options.measure === "storage") {
    /* Acre-feet have no fixed ceiling, so the axis has to scale itself here.
     * Bounds are cleared rather than left over from a previous render: a
     * 0-100 axis under a 3-million-acre-foot bar draws every bar at the
     * maximum, which is the same failure as the one below in reverse. */
    model.setAxisTitleText("Acre-feet stored", VALUE_AXIS);
    model.setMinBound(0, VALUE_AXIS);
    model.setMaxBound(null as unknown as number, VALUE_AXIS);
  } else {
    model.setAxisTitleText("Percent full", VALUE_AXIS);
    /* A percentage axis runs 0 to 100 whatever is on it. Left to scale
     * itself the axis fits the largest bar, so filtering down to one
     * drainage area at 6% drew a bar that filled the plot -- the length said
     * "full" while the label beside it said 6. */
    model.setMinBound(PERCENT_AXIS.min, VALUE_AXIS);
    model.setMaxBound(PERCENT_AXIS.max, VALUE_AXIS);
  }

  /* Colour every bar by its storage class, from the same table the map is
   * drawn from (ADR-008). `colorMatch` takes the colours from the layer
   * renderer, which is keyed on the category field, so this stays one series
   * and one bar per category -- splitting by class instead produced a series
   * per class and reserved a row for every class in every category, which
   * left most of the plot empty. */
  model.setSeriesName(options.measure === "storage" ? "Acre-feet stored" : "Percent full", 0);

  /* Selection mode rather than zoom when the caller wants clicks: the SDK
   * cannot do both, and a chart whose bars filter the page is worth more
   * than one that can be rubber-band zoomed -- the toolbar still offers
   * zoom as an explicit action either way.
   *
   * One bar at a time. The mode used to be `MultiSelectionWithCtrlKey` and
   * the card promised "hold Ctrl to compare several", but the handler below
   * narrows to a single name and threw a multiple selection away -- so
   * ctrl-clicking a second bar cleared the filter instead of adding to it.
   * A control that does the opposite of what it says is worse than one that
   * does less, and the page's one selection is the search box (see
   * state/overview-url.ts), which holds one name. */
  const chart = await mountChart(host, layer, model, ariaLabel,
    options.onSelect ? ActionModes.MonoSelection : ActionModes.Zoom);

  if (options.onSelect) {
    /* The SDK reports the selection as object IDs against the layer it was
     * given, which is the one built from these records a few lines up, so
     * the id maps straight back to a label without a query.
     *
     * The ids arrive under `detail.selectionData`, not on `detail` itself.
     * Read one level too high they were always `undefined`, so every click
     * selected nothing, called back with an empty list and left the page
     * exactly as it was: six charts, two of them documented as filters,
     * and clicking any bar did nothing at all. */
    let hadSelection = false;
    chart.addEventListener("arcgisSelectionComplete", (event: Event) => {
      const detail = (event as CustomEvent<{
        selectionData?: { selectionOIDs?: (number | string)[] };
      }>).detail;
      const ids = (detail?.selectionData?.selectionOIDs ?? []).map(Number);
      /* An empty selection clears the filter, but only once the reader has
       * actually chosen something here first: the SDK also reports an empty
       * selection while a freshly mounted chart settles, and acting on that
       * would wipe the search a shared link had just restored. */
      if (ids.length === 0 && !hadSelection) return;
      hadSelection = ids.length > 0;
      const chosen = records.filter((record) => ids.includes(record.id));
      options.onSelect?.(chosen.map((record) => record.label));
    });
  }

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

/* ------------------------------------------------------------------ */
/* The twelve-month trend                                              */
/* ------------------------------------------------------------------ */

function trendLayer(points: readonly TrendPoint[]): FeatureLayer {
  return new FeatureLayer({
    title: "Combined storage over the last twelve months",
    source: points.map((point) => new Graphic({
      geometry: new Point({ longitude: -111, latitude: 39 }),
      attributes: {
        ObjectID: point.id,
        /* A real date, not the label. The category axis sorts its values,
         * and month names sort alphabetically -- the axis read April,
         * August, February, July, March, which is every month present and
         * none of them in the order they happened. A date field makes the
         * axis temporal, so the SDK orders and formats it as time. */
        month_label: point.axisLabel,
        month_name: point.label,
        percent: point.percent,
        storage_af: point.storageAf,
        reporting: point.reporting
      }
    })),
    objectIdField: "ObjectID",
    geometryType: "point",
    spatialReference: { wkid: 4326 },
    fields: [
      { name: "ObjectID", alias: "Object ID", type: "oid" },
      { name: "month_label", alias: "Month", type: "string" },
      { name: "month_name", alias: "Month name", type: "string" },
      { name: "percent", alias: "Percent full", type: "double" },
      { name: "storage_af", alias: "Storage (acre-feet)", type: "double" },
      { name: "reporting", alias: "Reservoirs reporting", type: "integer" }
    ]
  });
}

/**
 * Combined storage across the last twelve months.
 *
 * A line rather than bars, because the months are a sequence and the shape
 * between them is the point -- this is the one chart on the page that
 * answers "which way is it going", which no arrangement of today's numbers
 * can. Sorting is left alone deliberately: the categories are months in
 * order, and sorting them by value would destroy the only axis that means
 * anything here.
 */
export async function renderArcgisTrendChart(
  host: HTMLElement,
  points: readonly TrendPoint[],
  ariaLabel: string,
  isCurrent: () => boolean = () => true,
  measure: ChartMeasure = "percent"
): Promise<void> {
  host.replaceChildren();
  if (points.length === 0) {
    showEmpty(host, "No monthly history for these filters.");
    return;
  }

  const layer = trendLayer(points);
  await layer.load();
  const model = await createModel({ layer, chartType: ModelTypes.LineChart });
  if (!isCurrent()) return;
  model.xAxisField = "month_label";
  model.numericFields = [measure === "storage" ? "storage_af" : "percent"];
  model.aggregationType = WebChartStatisticType.NoAggregation;
  /* Ascending on the category axis, which with year-first labels is
   * chronological order. See TrendPoint.axisLabel for why the axis is
   * categorical rather than temporal. */
  model.setSortOrder(SerialChartDataSortingKinds.xAxisAsc);
  model.chartTitleVisibility = false;
  model.legendVisibility = false;
  model.dataLabelsVisibility = false;
  if (measure === "storage") {
    model.setAxisTitleText("Acre-feet stored", VALUE_AXIS);
    model.setMinBound(0, VALUE_AXIS);
  } else {
    model.setAxisTitleText("Percent full", VALUE_AXIS);
    model.setMinBound(PERCENT_AXIS.min, VALUE_AXIS);
    model.setMaxBound(PERCENT_AXIS.max, VALUE_AXIS);
  }
  model.setSeriesName(measure === "storage" ? "Acre-feet stored" : "Percent full", 0);
  /* Colour matching reads a layer renderer, and the month layer has none --
   * left on it discards the series colour below and falls back to the SDK's
   * default orange, which is the colour the class table gives to 50-75%. A
   * line drawn in a class colour invites the reader to read its height off
   * the key beside the other charts. */
  model.colorMatch = false;
  model.setSeriesColor([...CHART_INK.measure], 0);
  await mountChart(host, layer, model, ariaLabel, ActionModes.Zoom);
}

/* ------------------------------------------------------------------ */
/* Storage against normal                                              */
/* ------------------------------------------------------------------ */

function normalLayer(points: readonly NormalPoint[]): FeatureLayer {
  return new FeatureLayer({
    title: "Storage against the normal value for this date",
    source: points.map((point) => new Graphic({
      geometry: new Point({ longitude: -111, latitude: 39 }),
      attributes: {
        ObjectID: point.id,
        label: point.label,
        normal_af: point.normalAf,
        storage_af: point.storageAf,
        percent_of_normal: point.percentOfNormal
      }
    })),
    objectIdField: "ObjectID",
    geometryType: "point",
    spatialReference: { wkid: 4326 },
    renderer: {
      type: "unique-value",
      field: "label",
      uniqueValueInfos: points.map((point) => ({
        value: point.label,
        symbol: {
          type: "simple-marker",
          style: "circle",
          size: 9,
          color: classColorRgba(point.classColor),
          outline: { color: [...CHART_INK.edge], width: 0.9 }
        }
      }))
    },
    fields: [
      { name: "ObjectID", alias: "Object ID", type: "oid" },
      { name: "label", alias: "Reservoir", type: "string" },
      { name: "normal_af", alias: "Usual storage for this date (acre-feet)", type: "double" },
      { name: "storage_af", alias: "Stored now (acre-feet)", type: "double" },
      { name: "percent_of_normal", alias: "Percent of the usual storage", type: "double" }
    ]
  });
}

/**
 * How each reservoir compares with its own normal for the date, against how
 * large that normal is.
 *
 * The question this answers is the one percent-full cannot: a reservoir at
 * 60% in April and one at 60% in September are not the same news.
 *
 * WHY THE HORIZONTAL AXIS IS LOGARITHMIC. Utah's reservoirs run from Flaming
 * Gorge at millions of acre-feet to Lost Lake at a few hundred -- more than
 * four orders of magnitude. Spread linearly, the two largest set the range
 * and every other reservoir in the state collapsed into one smudge against
 * the origin, so a chart whose whole purpose is per-reservoir comparison
 * could be read for no reservoir except the biggest. A logarithmic axis
 * spends the same width on each tenfold step, which is the only arrangement
 * that holds a 400 acre-foot reservoir and an 11,000,000 acre-foot one and
 * says something about both.
 *
 * WHY THE VERTICAL AXIS IS A RATIO AND NOT ACRE-FEET. Making both axes
 * logarithmic fixed the crowding and destroyed the meaning: the SDK's fitted
 * line is computed in linear space and drawn as a straight segment between
 * its endpoints, so on logarithmic axes it left the cloud entirely and hung
 * along the right-hand edge -- and "dots below the line" is the whole claim
 * of the chart. Percent of normal answers that claim directly and needs no
 * fit: 100 is the level, it is the same 100 for every reservoir whatever its
 * size, and it can be drawn as an actual line across the plot.
 *
 * The point colours come from the storage class table (ADR-008) through the
 * layer renderer, so a dot's colour here means what the same colour means on
 * the map.
 */
export async function renderArcgisNormalChart(
  host: HTMLElement,
  points: readonly NormalPoint[],
  ariaLabel: string,
  isCurrent: () => boolean = () => true
): Promise<void> {
  host.replaceChildren();
  if (points.length === 0) {
    showEmpty(host, "No reservoir in view has enough history for a normal value.");
    return;
  }

  const layer = normalLayer(points);
  await layer.load();
  const model = await createModel({ layer, chartType: ModelTypes.Scatterplot });
  if (!isCurrent()) return;
  model.xAxisField = "normal_af";
  model.yAxisField = "percent_of_normal";
  model.chartTitleVisibility = false;
  model.legendVisibility = false;
  model.setAxisTitleText("Usual storage for this date, in acre-feet", 0);
  model.setAxisTitleText("Percent of the usual storage", VALUE_AXIS);

  /* Axis 0 is the horizontal one. See the note above the function. */
  model.setLogarithmic(true, 0);
  /* A logarithmic axis cannot show zero, and does not have to: a reservoir
   * with no usual value for the date is not on this chart at all. */
  model.setMinBound(null as unknown as number, 0);
  /* The ratio axis starts at zero -- it is a percentage of something, and a
   * bottom that floats with the data would move the reference line's height
   * every time the filter changed. The top is left free: a reservoir above
   * twice its usual level is real, and clipping it would hide the one dot
   * most worth looking at. */
  model.setMinBound(0, VALUE_AXIS);

  /* The line the chart is read against, drawn rather than fitted. */
  model.addYAxisGuide("At the usual level");
  model.setGuideStart(100, 0, "y");
  model.setGuideEnd(null, 0, "y");
  model.setGuideLabelText("Usual level for this date", 0, "y");
  model.setGuideStyle({
    type: "esriSLS", style: "esriSLSDash", width: 1.6, color: [...CHART_INK.mean]
  }, 0, "y");
  model.setGuideVisibility(true, 0, "y");
  model.showLinearTrend = false;

  /* Two logarithmic decades of horizontal position cannot be read back as a
   * number by eye, and the acre-feet are what says whether a dot below the
   * line matters. */
  model.additionalTooltipField = "storage_af";
  await mountChart(host, layer, model, ariaLabel, ActionModes.Zoom);
  model.colorMatch = true;
}

/* ------------------------------------------------------------------ */
/* The distribution                                                    */
/* ------------------------------------------------------------------ */

function valueLayer(
  values: readonly { id: number; label: string; value: number; group: string }[],
  fieldAlias: string
): FeatureLayer {
  return new FeatureLayer({
    title: fieldAlias,
    source: values.map((entry) => new Graphic({
      geometry: new Point({ longitude: -111, latitude: 39 }),
      attributes: {
        ObjectID: entry.id, label: entry.label, value: entry.value, grouping: entry.group
      }
    })),
    objectIdField: "ObjectID",
    geometryType: "point",
    spatialReference: { wkid: 4326 },
    fields: [
      { name: "ObjectID", alias: "Object ID", type: "oid" },
      { name: "label", alias: "Reservoir", type: "string" },
      { name: "value", alias: fieldAlias, type: "double" },
      { name: "grouping", alias: "Drainage area", type: "string" }
    ]
  });
}

/**
 * How percent-full is distributed across the reservoirs in view.
 *
 * The bar charts answer "which reservoirs are low"; this answers "is the
 * state low", which a ranked list genuinely cannot: fifteen bars sorted
 * descending look alarming whether the other forty are full or empty.
 *
 * The mean, the median, the standard deviation and a fitted normal curve are
 * the SDK's own overlays -- computed from the data rather than drawn on top
 * of it -- and the gap between the mean and the median is the useful part: a
 * mean well below the median is a handful of nearly-empty reservoirs
 * dragging the average down.
 */
export async function renderArcgisDistributionChart(
  host: HTMLElement,
  values: readonly { id: number; label: string; value: number; group: string }[],
  ariaLabel: string,
  isCurrent: () => boolean = () => true
): Promise<void> {
  host.replaceChildren();
  if (values.length < 3) {
    showEmpty(host, "Too few reservoirs in view to show a distribution.");
    return;
  }

  const layer = valueLayer(values, "Percent full");
  await layer.load();
  const model = await createModel({ layer, chartType: ModelTypes.Histogram });
  if (!isCurrent()) return;
  model.numericField = "value";
  model.chartTitleVisibility = false;
  /* Ten bins. NOT ten-point bands: the SDK divides the range the data
   * actually covers, and axis bounds do not move the bin edges -- setting
   * them to 0 and 100 left the config saying 0-100 and the chart still
   * drawn from 3.3 to 96. The card says "ten equal bands" for that reason,
   * and the axis labels print the edges the reader is actually looking at. */
  model.binCount = 10;
  /* Colour matching takes a chart's colours from the layer's renderer, and
   * this layer has none -- it is a list of values, not of classified
   * features. Left on, it discarded `binSymbol` and painted the bars in the
   * SDK's default orange, which is the class table's own 50-75% colour
   * sitting directly above a key that says so. */
  model.colorMatch = false;
  model.showMeanOverlay = true;
  model.showMedianOverlay = true;
  model.showStandardDevOverlay = true;
  model.showNormalDistOverlay = true;
  /* A count of reservoirs is not a storage level, so the bars are drawn in
   * the app's teal rather than the SDK's default orange -- which is the
   * class table's 50-75% colour, sitting directly above a key that says so.
   * The overlays get palette colours for the same reason: the defaults are
   * a saturated blue and magenta that belong to nothing else on the page. */
  model.binSymbol = {
    type: "esriSFS", style: "esriSFSSolid", color: [...CHART_INK.measureSoft],
    outline: { type: "esriSLS", style: "esriSLSSolid", width: 1, color: [...CHART_INK.measure] }
  };
  model.meanSymbol = {
    type: "esriSLS", style: "esriSLSSolid", width: 1.6, color: [...CHART_INK.mean]
  };
  model.medianSymbol = {
    type: "esriSLS", style: "esriSLSDash", width: 1.6, color: [...CHART_INK.median]
  };
  model.standardDevSymbol = {
    type: "esriSLS", style: "esriSLSDot", width: 1, color: [...CHART_INK.guide]
  };
  model.normalDistSymbol = {
    type: "esriSLS", style: "esriSLSSolid", width: 1.4, color: [...CHART_INK.guide]
  };
  model.setAxisTitleText("Percent full", 0);
  model.setAxisTitleText("Reservoirs", VALUE_AXIS);
  await mountChart(host, layer, model, ariaLabel, ActionModes.Zoom);
}

/**
 * The spread of percent-full within each drainage area.
 *
 * The drainage-area bar chart gives one number per area, which hides the
 * thing a water manager most wants: whether an area at 60% is forty
 * reservoirs all near 60, or half of them full and half nearly empty. A box
 * plot answers that directly -- median, quartiles, whiskers and the
 * outliers, which are the individual reservoirs worth opening on the map.
 */
export async function renderArcgisSpreadChart(
  host: HTMLElement,
  values: readonly { id: number; label: string; value: number; group: string }[],
  ariaLabel: string,
  isCurrent: () => boolean = () => true
): Promise<void> {
  host.replaceChildren();
  const groups = new Set(values.map((entry) => entry.group));
  if (values.length < 3 || groups.size === 0) {
    showEmpty(host, "Too few reservoirs in view to show a spread.");
    return;
  }

  const layer = valueLayer(values, "Percent full");
  await layer.load();
  const model = await createModel({ layer, chartType: ModelTypes.BoxPlot });
  if (!isCurrent()) return;
  model.category = "grouping";
  model.numericFields = ["value"];
  model.chartTitleVisibility = false;
  model.legendVisibility = false;
  /* Outliers are the point of this chart rather than noise on it: a single
   * reservoir far below its neighbours is the one to go and look at. */
  model.showOutliers = true;
  model.showMeanLines = true;
  /* Quartiles are not a storage level either, so the boxes carry the same
   * teal the histogram and the trend line do rather than the SDK's grey,
   * which on the dark page was very nearly the page itself. */
  model.meanLinesBoxColor = [...CHART_INK.measureSoft];
  model.setSeriesColor([...CHART_INK.measureSoft], 0);
  model.setAxisTitleText("Drainage area", 0);
  model.setAxisTitleText("Percent full", VALUE_AXIS);
  model.setMinBound(PERCENT_AXIS.min, VALUE_AXIS);
  model.setMaxBound(PERCENT_AXIS.max, VALUE_AXIS);
  await mountChart(host, layer, model, ariaLabel, ActionModes.Zoom);
}
