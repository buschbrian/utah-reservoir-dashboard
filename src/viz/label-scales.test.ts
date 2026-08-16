/*
 * The label ladder, held as relationships rather than as four numbers.
 *
 * Every assertion here is a rule someone could break by nudging one
 * constant: a threshold that puts fifty-one reservoir names on the opening
 * frame, a county layer that starts drawing three thousand hairlines at
 * regional scale, or a name that grows larger than the shape it sits inside.
 * The numbers themselves are free to move; what must not move is the order.
 */
import { describe, expect, it } from "vitest";
import { MAP_MIN_ZOOM } from "./extent";
import {
  COUNTY_LABEL_SCALE,
  COUNTY_LABEL_SIZE_PX,
  COUNTY_SCALE,
  DRAINAGE_LABEL_SIZE_PX,
  RESERVOIR_LABEL_SCALE,
  RESERVOIR_LABEL_SIZE_PX,
  STATE_LABEL_SCALE,
  STATE_LABEL_SIZE_PX
} from "./label-scales";

/* Measured on the running pages rather than assumed: the storage map opens
 * at 1:10,700,000 in a full viewport, and the snow and drought cards at
 * about 1:7,900,000 in theirs. The tighter of the two is what a threshold
 * has to clear to stay off at load. */
const TIGHTEST_OPENING_SCALE = 7_900_000;

/* Where the navigation bounds stop a reader going out. Web Mercator scale
 * is 559,082,264 over two to the zoom, so the minimum zoom fixes it. */
const WIDEST_REACHABLE_SCALE = 559_082_264 / 2 ** MAP_MIN_ZOOM;

describe("when each kind of name appears", () => {
  it("keeps reservoir names off the opening view of every surface", () => {
    expect(RESERVOIR_LABEL_SCALE.minScale).toBeGreaterThan(0);
    expect(RESERVOIR_LABEL_SCALE.minScale).toBeLessThan(TIGHTEST_OPENING_SCALE);
  });

  /* States answer "where is this", which is the question the widest view
   * raises and the closest view has already answered. They therefore have
   * to be on at the furthest out a reader can get, and off well before the
   * reservoir names arrive, or the two crowd each other. */
  it("names the states from the widest view a reader can reach", () => {
    expect(STATE_LABEL_SCALE.minScale).toBe(0);
    expect(STATE_LABEL_SCALE.maxScale).toBeGreaterThan(0);
    expect(STATE_LABEL_SCALE.maxScale).toBeLessThan(WIDEST_REACHABLE_SCALE);
  });

  it("hands off from states to reservoirs without overlapping", () => {
    expect(STATE_LABEL_SCALE.maxScale).toBeLessThan(RESERVOIR_LABEL_SCALE.minScale);
  });

  /* The outline is context and the name is a claim, so the outlines come in
   * first and the names follow once a county is big enough to be worth
   * naming. Equal thresholds would put both on at once, which is the
   * information overload the ladder exists to prevent. */
  it("draws county outlines before it names them, and both after reservoirs", () => {
    expect(COUNTY_SCALE.minScale).toBeGreaterThan(COUNTY_LABEL_SCALE.minScale);
    expect(COUNTY_SCALE.minScale).toBeLessThan(RESERVOIR_LABEL_SCALE.minScale);
  });

  it("never puts every kind of name on at the same scale", () => {
    const onAt = (scale: number): number => [
      STATE_LABEL_SCALE, RESERVOIR_LABEL_SCALE, COUNTY_LABEL_SCALE
    ].filter((entry) =>
      (entry.minScale === 0 || scale <= entry.minScale)
      && (entry.maxScale === 0 || scale >= entry.maxScale)).length;

    for (const scale of [WIDEST_REACHABLE_SCALE, 10_000_000, 5_000_000,
      3_000_000, 1_000_000, 100_000]) {
      expect(onAt(scale), `three label tiers are on at 1:${scale}`)
        .toBeLessThan(3);
    }
  });
});

describe("how large each kind of name is drawn", () => {
  /* The containment rule: a state contains drainage areas, which contain
   * reservoirs, and a county name is the finest thing on the map. Sizes run
   * the other way, so a name is never larger than the shape it is inside. */
  it("gets smaller as the shape it names gets smaller", () => {
    expect(STATE_LABEL_SIZE_PX).toBeGreaterThan(DRAINAGE_LABEL_SIZE_PX);
    expect(DRAINAGE_LABEL_SIZE_PX).toBeGreaterThan(RESERVOIR_LABEL_SIZE_PX);
    expect(RESERVOIR_LABEL_SIZE_PX).toBeGreaterThan(COUNTY_LABEL_SIZE_PX);
  });
});
