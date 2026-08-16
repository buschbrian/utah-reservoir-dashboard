/*
 * State and county boundaries, from the authoritative hosted services rather
 * than from committed copies.
 *
 * This is the plan's own rule for optional map context: prefer a public REST
 * layer when it has a bounded failure path, and keep committed files for the
 * reviewed assignments and the daily numbers. These boundaries are neither
 * -- nothing on any page is computed from them, no figure moves if Esri
 * regeneralizes a coastline -- so a service is right and a third megabyte of
 * committed GeoJSON would be wrong.
 *
 * The bounded failure path is the condition, so it is enforced here rather
 * than assumed. Each layer is loaded against a deadline before it is put on
 * a map, and a layer that does not answer is simply not added: the drought
 * sweep, the drainage outlines, the reservoirs and every figure on the page
 * are already drawn from local data, so losing the state outlines costs
 * context and nothing else. A `FeatureLayer` added and left to fail on its
 * own would instead sit in the layer list forever, unloaded and unexplained.
 *
 * Both services are anonymous-readable and were verified as such before
 * being written down; the anonymous auth policy the shell installs is what
 * keeps a change on Esri's side from turning into a sign-in dialog for a
 * reader who has no ArcGIS account.
 */
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";

import {
  COUNTY_LABEL_SCALE,
  COUNTY_LABEL_SIZE_PX,
  COUNTY_SCALE,
  STATE_LABEL_SCALE,
  STATE_LABEL_SIZE_PX
} from "../viz/label-scales";

/** Esri's generalized state boundaries. Recorded in the source inventory. */
export const STATES_SERVICE_URL =
  "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/" +
  "USA_States_Generalized_Boundaries/FeatureServer/0";

/** Esri's generalized county boundaries. Recorded in the source inventory. */
export const COUNTIES_SERVICE_URL =
  "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/" +
  "USA_Counties_Generalized_Boundaries/FeatureServer/0";

export const STATE_LAYER_ID = "reference-states";
export const COUNTY_LAYER_ID = "reference-counties";

/** The field each service names its features with, read once here so a
 * rename upstream is one line rather than four. */
const STATE_NAME_FIELD = "STATE_NAME";
const COUNTY_NAME_FIELD = "NAME";

/**
 * How long a boundary service may take before the map goes on without it.
 *
 * Much shorter than the view's own deadline. This is decoration on a map
 * that is already drawn, and a reader should not wait half a minute to find
 * out that an outline is not coming.
 */
export const REFERENCE_LOAD_TIMEOUT_MS = 8000;

export interface ReferenceLayers {
  states: FeatureLayer | null;
  counties: FeatureLayer | null;
}

/**
 * Loads a layer against a deadline. Resolves to null on a refusal, an error
 * or a timeout -- every way of not arriving is the same fact to the caller.
 */
async function loadWithin(
  layer: FeatureLayer, timeoutMs: number
): Promise<FeatureLayer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const result = await Promise.race([
      layer.load().then(() => layer).catch(() => null),
      deadline
    ]);
    if (!result) {
      console.warn(`A boundary service did not answer in time: ${layer.url ?? layer.id}`);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function stateLayer(): FeatureLayer {
  return new FeatureLayer({
    id: STATE_LAYER_ID,
    url: STATES_SERVICE_URL,
    listMode: "hide",
    outFields: [STATE_NAME_FIELD],
    // These pages describe what a reader points at in their own card.
    popupEnabled: false,
    renderer: {
      type: "simple",
      symbol: {
        type: "simple-fill",
        /* Outlines only. A fill here would tint the drought classes
         * underneath, and the classes are the monitor's published colours --
         * the one thing on that map that must arrive unaltered. */
        color: [0, 0, 0, 0],
        outline: { color: "rgba(90,104,116,0.55)", width: 0.8 }
      }
    } as never,
    labelsVisible: true,
    labelingInfo: [{
      labelExpressionInfo: { expression: `$feature.${STATE_NAME_FIELD}` },
      labelPlacement: "always-horizontal",
      minScale: STATE_LABEL_SCALE.minScale,
      maxScale: STATE_LABEL_SCALE.maxScale,
      deconflictionStrategy: "static",
      /* The outermost container, so the largest type on the map -- and the
       * quietest, in grey with wide letter spacing. It is a place name on a
       * reference layer, not a heading. */
      symbol: {
        type: "text",
        color: "rgba(74,91,102,0.85)",
        haloColor: "rgba(255,255,255,0.7)",
        haloSize: "1.4px",
        font: { family: "sans-serif", size: STATE_LABEL_SIZE_PX, weight: "normal" }
      }
    }] as never
  });
}

function countyLayer(): FeatureLayer {
  return new FeatureLayer({
    id: COUNTY_LAYER_ID,
    url: COUNTIES_SERVICE_URL,
    listMode: "hide",
    outFields: [COUNTY_NAME_FIELD],
    popupEnabled: false,
    /* The layer itself is scale-limited, not only its labels. Three thousand
     * hairlines at regional scale is the overload this ladder exists to
     * avoid, and hiding the whole layer also stops it fetching features
     * nobody will see. */
    minScale: COUNTY_SCALE.minScale,
    maxScale: COUNTY_SCALE.maxScale,
    renderer: {
      type: "simple",
      symbol: {
        type: "simple-fill",
        color: [0, 0, 0, 0],
        // Fainter and thinner than the states: one step down the ladder.
        outline: { color: "rgba(120,133,143,0.4)", width: 0.5 }
      }
    } as never,
    labelsVisible: true,
    labelingInfo: [{
      labelExpressionInfo: { expression: `$feature.${COUNTY_NAME_FIELD}` },
      labelPlacement: "always-horizontal",
      // On later than the outlines: an outline is context, a name is a claim.
      minScale: COUNTY_LABEL_SCALE.minScale,
      maxScale: COUNTY_LABEL_SCALE.maxScale,
      deconflictionStrategy: "static",
      symbol: {
        type: "text",
        color: "rgba(108,122,133,0.85)",
        haloColor: "rgba(255,255,255,0.7)",
        haloSize: "1.2px",
        font: { family: "sans-serif", size: COUNTY_LABEL_SIZE_PX, weight: "normal" }
      }
    }] as never
  });
}

/**
 * The boundary context for a map, each half independently optional.
 *
 * Requested together and awaited together, so one slow service does not
 * delay the other, and either may come back null.
 */
export async function loadReferenceBoundaries(
  timeoutMs = REFERENCE_LOAD_TIMEOUT_MS
): Promise<ReferenceLayers> {
  const [states, counties] = await Promise.all([
    loadWithin(stateLayer(), timeoutMs),
    loadWithin(countyLayer(), timeoutMs)
  ]);
  return { states, counties };
}
