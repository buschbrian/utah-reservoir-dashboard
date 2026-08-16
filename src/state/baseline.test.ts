/*
 * The rules that make the baseline control honest rather than decorative.
 *
 * Two of these tests exist because of the same mistake in two places: a
 * comparison that answers with a period other than the one it was asked for,
 * without saying so. That is the failure the whole feature exists to fix -- the
 * site already had it, silently, in the form of a single "normal" that was a
 * median over the drought years -- so it is the thing most worth a test.
 */
import { describe, expect, it } from "vitest";

import {
  activeBaseline, baselineChoices, baselineCoverage, baselineRowLabel,
  describeBaseline, isBaselineId, periodLabel, readBaseline
} from "./baseline";
import type {
  Baseline, BaselineChoice, Reservoir, ReservoirPayload
} from "../types";

const CHOICES: BaselineChoice[] = [
  {
    id: "recent", label: "Recent years", period_label: "2015 through 2025",
    start_year: 2015, end_year: 2025, note: "Every earlier year this site holds."
  },
  {
    id: "climate", label: "Standard climate period", period_label: "1991 through 2020",
    start_year: 1991, end_year: 2020, note: "The standard thirty year period."
  }
];

function baseline(over: Partial<Baseline> = {}): Baseline {
  return {
    normal_af: 1000,
    pct_of_normal: 90,
    sample_years: 11,
    covers_full_period: true,
    first_obs: "2015-01-01",
    ...over
  };
}

/** Only the fields these tests read. The cast is the point of the helper. */
function reservoir(over: Partial<Reservoir> = {}): Reservoir {
  return {
    name: "Test",
    seasonal_normal_af: 1000,
    pct_of_seasonal_normal: 90,
    seasonal_sample_years: 11,
    first_obs: "2015-01-01",
    ...over
  } as unknown as Reservoir;
}

describe("which period a normal came from", () => {
  it("recognises only the two periods that exist", () => {
    expect(isBaselineId("recent")).toBe(true);
    expect(isBaselineId("climate")).toBe(true);
    expect(isBaselineId("1991")).toBe(false);
    expect(isBaselineId(null)).toBe(false);
  });

  it("reads a payload written before the control existed", () => {
    /* The three `seasonal_*` fields are the recent baseline -- the pipeline
     * computes both from one expression -- so an older payload still answers
     * for that period rather than showing nothing. */
    const older = reservoir();
    const found = readBaseline(older, "recent");
    expect(found?.normal_af).toBe(1000);
    expect(found?.sample_years).toBe(11);
    // But it cannot invent the period it never carried.
    expect(readBaseline(older, "climate")).toBeNull();
  });

  it("prefers what the payload published over the compatibility reading", () => {
    const current = reservoir({
      baselines: {
        recent: baseline({ normal_af: 1234 }), climate: null, default: "recent"
      }
    });
    expect(readBaseline(current, "recent")?.normal_af).toBe(1234);
  });
});

describe("choosing a period for one reservoir", () => {
  it("uses the period asked for when the reservoir has it", () => {
    const both = reservoir({
      baselines: {
        recent: baseline(),
        climate: baseline({ normal_af: 1400, sample_years: 30 }),
        default: "climate"
      }
    });
    const active = activeBaseline(both, "climate");
    expect(active.shown).toBe("climate");
    expect(active.substituted).toBe(false);
    expect(active.value?.sample_years).toBe(30);
  });

  it("substitutes the other period and marks that it did", () => {
    /* A dam built in 2017 has no 1991 comparison. Dropping its row would lose
     * a reservoir from a comparison of twenty; showing the other period's
     * number under the chosen label would be a lie. It does neither. */
    const young = reservoir({
      baselines: { recent: baseline(), climate: null, default: "recent" }
    });
    const active = activeBaseline(young, "climate");
    expect(active.requested).toBe("climate");
    expect(active.shown).toBe("recent");
    expect(active.substituted).toBe(true);
  });

  it("refuses a period the reservoir has too few years in", () => {
    /* The subtle case, and the one a reader would never catch. Jackson Flat's
     * dam dates from 2017, so it has three years inside 1991-2020. Showing a
     * three-year median under the label "1991 through 2020" is true in every
     * word and wrong as a whole. */
    const young = reservoir({
      baselines: {
        recent: baseline({ sample_years: 8 }),
        climate: baseline({ sample_years: 3 }),
        default: "recent"
      }
    });
    const active = activeBaseline(young, "climate", 10);
    expect(active.shown).toBe("recent");
    expect(active.substituted).toBe(true);
    expect(active.reason).toBe("thin");
    expect(describeBaseline(active, CHOICES))
      .toContain("too few years in 1991 through 2020");

    // And with no threshold declared, the same reservoir answers as before.
    expect(activeBaseline(young, "climate", 0).shown).toBe("climate");
  });

  it("tells a missing period apart from a thin one", () => {
    const missing = reservoir({
      baselines: { recent: baseline(), climate: null, default: "recent" }
    });
    expect(activeBaseline(missing, "climate", 10).reason).toBe("none");
    expect(describeBaseline(activeBaseline(missing, "climate", 10), CHOICES))
      .toContain("no 1991 through 2020 comparison");
  });

  it("has nothing to show when neither period exists", () => {
    const bare = reservoir({
      seasonal_normal_af: null,
      baselines: { recent: null, climate: null, default: "recent" }
    });
    const active = activeBaseline(bare, "climate");
    expect(active.shown).toBeNull();
    expect(active.value).toBeNull();
    expect(active.substituted).toBe(false);
  });
});

describe("the words the panel shows", () => {
  it("names the years and the number of them, every time", () => {
    const both = reservoir({
      baselines: {
        recent: baseline(),
        climate: baseline({ normal_af: 1400, pct_of_normal: 64.3, sample_years: 30 }),
        default: "climate"
      }
    });
    const text = describeBaseline(activeBaseline(both, "climate"), CHOICES);
    expect(text).toContain("1,400 acre-feet");
    expect(text).toContain("64.3%");
    expect(text).toContain("30 years of 1991 through 2020");
  });

  it("says which period it fell back to, in the same sentence as the number", () => {
    const young = reservoir({
      baselines: { recent: baseline(), climate: null, default: "recent" }
    });
    const text = describeBaseline(activeBaseline(young, "climate"), CHOICES);
    expect(text).toContain("no 1991 through 2020 comparison");
    expect(text).toContain("2015 through 2025");
  });

  it("puts the period in the row's own heading", () => {
    const both = reservoir({
      baselines: { recent: baseline(), climate: baseline(), default: "climate" }
    });
    expect(baselineRowLabel(activeBaseline(both, "climate"), CHOICES))
      .toBe("Normal for this week, 1991 through 2020");
  });

  it("says one year rather than 1 years", () => {
    const single = reservoir({
      baselines: {
        recent: baseline({ sample_years: 1 }), climate: null, default: "recent"
      }
    });
    expect(describeBaseline(activeBaseline(single, "recent"), CHOICES))
      .toContain("1 year of");
  });

  it("falls back to plain words for a period it was given no label for", () => {
    expect(periodLabel([], "climate")).toBe("earlier years");
    expect(periodLabel(CHOICES, null)).toBe("no earlier years");
  });
});

describe("what the control offers", () => {
  function payload(reservoirs: Reservoir[]): ReservoirPayload {
    return { baselines: CHOICES, reservoirs } as unknown as ReservoirPayload;
  }

  it("drops a period no reservoir can answer for", () => {
    /* A control with an option that changes nothing is a question about the
     * page rather than about the water. */
    const none = payload([reservoir({
      baselines: { recent: baseline(), climate: null, default: "recent" }
    })]);
    expect(baselineChoices(none).map((choice) => choice.id)).toEqual(["recent"]);
  });

  it("keeps a period even one reservoir can answer for", () => {
    const some = payload([
      reservoir({ baselines: { recent: baseline(), climate: null, default: "recent" } }),
      reservoir({ baselines: { recent: baseline(), climate: baseline(), default: "climate" } })
    ]);
    expect(baselineChoices(some).map((choice) => choice.id)).toEqual(["recent", "climate"]);
  });

  it("counts how many reservoirs a period actually covers", () => {
    const mixed = [
      reservoir({ baselines: { recent: baseline(), climate: baseline(), default: "climate" } }),
      reservoir({ baselines: { recent: baseline(), climate: null, default: "recent" } })
    ];
    expect(baselineCoverage(mixed, "climate")).toEqual({ covered: 1, total: 2 });
    expect(baselineCoverage(mixed, "recent")).toEqual({ covered: 2, total: 2 });
  });

  it("does not count a reservoir with too few years as covered", () => {
    const thin = [
      reservoir({
        baselines: {
          recent: baseline(), climate: baseline({ sample_years: 30 }), default: "climate"
        }
      }),
      reservoir({
        baselines: {
          recent: baseline(), climate: baseline({ sample_years: 3 }), default: "recent"
        }
      })
    ];
    expect(baselineCoverage(thin, "climate", 10)).toEqual({ covered: 1, total: 2 });
  });
});
