/*
 * The digest's sentences.
 *
 * The model is tested for arithmetic; this is tested for honesty. Every case
 * here is one where a summary could state something true and misleading, or
 * quietly leave a gap where a reason belongs.
 */
import { describe, expect, it } from "vitest";
import type { WeeklyMove, WeeklyStorage } from "../weekly-model";
import {
  describeDrought, describeMove, describeMovers, describeSnow, describeStorage
} from "./weekly-summary";

const move = (over: Partial<WeeklyMove>): WeeklyMove => ({
  name: "Test", changeAf: 100, changePercent: 5, changePoints: 2, asOf: "2026-08-15", ...over
});
const storage = (over: Partial<WeeklyStorage>): WeeklyStorage => ({
  measured: 40, published: 69, netAf: -1000, rose: 6, fell: 33, steady: 1,
  percentNow: 31.8, percentBefore: 32.2,
  biggestRise: null, biggestFall: null, largestShareMove: null, ...over
});

describe("a single reservoir's week", () => {
  it("gives the volume and the share of its own full level", () => {
    expect(describeMove(move({ name: "Powell", changeAf: -69480, changePoints: -0.28 })))
      .toBe("Powell fell 69,480 acre-feet, which is 0.3% of its own full level");
  });

  it("says rose or fell rather than leaning on a sign", () => {
    expect(describeMove(move({ changeAf: 565 }))).toContain("rose");
    expect(describeMove(move({ changeAf: -565 }))).toContain("fell");
  });
});

describe("the storage paragraph", () => {
  /*
   * A combined figure moving from 32.2% full to 31.8% has changed by half a
   * point, not by half a percent -- half a percent of 32.2 is 0.16. Reusing
   * the per-cent sign for both is the unit error this wording exists to
   * avoid.
   */
  it("reports a change in the combined figure as points", () => {
    const lines = describeStorage(storage({}));

    // 32.2 to 31.8 is four tenths of a point.
    expect(lines.join(" ")).toContain("down 0.4 points");
    expect(lines.join(" ")).not.toContain("-0.4%");
    expect(lines.join(" ")).toContain("32.2% full to 31.8%");
  });

  /* Twenty-nine of sixty-nine reservoirs report month-end only, so no
   * sentence above describes them. Saying so is not a footnote. */
  it("says how much of the region it did not measure", () => {
    const lines = describeStorage(storage({ measured: 40, published: 69 }));

    expect(lines.join(" ")).toContain("40 reservoirs that report every day");
    expect(lines.join(" ")).toContain("other 29");
  });

  it("leaves the caveat out when every reservoir was measured", () => {
    const lines = describeStorage(storage({ measured: 69, published: 69 }));
    expect(lines.join(" ")).not.toContain("once a month");
  });

  it("has words for a week where nothing was published", () => {
    expect(describeStorage(storage({ measured: 0 })).join(" "))
      .toContain("nothing to compare");
  });
});

describe("the movers", () => {
  /* When one reservoir leads both the volume and the proportion, naming it
   * twice reads as two separate findings. */
  it("does not name the same reservoir twice", () => {
    const same = move({ name: "Newton", changeAf: 565, changePoints: 10.1 });
    const lines = describeMovers(storage({ biggestRise: same, largestShareMove: same }));

    expect(lines.filter((line) => line.includes("Newton"))).toHaveLength(1);
  });

  /* And when they differ, the proportional mover has to arrive with the
   * measure that makes it one -- otherwise a 565 acre-foot move looks like it
   * beat a 69,480 acre-foot one. */
  it("names the proportional mover with its own measure", () => {
    const lines = describeMovers(storage({
      biggestFall: move({ name: "Powell", changeAf: -69480, changePoints: -0.28 }),
      largestShareMove: move({ name: "Newton", changeAf: 565, changePoints: 10.1,
        changePercent: 111.9 })
    }));

    const proportional = lines.find((line) => line.includes("Newton")) ?? "";
    expect(proportional).toContain("for its own size");
    expect(proportional).toContain("111.9%");
    expect(proportional).toContain("held a week earlier");
  });
});

describe("the sections that have nothing to report", () => {
  /* A gap reads as a fault. Each of these says the reason instead. */
  it("explains why there is no snow comparison out of season", () => {
    const lines = describeSnow({
      comparable: false, day: "2026-08-15", previousDay: "2026-08-08",
      percentNow: null, percentBefore: null, reporting: 0
    });

    expect(lines.join(" ")).toContain("nothing to");
    expect(lines.join(" ")).toContain("1991 through 2020");
  });

  it("compares the two ends of the week when both have a value", () => {
    const lines = describeSnow({
      comparable: true, day: "2026-03-07", previousDay: "2026-02-28",
      percentNow: 61.1, percentBefore: 55.0, reporting: 171
    });

    expect(lines.join(" ")).toContain("55.0% of normal");
    expect(lines.join(" ")).toContain("61.1%");
    expect(lines.join(" ")).toContain("171 sites");
  });

  /* This one is a fact about this project's data rather than about the
   * monitor, and the sentence has to say which. */
  it("says the missing drought history is ours, not the publisher's", () => {
    const lines = describeDrought({
      mapDate: "2026-08-11", releaseDate: "2026-08-13",
      worst: { key: "d4", code: "D4", label: "Exceptional drought", color: "#730000" },
      areasAtOrWorse: 14, units: 14, comparable: false
    });

    expect(lines.join(" ")).toContain("This site keeps one week");
  });
});
