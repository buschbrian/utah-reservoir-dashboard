/*
 * The weekly digest, tested as arithmetic.
 *
 * The tests that matter here are the ones about what the digest refuses to
 * say. A summary is the surface most likely to state a number confidently
 * from data that does not support it, and every section of this one has a
 * way of being unavailable that a naive implementation would report as zero.
 */
import { describe, expect, it } from "vitest";
import { readDroughtCoverage, readPayload, readSnowpack } from "./data/payload-fixture";
import type { Reservoir } from "./types";
import { weeklyDrought, weeklySnow, weeklyStorage, weeklySummary } from "./weekly-model";

const reservoir = (over: Partial<Reservoir>): Reservoir => ({
  name: "Test",
  as_of: "2026-08-15",
  current_storage_af: 1000,
  capacity_af: 2000,
  record_max_af: 1800,
  change_7d_af: 0,
  change_7d_pct: 0,
  ...over
} as unknown as Reservoir);

describe("the storage half of the week", () => {
  /* Twenty-nine of the sixty-nine reservoirs report month-end only, so they
   * cannot move in a week at all. A digest that averaged over all of them, or
   * counted them as steady, would understate every week. */
  it("counts only the reservoirs that published a weekly change", () => {
    const week = weeklyStorage([
      reservoir({ name: "Daily", change_7d_af: 100 }),
      reservoir({ name: "Monthly", change_7d_af: null as never })
    ]);

    expect(week.measured).toBe(1);
    expect(week.published).toBe(2);
    expect(week.rose).toBe(1);
    expect(week.netAf).toBe(100);
  });

  it("separates rises, falls and reservoirs that did not move", () => {
    const week = weeklyStorage([
      reservoir({ change_7d_af: 50 }),
      reservoir({ change_7d_af: -30 }),
      reservoir({ change_7d_af: 0 })
    ]);

    expect([week.rose, week.fell, week.steady]).toEqual([1, 1, 1]);
    expect(week.netAf).toBe(20);
  });

  /* The region's combined figure is storage over combined full level, the
   * ADR-011 arithmetic every other surface uses, so a large reservoir counts
   * for more than a small one. A week ago is this week minus the change. */
  it("moves the combined percentage by the week's net change", () => {
    const week = weeklyStorage([
      reservoir({ current_storage_af: 1000, capacity_af: 2000, change_7d_af: -200 })
    ]);

    expect(week.percentNow).toBeCloseTo(50, 6);
    expect(week.percentBefore).toBeCloseTo(60, 6);
  });

  /*
   * The distinction the digest exists to get right. A small reservoir that
   * doubles reports a huge share of its previous reading and a trivial volume;
   * a large one losing a great deal of water reports a small share. Naming
   * either as "the biggest move" without the measure is the easiest lie a
   * summary can tell, so the model answers both and the view says which.
   */
  it("keeps the volume leaders apart from the proportional one", () => {
    const week = weeklyStorage([
      reservoir({ name: "Small", current_storage_af: 1069, capacity_af: 5594,
        change_7d_af: 565, change_7d_pct: 111.9 }),
      reservoir({ name: "Large", current_storage_af: 5_000_000, capacity_af: 25_000_000,
        change_7d_af: -69_480, change_7d_pct: -1.3 })
    ]);

    expect(week.biggestFall?.name).toBe("Large");
    expect(week.biggestRise?.name).toBe("Small");
    // Points of its own full level, which is what the map colours by.
    expect(week.largestShareMove?.name).toBe("Small");
    expect(week.largestShareMove?.changePoints).toBeCloseTo(10.1, 1);
    expect(week.biggestFall?.changePoints).toBeCloseTo(-0.28, 2);
  });

  it("names no mover at all in a week where nothing moved", () => {
    const week = weeklyStorage([reservoir({ change_7d_af: 0 })]);

    expect(week.biggestRise).toBeNull();
    expect(week.biggestFall).toBeNull();
  });
});

describe("the snow half of the week", () => {
  /*
   * Percent of normal divides by the normal median for the same day, which is
   * zero once the sites have melted out -- so out of season the honest answer
   * is that there is no comparison to make, not that snow did not change.
   * The committed payload is an August one, which is exactly that case.
   */
  it("refuses to compare a week with no snow season in it", () => {
    const week = weeklySnow(readSnowpack());

    expect(week.day).not.toBeNull();
    expect(week.previousDay).not.toBeNull();
    if (week.percentNow === null || week.percentBefore === null) {
      expect(week.comparable).toBe(false);
    } else {
      expect(week.comparable).toBe(true);
    }
  });

  it("reaches exactly seven days back", () => {
    const week = weeklySnow(readSnowpack());
    const day = Date.parse(`${week.day}T00:00:00Z`);
    const before = Date.parse(`${week.previousDay}T00:00:00Z`);

    expect((day - before) / 86_400_000).toBe(7);
  });
});

describe("the drought half of the week", () => {
  /* One committed week cannot be compared with itself. This stays false until
   * a history is published, and the view says why rather than showing a
   * change of nothing. */
  it("reports that there is no week to compare against yet", () => {
    const week = weeklyDrought(readDroughtCoverage());

    expect(week.comparable).toBe(false);
    expect(week.units).toBeGreaterThan(0);
    expect(week.mapDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the digest as a whole", () => {
  it("describes the newest reading it has", () => {
    const payload = readPayload();
    const summary = weeklySummary(payload.reservoirs, readSnowpack(), readDroughtCoverage());

    expect(summary.through).toBe(
      payload.reservoirs.reduce((newest, r) => r.as_of > newest ? r.as_of : newest, ""));
    expect(summary.storage.published).toBe(payload.reservoirs.length);
  });

  /* Snow and drought are separate fetches this page is allowed to do without.
   * Losing one must cost that section and nothing else. */
  it("still reports storage when the other two payloads are missing", () => {
    const summary = weeklySummary(readPayload().reservoirs, null, null);

    expect(summary.storage.measured).toBeGreaterThan(0);
    expect(summary.snow.comparable).toBe(false);
    expect(summary.drought).toBeNull();
  });
});
