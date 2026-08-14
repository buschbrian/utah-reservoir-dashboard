import { describe, expect, it } from "vitest";
import type { DrainageArea } from "../data/boundaries";
import {
  DRAINAGE_LABEL_MIN_SCALE,
  DRAINAGE_NAME_FIELD,
  createDrainageLayer
} from "./layers";

const square = (west: number, south: number): [number, number][] => [
  [west, south], [west + 1, south], [west + 1, south + 1],
  [west, south + 1], [west, south]
];

describe("the drainage-area layer", () => {
  it("builds one source feature and one label candidate per HUC6", () => {
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
    expect(result.layer.source.at(0)?.geometry?.type).toBe("polygon");
    expect((result.layer.source.at(0)?.geometry as { rings?: unknown[] }).rings).toHaveLength(2);
  });

  it("uses one name label class at the regional map scale", () => {
    const result = createDrainageLayer([{
      huc6: "160202",
      name: "Jordan",
      states: "UT",
      polygons: [[square(-112, 40)]]
    }]);
    const labels = result.layer.labelingInfo ?? [];
    const label = labels[0];

    expect(result.layer.labelsVisible).toBe(true);
    expect(labels).toHaveLength(1);
    expect(label?.labelExpressionInfo?.expression).toBe(`$feature.${DRAINAGE_NAME_FIELD}`);
    expect(label?.minScale).toBe(DRAINAGE_LABEL_MIN_SCALE);
  });
});
