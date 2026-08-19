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

/** The six-digit basin codes the payload actually carries. */
const basinCodes = [...new Set(reservoirs.map((reservoir) => reservoir.huc6).filter(
  (code): code is string => typeof code === "string"))];

/**
 * Every drainage-area code the three widths a reader may choose can produce,
 * plus "every area". Basin codes come straight from the payload; the
 * subregion and region codes are their four- and two-digit prefixes, so this
 * covers 2, 4 and 6 digits without writing down a single code by hand -- an
 * area added or renamed one morning is covered by this agreement the same
 * morning.
 */
const everyArea: (string | null)[] = [null,
  ...basinCodes,
  ...new Set(basinCodes.map((code) => code.slice(0, 4))),
  ...new Set(basinCodes.map((code) => code.slice(0, 2)))];

/** Every state the three controls can produce. */
const everyState: FilterState[] = [null, ...STORAGE_CLASSES.map((_, index) => index)]
  .flatMap((storageClass) => (["all", "late", "current"] as const)
    .flatMap((reporting) => everyArea.map((drainageArea) =>
      ({ storageClass, reporting, drainageArea }))));

/** The attributes `createReservoirLayer` puts on each feature. */
function featureAttributes(reservoir: (typeof reservoirs)[number]) {
  return {
    fill_percent: headlinePercent(reservoir),
    late: isLate(reservoir) ? 1 : 0,
    // The layer writes the empty string where a reservoir has no area, so
    // the comparison here is against the same value the map holds.
    drainage_area: reservoir.huc6 ?? ""
  };
}

/**
 * What the layer view does with the bounds, applied here in plain code.
 *
 * The drainage check is a prefix match (`LIKE '<code>%'`), not equality, for
 * the same reason `filterWhere` renders it that way: a two- or four-digit
 * choice is a region or subregion that every basin inside it must still
 * match, and only a six-digit choice happens to equal the field outright.
 */
function boundsAccept(
  attributes: { fill_percent: number | null; late: number; drainage_area: string },
  state: FilterState
): boolean {
  if (!isFiltered(state)) return true;
  const bounds = filterBounds(state);
  if (bounds.drainageArea !== null && !attributes.drainage_area.startsWith(bounds.drainageArea)) {
    return false;
  }
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
        matchesFilter(reservoir, { storageClass: index, reporting: "all", drainageArea: null }));
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
    expect(filterWhere({ storageClass: 0, reporting: "all", drainageArea: null }))
      .toBe(`fill_percent < ${STORAGE_CLASSES[1]?.min}`);
  });

  it("leaves the highest class without an upper bound", () => {
    const top = STORAGE_CLASSES.length - 1;
    expect(filterWhere({ storageClass: top, reporting: "all", drainageArea: null }))
      .toBe(`fill_percent >= ${STORAGE_CLASSES[top]?.min}`);
  });

  it("combines a storage class with a reporting status", () => {
    expect(filterWhere({ storageClass: 2, reporting: "late", drainageArea: null }))
      .toBe(`late = 1 AND fill_percent >= ${STORAGE_CLASSES[2]?.min} ` +
        `AND fill_percent < ${STORAGE_CLASSES[3]?.min}`);
    expect(filterWhere({ storageClass: null, reporting: "current", drainageArea: null })).toBe("late = 0");
  });

  it("quotes a drainage area as a prefix match, and refuses one that is not a code", () => {
    expect(filterWhere({ storageClass: null, reporting: "all", drainageArea: "140600" }))
      .toBe("drainage_area LIKE '140600%'");
    // The one value in the clause that comes from data. Anything that is not
    // a code is dropped rather than quoted, which leaves the state filtering
    // nothing rather than carrying a string into the clause.
    for (const bad of ["' OR 1=1 --", "140600'", "", "14 0600", "14060", "1406000000000"]) {
      expect(filterWhere({ storageClass: null, reporting: "all", drainageArea: bad })).toBeNull();
    }
  });

  it("matches by prefix at 2, 4 and 6 digits, the same widths the predicate accepts", () => {
    expect(filterWhere({ storageClass: null, reporting: "all", drainageArea: "14" }))
      .toBe("drainage_area LIKE '14%'");
    expect(filterWhere({ storageClass: null, reporting: "all", drainageArea: "1406" }))
      .toBe("drainage_area LIKE '1406%'");
    expect(filterWhere({ storageClass: null, reporting: "all", drainageArea: "140600" }))
      .toBe("drainage_area LIKE '140600%'");
  });
});

describe("the predicate and the clause at every code width", () => {
  /* This is the finding docs/INITIAL-SCOPE-SELECTION.md opens with: the
   * predicate compares by prefix at any width, but the clause used to emit
   * equality, so a two- or four-digit choice would grey every reservoir on
   * the map while the list still showed the whole region or subregion. Held
   * against each other at 2, 4 and 6 digits over the committed payload --
   * "these two agree", not "today's data looks like this". */
  it("agree on a short code exactly as they agree on a full one", () => {
    for (const width of [2, 4, 6] as const) {
      const codes = [...new Set(basinCodes.map((code) => code.slice(0, width)))];
      for (const drainageArea of codes) {
        const state: FilterState = { storageClass: null, reporting: "all", drainageArea };
        const clause = filterWhere(state);
        expect(clause, `width ${width}, code ${drainageArea}`)
          .toBe(`drainage_area LIKE '${drainageArea}%'`);
        for (const reservoir of reservoirs) {
          const attributes = { fill_percent: headlinePercent(reservoir), late: isLate(reservoir) ? 1 : 0,
            drainage_area: reservoir.huc6 ?? "" };
          expect(
            boundsAccept(attributes, state),
            `${reservoir.name} disagreed at width ${width} for ${drainageArea}`
          ).toBe(matchesFilter(reservoir, state));
        }
      }
    }
  });

  /* A width the codes never come in. `HUC_CODE` refuses it, so the clause
   * drops it and the map filters nothing -- and the predicate has to reach
   * the same conclusion, or a hand-typed `?drainage=14060` dims the list
   * against a map showing every reservoir. Odd widths are the only place
   * the two forms can still be asked a question the payload never asks. */
  it("agree that a code of an odd width is no filter at all", () => {
    const odd = (basinCodes[0] ?? "140600").slice(0, 5);
    const state: FilterState = { storageClass: null, reporting: "all", drainageArea: odd };
    expect(filterWhere(state)).toBe(null);
    expect(isFiltered(state)).toBe(false);
    for (const reservoir of reservoirs) {
      expect(matchesFilter(reservoir, state), `${reservoir.name} was filtered by ${odd}`)
        .toBe(true);
    }
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
    const summary = describeFilter({ storageClass: 0, reporting: "late", drainageArea: null }, 3, 51);
    expect(summary).toContain("3 of 51");
    expect(summary).toContain("grey");
    expect(describeFilter(ALL_RESERVOIRS, 51, 51)).toBe("Showing all 51 reservoirs.");
  });

  it("reads as a sentence whichever controls the reader has used", () => {
    const area = { storageClass: null, reporting: "all", drainageArea: "140600" } as const;
    expect(describeFilter(area, 6, 51, "Lower Green"))
      .toContain("Showing 6 of 51 reservoirs in Lower Green.");
    expect(describeFilter({ ...area, storageClass: 0 }, 2, 51, "Lower Green"))
      .toContain(`Showing 2 of 51 reservoirs in Lower Green: ${storageLabel(0).toLowerCase()}.`);
    // The name arrives from the payload, so the sentence has to survive not
    // having one -- the moment after a scope change, before the control is
    // refilled.
    expect(describeFilter(area, 6, 51, null)).toContain("in one drainage area.");
  });

  it("keeps every label in Simplified Technical English", () => {
    const retired = /\baf\b|period-of-record|\bstale\b|cadence|seasonal percentile|RISE|AWDB/i;
    const copy = [
      ...STORAGE_CLASSES.map((_, index) => storageLabel(index)),
      storageLabel(null),
      ...(["all", "late", "current"] as const).map(reportingLabel),
      describeFilter({ storageClass: 1, reporting: "current", drainageArea: null }, 4, 51),
      describeFilter(ALL_RESERVOIRS, 51, 51)
    ].join(" ");
    expect(copy).not.toMatch(retired);
  });
});
