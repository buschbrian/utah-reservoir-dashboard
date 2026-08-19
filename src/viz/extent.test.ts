/* The region is a ported constant, so the first test is the one that keeps
 * the three engines constraining navigation to the same box. The rest are
 * about where selecting a reservoir takes the view -- decisions, not
 * geometry, and asserted over the published reservoirs rather than over a
 * literal coordinate. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDrainageUnits } from "../data/boundaries";
import { loadLegacyApi } from "../data/legacy-harness";
import { readPayload } from "../data/payload-fixture";
import {
  HUC6_BOUNDS,
  MAP_BOUNDS,
  MAP_CENTER,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  expandBounds,
  SELECTION_ZOOM,
  regionExtent,
  selectionTarget,
  unionOfAreaBoxes,
  withinRegion
} from "./extent";

const legacy = loadLegacyApi();
const reservoirs = readPayload().reservoirs;

describe("the navigable region", () => {
  /*
   * The geography stays pinned to the frozen module. Where a reader may go
   * is a contract shared with the saved links the retired routes translate,
   * and it must not drift.
   *
   * How far they may zoom is not, and is no longer checked against it. That
   * parity was written when two production maps had to agree with each
   * other; ADR-031 retired the second, and the frozen module is source-only
   * and draws nothing. Holding the view's constraints to it meant a value
   * measured against the real cards -- which is how 4 was found to be
   * 1:37,000,000, most of a continent -- could not be corrected without
   * editing an oracle whose job is colour.
   *
   * So these two are asserted for what they have to be true of instead.
   */
  it("is the region the retired routes still translate links into", () => {
    expect(MAP_BOUNDS.map((corner) => [...corner])).toEqual(legacy.MAP_BOUNDS.map((c) => [...c]));
    expect([...MAP_CENTER]).toEqual([...legacy.MAP_CENTER]);
  });

  it("keeps the zoom envelope between a world map and a dam", () => {
    expect(MAP_MIN_ZOOM).toBeLessThan(MAP_MAX_ZOOM);
    /* Web Mercator scale is about 1:591,657,527 / 2^z. Level 5 is
     * 1:18,500,000, which still holds the whole connected geography this
     * dashboard covers; anything lower starts showing the continent. */
    expect(MAP_MIN_ZOOM).toBeGreaterThanOrEqual(5);
    /* And far enough out that every map's opening view is reachable. The
     * widest of them opens near 1:11,000,000, which is level 5.7. */
    expect(MAP_MIN_ZOOM).toBeLessThanOrEqual(6);
    /* Deep enough to read a dam, and no deeper: past about 1:9,000 there is
     * nothing in this data finer to look at. */
    expect(MAP_MAX_ZOOM).toBeGreaterThanOrEqual(14);
    expect(MAP_MAX_ZOOM).toBeLessThanOrEqual(18);
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

/* The map's geography is derived from the drainage-area polygons, which are
 * the primary source. HUC6_BOUNDS is written down because both engines need
 * their navigation constraint when the view is constructed, before any
 * boundary file has been fetched -- so the file it describes is read here
 * and the constant held against it.
 *
 * Which file that is comes from the reference export rather than being named
 * here: the areas drawn and the areas holding reservoirs stopped being one
 * set when the coverage moved west (ADR-063), and the extent follows the
 * roster. Naming `huc6.geojson` in this test would have pinned the box to the
 * file that happens to be the roster's today, and the box would have silently
 * stopped following the reservoirs the morning the roster expanded. */
describe("the drainage-area extent the map is built from", () => {
  const reference = JSON.parse(
    readFileSync(new URL("../../reference.json", import.meta.url), "utf8")
  ) as {
    geography: {
      watersheds: {
        roster_scope: string;
        scopes: Record<string, { source_file: string; level: number; units: unknown }>;
      };
    };
  };
  const watersheds = reference.geography.watersheds;
  const rosterScope = watersheds.scopes[watersheds.roster_scope];
  if (!rosterScope) {
    throw new Error(
      `reference.json names roster scope ${watersheds.roster_scope}, which it does not publish`);
  }
  const huc6 = JSON.parse(
    readFileSync(new URL(`../../${rosterScope.source_file}`, import.meta.url), "utf8")
  ) as { features: { geometry: { coordinates: unknown } }[] };

  function boundsOf(features: typeof huc6.features): [[number, number], [number, number]] {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    const walk = (node: unknown): void => {
      if (!Array.isArray(node)) return;
      if (typeof node[0] === "number" && typeof node[1] === "number") {
        west = Math.min(west, node[0]); east = Math.max(east, node[0]);
        south = Math.min(south, node[1]); north = Math.max(north, node[1]);
        return;
      }
      for (const child of node) walk(child);
    };
    for (const feature of features) walk(feature.geometry.coordinates);
    return [[west, south], [east, north]];
  }

  it("matches the polygons of the areas that hold reservoirs", () => {
    const measured = boundsOf(huc6.features);
    // To the same three decimals the constant is written at: the file is
    // published to five, and rounding is what makes the constant readable.
    expect(HUC6_BOUNDS[0][0]).toBeCloseTo(measured[0][0], 3);
    expect(HUC6_BOUNDS[0][1]).toBeCloseTo(measured[0][1], 3);
    expect(HUC6_BOUNDS[1][0]).toBeCloseTo(measured[1][0], 3);
    expect(HUC6_BOUNDS[1][1]).toBeCloseTo(measured[1][1], 3);
  });

  it("contains every polygon of the areas that hold reservoirs", () => {
    const measured = boundsOf(huc6.features);
    expect(HUC6_BOUNDS[0][0]).toBeLessThanOrEqual(measured[0][0] + 0.001);
    expect(HUC6_BOUNDS[0][1]).toBeLessThanOrEqual(measured[0][1] + 0.001);
    expect(HUC6_BOUNDS[1][0]).toBeGreaterThanOrEqual(measured[1][0] - 0.001);
    expect(HUC6_BOUNDS[1][1]).toBeGreaterThanOrEqual(measured[1][1] - 0.001);
  });

  it("is the shared module's, so the three maps use one geography", () => {
    expect(HUC6_BOUNDS.map((corner) => [...corner]))
      .toEqual(legacy.HUC6_BOUNDS.map((corner) => [...corner]));
  });

  /* S1 published a box per unit (`bbox`, `huc.outer_bbox`) so a future
   * chooser can build an opening view from whatever areas a reader picks,
   * rather than only from the fixed roster scope. This holds that second
   * path against the first: unioning the roster scope's own published boxes
   * has to land on the same box `HUC6_BOUNDS` is pinned to, or a reader who
   * chose every roster area one at a time would get a different view than
   * the one the map opens on by default.
   *
   * Not an exact match: the published boxes are rounded outward to three
   * decimal places (`PUBLISHED_BBOX_DECIMALS` in `huc.py`) and `HUC6_BOUNDS`
   * is the unrounded extreme, so the union can only be as wide as
   * `HUC6_BOUNDS` or up to one thousandth of a degree wider on each edge --
   * never narrower, because a narrower published box would clip the very
   * area it describes, which `test_watershed_scopes.py` also guards. */
  it("equals HUC6_BOUNDS when the roster scope's own published boxes are unioned", () => {
    const areas = parseDrainageUnits(rosterScope.units, rosterScope.level);
    const union = unionOfAreaBoxes(areas);

    expect(union).not.toBeNull();
    if (!union) return;

    expect(union[0][0]).toBeLessThanOrEqual(HUC6_BOUNDS[0][0]);
    expect(union[0][0]).toBeGreaterThan(HUC6_BOUNDS[0][0] - 0.001);
    expect(union[0][1]).toBeLessThanOrEqual(HUC6_BOUNDS[0][1]);
    expect(union[0][1]).toBeGreaterThan(HUC6_BOUNDS[0][1] - 0.001);

    expect(union[1][0]).toBeGreaterThanOrEqual(HUC6_BOUNDS[1][0]);
    expect(union[1][0]).toBeLessThan(HUC6_BOUNDS[1][0] + 0.001);
    expect(union[1][1]).toBeGreaterThanOrEqual(HUC6_BOUNDS[1][1]);
    expect(union[1][1]).toBeLessThan(HUC6_BOUNDS[1][1] + 0.001);
  });
});

describe("unioning a chosen set of areas' published boxes", () => {
  const box = (west: number, south: number, east: number, north: number):
    [[number, number], [number, number]] => [[west, south], [east, north]];

  it("is null when none of the areas have a box", () => {
    expect(unionOfAreaBoxes([{ huc6: "140100", name: "No box", states: "" }])).toBeNull();
  });

  it("contains every area's box, and nothing wider", () => {
    const areas = [
      { huc6: "140100", name: "A", states: "", box: box(-112, 39, -111, 40) },
      { huc6: "140200", name: "B", states: "", box: box(-113, 38, -110, 39.5) }
    ];
    expect(unionOfAreaBoxes(areas)).toEqual(box(-113, 38, -110, 40));
  });

  it("skips an area with no box rather than failing the whole union", () => {
    const areas = [
      { huc6: "140100", name: "A", states: "", box: box(-112, 39, -111, 40) },
      { huc6: "140200", name: "No box here", states: "" }
    ];
    expect(unionOfAreaBoxes(areas)).toEqual(box(-112, 39, -111, 40));
  });

  it("returns a single area's own box unchanged", () => {
    const areas = [{ huc6: "140100", name: "A", states: "", box: box(-112, 39, -111, 40) }];
    expect(unionOfAreaBoxes(areas)).toEqual(box(-112, 39, -111, 40));
  });
});

describe("one zoom level out", () => {
  it("doubles the box about its centre", () => {
    expect(expandBounds([[-10, -10], [10, 10]], 2)).toEqual([[-20, -20], [20, 20]]);
    expect(expandBounds([[0, 0], [10, 20]], 2)).toEqual([[-5, -10], [15, 30]]);
  });

  it("leaves a box alone at a factor of one", () => {
    expect(expandBounds([[-3, -4], [5, 6]], 1)).toEqual([[-3, -4], [5, 6]]);
  });

  it("is what the opening extent is, measured from the drainage areas", () => {
    expect(MAP_BOUNDS.map((corner) => [...corner]))
      .toEqual(expandBounds(HUC6_BOUNDS, 2).map((corner) => [...corner]));
  });

  it("contains the drainage areas it was expanded from", () => {
    expect(MAP_BOUNDS[0][0]).toBeLessThan(HUC6_BOUNDS[0][0]);
    expect(MAP_BOUNDS[0][1]).toBeLessThan(HUC6_BOUNDS[0][1]);
    expect(MAP_BOUNDS[1][0]).toBeGreaterThan(HUC6_BOUNDS[1][0]);
    expect(MAP_BOUNDS[1][1]).toBeGreaterThan(HUC6_BOUNDS[1][1]);
  });

  it("still contains every reservoir the map draws", () => {
    for (const reservoir of reservoirs) {
      expect(withinRegion(reservoir.lon, reservoir.lat), reservoir.name).toBe(true);
    }
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
