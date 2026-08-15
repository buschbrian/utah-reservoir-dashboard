import { describe, expect, it } from "vitest";
import { reservoirFromHits } from "./hit";

const reservoirs = [
  { name: "Deer Creek" },
  { name: "Jordanelle" }
];

describe("reservoir hit selection", () => {
  it("uses the reservoir object ID when the layer view omits the name", () => {
    const hit = reservoirFromHits(reservoirs, [{
      graphic: {
        layer: { id: "reservoirs" },
        attributes: { objectid: 2 }
      }
    }]);

    expect(hit?.reservoir.name).toBe("Jordanelle");
  });

  it("does not treat a drainage-area object ID as a reservoir", () => {
    const hit = reservoirFromHits(reservoirs, [{
      graphic: {
        layer: { id: "drainage-areas" },
        attributes: { objectid: 1 }
      }
    }]);

    expect(hit).toBeNull();
  });

  it("keeps accepting a named hit without layer metadata", () => {
    const hit = reservoirFromHits(reservoirs, [{
      graphic: { attributes: { name: "deer creek" } }
    }]);

    expect(hit?.reservoir.name).toBe("Deer Creek");
  });
});
