import { describe, expect, it } from "vitest";
import {
  DRAINAGE_FILL,
  DRAINAGE_LINE,
  REFERENCE_SCHEMA_VERSION,
  DEFAULT_LEVEL,
  JOINABLE_LEVELS,
  parseDrainageUnits,
  referenceGeography
} from "./boundaries";
import { loadLegacyApi } from "./legacy-harness";
import { readDrainageGeoJson, readPayload, readReferenceExport } from "./payload-fixture";

const legacy = loadLegacyApi();

/* The Utah mask itself -- MASK_FILL, MASK_LINE, utahMaskRings, the
 * authoritative-UGRC-boundary parity checks -- is gone with ADR-067. Per
 * ADR-044, the frozen oracle's own colours and rings still describe a mask
 * this site no longer draws, so parity with them stopped being a fact worth
 * asserting rather than a fact worth pinning. The drainage colours below are
 * the parity that is still load-bearing. */
describe("the drainage-area colours", () => {
  it("keeps the colours the production maps draw", () => {
    expect(DRAINAGE_FILL).toBe(legacy.HUC_FILL);
    expect(DRAINAGE_LINE).toBe(legacy.HUC_LINE);
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

  /* S1 (OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md) added a box per area. A
   * reader who chose a state or a region loses nothing if one of its areas'
   * boxes came back broken -- the area is still worth drawing and worth
   * listing -- so the failure has to stop at that one area's `box` field and
   * not spread to the area itself, the way a malformed whole entry already
   * costs only that entry (`keeps the readable areas when one entry is
   * malformed`, above). */
  it("reads an area with no box as an area with no box, not a dropped area", () => {
    const parsed = parseDrainageUnits([{ huc6: "160203", name: "No box" }], 6);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("No box");
    expect(parsed[0]?.box).toBeUndefined();
  });

  it.each([
    ["not an array", { west: -112 }],
    ["the wrong length", [-112, 40, -111]],
    ["a non-numeric edge", [-112, 40, -111, "north"]],
    ["a non-finite edge", [-112, 40, -111, Number.NaN]],
    ["west east of east", [-111, 40, -112, 41]],
    ["south north of north", [-112, 41, -111, 40]]
  ])("drops a malformed box (%s) but keeps the area", (_label, bbox) => {
    const parsed = parseDrainageUnits([{ huc6: "160203", name: "Bad box", bbox }], 6);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("Bad box");
    expect(parsed[0]?.box).toBeUndefined();
  });

  it("reshapes a valid published box into corner pairs", () => {
    const parsed = parseDrainageUnits(
      [{ huc6: "160203", name: "Bear River", bbox: [-112.5, 41.0, -111.5, 42.0] }], 6);
    expect(parsed[0]?.box).toEqual([[-112.5, 41.0], [-111.5, 42.0]]);
  });

  it("keeps the one good box when its neighbour's is malformed", () => {
    const parsed = parseDrainageUnits([
      { huc6: "160203", name: "Good", bbox: [-112, 40, -111, 41] },
      { huc6: "160204", name: "Bad", bbox: [1, 2] }
    ], 6);
    expect(parsed[0]?.box).toEqual([[-112, 40], [-111, 41]]);
    expect(parsed[1]?.box).toBeUndefined();
  });

  /* Every figure on this site -- storage banked in an area, drought coverage,
   * snow percent of normal -- exists at both offered levels (ADR-064), and at
   * no other. A scope drawn at a size no figure describes would put shapes on
   * the map whose hover cards come back empty. */
  it("keys the figures at the levels the export offers", () => {
    expect(JOINABLE_LEVELS).toEqual([4, 6]);
    expect(DEFAULT_LEVEL).toBe(6);

    const reference = readReferenceExport();
    const geography = referenceGeography(reference);
    expect(geography?.level).toBe(DEFAULT_LEVEL);
    /* Every offered level is one the figures exist at, and the default is one
     * of them: a level offered with no figures behind it is a control that
     * empties the map. */
    expect(geography?.levels).toEqual([4, 6]);
    for (const level of geography?.levels ?? []) {
      expect(JOINABLE_LEVELS).toContain(level);
      expect(referenceGeography(reference, level)?.level).toBe(level);
    }
    expect(geography?.levels).toContain(DEFAULT_LEVEL);
  });

  it("draws the coarser scope when the reader asks for it", () => {
    const four = referenceGeography(readReferenceExport(), 4);
    const six = referenceGeography(readReferenceExport(), 6);

    expect(parseDrainageUnits(four?.drainage, 4)).toHaveLength(44);
    expect(parseDrainageUnits(six?.drainage, 6)).toHaveLength(75);
    /* Codes nest, which is what makes every figure regroupable: each of the
     * 75 basins sits inside one of the 44 subregions. */
    const subregions = new Set(parseDrainageUnits(four?.drainage, 4)
      .map((area) => area.huc6));
    for (const basin of parseDrainageUnits(six?.drainage, 6)) {
      expect(subregions.has(basin.huc6.slice(0, 4))).toBe(true);
    }
  });

  it("falls back to the default for a level it does not offer", () => {
    /* A saved link to a level this site has stopped offering opens the map it
     * has, rather than an empty one. */
    const geography = referenceGeography(readReferenceExport(), 8);
    expect(geography?.level).toBe(DEFAULT_LEVEL);
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
     * The drainage areas are a roster, so what has to match is which areas
     * exist and what each is called: the codes still come out of the same
     * committed file the pipeline assigns reservoirs with, which is the
     * guarantee ADR-018 was written for. There is no state outline to check
     * here any more -- ADR-067 stopped publishing one. */
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
    expect(REFERENCE_SCHEMA_VERSION).toBe(4);
  });

  it("reads the shape before this one as no boundaries either", () => {
    /* Version 3 still published a state boundary alongside the roster
     * (ADR-014, retired by ADR-067). A reader still on that shape is told
     * rather than handed a `state` field this build no longer looks for. */
    const earlier = { ...(readReferenceExport() as object), schema_version: 3 };
    expect(referenceGeography(earlier)).toBeNull();
  });

  it.each([
    ["a null payload", null],
    ["an error document", { error: { code: 500 } }],
    ["no version at all", { geography: { watersheds: {} } }],
    ["no geography", { schema_version: 1 }],
    ["a scope name nothing matches", {
      schema_version: 1,
      geography: { watersheds: { default_scope: "gone", scopes: {} } }
    }]
  ])("survives %s without throwing", (_label, value) => {
    const parsed = referenceGeography(value);
    // No sections at all, or sections whose drainage roster parses as
    // empty -- both are the soft failure the callers already handle.
    expect(parseDrainageUnits(parsed?.drainage, 6)).toEqual([]);
  });
});
