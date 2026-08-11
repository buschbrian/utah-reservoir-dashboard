import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statewideRollup, percentFull, isLateForCadence, sizeBasis } from "./rollup";
import { validateReservoirPayload } from "./validate";
import { loadLegacyApi } from "./legacy-harness";
import { STORAGE_CLASSES, storageClass } from "../viz/classes";

const payload = validateReservoirPayload(JSON.parse(
  readFileSync(new URL("../../reservoirs.json", import.meta.url), "utf8")
) as unknown);

const legacy = loadLegacyApi();
const legacyAll = legacy.statewideSummary(payload.reservoirs);
const CONNECTED_WITH_LAKE_POWELL = {
  geography: "connected",
  lakePowell: "include"
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
      lakePowell: "exclude"
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

  /* The one aggregate that is deliberately *not* a parity port. The legacy
   * page counts the pipeline's `is_stale` flag, which is computed against a
   * single threshold; the port asks whether each reservoir is late for its
   * own cadence -- 2 days for daily feeds, 45 for month-end ones -- which is
   * the claim the refresh workflow's staleness issue already makes. Asserted
   * here so the divergence stays a decision rather than a surprise.
   */
  it("counts staleness per cadence rather than by the legacy flag", () => {
    const ported = statewideRollup(payload.reservoirs, CONNECTED_WITH_LAKE_POWELL);
    expect(ported.stale).toBe(payload.reservoirs.filter(isLateForCadence).length);
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
    const reservoirs = [
      { ...example, name: "Cross-border example", in_utah: false, intersects_utah: true },
      { ...example, name: "Connected example", in_utah: false, intersects_utah: false }
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

  it("applies each record's daily or monthly freshness contract", () => {
    const monthly = payload.reservoirs.find((entry) => entry.data_frequency === "monthly");
    const daily = payload.reservoirs.find((entry) => entry.data_frequency === "daily");
    expect(monthly).toBeDefined();
    expect(daily).toBeDefined();
    if (!monthly || !daily) return;
    const late = { stale_after_days: 45, data_frequency: "monthly" as const, fetch_ok: true };
    expect(isLateForCadence({ ...monthly, ...late, days_stale: 44 })).toBe(false);
    expect(isLateForCadence({ ...monthly, ...late, days_stale: 46 })).toBe(true);
    const soon = { stale_after_days: 2, data_frequency: "daily" as const, fetch_ok: true };
    expect(isLateForCadence({ ...daily, ...soon, days_stale: 2 })).toBe(false);
    expect(isLateForCadence({ ...daily, ...soon, days_stale: 3 })).toBe(true);
    expect(isLateForCadence({ ...daily, ...soon, days_stale: 0, fetch_ok: false })).toBe(true);
  });
});
