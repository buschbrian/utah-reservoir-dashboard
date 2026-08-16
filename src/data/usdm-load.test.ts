import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDroughtCoverage } from "./payload-fixture";
import { parseUsdmPolygons } from "./usdm-load";

const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];

function validCollection(): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    map_date: "2026-08-11",
    release_date: "2026-08-13",
    features: [
      {
        properties: { DM: 2 },
        geometry: { type: "Polygon", coordinates: [square] }
      },
      {
        properties: { DM: 0 },
        geometry: { type: "MultiPolygon", coordinates: [[square], [square]] }
      }
    ]
  };
}

describe("drought polygon parsing", () => {
  it("accepts a collection and orders intensities ascending", () => {
    const parsed = parseUsdmPolygons(validCollection());
    expect(parsed.mapDate).toBe("2026-08-11");
    expect(parsed.features.map((feature) => feature.level)).toEqual([0, 2]);
    // The multipolygon's parts pool into one ring list for even-odd drawing.
    expect(parsed.features[0]!.rings.length).toBe(2);
  });

  it("rejects a repeated intensity", () => {
    const collection = validCollection();
    (collection.features as Record<string, unknown>[])[1]!.properties = { DM: 2 };
    expect(() => parseUsdmPolygons(collection)).toThrow("appears twice");
  });

  it("rejects an unknown intensity", () => {
    const collection = validCollection();
    (collection.features as Record<string, unknown>[])[0]!.properties = { DM: 5 };
    expect(() => parseUsdmPolygons(collection)).toThrow("intensity 5");
  });

  it("skips a degenerate sliver ring rather than rejecting the file", () => {
    const collection = validCollection();
    (collection.features as Record<string, unknown>[])[1]!.geometry = {
      type: "MultiPolygon",
      // One drawable part, one three-point simplification artifact.
      coordinates: [[square], [[[5, 5], [6, 5], [5, 5]]]]
    };
    const parsed = parseUsdmPolygons(collection);
    expect(parsed.features[0]!.rings.length).toBe(1);
  });

  it("rejects a non-polygon feature", () => {
    const collection = validCollection();
    (collection.features as Record<string, unknown>[])[0]!.geometry =
      { type: "Point", coordinates: [0, 0] };
    expect(() => parseUsdmPolygons(collection)).toThrow("not a polygon");
  });

  it("rejects missing dates and empty collections", () => {
    const undated = validCollection();
    delete undated.map_date;
    expect(() => parseUsdmPolygons(undated)).toThrow("map or release date");

    const empty = validCollection();
    empty.features = [];
    expect(() => parseUsdmPolygons(empty)).toThrow("no features");
  });
});

/* The committed weekly download, through the same parser the drought map
 * uses -- and held to the same week as the committed coverage figures,
 * because a map painting one week over bars describing another would be
 * the page quietly lying about its own date. */
describe("the committed drought polygons", () => {
  const parsed = parseUsdmPolygons(JSON.parse(readFileSync(
    new URL("../../data/drought/usdm-current.geojson", import.meta.url), "utf8"
  )) as unknown);

  it("parse and carry at least one intensity", () => {
    expect(parsed.features.length).toBeGreaterThan(0);
    expect(parsed.features.length).toBeLessThanOrEqual(5);
  });

  it("describe the same week as the committed coverage figures", () => {
    const coverage = readDroughtCoverage();
    expect(parsed.mapDate).toBe(coverage.map_date);
    expect(parsed.releaseDate).toBe(coverage.release_date);
  });
});
