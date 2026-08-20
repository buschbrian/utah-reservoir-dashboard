import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reservoirSymbol, sizeDomain } from "../viz/symbols";
import {
  isLakeMead, isLakePowell, percentFull, isLate, RECORD_MAX_BASIS, reservoirInScope,
  sizeBasis, statewideRollup
} from "./rollup";
import type { Reservoir } from "../types";
import { validateReservoirPayload } from "./validate";
import { loadLegacyApi } from "./legacy-harness";
import { STORAGE_CLASSES, storageClass } from "../viz/classes";

const payload = validateReservoirPayload(JSON.parse(
  readFileSync(new URL("../../reservoirs.json", import.meta.url), "utf8")
) as unknown);

const legacy = loadLegacyApi();
const legacyAll = legacy.statewideSummary(payload.reservoirs);
/* Every dominant-reservoir control open.
 *
 * `shared/reservoir-viz.js` is frozen and predates Lake Mead's admission
 * (ADR-062), so it has no concept of excluding it and simply sums whatever
 * the payload holds. Parity is therefore only meaningful with the controls
 * open -- closed, the two sides answer different questions, which is the
 * point of a control rather than a defect in the oracle. */
const CONNECTED_WITH_LAKE_POWELL = {
  geography: "connected",
  lakePowell: "include",
  lakeMead: "include"
} as const;

/* The port recomputes the headline percentage from `current_storage_af` and
 * the size basis; `shared/reservoir-viz.js` reads the percentage the Python
 * pipeline already rounded into `pct_of_capacity` / `pct_of_record_max`.
 * Deliberate: recomputing is the more precise number and keeps the client
 * from depending on a derived field. The cost is that the two can disagree
 * by the pipeline's rounding, so percentage comparisons carry this
 * tolerance and class-boundary comparisons skip reservoirs sitting inside
 * it -- otherwise a reservoir drifting past 50.00% would fail this suite on
 * a morning when nothing in the code had changed.
 */
const ROUNDING_TOLERANCE_PP = 0.1;

function nearBreak(percent: number | null): boolean {
  if (percent === null) return false;
  return STORAGE_CLASSES.some((entry) =>
    Math.abs(percent - entry.min) <= ROUNDING_TOLERANCE_PP);
}

describe("statewide rollup parity with shared/reservoir-viz.js", () => {
  it("reproduces the legacy volume aggregates exactly", () => {
    const ported = statewideRollup(payload.reservoirs, CONNECTED_WITH_LAKE_POWELL);
    expect(ported.count).toBe(legacyAll.count);
    expect(ported.storageAf).toBeCloseTo(legacyAll.storage_af, 6);
    expect(ported.capacityAf).toBeCloseTo(legacyAll.capacity_af, 6);
    expect(ported.percentFull).toBeCloseTo(legacyAll.pct_full ?? Number.NaN, 6);
    expect(ported.change30dAf).toBeCloseTo(legacyAll.change_30d_af, 6);
    expect(ported.change365dAf).toBeCloseTo(legacyAll.change_365d_af, 6);
  });

  it("reproduces the legacy seasonal-normal aggregate and its coverage", () => {
    const ported = statewideRollup(payload.reservoirs, CONNECTED_WITH_LAKE_POWELL);
    expect(ported.normalAf).toBeCloseTo(legacyAll.normal_af, 6);
    expect(ported.normalCovers).toBe(legacyAll.normal_covers);
    expect(ported.percentOfNormal).toBeCloseTo(legacyAll.pct_of_normal ?? Number.NaN, 6);
  });

  it("reproduces the legacy exclude-Lake-Powell aggregation", () => {
    const ported = statewideRollup(payload.reservoirs, {
      geography: "connected",
      lakePowell: "exclude",
      lakeMead: "include"
    });
    expect(ported.count).toBe(legacyAll.without_lake_powell.count);
    expect(ported.storageAf).toBeCloseTo(legacyAll.without_lake_powell.storage_af, 6);
    expect(ported.capacityAf).toBeCloseTo(legacyAll.without_lake_powell.capacity_af, 6);
    expect(ported.percentFull)
      .toBeCloseTo(legacyAll.without_lake_powell.pct_full ?? Number.NaN, 6);
  });

  it("keeps the size basis identical to the legacy capacity-or-record-max rule", () => {
    for (const reservoir of payload.reservoirs) {
      expect(sizeBasis(reservoir)).toBe(legacy.sizeBasis(reservoir));
    }
  });

  it("agrees with the legacy headline percentage within the pipeline's rounding", () => {
    for (const reservoir of payload.reservoirs) {
      const ported = percentFull(reservoir);
      const before = legacy.headlinePct(reservoir);
      expect(ported === null).toBe(before === null || before === undefined);
      if (ported === null || before === null || before === undefined) continue;
      expect(Math.abs(ported - before)).toBeLessThanOrEqual(ROUNDING_TOLERANCE_PP);
    }
  });

  it("puts every reservoir in the legacy class, boundary cases excepted", () => {
    for (const reservoir of payload.reservoirs) {
      const ported = percentFull(reservoir);
      const before = legacy.headlinePct(reservoir);
      if (before === null || before === undefined || nearBreak(ported)) continue;
      expect(storageClass(ported)?.color).toBe(legacy.colorFor(before));
    }
  });

  it("counts the same class histogram, allowing for boundary drift", () => {
    const ported = statewideRollup(payload.reservoirs, CONNECTED_WITH_LAKE_POWELL);
    const drift = payload.reservoirs.filter((reservoir) =>
      nearBreak(percentFull(reservoir))).length;
    expect(ported.classes.map((entry) => entry.label))
      .toEqual(legacyAll.classes.map((entry) => entry.label));
    expect(ported.classes.map((entry) => entry.color))
      .toEqual(legacyAll.classes.map((entry) => entry.color));
    for (const [index, entry] of ported.classes.entries()) {
      expect(Math.abs(entry.count - (legacyAll.classes[index]?.count ?? -1)))
        .toBeLessThanOrEqual(drift);
    }
    expect(Math.abs(ported.belowHalf - legacyAll.below_half)).toBeLessThanOrEqual(drift);
  });

  /* This was once the one aggregate deliberately *not* a parity port: the
   * legacy page counted the pipeline's `is_stale` flag, and the port asked
   * its own question, because the flag was computed against a single
   * threshold for every reservoir. The pipeline has since caught up -- it
   * applies each record's own threshold and publishes the answer -- so the
   * port's second calculation had become a duplicate that could only ever
   * drift. It now reports the published flag, and this is a parity port
   * like the rest.
   */
  it("counts late readings exactly as the published payload does", () => {
    const ported = statewideRollup(payload.reservoirs, CONNECTED_WITH_LAKE_POWELL);
    expect(ported.stale).toBe(payload.reservoirs.filter(isLate).length);
    expect(ported.stale).toBe(payload.stale_count);
  });

  it("classifies every reservoir, so the histogram accounts for all of them", () => {
    const ported = statewideRollup(payload.reservoirs, CONNECTED_WITH_LAKE_POWELL);
    const classified = ported.classes.reduce((total, entry) => total + entry.count, 0);
    const unclassifiable = payload.reservoirs
      .filter((reservoir) => percentFull(reservoir) === null).length;
    expect(classified).toBe(ported.count - unclassifiable);
  });
});

describe("rollup rules independent of today's data", () => {
  it("separates reservoirs in Utah from all connected reservoirs", () => {
    const example = payload.reservoirs[0];
    expect(example).toBeDefined();
    if (!example) return;
    /* Explicit ids, because the fixture is spread from a real record and
     * would otherwise inherit that record's provider identity -- and if the
     * payload happens to lead with a dominant reservoir (ADR-062) the fixture
     * inherits its exclusion too, and the test measures the wrong thing. */
    const reservoirs = [
      { ...example, name: "Cross-border example", rise_item_id: 9001,
        in_utah: false, intersects_utah: true },
      { ...example, name: "Connected example", rise_item_id: 9002,
        in_utah: false, intersects_utah: false }
    ];

    const utah = statewideRollup(reservoirs, {
      geography: "utah",
      lakePowell: "include"
    });
    const connected = statewideRollup(reservoirs, {
      geography: "connected",
      lakePowell: "include"
    });

    expect(utah.count).toBe(1);
    expect(connected.count).toBe(2);
  });

  it("applies the Lake Powell choice independently of geography", () => {
    const example = payload.reservoirs[0];
    expect(example).toBeDefined();
    if (!example) return;
    const lakePowell = {
      ...example,
      name: "Lake Powell",
      rise_item_id: 509,
      in_utah: false,
      intersects_utah: true
    };
    const reservoirs = [
      lakePowell,
      { ...example, name: "Utah example", rise_item_id: 101,
        in_utah: true, intersects_utah: true },
      { ...example, name: "Connected example", rise_item_id: 102,
        in_utah: false, intersects_utah: false }
    ];

    for (const geography of ["utah", "connected"] as const) {
      const included = statewideRollup(reservoirs, {
        geography,
        lakePowell: "include"
      });
      const excluded = statewideRollup(reservoirs, {
        geography,
        lakePowell: "exclude"
      });

      expect(excluded.count).toBe(included.count - 1);
      expect(excluded.storageAf).toBeCloseTo(
        included.storageAf - lakePowell.current_storage_af,
        6
      );
      expect(excluded.capacityAf).toBeCloseTo(
        included.capacityAf - sizeBasis(lakePowell),
        6
      );
    }
  });

  it("excludes Lake Powell by its stable RISE identity when its label changes", () => {
    const example = payload.reservoirs[0];
    expect(example).toBeDefined();
    if (!example) return;
    const renamedPowell = {
      ...example,
      name: "Glen Canyon reservoir",
      rise_item_id: 509,
      intersects_utah: true,
      current_storage_af: 5_000,
      capacity_af: 25_000
    };
    const local = { ...example, name: "Local", rise_item_id: 100, intersects_utah: true };

    const result = statewideRollup([renamedPowell, local], {
      geography: "utah",
      lakePowell: "exclude"
    });

    expect(result.count).toBe(1);
    expect(result.storageAf).toBe(local.current_storage_af);
  });

  it("keeps the production overview's Utah scope aligned with the typed rollup", () => {
    const example = payload.reservoirs[0];
    expect(example).toBeDefined();
    if (!example) return;
    const reservoirs = [
      { ...example, name: "Lake Powell", intersects_utah: true },
      { ...example, name: "Cross-border", in_utah: false, intersects_utah: true },
      { ...example, name: "Connected", in_utah: false, intersects_utah: false }
    ];

    expect(legacy.utahReservoirs(reservoirs, true).map((reservoir) => reservoir.name))
      .toEqual(["Cross-border"]);
  });

  it("uses capacity and falls back to record max", () => {
    const reservoir = payload.reservoirs.find((entry) => entry.capacity_af !== null);
    expect(reservoir).toBeDefined();
    if (!reservoir) return;
    expect(percentFull(reservoir)).toBeCloseTo(
      reservoir.current_storage_af / (reservoir.capacity_af ?? reservoir.record_max_af) * 100
    );
    expect(percentFull({ ...reservoir, capacity_af: null })).toBeCloseTo(
      reservoir.current_storage_af / reservoir.record_max_af * 100
    );
  });

  /* The freshness contract is the pipeline's, not the page's. It applies
   * each record's own threshold -- two days for a daily feed, 45 for a
   * month-end one -- and publishes the answer as `is_stale`, so what is
   * asserted here is that the page reports that answer rather than
   * recomputing it. It did recompute it once; the two rules agreed only by
   * luck, and one of them fed the dashed ring while the other fed the list
   * badge beside it. */
  it("reports the published freshness answer instead of recomputing it", () => {
    const reservoir = payload.reservoirs[0];
    expect(reservoir).toBeDefined();
    if (!reservoir) return;
    expect(isLate({ ...reservoir, is_stale: true })).toBe(true);
    expect(isLate({ ...reservoir, is_stale: false })).toBe(false);
    // The threshold and the reading age do not get a second vote: the
    // pipeline already weighed them, and a fetch failure is published as a
    // late reading rather than left for the page to infer.
    expect(isLate({ ...reservoir, is_stale: false, days_stale: 400 })).toBe(false);
    expect(isLate({ ...reservoir, is_stale: true, days_stale: 0, fetch_ok: false })).toBe(true);
  });

  it("agrees with every other surface that reports a late reading", () => {
    for (const reservoir of payload.reservoirs) {
      // The ring the map draws and the badge the list draws are now one
      // rule, so this holds for every reservoir rather than most mornings.
      expect(reservoirSymbol(reservoir, sizeDomain(payload.reservoirs)).accent !== null)
        .toBe(isLate(reservoir));
    }
  });
});

/* Built from a real published record so the fixture cannot drift from the
 * payload's shape, the same arrangement `overview-model.test.ts` uses. */
const base = payload.reservoirs[0]!;
const reservoir = (overrides: Partial<Reservoir>): Reservoir =>
  ({ ...base, ...overrides });

/* ADR-062. Lake Mead is 28 million acre-feet in a drainage area this site has
 * published since ADR-009, so it is the same problem ADR-011 solved for Lake
 * Powell arriving a second time: a total with it and a total without are both
 * true and are not the same measurement. */
describe("the dominant-reservoir controls", () => {
  const mead = (overrides: Partial<Reservoir> = {}): Reservoir => reservoir({
    name: "Lake Mead", rise_item_id: 6124, intersects_utah: false, ...overrides
  });
  const powell = (): Reservoir => reservoir({
    name: "Lake Powell", rise_item_id: 509, intersects_utah: true
  });
  const ordinary = (): Reservoir => reservoir({
    name: "Deer Creek", rise_item_id: 290, intersects_utah: true
  });

  it("identifies each by its provider item id", () => {
    expect(isLakeMead(mead())).toBe(true);
    expect(isLakePowell(mead())).toBe(false);
    expect(isLakeMead(powell())).toBe(false);
    expect(isLakeMead(ordinary())).toBe(false);
  });

  it("falls back to the name for a payload predating the id", () => {
    expect(isLakeMead(mead({ rise_item_id: 0 }))).toBe(true);
    expect(isLakeMead(mead({ rise_item_id: 0, name: "  lake   MEAD " }))).toBe(true);
  });

  /* The property that keeps every caller written before Mead existed
   * answering what it answered: absent must mean excluded, or those callers
   * silently start adding 28 million acre-feet to totals nobody changed. */
  it("excludes Mead when no choice is given at all", () => {
    const scope = { geography: "connected" as const, lakePowell: "include" as const };
    expect(reservoirInScope(mead(), scope)).toBe(false);
    expect(reservoirInScope(ordinary(), scope)).toBe(true);
  });

  it("includes Mead only when asked", () => {
    const base = { geography: "connected" as const, lakePowell: "exclude" as const };
    expect(reservoirInScope(mead(), { ...base, lakeMead: "include" })).toBe(true);
    expect(reservoirInScope(mead(), { ...base, lakeMead: "exclude" })).toBe(false);
  });

  it("keeps the two controls independent", () => {
    const scope = {
      geography: "connected" as const,
      lakePowell: "exclude" as const,
      lakeMead: "include" as const
    };
    expect(reservoirInScope(powell(), scope)).toBe(false);
    expect(reservoirInScope(mead(), scope)).toBe(true);
  });

  /* Mead is connected to Utah by drainage and its water never enters the
   * state, so the Utah geography excludes it whatever the toggle says. */
  it("keeps Mead out of the Utah geography however it is toggled", () => {
    expect(reservoirInScope(mead(), {
      geography: "utah", lakePowell: "include", lakeMead: "include"
    })).toBe(false);
  });
});

/*
 * What a combined figure is made of, beyond the figure itself.
 *
 * Each of these was invisible until it was published: the total spanned
 * seven weeks of observation dates and said "Observation dates vary by
 * reservoir"; it divided by three different definitions of full and said
 * "percent full"; and it compared against 2015-2025 whatever period the
 * reader had chosen, under the words "the usual storage for this date".
 *
 * Asserted against the payload's own arithmetic rather than against today's
 * numbers, so a morning's refresh cannot turn the build red.
 */
describe("what a combined figure is made of", () => {
  const all = statewideRollup(payload.reservoirs, CONNECTED_WITH_LAKE_POWELL);

  it("reports the span of observation dates behind the total", () => {
    const dates = payload.reservoirs.map((reservoir) => reservoir.as_of).sort();
    expect(all.coverage.earliestDate).toBe(dates[0]);
    expect(all.coverage.latestDate).toBe(dates[dates.length - 1]);
  });

  it("splits freshness by combined full level, not only by count", () => {
    expect(all.coverage.currentCount + all.coverage.lateCount).toBe(all.count);
    expect(all.coverage.currentCapacityAf + all.coverage.lateCapacityAf)
      .toBeCloseTo(all.capacityAf, 6);
    /* The reason this exists: ten small late reservoirs and one enormous
     * late reservoir give the same count and are not the same warning. */
    expect(all.coverage.percentCapacityCurrent)
      .toBeCloseTo(all.coverage.currentCapacityAf / all.capacityAf * 100, 6);
  });

  it("reports how the reservoirs divide by reporting schedule", () => {
    expect(all.coverage.dailyCount + all.coverage.monthlyCount).toBe(all.count);
  });

  it("names every kind of full level the denominator is made of", () => {
    const summed = all.basisShares.reduce((total, share) => total + share.capacityAf, 0);
    const counted = all.basisShares.reduce((total, share) => total + share.count, 0);
    expect(summed).toBeCloseTo(all.capacityAf, 6);
    expect(counted).toBe(all.count);
    // Largest share first, so a caller naming only the first names the biggest.
    const shares = all.basisShares.map((share) => share.capacityAf);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
    // And every one of them is named in words, never left as a source field.
    for (const share of all.basisShares) {
      expect(share.label).not.toBe(share.basis);
      expect(share.label.length).toBeGreaterThan(0);
    }
  });

  /*
   * A reservoir with no traceable capacity falls back to its highest recorded
   * storage, which is a floor and not a capacity. `sizeBasis` has always made
   * that substitution; what is new is that it can no longer make it silently
   * inside a regional denominator.
   */
  it("reports the record-high fallback as its own kind of full level", () => {
    const fallback: Reservoir = {
      ...(payload.reservoirs[0] as Reservoir),
      name: "No traceable capacity",
      rise_item_id: -1,
      capacity_af: null,
      capacity_basis: null,
      record_max_af: 1000
    };
    const rollup = statewideRollup([fallback], CONNECTED_WITH_LAKE_POWELL);
    expect(rollup.basisShares).toHaveLength(1);
    expect(rollup.basisShares[0]?.basis).toBe(RECORD_MAX_BASIS);
    expect(rollup.basisShares[0]?.label).toBe("Highest recorded storage");
    expect(rollup.capacityAf).toBe(1000);
  });
});

/*
 * The combined comparison used to read `seasonal_normal_af` whatever the
 * reader had selected, and that field is the recent period. So the storage
 * charts printed a 2015-2025 figure while the map beside them opened on
 * 1991-2020, and both were labelled "normal".
 */
describe("which period the combined comparison uses", () => {
  const withClimate = payload.reservoirs.filter((reservoir) =>
    reservoir.baselines?.climate);

  it("measures against the period it was asked for", () => {
    const recent = statewideRollup(withClimate,
      { ...CONNECTED_WITH_LAKE_POWELL, baseline: "recent" });
    const climate = statewideRollup(withClimate,
      { ...CONNECTED_WITH_LAKE_POWELL, baseline: "climate" });

    expect(recent.normalBaseline).toBe("recent");
    expect(climate.normalBaseline).toBe("climate");
    expect(recent.normalAf).toBeCloseTo(withClimate.reduce((total, reservoir) =>
      total + (reservoir.baselines?.recent?.normal_af ?? 0), 0), 6);
    expect(climate.normalAf).toBeCloseTo(withClimate.reduce((total, reservoir) =>
      total + (reservoir.baselines?.climate?.normal_af ?? 0), 0), 6);
  });

  /* The whole reason the period has to travel with the number. */
  it("gives a different answer for the two periods", () => {
    const recent = statewideRollup(withClimate,
      { ...CONNECTED_WITH_LAKE_POWELL, baseline: "recent" });
    const climate = statewideRollup(withClimate,
      { ...CONNECTED_WITH_LAKE_POWELL, baseline: "climate" });
    expect(recent.percentOfNormal).not.toBeCloseTo(climate.percentOfNormal ?? 0, 1);
  });

  it("defaults to the recent period, which is what every caller had", () => {
    const asked = statewideRollup(payload.reservoirs,
      { ...CONNECTED_WITH_LAKE_POWELL, baseline: "recent" });
    const unasked = statewideRollup(payload.reservoirs, CONNECTED_WITH_LAKE_POWELL);
    expect(unasked.normalBaseline).toBe("recent");
    expect(unasked.percentOfNormal).toBe(asked.percentOfNormal);
  });

  /*
   * How much of the total the comparison actually covers, by volume and not
   * only by count. The standard period exists for 69 of 198 reservoirs and
   * those 69 hold most of the water, so the two numbers tell very different
   * stories and the count alone is the more alarming one.
   */
  it("reports baseline coverage by combined full level as well as by count", () => {
    const climate = statewideRollup(payload.reservoirs,
      { ...CONNECTED_WITH_LAKE_POWELL, baseline: "climate" });
    expect(climate.normalCovers).toBe(withClimate.length);
    expect(climate.normalCoversCapacityAf)
      .toBeCloseTo(withClimate.reduce((total, row) => total + sizeBasis(row), 0), 6);
    expect(climate.normalCoversCapacityAf).toBeLessThanOrEqual(climate.capacityAf);
  });
});
