/*
 * The drainage areas, drawn from the hosted Watershed Boundary Dataset.
 *
 * ## Why this replaces a committed file
 *
 * The boundaries used to reach the browser inside `reference.json`: 982 KB of
 * the file's 1,001 KB, fetched whole on every map page and then walked
 * coordinate by coordinate on the main thread to type-check it.
 *
 * A hosted feature layer is not a smaller version of that. It is a different
 * transaction: the SDK asks for the features in the current view, quantized
 * to the resolution that view can actually show, in a binary format. Measured
 * against this layer for the fourteen published basins:
 *
 *     view          committed     hosted, quantized
 *     ~1:18,000,000   982 KB          12 KB
 *     ~1:9,000,000    982 KB          24 KB
 *     ~1:4,600,000    982 KB          47 KB
 *     ~1:1,200,000    982 KB         176 KB
 *
 * So the wide view costs about a fortieth of the file, and what it costs
 * follows the viewport rather than the size of the scope -- which is the
 * property that makes a western scope possible at all. The same fourteen
 * basins fetched in bulk without quantization are 935 KB as binary and 4.7 MB
 * as JSON, so the saving is the quantization, not the hosting.
 *
 * Note this layer ignores `maxAllowableOffset` -- every offset from 56 m to
 * 2 km returns byte-identical results. Generalization is not the lever here;
 * quantization is, and the SDK applies it from the view without being asked.
 *
 * ## Which service
 *
 * Esri's Living Atlas publishes one layer per hydrologic level, all public
 * and anonymous, on the same organisation this project already draws its
 * state and county boundaries from (ADR-034). So the content policy already
 * allows the host, ADR-004's no-API-key rule is untouched, and the failure
 * mode is one the project already handles: a layer that does not answer in
 * time resolves to null and the map draws without it.
 */
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";

/** Living Atlas publishes each hydrologic level as its own feature service. */
const WATERSHED_SERVICE_BY_LEVEL: Readonly<Record<number, string>> = {
  4: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/" +
    "Watershed_Boundary_Dataset_HUC_4s/FeatureServer/0",
  6: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/" +
    "Watershed_Boundary_Dataset_HUC_6s/FeatureServer/0",
  8: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/" +
    "Watershed_Boundary_Dataset_HUC_8s/FeatureServer/0"
};

export const WATERSHED_LAYER_ID = "drainage-areas";
export const WATERSHED_NAME_FIELD = "name";

/** The levels this project can draw. See `watershed_scopes.py` for why the
 * finer ones are absent: the drought engine's sampled share stops holding the
 * published precision below HUC-8. */
export const DRAWABLE_LEVELS = Object.keys(WATERSHED_SERVICE_BY_LEVEL)
  .map(Number)
  .sort((left, right) => left - right);

export function watershedServiceUrl(level: number): string {
  const url = WATERSHED_SERVICE_BY_LEVEL[level];
  if (!url) {
    throw new Error(
      `no watershed service for hydrologic level ${level}; ` +
      `choose ${DRAWABLE_LEVELS.join(", ")}`);
  }
  return url;
}

/** The attribute a level's layer publishes its unit code in. */
export function watershedCodeField(level: number): string {
  return `huc${level}`;
}

/**
 * A `where` clause naming exactly the units in scope.
 *
 * An explicit list rather than a prefix match, because the published scope is
 * not a prefix: it is "touches Utah and is not the Columbia", which no code
 * pattern expresses. The codes are validated as digits before they get here,
 * so this is not building a clause out of anything a reader supplied.
 */
export function watershedScopeClause(level: number, codes: readonly string[]): string {
  if (codes.length === 0) return "1=0";
  const field = watershedCodeField(level);
  const quoted = codes.map((code) => `'${code}'`).join(",");
  return `${field} IN (${quoted})`;
}

export interface WatershedLayerOptions {
  level: number;
  /** The units in scope. */
  codes: readonly string[];
  /** Drawn appearance. Outlines only -- the fill is the caller's business,
   * and on the drought map it is the monitor's classes underneath. */
  renderer?: unknown;
  labelsVisible?: boolean;
  labelingInfo?: unknown;
  minScale?: number;
  maxScale?: number;
}

/**
 * The drainage areas as a hosted layer, scoped to the units this site draws.
 *
 * `outFields` is the code, the name and the states and nothing else. The
 * service also publishes acreage and a global id, and asking for them would
 * be paying to move numbers no surface reads.
 */
export function createWatershedLayer(options: WatershedLayerOptions): FeatureLayer {
  const { level, codes } = options;
  const properties: Record<string, unknown> = {
    id: WATERSHED_LAYER_ID,
    url: watershedServiceUrl(level),
    listMode: "hide",
    definitionExpression: watershedScopeClause(level, codes),
    outFields: [watershedCodeField(level), WATERSHED_NAME_FIELD, "states"],
    /* Every page on this site describes what a reader points at in its own
     * hover card, in its own words (ADR-006). A service popup would answer
     * the same gesture with the publisher's field names. */
    popupEnabled: false
  };
  if (options.renderer) properties["renderer"] = options.renderer;
  if (options.labelingInfo) {
    properties["labelingInfo"] = options.labelingInfo;
    properties["labelsVisible"] = options.labelsVisible ?? true;
  } else if (options.labelsVisible !== undefined) {
    properties["labelsVisible"] = options.labelsVisible;
  }
  if (options.minScale !== undefined) properties["minScale"] = options.minScale;
  if (options.maxScale !== undefined) properties["maxScale"] = options.maxScale;
  return new FeatureLayer(properties as never);
}

export interface WatershedShape {
  code: string;
  name: string;
  /** Rings in longitude and latitude, the shape the drawing code already
   * takes. A multipolygon is several. */
  rings: number[][][];
}

/**
 * The scope's geometry, once, for the surfaces that colour each area by data.
 *
 * The snow map fills every basin by its percent of normal, which no hosted
 * renderer can do: the values are this project's and the service has never
 * heard of them. So that map needs the shapes in hand.
 *
 * It asks the layer rather than a committed file, which is the whole saving --
 * and it asks with the view's own resolution, so a wide card pays for a wide
 * card. A failure resolves to an empty list rather than throwing: a snow page
 * without basin fills still has its curve, its table and its sites.
 */
export async function queryWatershedShapes(
  layer: FeatureLayer, level: number
): Promise<WatershedShape[]> {
  const field = watershedCodeField(level);
  try {
    /* Query properties rather than a constructed `Query`: under
     * `exactOptionalPropertyTypes` a real Query does not satisfy the
     * parameter type, because its own optional members are
     * `T | null | undefined` where the properties shape accepts only
     * `T | null`. The same narrowing the basemap assignment needs. */
    const result = await layer.queryFeatures({
      where: layer.definitionExpression || "1=1",
      outFields: [field, WATERSHED_NAME_FIELD],
      returnGeometry: true,
      outSpatialReference: { wkid: 4326 }
    } as never);
    const shapes: WatershedShape[] = [];
    for (const feature of result.features) {
      const geometry = feature.geometry as { rings?: number[][][] } | null;
      const code = feature.attributes?.[field];
      if (!geometry?.rings || typeof code !== "string") continue;
      shapes.push({
        code,
        name: String(feature.attributes?.[WATERSHED_NAME_FIELD] ?? ""),
        rings: geometry.rings
      });
    }
    return shapes;
  } catch (error) {
    console.warn("The drainage-area shapes could not be read:", error);
    return [];
  }
}
