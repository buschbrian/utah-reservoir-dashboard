/*
 * The hover cards, tested as text.
 *
 * This is the whole of hover a test can reach: `hitTest` is settled by the
 * render loop, which does not run headless and does not exist in Node, so
 * the pointer plumbing is proved in a real browser or not at all. What can
 * be held here is what the cards actually claim -- and every one of these
 * claims was a sentence somebody wrote, so the ones that are easy to get
 * subtly wrong are pinned: which basis a percentage is of, whether a share
 * is "or worse" or exactly that class, and the singular of "sites".
 */
import { describe, expect, it } from "vitest";
import type { DroughtUnit, Reservoir, SnowSite } from "../types";
import {
  droughtAreaLines,
  droughtClassLines,
  drainageAreaLines,
  droughtNoteForArea,
  formatInches,
  referenceReservoirLines,
  snowBasinLines,
  snowClassLabel,
  snowSiteLines,
  storageReservoirLines,
  worstDroughtShare
} from "./hover-content";

const reservoir = (over: Partial<Reservoir>): Reservoir => ({
  name: "Test Reservoir",
  lat: 40,
  lon: -111,
  as_of: "2026-08-14",
  current_storage_af: 123456,
  pct_of_capacity: 62.5,
  pct_of_record_max: 71.25,
  change_30d_pct: -3.5,
  huc6: "160202",
  ...over
} as unknown as Reservoir);

const unit = (over: Partial<DroughtUnit>): DroughtUnit => ({
  huc6: "140100",
  huc6_name: "Colorado Headwaters",
  percent_of_area: { none: 0, d0: 5, d1: 10, d2: 15, d3: 10, d4: 60 },
  percent_of_area_at_least: { d0: 100, d1: 95, d2: 85, d3: 70, d4: 60 },
  ...over
} as DroughtUnit);

describe("the storage map card", () => {
  it("names the basis the percentage is of", () => {
    const lines = storageReservoirLines(reservoir({}));
    expect(lines[0]).toBe("62.5% of capacity");
  });

  /* The map draws both with the same circle. A reservoir with no surveyed
   * capacity falls back to the highest level ever recorded, and a card that
   * did not say so would be quietly making a different claim. */
  it("says so when the percentage is of the highest recorded storage", () => {
    const lines = storageReservoirLines(reservoir({ pct_of_capacity: null }));
    expect(lines[0]).toBe("71.3% of highest recorded storage");
  });

  it("gives the volume, the direction and the reading date", () => {
    const lines = storageReservoirLines(reservoir({}));
    expect(lines).toContain("123,456 acre-feet stored");
    expect(lines).toContain("-3.5% over 30 days");
    expect(lines.at(-1)).toBe("Reading Aug 14, 2026");
  });

  it("signs a rise, and leaves the line out when there is no change to report", () => {
    expect(storageReservoirLines(reservoir({ change_30d_pct: 4 })))
      .toContain("+4.0% over 30 days");
    expect(storageReservoirLines(reservoir({ change_30d_pct: null })))
      .toEqual(["62.5% of capacity", "123,456 acre-feet stored", "Reading Aug 14, 2026"]);
  });
});

describe("a reservoir used as reference on another map", () => {
  it("gives one storage figure, where it is, and what the host map adds", () => {
    expect(referenceReservoirLines(reservoir({}), "Great Salt Lake", "Nearly all dry"))
      .toEqual([
        "Reservoir, 62.5% full",
        "In the Great Salt Lake drainage area",
        "Nearly all dry"
      ]);
  });

  it("drops the lines it has nothing to put in them", () => {
    expect(referenceReservoirLines(reservoir({}), null, null))
      .toEqual(["Reservoir, 62.5% full"]);
  });

  it("falls back to the highest recorded storage, and shows no reading as a dash", () => {
    expect(referenceReservoirLines(
      reservoir({ pct_of_capacity: null }), null, null)[0])
      .toBe("Reservoir, 71.3% full");
    expect(referenceReservoirLines(
      reservoir({ pct_of_capacity: null, pct_of_record_max: null }), null, null)[0])
      .toBe("Reservoir, — full");
  });
});

describe("the storage map's drainage-area card", () => {
  it("gives the area's combined storage and how many reservoirs it is over", () => {
    expect(drainageAreaLines({ percent: 61.25, reservoirCount: 8 })).toEqual([
      "61.3% full across 8 reservoirs",
      "Choose this area in the analysis controls to narrow the map"
    ]);
  });

  it("counts one reservoir correctly", () => {
    expect(drainageAreaLines({ percent: 12, reservoirCount: 1 })[0])
      .toBe("12.0% full across 1 reservoir");
  });

  /* An area can be outlined and hold nothing the map is currently drawing --
   * the scope control and the area filter both do this -- and a card that
   * answered "0.0% full" there would be reporting empty reservoirs rather
   * than no reservoirs. */
  it("says there is nothing in view rather than reporting an empty area", () => {
    expect(drainageAreaLines(undefined))
      .toEqual(["No reservoirs in this drainage area are in view"]);
    expect(drainageAreaLines({ percent: null, reservoirCount: 0 }))
      .toEqual(["No reservoirs in this drainage area are in view"]);
  });
});

describe("the snow map cards", () => {
  const site = (over: Partial<SnowSite>): SnowSite => ({
    elevation_feet: 9284.4,
    huc6_name: "Weber",
    late: false,
    latest_date: "2026-08-15",
    ...over
  } as SnowSite);

  it("reads the percentage against the class table", () => {
    expect(snowClassLabel(12)).toBe("Under 25% of normal");
    expect(snowClassLabel(46)).toBe("25 to 50% of normal");
    expect(snowClassLabel(101)).toBe("90 to 110%: near normal");
    expect(snowClassLabel(null)).toBe("No value for this day");
  });

  it("gives the depth beside the ratio", () => {
    const lines = snowSiteLines(site({}), 46.2,
      { inches: 4.62, normalInches: 10 });
    expect(lines[0]).toBe("46.2% of normal — 25 to 50% of normal");
    expect(lines[1]).toBe("4.6 inches, normally 10.0 inches");
    expect(lines[2]).toBe("9,284 feet, Weber");
  });

  it("has words for a day the site did not report", () => {
    const lines = snowSiteLines(site({}), null, { inches: null, normalInches: null });
    expect(lines[1]).toBe("no value, normally no value");
    expect(formatInches(null)).toBe("no value");
  });

  it("marks a late site, in the approved words", () => {
    expect(snowSiteLines(site({ late: true }), 50, undefined).at(-1))
      .toBe("Late data: newest value Aug 15, 2026");
    expect(snowSiteLines(site({}), 50, undefined).at(-1))
      .toBe("Newest value Aug 15, 2026");
  });

  /* The fill draws eleven reporting sites and two in exactly the same
   * colour, so the count is the line that lets a reader weigh the mean. */
  it("says how many sites the area mean came from, and counts one correctly", () => {
    expect(snowBasinLines(46.2, 11)[1])
      .toBe("Mean of 11 sites reporting this day");
    expect(snowBasinLines(46.2, 1)[1])
      .toBe("Mean of 1 site reporting this day");
  });
});

describe("the drought map cards", () => {
  it("finds the most severe class present, with its cumulative share", () => {
    expect(worstDroughtShare(unit({}))).toEqual({
      label: "Exceptional drought", share: 60
    });
  });

  it("steps down to the worst class that is actually present", () => {
    expect(worstDroughtShare(unit({
      percent_of_area_at_least: { d0: 100, d1: 40, d2: 0, d3: 0, d4: 0 }
    }))).toEqual({ label: "Moderate drought", share: 40 });
  });

  it("reports an area in no class at all as no drought", () => {
    expect(worstDroughtShare(unit({
      percent_of_area: { none: 100, d0: 0, d1: 0, d2: 0, d3: 0, d4: 0 },
      percent_of_area_at_least: { d0: 0, d1: 0, d2: 0, d3: 0, d4: 0 }
    }))).toEqual({ label: "No drought", share: 100 });
  });

  /* "or worse" is load-bearing: the shares are cumulative, so 60% at D4
   * means 60% of the land is D4, while 85% at D2 means D2 *and everything
   * more severe*. Dropping those two words would overstate the milder
   * classes on every area on the map. */
  it("says the share is that class or worse, and joins the water to the land", () => {
    expect(droughtAreaLines(unit({}), { percent: 48.75, reservoirCount: 6 }))
      .toEqual([
        "60.0% of the land is Exceptional drought or worse",
        "0.0% of it is in no class",
        "Reservoirs here: 48.8% full across 6"
      ]);
  });

  it("says plainly when no reservoir reading was joined", () => {
    expect(droughtAreaLines(unit({}), undefined).at(-1))
      .toBe("No reservoir reading for this area");
  });

  it("names the class outside the areas the page reports", () => {
    expect(droughtClassLines("D3")).toEqual([
      "Drought class D3",
      "Outside the drainage areas this page reports"
    ]);
  });

  it("has no land note for an area with no coverage row", () => {
    expect(droughtNoteForArea(undefined)).toBeNull();
    expect(droughtNoteForArea(unit({})))
      .toBe("60.0% of that land is Exceptional drought or worse");
  });
});
