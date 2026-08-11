/* The slider draws the same drawdown on all three engines or it is drawing
 * a different claim, so the per-month percentage is held against
 * `shared/reservoir-viz.js` over every reservoir and every month it
 * publishes -- never against a literal, since the payload is rewritten each
 * morning. */
import { describe, expect, it } from "vitest";
import { loadLegacyApi } from "./legacy-harness";
import { readPayload } from "./payload-fixture";
import { monthKeys, monthLabel, monthPercent, monthlyRollup } from "./months";
import { sizeBasis } from "./rollup";

const legacy = loadLegacyApi();
const reservoirs = readPayload().reservoirs;
const months = monthKeys(reservoirs);

describe("the months the payload carries", () => {
  it("finds twelve, oldest first", () => {
    expect(months.length).toBeGreaterThan(1);
    expect([...months].sort()).toEqual(months);
  });

  it("takes them across every reservoir, not from whichever comes first", () => {
    // A reservoir that came online mid-year has a shorter array; the slider
    // must still offer every position the data has.
    for (const reservoir of reservoirs) {
      for (const entry of reservoir.monthly) {
        expect(months, `${reservoir.name} reports ${entry.month}`).toContain(entry.month);
      }
    }
  });
});

describe("percent full for one month", () => {
  it("matches the shared rule for every reservoir in every month", () => {
    for (const reservoir of reservoirs) {
      for (const month of months) {
        const ported = monthPercent(reservoir, month);
        const before = legacy.monthPct(reservoir, month);
        if (ported === null || before === null || before === undefined) {
          expect(ported === null, `${reservoir.name} ${month}`)
            .toBe(before === null || before === undefined);
          continue;
        }
        expect(ported, `${reservoir.name} ${month}`).toBeCloseTo(before, 9);
      }
    }
  });

  it("is measured against the reservoir's own size basis, not a global one", () => {
    const reservoir = reservoirs.find((entry) =>
      entry.monthly.some((month) => month.mean_af !== null));
    expect(reservoir).toBeDefined();
    if (!reservoir) return;
    const entry = reservoir.monthly.find((month) => month.mean_af !== null);
    expect(entry).toBeDefined();
    if (!entry || entry.mean_af === null) return;
    expect(monthPercent(reservoir, entry.month))
      .toBeCloseTo((entry.mean_af / sizeBasis(reservoir)) * 100, 9);
  });

  it("says nothing rather than zero for a month a reservoir did not report", () => {
    const reservoir = reservoirs[0];
    expect(reservoir).toBeDefined();
    if (!reservoir) return;
    expect(monthPercent(reservoir, "1900-01")).toBeNull();
    expect(monthPercent({ ...reservoir, monthly: [] }, months[0] ?? "2026-01")).toBeNull();
  });
});

describe("the combined figure for one month", () => {
  it("counts a reservoir on both sides of the ratio or on neither", () => {
    for (const month of months) {
      const rollup = monthlyRollup(reservoirs, month);
      const reported = reservoirs.filter((reservoir) =>
        monthPercent(reservoir, month) !== null);
      expect(rollup.reporting, month).toBe(reported.length);
      // Capacity is the sum of exactly those reservoirs' size bases, so a
      // silent reservoir cannot drag the state's percentage down.
      expect(rollup.capacityAf, month)
        .toBeCloseTo(reported.reduce((total, r) => total + sizeBasis(r), 0), 6);
    }
  });

  it("stays inside the range its own reservoirs span", () => {
    for (const month of months) {
      const rollup = monthlyRollup(reservoirs, month);
      if (rollup.percentFull === null) continue;
      const percents = reservoirs
        .map((reservoir) => monthPercent(reservoir, month))
        .filter((percent): percent is number => percent !== null);
      expect(rollup.percentFull, month).toBeGreaterThanOrEqual(Math.min(...percents) - 1e-6);
      expect(rollup.percentFull, month).toBeLessThanOrEqual(Math.max(...percents) + 1e-6);
    }
  });

  it("reports nothing for a month nobody has", () => {
    expect(monthlyRollup(reservoirs, "1900-01").percentFull).toBeNull();
    expect(monthlyRollup([], months[0] ?? "2026-01").percentFull).toBeNull();
  });
});

describe("how a month reads", () => {
  it("names the month rather than showing its key", () => {
    expect(monthLabel("2026-08")).toBe("August 2026");
    expect(monthLabel("2025-01")).toBe("January 2025");
  });

  it("hands back anything it cannot read rather than inventing a month", () => {
    expect(monthLabel("2026-13")).toBe("2026-13");
    expect(monthLabel("nonsense")).toBe("nonsense");
  });

  it("labels every month the payload publishes", () => {
    for (const month of months) {
      expect(monthLabel(month), month).toMatch(/^[A-Z][a-z]+ \d{4}$/);
    }
  });
});
