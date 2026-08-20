import { describe, expect, it, vi } from "vitest";
import { readPayload } from "../data/payload-fixture";
import { storageColor } from "../viz/classes";
import { headlinePercent } from "../viz/symbols";
import {
  changeLabel, describeReservoir, lateMessage, monthlyDetail, providerName,
  rankWithYears
} from "./detail";
import { createSelectionStore, findReservoir, normalizeSelectionValue } from "./selection";
import { loadLegacyApi } from "../data/legacy-harness";

const legacy = loadLegacyApi();
const reservoirs = readPayload().reservoirs;
const views = reservoirs.map((reservoir) =>
  describeReservoir(reservoir, storageColor(headlinePercent(reservoir))));

/* The acronyms in the payload's own `source_label`, and the rest of the
 * retired vocabulary. The smoke test reads the rendered page; this reads the
 * strings before they reach it, so a bad word fails in milliseconds and
 * names the reservoir it came from.
 *
 * Whole words, and the acronyms case-sensitively: two of the reservoirs are
 * called Upper and Lower Enterprise, and a loose substring search reads the
 * provider's name out of the middle of them. */
const RETIRED = [/\bRISE\b/, /\bAWDB\b/, /\baf\b/i, /period-of-record/i, /\bstale\b/i,
  /\bcadence\b/i, /seasonal percentile/i];

describe("the details a reader sees", () => {
  it("never shows a retired term for any published reservoir", () => {
    const offenders: string[] = [];
    for (const view of views) {
      /* The note and the month labels are read here too. They arrived with
       * the twelve-month history, which was ported from the legacy popup --
       * the one place on the old pages where "seasonal percentile" and the
       * provider acronyms were still written out in full. */
      const text = [view.name, view.percent, view.basis, view.late ?? "", view.note,
        ...view.months.map((month) => month.label),
        ...view.rows.flatMap((row) => [row.label, row.value])].join(" | ");
      for (const term of RETIRED) {
        if (term.test(text)) offenders.push(`${view.name}: ${String(term)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names the measuring agency in full, not the payload's own label", () => {
    for (const reservoir of reservoirs) {
      expect(providerName(reservoir)).toBe(reservoir.source_key === "rise"
        ? "Bureau of Reclamation"
        : "Natural Resources Conservation Service");
    }
  });

  it("gives the name, percentage, reading date and agency for every reservoir", () => {
    for (const view of views) {
      expect(view.name).not.toBe("");
      expect(view.rows.map((row) => row.label)).toEqual(
        expect.arrayContaining(["Stored now", "Reading date", "Measured by"]));
      expect(view.rows.find((row) => row.label === "Reading date")?.value).not.toBe("");
    }
  });

  it("says which number the percentage is measured against", () => {
    const reservoir = reservoirs.find((candidate) => candidate.capacity_af !== null);
    const withoutCapacity = reservoirs.find((candidate) => candidate.capacity_af === null);
    expect(reservoir).toBeDefined();
    if (reservoir) {
      expect(describeReservoir(reservoir, "#000").basis).toContain("capacity");
    }
    if (withoutCapacity) {
      expect(describeReservoir(withoutCapacity, "#000").basis)
        .toContain("highest recorded storage");
    }
  });

  it("marks late data in plain words and leaves current data unmarked", () => {
    /* Whether a reading is late is the pipeline's answer, published as
     * `is_stale`; the message only says how late. Setting the flag here
     * rather than the days it was derived from is what keeps this panel,
     * the dashed ring and the list badge one rule instead of three. */
    const late = { ...reservoirs[0], is_stale: true, days_stale: 40, fetch_ok: true };
    expect(lateMessage(late as never)).toBe("This reading is late by 40 days.");
    expect(lateMessage({ ...late, is_stale: false } as never)).toBeNull();
    expect(lateMessage({ ...late, days_stale: 3 } as never))
      .toBe("This reading is late by 3 days.");
  });

  it("takes the headline colour from the shared class table", () => {
    for (const [index, view] of views.entries()) {
      expect(view.color).toBe(legacy.colorFor(legacy.headlinePct(reservoirs[index])));
    }
  });

  /* The panel is the 5.1 replacement for the legacy popup, and the cut-over
   * to the root made it the only place most readers will ever see these
   * numbers. It shipped with five rows against that popup's eleven. */
  it("carries every reading the legacy popup carried", () => {
    for (const view of views) {
      expect(view.rows.map((row) => row.label)).toEqual(expect.arrayContaining([
        "Stored now", "History rank", "Highest value this year", "Reading date",
        "Update schedule", "Measured by"
      ]));
      /* The comparison row is still there, but its label now names the period
       * rather than saying "normal" and leaving the reader to guess which
       * normal. That naming is the point of the row, so it is asserted as a
       * shape rather than as a fixed string. */
      expect(view.rows.some((row) => row.label.startsWith("Normal for this week,")))
        .toBe(true);
      /* The two change rows, for the same reason one step further on. "30
       * days" is the interval the pipeline asks for and not always the one it
       * gets, so where the reading it found is 31 days back the row says 31.
       * Asserting the literal label would pin the row to the case where the
       * provider happened to answer on the exact day. */
      const changes = view.rows.filter((row) => row.label.startsWith("Change in "));
      expect(changes, view.name).toHaveLength(2);
      for (const row of changes) {
        expect(row.label, view.name).toMatch(/^Change in (30 days|1 year|\d+ days)$/);
      }
    }
  });

  const comparisonRow = (view: { rows: { label: string; value: string }[] }) =>
    view.rows.find((entry) => entry.label.startsWith("Normal for this week"));

  it("states how many earlier years support the weekly comparison", () => {
    const reservoir = reservoirs.find((candidate) => candidate.seasonal_sample_years > 0);
    expect(reservoir).toBeDefined();
    if (reservoir) {
      const row = comparisonRow(describeReservoir(reservoir, "#000"));
      expect(row?.value).toContain(`${reservoir.seasonal_sample_years} years`);
    }

    const base = reservoirs[0];
    expect(base).toBeDefined();
    if (!base) return;
    /* The key is removed rather than set to undefined: `exactOptionalPropertyTypes`
     * treats "absent" and "present and undefined" as different, and the case
     * under test is a payload written before the control existed. */
    const { baselines: _unused, ...withoutBaselines } = base;
    const withoutComparison = {
      ...withoutBaselines,
      seasonal_normal_af: null,
      pct_of_seasonal_normal: null,
      seasonal_sample_years: 0
    };
    const row = comparisonRow(describeReservoir(withoutComparison, "#000"));
    expect(row?.value).toBe("No earlier years to compare with.");
  });

  it("names the period in the row, so two normals cannot be confused", () => {
    /* The whole point of the change. A reader looking at "44.6% of normal"
     * has to be able to see which years that normal came from, because the
     * same reservoir reads 35.0% against 1991-2020 -- a ten point difference
     * that is invisible in the number itself. */
    const base = reservoirs[0];
    expect(base).toBeDefined();
    if (!base) return;
    const reservoir = {
      ...base,
      baselines: {
        recent: {
          normal_af: 1000, pct_of_normal: 90, sample_years: 11,
          covers_full_period: true, first_obs: "2015-01-01"
        },
        climate: {
          normal_af: 1400, pct_of_normal: 64.3, sample_years: 30,
          covers_full_period: true, first_obs: "1991-01-01"
        },
        default: "climate" as const
      }
    };
    const choices = [
      { id: "recent" as const, label: "Recent years", period_label: "2015 through 2025",
        start_year: 2015, end_year: 2025, note: "" },
      { id: "climate" as const, label: "Standard climate period",
        period_label: "1991 through 2020", start_year: 1991, end_year: 2020, note: "" }
    ];
    const climate = describeReservoir(reservoir, "#000", "climate", choices);
    expect(comparisonRow(climate)?.label).toContain("1991 through 2020");
    expect(comparisonRow(climate)?.value).toContain("30 years");
    expect(climate.baseline.substituted).toBe(false);

    const recent = describeReservoir(reservoir, "#000", "recent", choices);
    expect(comparisonRow(recent)?.label).toContain("2015 through 2025");
    expect(comparisonRow(recent)?.value).toContain("11 years");
  });

  it("says when a reservoir cannot answer for the period the reader chose", () => {
    /* Five reservoirs are younger than 1991. Showing the other period's
     * number under the label the reader selected would make the control a
     * lie, so the substitution is stated in the same sentence. */
    const base = reservoirs[0];
    expect(base).toBeDefined();
    if (!base) return;
    const young = {
      ...base,
      baselines: {
        recent: {
          normal_af: 1000, pct_of_normal: 90, sample_years: 8,
          covers_full_period: true, first_obs: "2017-06-01"
        },
        climate: null,
        default: "recent" as const
      }
    };
    const choices = [
      { id: "recent" as const, label: "Recent years", period_label: "2015 through 2025",
        start_year: 2015, end_year: 2025, note: "" },
      { id: "climate" as const, label: "Standard climate period",
        period_label: "1991 through 2020", start_year: 1991, end_year: 2020, note: "" }
    ];
    const view = describeReservoir(young, "#000", "climate", choices);
    expect(view.baseline.substituted).toBe(true);
    expect(comparisonRow(view)?.label).toContain("2015 through 2025");
    expect(comparisonRow(view)?.value).toContain("no 1991 through 2020 comparison");
  });

  it("signs a change and marks a fall, so a drop cannot read as a rise", () => {
    const falling = reservoirs.find((candidate) =>
      (candidate.change_30d_af ?? 0) < 0);
    expect(falling, "the fixture has no falling reservoir to check").toBeDefined();
    /* The 30-day row, whatever interval it turned out to cover: the label
     * carries the measured days when they differ from the 30 asked for, so
     * finding the row by its literal label finds nothing on most mornings. */
    const thirtyDayRow = (reservoir: typeof reservoirs[number]) =>
      describeReservoir(reservoir, "#000").rows
        .filter((entry) => entry.label.startsWith("Change in "))[0];
    if (falling) {
      const row = thirtyDayRow(falling);
      expect(row?.value.startsWith("-")).toBe(true);
      expect(row?.value).toContain("%");
      expect(row?.negative).toBe(true);
    }
    const rising = reservoirs.find((candidate) => (candidate.change_30d_af ?? 0) > 0);
    if (rising) {
      const row = thirtyDayRow(rising);
      expect(row?.value.startsWith("+")).toBe(true);
      expect(row?.value).toContain("%");
      expect(row?.negative).toBe(false);
    }
  });

  it("shows relative change for both comparison periods", () => {
    const comparable = reservoirs.find((candidate) =>
      candidate.change_30d_pct !== null && candidate.change_365d_pct !== null);
    expect(comparable).toBeDefined();
    if (!comparable) return;
    const rows = describeReservoir(comparable, "#000").rows;
    expect(rows.find((row) => row.label === "Change in 30 days")?.value).toContain("%");
    expect(rows.find((row) => row.label === "Change in 1 year")?.value).toContain("%");
  });

  /* The chart under the circle must not answer the question the circle
   * answered with a different denominator: both divide by `sizeBasis`. */
  it("colours each month by the same denominator the map uses", () => {
    for (const reservoir of reservoirs) {
      for (const month of monthlyDetail(reservoir)) {
        expect(month.color).toBe(storageColor(month.percent));
        expect(month.percent).toBe(legacy.monthPct(reservoir, month.key));
      }
    }
  });
});

describe("selecting a reservoir", () => {
  it("finds a reservoir the way the production pages do", () => {
    const rows = reservoirs.map((reservoir) => ({ name: reservoir.name }));
    for (const name of ["Deer Creek", "  deer creek ", "LAKE POWELL"]) {
      expect(findReservoir(rows, name)?.name).toBe(legacy.findReservoir(rows, name)?.name);
    }
    expect(findReservoir(rows, "Lake Wobegon")).toBeNull();
    expect(findReservoir(rows, null)).toBeNull();
  });

  it("reads a blank name as nothing selected", () => {
    expect(normalizeSelectionValue("   ")).toBeNull();
    const store = createSelectionStore();
    store.set("   ");
    expect(store.get()).toBeNull();
  });

  it("tells subscribers only about real changes", () => {
    const store = createSelectionStore();
    const seen = vi.fn();
    store.subscribe(seen);
    expect(store.set("Deer Creek", { source: "map" })).toBe(true);
    expect(store.set("Deer Creek", { source: "list" })).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith("Deer Creek", { source: "map" });
  });

  it("keeps calling the other subscribers after one throws", () => {
    const store = createSelectionStore();
    const second = vi.fn();
    store.subscribe(() => { throw new Error("layer not ready"); });
    store.subscribe(second);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.set("Deer Creek");
    expect(second).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("stops calling a subscriber that unsubscribed", () => {
    const store = createSelectionStore();
    const seen = vi.fn();
    const off = store.subscribe(seen);
    store.set("Deer Creek");
    off();
    store.clear();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

/*
 * What "full" is measured against, and how much history a rank rests on.
 *
 * Both were reviewed into the panel after a read of the published data found
 * that neither was stated anywhere a reader could see. Three different
 * quantities arrive as "capacity" from the two providers, and four reservoirs
 * -- Lake Powell among them -- carry roughly seven tenths of the combined
 * full level that every regional percentage is divided by. And every history
 * rank rests on eight to eleven years, because the record starts in 2015.
 */
describe("what the panel says about its own basis", () => {
  it("names which kind of full level each percentage is measured against", () => {
    const named = reservoirs
      .filter((reservoir) => reservoir.capacity_basis !== null)
      .map((reservoir) => describeReservoir(reservoir, "#000"));

    expect(named.length).toBeGreaterThan(0);
    for (const view of named) {
      const capacity = view.rows.find((row) =>
        row.label === "Capacity" || row.label === "Highest recorded storage");
      expect(capacity?.value, `${view.name} does not say which full level`)
        .toMatch(/measured as /);
    }
  });

  /* The distinction that matters: a maximum level includes storage kept for
   * floods and is not the pool a reservoir is operated to hold. A reader
   * comparing two reservoirs is entitled to know they are not the same
   * measurement. */
  it("distinguishes a maximum level from a normal one", () => {
    const maximum = reservoirs.find((r) => r.capacity_basis === "max_storage");
    const normal = reservoirs.find((r) => r.capacity_basis === "normal_storage");

    expect(maximum, "the payload no longer carries a maximum-level reservoir")
      .toBeDefined();
    expect(normal).toBeDefined();
    const maximumRow = describeReservoir(maximum!, "#000").rows
      .find((row) => row.label === "Capacity")?.value ?? "";
    const normalRow = describeReservoir(normal!, "#000").rows
      .find((row) => row.label === "Capacity")?.value ?? "";

    expect(maximumRow).toContain("floods");
    expect(normalRow).toContain("normal full level");
    expect(maximumRow).not.toBe(normalRow);
  });

  it("names a full level resolved from the reservoir operator's record", () => {
    const reservoir = reservoirs.find(
      (row) => row.capacity_basis === "reclamation_project_record");

    expect(reservoir).toBeDefined();
    const capacity = describeReservoir(reservoir!, "#000").rows
      .find((row) => row.label === "Capacity")?.value ?? "";
    expect(capacity).toContain("published by the reservoir operator");
  });

  /*
   * A rank without its sample size is the failure this guards; which form it
   * takes is not. "3rd-lowest of 12" names the population it is a position
   * in, and "18.2%, out of 11 earlier years" names it beside the share --
   * both satisfy the rule, and the ordinal is the one that cannot be read as
   * more precise than eleven years support.
   */
  it("gives every history rank the number of years behind it", () => {
    for (const view of views) {
      const rank = view.rows.find((row) => row.label === "History rank")?.value ?? "";
      if (rank === "—") continue;
      expect(rank, `${view.name} states a rank with no sample size`)
        .toMatch(/(out of \d+ earlier years?)|(-lowest of \d+)/);
    }
  });

  /* The record is short and the note has to say so, because a percentile out
   * of eleven reads exactly like a percentile out of a hundred. */
  it("warns that a rank from this record is an indication, not a measurement", () => {
    expect(views[0]?.note).toContain("indication rather than a measurement");
  });
});

/*
 * The history rank, said as a position rather than only as a percentage.
 *
 * The percentage was the whole answer, and with eleven earlier years behind
 * it the reachable values are about nine points apart -- so every value in
 * between is unreachable, and two ranks four points apart are the same rank.
 * A reader has no way to know that from "18.2%" alone.
 */
describe("how the history rank reads", () => {
  it("leads with the position and keeps the percentage", () => {
    expect(rankWithYears(18.2, 11, 3, 12)).toBe("3rd-lowest of 12, 18.2%");
    expect(rankWithYears(0, 10, 1, 11)).toBe("1st-lowest of 11, 0.0%");
    expect(rankWithYears(100, 10, 11, 11)).toBe("11th-lowest of 11, 100.0%");
  });

  it("spells the awkward ordinals correctly", () => {
    expect(rankWithYears(50, 30, 11, 31)).toContain("11th-lowest");
    expect(rankWithYears(50, 30, 12, 31)).toContain("12th-lowest");
    expect(rankWithYears(50, 30, 13, 31)).toContain("13th-lowest");
    expect(rankWithYears(50, 30, 21, 31)).toContain("21st-lowest");
    expect(rankWithYears(50, 30, 22, 31)).toContain("22nd-lowest");
    expect(rankWithYears(50, 30, 23, 31)).toContain("23rd-lowest");
  });

  /* The fields arrive from the pipeline. A payload written before they did
   * must still answer, rather than losing the row. */
  it("falls back to the percentage and year count without them", () => {
    expect(rankWithYears(18.2, 11)).toBe("18.2%, out of 11 earlier years");
    expect(rankWithYears(18.2, 1)).toBe("18.2%, out of 1 earlier year");
  });

  it("says nothing it cannot support", () => {
    expect(rankWithYears(null, 11, 3, 12)).toBe("—");
    expect(rankWithYears(18.2, 0)).toBe("18.2%");
    // One "earlier year" that is only this reading is not a population.
    expect(rankWithYears(18.2, 0, 1, 1)).toBe("18.2%");
  });

  /* Whatever the payload holds today, the two forms must not disagree about
   * direction: the top position and 100% have to arrive together. */
  it("agrees with the percentage across the published payload", () => {
    for (const reservoir of reservoirs) {
      const rank = reservoir.seasonal_rank ?? null;
      const rankOf = reservoir.seasonal_rank_of ?? null;
      if (rank === null || rankOf === null) continue;
      expect(rank, reservoir.name).toBeGreaterThanOrEqual(1);
      expect(rank, reservoir.name).toBeLessThanOrEqual(rankOf);
      expect(rankWithYears(reservoir.seasonal_percentile, 0, rank, rankOf),
        reservoir.name).toContain("-lowest of ");
    }
  });
});

/*
 * "Change in 1 year" is the date the pipeline asks for, not the one it gets.
 * The nearest usable reading is taken within ten days for a daily feed and
 * forty-five for a month-end one, so the row has covered 320 days to 410 --
 * and the panel said "1 year" for all of it.
 */
describe("how a change states its own interval", () => {
  it("keeps the plain label when the interval is the one in the name", () => {
    expect(changeLabel("Change in 30 days", 30)).toBe("Change in 30 days");
    expect(changeLabel("Change in 1 year", 365)).toBe("Change in 1 year");
  });

  it("gives way to the measurement when they differ", () => {
    expect(changeLabel("Change in 30 days", 44)).toBe("Change in 44 days");
    expect(changeLabel("Change in 1 year", 397)).toBe("Change in 397 days");
    expect(changeLabel("Change in 1 year", 320)).toBe("Change in 320 days");
  });

  /* A payload written before the pipeline published the elapsed days keeps
   * the plain label rather than losing the row. */
  it("falls back to the name when the payload cannot say", () => {
    expect(changeLabel("Change in 30 days", null)).toBe("Change in 30 days");
    expect(changeLabel("Change in 30 days", undefined)).toBe("Change in 30 days");
    expect(changeLabel("Change in 30 days", Number.NaN)).toBe("Change in 30 days");
  });

  it("names the reading a change is measured from, where the payload has one", () => {
    for (const view of views) {
      const row = view.rows.find((entry) => entry.label.startsWith("Change in 1"))
        ?? view.rows.find((entry) => entry.label.startsWith("Change in 3"));
      if (!row || row.value === "—") continue;
      // Either it names the date, or the payload predates the field entirely.
      const reservoir = reservoirs.find((entry) => entry.name === view.name);
      if (reservoir?.change_365d_reference_date) {
        expect(row.value, view.name).toMatch(/since /);
      }
    }
  });
});
