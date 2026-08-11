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
