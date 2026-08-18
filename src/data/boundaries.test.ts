import { describe, expect, it } from "vitest";
import {
  DRAINAGE_FILL,
  DRAINAGE_LINE,
  MASK_FILL,
  MASK_LINE,
  REFERENCE_SCHEMA_VERSION,
  JOINABLE_LEVEL,
  parseDrainageUnits,
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

/* Codes and names, not shapes. The outlines are the hosted layer's since
 * ADR-047, and the 982 KB of geometry that used to travel in this file --
 * and be type-checked coordinate by coordinate on the main thread on the
 * way past -- went with them. */
describe("the drainage-area roster", () => {
  const roster = () => (readDrainageGeoJson() as {
    features: { properties: Record<string, string> }[]
  }).features.map((feature) => ({
    huc6: feature.properties["huc6"] ?? "",
    name: feature.properties["name"] ?? "",
    states: feature.properties["states"] ?? ""
  }));
  const areas = parseDrainageUnits(roster(), 6);

  it("reads every committed area", () => {
    expect(areas).toHaveLength(roster().length);
    for (const area of areas) {
      expect(area.huc6).toMatch(/^\d{6}$/);
      expect(area.name).not.toBe("");
    }
  });

  it("covers the areas the published reservoirs are assigned to", () => {
    const drawn = new Set(areas.map((area) => area.huc6));
    const assigned = new Set(readPayload().reservoirs
      .map((reservoir) => reservoir.huc6)
      .filter((huc6): huc6 is string => typeof huc6 === "string"));
    expect([...assigned].filter((huc6) => !drawn.has(huc6))).toEqual([]);
  });

  /* The reservoirs are the page; the areas are context. A roster that
   * arrives broken, half-written or replaced by an error document must cost
   * the reader context and nothing else. */
  it.each([
    ["not a list", {}],
    ["a null payload", null],
    ["an error document", { error: { code: 500 } }],
    ["entries that are not objects", [1, "two", null]]
  ])("reads %s as no areas rather than throwing", (_label, value) => {
    expect(parseDrainageUnits(value, 6)).toEqual([]);
  });

  it("keeps the readable areas when one entry is malformed", () => {
    expect(parseDrainageUnits([{ name: "No code here" }, ...roster()], 6))
      .toHaveLength(roster().length);
  });

  /* A code with no name is still a drawable area. It falls back to the code
   * rather than to an empty string, because a blank entry in the area
   * chooser is a row a reader cannot pick and cannot report. */
  /* The attribute follows the level, the same rule the pipeline applies
   * writing it. Reading a fixed `huc6` would parse a HUC-4 scope as no areas
   * at all -- a blank map rather than an error, which is the failure this
   * project keeps finding and keeps writing tests against. */
  it("reads the code from the field the level names", () => {
    expect(parseDrainageUnits([{ huc4: "1401", name: "Upper Colorado" }], 4))
      .toEqual([{ huc6: "1401", name: "Upper Colorado", states: "" }]);
    // The same payload read at the wrong level is no areas, not a guess.
    expect(parseDrainageUnits([{ huc4: "1401", name: "Upper Colorado" }], 6))
      .toEqual([]);
  });

  /* Every figure on this site -- storage banked in an area, drought
   * coverage, snow percent of normal, and each reservoir's own code -- is a
   * six-digit fact. A scope published at another size would draw shapes no
   * figure describes. */
  it("keys the figures at the level the payload publishes", () => {
    expect(JOINABLE_LEVEL).toBe(6);
    expect(referenceGeography(readReferenceExport())?.level).toBe(JOINABLE_LEVEL);
  });

  it("names an area after its code when the name is missing", () => {
    const parsed = parseDrainageUnits([{ huc6: "160203", states: "UT" }], 6);
    expect(parsed[0]?.name).toBe("160203");
    expect(parsed[0]?.states).toBe("UT");
  });
});

describe("the reference export", () => {
  const sections = referenceGeography(readReferenceExport());

  it("hands the parsers what the standalone files hold", () => {
    /* The export is a repackaging, not a second copy with a life of its
     * own. If these ever differ, two pages drawing from two files disagree
     * about where a drainage area is -- and the maps exist to be compared
     * (ADR-007), so a difference would read as an engine difference.
     *
     * The state outline is still the committed polygon unchanged. The
     * drainage areas are a roster now, so what has to match is which areas
     * exist and what each is called: the codes still come out of the same
     * committed file the pipeline assigns reservoirs with, which is the
     * guarantee ADR-018 was written for. */
    expect(sections?.state).toEqual(readUtahBoundaryGeoJson());
    const committed = (readDrainageGeoJson() as {
      features: { properties: Record<string, string> }[]
    }).features.map((feature) => feature.properties["huc6"]);
    expect(parseDrainageUnits(sections?.drainage, 6).map((area) => area.huc6))
      .toEqual(committed);
  });

  /* The saving, asserted rather than described. This file is fetched by
   * every map page on every load (`cache: "no-cache"`, so an unchanged file
   * is a 304 but a changed one is paid whole), and it was 1,001 KB, of
   * which 982 KB was geometry no page draws from any more. */
  it("is small enough that every page can afford to fetch it whole", () => {
    const bytes = JSON.stringify(readReferenceExport()).length;
    expect(bytes).toBeLessThan(120_000);
  });

  it("draws the scope the export names, not one written down here", () => {
    const published = parseDrainageUnits(sections?.drainage, 6);
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
    expect(REFERENCE_SCHEMA_VERSION).toBe(2);
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
    expect(parseDrainageUnits(parsed?.drainage, 6)).toEqual([]);
    expect(parseUtahBoundary(parsed?.state)).toBeNull();
  });
});
