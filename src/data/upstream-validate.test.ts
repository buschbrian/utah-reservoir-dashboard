import { describe, expect, it } from "vitest";
import { validateUpstreamIndex } from "./validate";

const valid = {
  source: "USGS Network-Linked Data Index over NHDPlus",
  source_url: "https://api.water.usgs.gov/nldi",
  retrieved: "2026-08-22",
  keyed_by: "source_station_id",
  selection: "every published reservoir",
  self_exclusion: "deliberate: a dam point lies inside its own basin",
  traced_count: 2,
  traces: {
    "337": {
      name: "Flaming Gorge",
      trace_point: "reviewed dam point",
      comid: "10040912",
      basin_area_sq_mi: 14775,
      upstream_reservoirs: ["09213700:WY:BOR", "574"],
      upstream_snow_sites: ["509:WY:SNTL", "831:WY:SNTL"]
    },
    "509": {
      name: "Lake Powell",
      trace_point: "reviewed dam point",
      comid: "3528925",
      upstream_reservoirs: ["337"],
      upstream_snow_sites: []
    }
  }
};

describe("validateUpstreamIndex", () => {
  it("accepts a well-formed index and keeps the evidence fields", () => {
    const index = validateUpstreamIndex(valid);
    expect(index.traces["337"]?.comid).toBe("10040912");
    expect(index.traces["509"]?.upstream_reservoirs).toEqual(["337"]);
  });

  it("refuses an index with no traces object", () => {
    expect(() => validateUpstreamIndex({ retrieved: "2026-08-22" }))
      .toThrow(/traces/);
  });

  it("refuses an index without the date it was traced", () => {
    const { retrieved, ...rest } = valid;
    void retrieved;
    expect(() => validateUpstreamIndex(rest)).toThrow(/retrieved/);
  });

  it("refuses a trace whose station lists are not string arrays", () => {
    const broken = structuredClone(valid);
    (broken.traces["337"] as { upstream_reservoirs: unknown }).upstream_reservoirs =
      [7, 4];
    expect(() => validateUpstreamIndex(broken))
      .toThrow(/station 337/);
  });

  it("refuses a trace missing its station lists entirely", () => {
    const broken = structuredClone(valid);
    delete (broken.traces["509"] as Record<string, unknown>).upstream_snow_sites;
    expect(() => validateUpstreamIndex(broken)).toThrow(/station 509/);
  });
});
