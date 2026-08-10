import { describe, expect, it } from "vitest";
import {
  DRAINAGE_FILL,
  DRAINAGE_LINE,
  MASK_FILL,
  MASK_LINE,
  parseDrainageAreas,
  parseUtahBoundary,
  utahMaskRings
} from "./boundaries";
import { loadLegacyApi } from "./legacy-harness";
import {
  readDrainageGeoJson,
  readPayload,
  readUtahBoundaryGeoJson
} from "./payload-fixture";

const legacy = loadLegacyApi();

describe("the Utah mask", () => {
  const boundary = parseUtahBoundary(readUtahBoundaryGeoJson());

  it("reads the authoritative UGRC boundary rather than a corner approximation", () => {
    expect(boundary).not.toBeNull();
    expect(boundary?.[0]?.[0]?.length).toBeGreaterThan(100);
    const outer = boundary?.[0]?.[0] ?? [];
    const signedArea = outer.slice(0, -1).reduce((area, [x, y], index) => {
      const next = outer[index + 1] ?? outer[0];
      return area + x * next[1] - next[0] * y;
    }, 0) / 2;
    expect(signedArea).toBeGreaterThan(0);
  });

  it("keeps the rings and colours the production maps draw", () => {
    expect(utahMaskRings(boundary ?? [])).toEqual(
      legacy.utahMaskRings(boundary ?? undefined));
    expect(MASK_FILL).toBe(legacy.MASK_FILL);
    expect(MASK_LINE).toBe(legacy.MASK_LINE);
    expect(DRAINAGE_FILL).toBe(legacy.HUC_FILL);
    expect(DRAINAGE_LINE).toBe(legacy.HUC_LINE);
  });

  it("puts the state inside a far larger surround, so it reads as a hole", () => {
    const [surround, hole] = utahMaskRings(boundary ?? []);
    expect(hole?.length).toBeGreaterThan(100);
    const longitudes = (surround ?? []).map(([lon]) => lon);
    expect(Math.min(...longitudes)).toBeLessThan(-114.052);
    expect(Math.max(...longitudes)).toBeGreaterThan(-109.041);
    // Not the whole world: an antimeridian-spanning ring dimmed Utah
    // instead of everything around it.
    expect(Math.min(...longitudes)).toBeGreaterThan(-180);
  });
});

describe("drainage-area boundaries", () => {
  const areas = parseDrainageAreas(readDrainageGeoJson());

  it("reads every committed area", () => {
    const collection = readDrainageGeoJson() as { features: unknown[] };
    expect(areas).toHaveLength(collection.features.length);
    for (const area of areas) {
      expect(area.huc6).toMatch(/^\d{6}$/);
      expect(area.polygons.length).toBeGreaterThan(0);
      expect(area.polygons[0]?.[0]?.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("covers the areas the published reservoirs are assigned to", () => {
    const drawn = new Set(areas.map((area) => area.huc6));
    const assigned = new Set(readPayload().reservoirs
      .map((reservoir) => reservoir.huc6)
      .filter((huc6): huc6 is string => typeof huc6 === "string"));
    expect([...assigned].filter((huc6) => !drawn.has(huc6))).toEqual([]);
  });

  /* The reservoirs are the page; the outlines are context. A boundary file
   * that arrives broken, half-written or replaced by an error document must
   * cost the reader context and nothing else. */
  it.each([
    ["not a collection", {}],
    ["a null payload", null],
    ["an error document", { error: { code: 500 } }],
    ["features that are not objects", { features: [1, "two", null] }]
  ])("reads %s as no boundaries rather than throwing", (_label, value) => {
    expect(parseDrainageAreas(value)).toEqual([]);
  });

  it("keeps the readable areas when one feature is malformed", () => {
    const collection = readDrainageGeoJson() as { features: unknown[] };
    const damaged = {
      ...collection,
      features: [{ type: "Feature", properties: { huc6: "160200" }, geometry: null },
        ...collection.features]
    };
    expect(parseDrainageAreas(damaged)).toHaveLength(collection.features.length);
  });

  it("accepts a multipolygon area", () => {
    const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const parsed = parseDrainageAreas({
      features: [{
        properties: { huc6: "160203", name: "Split area", states: "UT" },
        geometry: { type: "MultiPolygon", coordinates: [[square], [square]] }
      }]
    });
    expect(parsed[0]?.polygons).toHaveLength(2);
    expect(parsed[0]?.name).toBe("Split area");
  });
});
