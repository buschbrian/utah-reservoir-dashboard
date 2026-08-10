/* Held against `shared/reservoir-viz.js` over the committed payload rather
 * than against literal radii: the file is rewritten every morning, so a
 * literal is a test that fails on a schedule and freezes the published
 * numbers behind a red build. */
import { describe, expect, it } from "vitest";
import { loadLegacyApi } from "../data/legacy-harness";
import { readPayload } from "../data/payload-fixture";
import {
  RING_MAX_PX,
  RING_MIN_PX,
  fillSize,
  headlineBasis,
  headlinePercent,
  reservoirSymbol,
  ringSize,
  sizeDomain
} from "./symbols";

const legacy = loadLegacyApi();
const reservoirs = readPayload().reservoirs;

describe("headline percentage", () => {
  it("matches the shared rule for every published reservoir", () => {
    for (const reservoir of reservoirs) {
      expect(headlinePercent(reservoir)).toBe(legacy.headlinePct(reservoir));
    }
  });

  it("names the basis it used", () => {
    for (const reservoir of reservoirs) {
      expect(headlineBasis(reservoir))
        .toBe(reservoir.capacity_af === null ? "highest recorded storage" : "capacity");
    }
  });
});

describe("ring size", () => {
  const domain = sizeDomain(reservoirs);

  it("scales the shared size basis, largest reservoir at the widest ring", () => {
    expect(domain).toBe(Math.sqrt(Math.max(...reservoirs.map(legacy.sizeBasis))));
    const widest = reservoirs.reduce((largest, reservoir) =>
      legacy.sizeBasis(reservoir) > legacy.sizeBasis(largest) ? reservoir : largest);
    expect(ringSize(widest, domain)).toBeCloseTo(RING_MAX_PX, 6);
  });

  it("stays inside the drawn range for every reservoir", () => {
    for (const reservoir of reservoirs) {
      const radius = ringSize(reservoir, domain);
      expect(radius).toBeGreaterThanOrEqual(RING_MIN_PX);
      expect(radius).toBeLessThanOrEqual(RING_MAX_PX);
    }
  });

  it("draws the smallest ring rather than dividing by an empty domain", () => {
    const first = reservoirs[0];
    expect(first).toBeDefined();
    if (first) expect(ringSize(first, 0)).toBe(RING_MIN_PX);
  });
});

describe("fill size", () => {
  it("carries the percentage as area, not as radius", () => {
    // A quarter full covers a quarter of the ring's area, so its radius is
    // half the ring -- the check that separates sqrt from a plain fraction.
    expect(fillSize(40, 25)).toBeCloseTo(20, 6);
    expect(fillSize(40, 100)).toBeCloseTo(40, 6);
  });

  it("draws nothing when there is no readable percentage", () => {
    expect(fillSize(40, null)).toBe(0);
    expect(fillSize(40, Number.NaN)).toBe(0);
  });

  it("never spills outside its own ring", () => {
    expect(fillSize(40, 140)).toBe(40);
    expect(fillSize(40, -10)).toBe(0);
  });
});

describe("the drawn symbol", () => {
  const domain = sizeDomain(reservoirs);

  it("takes its colour from the shared class table", () => {
    for (const reservoir of reservoirs) {
      expect(reservoirSymbol(reservoir, domain).color)
        .toBe(legacy.colorFor(legacy.headlinePct(reservoir)));
    }
  });

  it("marks late data and only late data", () => {
    for (const reservoir of reservoirs) {
      const marked = reservoirSymbol(reservoir, domain).accent !== null;
      expect(marked).toBe(reservoir.is_stale);
    }
  });
});
