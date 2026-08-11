/* The region is a ported constant, so the first test is the one that keeps
 * the three engines constraining navigation to the same box. The rest are
 * about where selecting a reservoir takes the view -- decisions, not
 * geometry, and asserted over the published reservoirs rather than over a
 * literal coordinate. */
import { describe, expect, it } from "vitest";
import { loadLegacyApi } from "../data/legacy-harness";
import { readPayload } from "../data/payload-fixture";
import {
  MAP_BOUNDS,
  MAP_CENTER,
  MAP_MIN_ZOOM,
  SELECTION_ZOOM,
  regionExtent,
  selectionTarget,
  withinRegion
} from "./extent";

const legacy = loadLegacyApi();
const reservoirs = readPayload().reservoirs;

describe("the navigable region", () => {
  it("is the region both production maps already use", () => {
    expect(MAP_BOUNDS.map((corner) => [...corner])).toEqual(legacy.MAP_BOUNDS.map((c) => [...c]));
    expect(MAP_MIN_ZOOM).toBe(legacy.MAP_MIN_ZOOM);
    expect([...MAP_CENTER]).toEqual([...legacy.MAP_CENTER]);
  });

  it("describes the same box as an extent", () => {
    const extent = regionExtent();
    expect([[extent.xmin, extent.ymin], [extent.xmax, extent.ymax]])
      .toEqual(MAP_BOUNDS.map((corner) => [...corner]));
    expect(extent.spatialReference.wkid).toBe(4326);
    expect(extent.xmin).toBeLessThan(extent.xmax);
    expect(extent.ymin).toBeLessThan(extent.ymax);
  });

  it("contains every reservoir the map draws", () => {
    // If this fails the region is wrong, not the data: a reservoir in scope
    // that the map will not navigate to is unreachable by selection.
    for (const reservoir of reservoirs) {
      expect(withinRegion(reservoir.lon, reservoir.lat), reservoir.name).toBe(true);
    }
  });

  it("does not contain somewhere the reader should never end up", () => {
    expect(withinRegion(0, 0)).toBe(false);
    expect(withinRegion(-160, 20)).toBe(false);
  });
});

/* Where the map opens, which the two production pages take from the shared
 * module and the modern map takes from its own layer's extent. The three
 * have to agree or the engines stop being comparable (ADR-007), so this
 * holds the shared answer against the reservoirs it is computed from
 * rather than against a written-down box. */
describe("where the map opens", () => {
  const opening = legacy.reservoirBounds(reservoirs);

  it("contains every reservoir it was computed from", () => {
    for (const reservoir of reservoirs) {
      expect(reservoir.lon, reservoir.name).toBeGreaterThanOrEqual(opening[0][0]);
      expect(reservoir.lon, reservoir.name).toBeLessThanOrEqual(opening[1][0]);
      expect(reservoir.lat, reservoir.name).toBeGreaterThanOrEqual(opening[0][1]);
      expect(reservoir.lat, reservoir.name).toBeLessThanOrEqual(opening[1][1]);
    }
  });

  it("never opens outside the region navigation is held inside", () => {
    expect(opening[0][0]).toBeGreaterThanOrEqual(MAP_BOUNDS[0][0]);
    expect(opening[0][1]).toBeGreaterThanOrEqual(MAP_BOUNDS[0][1]);
    expect(opening[1][0]).toBeLessThanOrEqual(MAP_BOUNDS[1][0]);
    expect(opening[1][1]).toBeLessThanOrEqual(MAP_BOUNDS[1][1]);
  });

  it("is tighter than the region, which is the whole point", () => {
    const span = (box: readonly (readonly [number, number])[]): number =>
      ((box[1]?.[0] ?? 0) - (box[0]?.[0] ?? 0)) * ((box[1]?.[1] ?? 0) - (box[0]?.[1] ?? 0));
    expect(span(opening)).toBeLessThan(span(MAP_BOUNDS));
  });

  it("gives an empty payload the region rather than a box with no width", () => {
    expect(legacy.reservoirBounds([]).map((corner) => [...corner]))
      .toEqual(MAP_BOUNDS.map((corner) => [...corner]));
    expect(legacy.reservoirBounds(null).map((corner) => [...corner]))
      .toEqual(MAP_BOUNDS.map((corner) => [...corner]));
  });

  it("keeps a usable box around a single reservoir", () => {
    const one = legacy.reservoirBounds([{ lon: -111.5, lat: 39.5 }]);
    expect(one[1][0]).toBeGreaterThan(one[0][0]);
    expect(one[1][1]).toBeGreaterThan(one[0][1]);
  });

  it("ignores a record with no usable position", () => {
    const withJunk = legacy.reservoirBounds([
      ...reservoirs, { lon: Number.NaN, lat: Number.NaN }, { lon: null, lat: null }
    ]);
    expect(withJunk.map((corner) => [...corner])).toEqual(opening.map((corner) => [...corner]));
  });
});

describe("where selecting a reservoir goes", () => {
  it("centres on the reservoir, inside the region, for every published one", () => {
    for (const reservoir of reservoirs) {
      const target = selectionTarget(reservoir);
      expect(target.center).toEqual([reservoir.lon, reservoir.lat]);
      expect(withinRegion(...target.center), reservoir.name).toBe(true);
    }
  });

  it("never leaves the region, even for a reservoir outside it", () => {
    const target = selectionTarget({ lon: -170, lat: 5 });
    expect(withinRegion(...target.center)).toBe(true);
    expect(target.center).toEqual([MAP_BOUNDS[0]?.[0], MAP_BOUNDS[0]?.[1]]);
  });

  it("never zooms out from where the reader already is", () => {
    const reservoir = reservoirs[0];
    expect(reservoir).toBeDefined();
    if (!reservoir) return;
    expect(selectionTarget(reservoir, 12).zoom).toBe(12);
    expect(selectionTarget(reservoir, SELECTION_ZOOM + 1).zoom).toBe(SELECTION_ZOOM + 1);
  });

  it("zooms in when the reader is further out than the selection zoom", () => {
    const reservoir = reservoirs[0];
    expect(reservoir).toBeDefined();
    if (!reservoir) return;
    expect(selectionTarget(reservoir, 5).zoom).toBe(SELECTION_ZOOM);
    expect(selectionTarget(reservoir).zoom).toBe(SELECTION_ZOOM);
  });

  it("never asks for a zoom the constraint would refuse", () => {
    const reservoir = reservoirs[0];
    expect(reservoir).toBeDefined();
    if (!reservoir) return;
    for (const current of [Number.NaN, 0, 1, MAP_MIN_ZOOM - 1]) {
      expect(selectionTarget(reservoir, current).zoom).toBeGreaterThanOrEqual(MAP_MIN_ZOOM);
    }
  });
});
