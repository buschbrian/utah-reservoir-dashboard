/* The filter exists twice -- as a predicate the list counts with, and as
 * bounds the map's `featureEffect` greys by. These tests hold the two
 * against each other over the committed payload. The assertion is always
 * "these two agree", never "today's data looks like this", so a morning's
 * refresh cannot turn the build red. */
import { describe, expect, it } from "vitest";
import { readPayload } from "../data/payload-fixture";
import { isLate } from "../data/rollup";
import { STORAGE_CLASSES } from "../viz/classes";
import { headlinePercent } from "../viz/symbols";
import {
  ALL_RESERVOIRS,
  classIndexOf,
  describeFilter,
  filterBounds,
  filterWhere,
  isFiltered,
  matchesFilter,
  reportingLabel,
  storageLabel,
  type FilterState
} from "./filters";

const reservoirs = readPayload().reservoirs;

/** Every state the two controls can produce. */
const everyState: FilterState[] = [null, ...STORAGE_CLASSES.map((_, index) => index)]
  .flatMap((storageClass) =>
    (["all", "late", "current"] as const).map((reporting) => ({ storageClass, reporting })));

/** The attributes `createReservoirLayer` puts on each feature. */
function featureAttributes(reservoir: (typeof reservoirs)[number]) {
  return { fill_percent: headlinePercent(reservoir), late: isLate(reservoir) ? 1 : 0 };
}

/** What the layer view does with the bounds, applied here in plain code. */
function boundsAccept(
  attributes: { fill_percent: number | null; late: number },
  state: FilterState
): boolean {
  if (!isFiltered(state)) return true;
  const bounds = filterBounds(state);
  if (bounds.late !== null && attributes.late !== bounds.late) return false;
  const percent = attributes.fill_percent;
  // A null fails every comparison, exactly as it does in a where clause.
  if (bounds.minPercent !== null && !(percent !== null && percent >= bounds.minPercent)) return false;
  if (bounds.maxPercent !== null && !(percent !== null && percent < bounds.maxPercent)) return false;
  return true;
}

describe("the two forms of one filter", () => {
  it("agree on every reservoir, in every state the controls can reach", () => {
    for (const state of everyState) {
      for (const reservoir of reservoirs) {
        expect(
          boundsAccept(featureAttributes(reservoir), state),
          `${reservoir.name} disagreed under ${JSON.stringify(state)}`
        ).toBe(matchesFilter(reservoir, state));
      }
    }
  });

  it("covers every reservoir exactly once across the storage classes", () => {
    for (const reservoir of reservoirs) {
      const matched = STORAGE_CLASSES.filter((_, index) =>
        matchesFilter(reservoir, { storageClass: index, reporting: "all" }));
      // None is the honest answer for a reservoir with no readable
      // percentage; more than one would mean the breaks overlap.
      expect(matched.length, reservoir.name)
        .toBe(headlinePercent(reservoir) === null ? 0 : 1);
    }
  });

  it("puts a reservoir in the class it is coloured by", () => {
    for (const reservoir of reservoirs) {
      const index = classIndexOf(reservoir);
      if (index === null) continue;
      expect(STORAGE_CLASSES[index]?.min).toBeLessThanOrEqual(headlinePercent(reservoir) ?? 0);
    }
  });
});

describe("the where clause", () => {
  it("is null when nothing is filtered, rather than a clause matching everything", () => {
    expect(isFiltered(ALL_RESERVOIRS)).toBe(false);
    expect(filterWhere(ALL_RESERVOIRS)).toBeNull();
  });

  it("leaves the lowest class without a lower bound", () => {
    expect(filterWhere({ storageClass: 0, reporting: "all" }))
      .toBe(`fill_percent < ${STORAGE_CLASSES[1]?.min}`);
  });

  it("leaves the highest class without an upper bound", () => {
    const top = STORAGE_CLASSES.length - 1;
    expect(filterWhere({ storageClass: top, reporting: "all" }))
      .toBe(`fill_percent >= ${STORAGE_CLASSES[top]?.min}`);
  });

  it("combines a storage class with a reporting status", () => {
    expect(filterWhere({ storageClass: 2, reporting: "late" }))
      .toBe(`late = 1 AND fill_percent >= ${STORAGE_CLASSES[2]?.min} ` +
        `AND fill_percent < ${STORAGE_CLASSES[3]?.min}`);
    expect(filterWhere({ storageClass: null, reporting: "current" })).toBe("late = 0");
  });
});

describe("what the panel says", () => {
  it("takes every storage label from the class table", () => {
    STORAGE_CLASSES.forEach((storageClass, index) => {
      expect(storageLabel(index)).toBe(storageClass.label);
    });
    expect(storageLabel(null)).toBe("All storage levels");
  });

  it("reports how many of how many, because the map dims rather than hides", () => {
    const summary = describeFilter({ storageClass: 0, reporting: "late" }, 3, 51);
    expect(summary).toContain("3 of 51");
    expect(summary).toContain("grey");
    expect(describeFilter(ALL_RESERVOIRS, 51, 51)).toBe("Showing all 51 reservoirs.");
  });

  it("keeps every label in Simplified Technical English", () => {
    const retired = /\baf\b|period-of-record|\bstale\b|cadence|seasonal percentile|RISE|AWDB/i;
    const copy = [
      ...STORAGE_CLASSES.map((_, index) => storageLabel(index)),
      storageLabel(null),
      ...(["all", "late", "current"] as const).map(reportingLabel),
      describeFilter({ storageClass: 1, reporting: "current" }, 4, 51),
      describeFilter(ALL_RESERVOIRS, 51, 51)
    ].join(" ");
    expect(copy).not.toMatch(retired);
  });
});
