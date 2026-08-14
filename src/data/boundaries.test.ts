import { describe, expect, it } from "vitest";
import {
  DRAINAGE_FILL,
  DRAINAGE_LINE,
  MASK_FILL,
  MASK_LINE,
  REFERENCE_SCHEMA_VERSION,
  parseDrainageAreas,
  parseUtahBoundary,
  referenceGeography,
  utahMaskRings
} from "./boundaries";
import { loadLegacyApi } from "./legacy-harness";
import {
  readDrainageGeoJson,
  readPayload,
  readReferenceExport,
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
      if (!next) return area;
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

describe("the reference export", () => {
  const sections = referenceGeography(readReferenceExport());

  it("hands the parsers the same geometry the standalone files hold", () => {
    /* The export is a repackaging, not a second copy with a life of its
     * own. If these ever differ, two pages drawing from two files disagree
     * about where a drainage area is -- and the maps exist to be compared
     * (ADR-007), so a difference would read as an engine difference. */
    expect(sections?.state).toEqual(readUtahBoundaryGeoJson());
    expect(sections?.drainage).toEqual(readDrainageGeoJson());
  });

  it("draws the scope the export names, not one written down here", () => {
    const published = parseDrainageAreas(sections?.drainage);
    const assigned = new Set(readPayload().reservoirs
      .map((reservoir) => reservoir.huc6)
      .filter((huc6): huc6 is string => typeof huc6 === "string"));
    const drawn = new Set(published.map((area) => area.huc6));
    expect([...assigned].filter((huc6) => !drawn.has(huc6))).toEqual([]);
    // The research scopes travel in the same file and must stay undrawn.
    expect(published).toHaveLength((readDrainageGeoJson() as { features: unknown[] })
      .features.length);
  });

  it("reads a payload from a later shape as no boundaries at all", () => {
    /* Not a best effort at parsing it: a later shape may put the outlines
     * somewhere else, and half-understanding one is how a map draws the
     * wrong geography while looking like it worked. */
    const later = { ...(readReferenceExport() as object), schema_version: 99 };
    expect(referenceGeography(later)).toBeNull();
    expect(REFERENCE_SCHEMA_VERSION).toBe(1);
  });

  it.each([
    ["a null payload", null],
    ["an error document", { error: { code: 500 } }],
    ["no version at all", { geography: { state: {}, watersheds: {} } }],
    ["no geography", { schema_version: 1 }],
    ["a scope name nothing matches", {
      schema_version: 1,
      geography: { state: {}, watersheds: { default_scope: "gone", scopes: {} } }
    }]
  ])("survives %s without throwing", (_label, value) => {
    const parsed = referenceGeography(value);
    // Either no sections at all, or sections whose halves parse as empty --
    // both are the soft failure the callers already handle.
    expect(parseDrainageAreas(parsed?.drainage)).toEqual([]);
    expect(parseUtahBoundary(parsed?.state)).toBeNull();
  });
});
