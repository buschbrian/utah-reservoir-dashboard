import { describe, expect, it } from "vitest";
import type { DrainageArea } from "../data/boundaries";
import type { Reservoir } from "../types";
import { cssPixelsToPoints } from "../viz/units";
import {
  DRAINAGE_LABEL_HALO_COLOR,
  DRAINAGE_LABEL_MIN_SCALE,
  DRAINAGE_LABEL_HALO_PX,
  DRAINAGE_NAME_FIELD,
  NAME_FIELD,
  createDrainageLayer,
  createReservoirLayer
} from "./layers";

const square = (west: number, south: number): [number, number][] => [
  [west, south], [west + 1, south], [west + 1, south + 1],
  [west, south + 1], [west, south]
];

describe("the reservoir layer", () => {
  const reservoir = (name: string): Reservoir => ({
    name,
    lon: -111,
    lat: 40,
    current_storage_af: 1000,
    capacity_af: 2000,
    pct_of_capacity: 50,
    as_of: "2026-08-14",
    source_key: "rise",
    monthly: []
  } as unknown as Reservoir);

  /**
   * The regression this pins is invisible in the source and only appears in
   * a painting browser: `hitTest` answers from the layer *view*, which
   * materializes the fields it can prove the layer needs. The renderer needs
   * `symbol_key`, `size_basis` and `fill_percent`, so the hit graphic came
   * back with no `name` on it and pointer selection had nothing to identify
   * a reservoir by -- until a scope change replaced the layer, after which
   * the replacement carried every field and clicking started working.
   *
   * Asserting the request rather than the answer is the point: the answer
   * needs a render loop, and there is no render loop here or in the smoke
   * test's headless browser.
   */
  it("requests every field, so a hit graphic can identify its reservoir", () => {
    const { layer } = createReservoirLayer([reservoir("Deer Creek")]);

    expect(layer.outFields).toContain("*");
    expect(layer.fields?.map((field) => field.name)).toContain(NAME_FIELD);
    expect(layer.source.at(0)?.attributes?.[NAME_FIELD]).toBe("Deer Creek");
  });
});

describe("the drainage-area layer", () => {
  it("builds one source feature and one background label per HUC6", () => {
    const areas: DrainageArea[] = [{
      huc6: "140100",
      name: "Colorado Headwaters",
      states: "CO,UT",
      // Two disconnected polygons still belong to one drainage-area feature.
      polygons: [[square(-110, 39)], [square(-108, 39)]]
    }, {
      huc6: "160202",
      name: "Jordan",
      states: "UT",
      polygons: [[square(-112, 40)]]
    }];

    const result = createDrainageLayer(areas);

    expect(result.labels).toBe(areas.length);
    expect(result.layer.source.length).toBe(areas.length);
    expect(result.labelLayer.graphics.length).toBe(areas.length);
    expect(result.layer.source.at(0)?.geometry?.type).toBe("polygon");
    expect((result.layer.source.at(0)?.geometry as { rings?: unknown[] }).rings).toHaveLength(2);
    expect(result.labelLayer.graphics.at(0)?.geometry?.type).toBe("point");
  });

  it("uses one name symbol with a half-opacity halo at the regional map scale", () => {
    const result = createDrainageLayer([{
      huc6: "160202",
      name: "Jordan",
      states: "UT",
      polygons: [[square(-112, 40)]]
    }]);
    const label = result.labelLayer.graphics.at(0);
    const symbol = label?.symbol;

    expect(result.layer.labelingInfo ?? []).toHaveLength(0);
    expect(result.labelLayer.minScale).toBe(DRAINAGE_LABEL_MIN_SCALE);
    expect(result.labelLayer.graphics).toHaveLength(1);
    expect(label?.attributes?.[DRAINAGE_NAME_FIELD]).toBe("Jordan");
    expect(symbol?.type).toBe("text");
    expect((symbol as { text?: string } | null | undefined)?.text).toBe("Jordan");
    expect((symbol as { haloSize?: number } | null | undefined)?.haloSize)
      .toBe(cssPixelsToPoints(DRAINAGE_LABEL_HALO_PX));
    expect((symbol as { haloColor?: { toCss(alpha?: boolean): string } } | null | undefined)
      ?.haloColor?.toCss(true).replaceAll(" ", "")).toBe(DRAINAGE_LABEL_HALO_COLOR);
  });
});
