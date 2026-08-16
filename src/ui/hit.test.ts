import { describe, expect, it } from "vitest";
import { hitLayerId, reservoirFromHits } from "./hit";

const reservoirs = [
  { name: "Deer Creek" },
  { name: "Jordanelle" }
];

describe("reservoir hit selection", () => {
  it("uses the reservoir object ID when the layer view omits the name", () => {
    const hit = reservoirFromHits(reservoirs, [{
      layer: { id: "reservoirs" },
      graphic: { attributes: { objectid: 2 } }
    }]);

    expect(hit?.reservoir.name).toBe("Jordanelle");
  });

  it("does not treat a drainage-area object ID as a reservoir", () => {
    const hit = reservoirFromHits(reservoirs, [{
      layer: { id: "drainage-areas" },
      graphic: { attributes: { objectid: 1 } }
    }]);

    expect(hit).toBeNull();
  });

  it("does not fall back to the object ID when the hit carries no layer at all", () => {
    const hit = reservoirFromHits(reservoirs, [{
      graphic: { attributes: { objectid: 2 } }
    }]);

    expect(hit).toBeNull();
  });

  it("accepts SDK hits that attach the reservoir layer to the graphic", () => {
    const hit = reservoirFromHits(reservoirs, [{
      graphic: {
        layer: { id: "reservoirs" },
        attributes: { objectid: 1 }
      }
    }]);

    expect(hit?.reservoir.name).toBe("Deer Creek");
  });

  it("keeps accepting a named hit without layer metadata", () => {
    const hit = reservoirFromHits(reservoirs, [{
      graphic: { attributes: { name: "deer creek" } }
    }]);

    expect(hit?.reservoir.name).toBe("Deer Creek");
  });
});

describe("which layer a hit came from", () => {
  /* The snow and drought maps put three and four layers into one hit test
   * and tell the answers apart by this. The SDK carries the layer in two
   * different places -- on the hit result for feature layers, on the graphic
   * for graphics layers -- so both are read, result first. */
  it("reads the layer off the hit result", () => {
    expect(hitLayerId({ layer: { id: "snow-sites" }, graphic: {} }))
      .toBe("snow-sites");
  });

  it("falls back to the layer the graphic carries", () => {
    expect(hitLayerId({ graphic: { layer: { id: "snow-basins" } } }))
      .toBe("snow-basins");
  });

  it("prefers the result over the graphic when both are present", () => {
    expect(hitLayerId({
      layer: { id: "reservoir-reference" },
      graphic: { layer: { id: "snow-basins" } }
    })).toBe("reservoir-reference");
  });

  it("answers null rather than undefined when neither carries one", () => {
    expect(hitLayerId({ graphic: {} })).toBeNull();
    expect(hitLayerId({})).toBeNull();
  });
});
