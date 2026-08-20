/*
 * The weekly digest in words.
 *
 * Kept apart from `weekly-model.ts` for the same reason the hover cards are:
 * the model does arithmetic, this writes sentences, and sentences are visible
 * text that the Simplified Technical English test has to be able to read
 * (ADR-006). It is also the only half a unit test can hold to account for
 * saying the right thing, as opposed to computing the right number.
 *
 * Two rules run through all of it.
 *
 * **Every number carries its measure.** "Fell 69,480 acre-feet" and "rose
 * 111.9%" can describe the same week, and the second is a small reservoir
 * doubling while the first is the region emptying. A sentence that says
 * "biggest move" without saying by what is the easiest lie this page could
 * tell, so no sentence here does.
 *
 * **A section with nothing to say says why.** Out of season the snow has no
 * comparison to make, because percent of normal divides by a normal that is
 * zero. Drought publishes weekly but only one week is committed. Both are
 * stated as the reason rather than left as a gap, because a reader who finds
 * a missing section assumes a fault.
 */
import type {
  WeeklyDrought, WeeklyMove, WeeklySnow, WeeklyStorage, WeeklySummary
} from "../weekly-model";
import { formatAcreFeet, formatDate, formatPercent } from "./format";

/** A signed volume, with the direction in the words rather than in a glyph. */
function volume(changeAf: number): string {
  return `${formatAcreFeet(Math.abs(changeAf))} acre-feet`;
}

/**
 * A change in percentage points, said as points.
 *
 * A combined figure that moves from 32.2% full to 31.8% has changed by half a
 * *point*, not by half a percent -- half a percent of 32.2 would be 0.16. The
 * two are different quantities and the site colours by the first, so the
 * digest names the unit rather than reusing the per-cent sign for both.
 */
function signedPoints(points: number | null): string {
  if (points === null) return "—";
  const rounded = Math.abs(points) < 0.05 ? 0 : points;
  const magnitude = Math.abs(rounded).toFixed(1);
  if (rounded === 0) return "no change";
  return `${rounded > 0 ? "up" : "down"} ${magnitude} ` +
    `${magnitude === "1.0" ? "point" : "points"}`;
}

/** One reservoir's week, with both measures so neither can mislead. */
export function describeMove(move: WeeklyMove): string {
  const direction = move.changeAf > 0 ? "rose" : "fell";
  const points = move.changePoints === null
    ? ""
    : `, which is ${formatPercent(Math.abs(move.changePoints))} of its own full level`;
  return `${move.name} ${direction} ${volume(move.changeAf)}${points}`;
}

/** The headline: which way the region went, and by how much. */
export function describeStorage(storage: WeeklyStorage): string[] {
  if (storage.measured === 0) {
    return ["No reservoir published a weekly change, so there is nothing to compare."];
  }
  const lines: string[] = [];
  const direction = storage.netAf > 0 ? "gained" : storage.netAf < 0 ? "lost" : "held";
  const net = storage.netAf === 0
    ? "The measured reservoirs held their water this week."
    : `The measured reservoirs ${direction} ${volume(storage.netAf)} between them.`;
  lines.push(net);

  if (storage.percentNow !== null && storage.percentBefore !== null) {
    const points = storage.percentNow - storage.percentBefore;
    lines.push(
      `Together they moved from ${formatPercent(storage.percentBefore)} full to ` +
      `${formatPercent(storage.percentNow)}, ${signedPoints(points)}.`);
  }

  lines.push(
    `${storage.fell} fell, ${storage.rose} rose and ${storage.steady} did not move.`);

  /* The coverage caveat is not a footnote. Twenty-nine of the sixty-nine
   * reservoirs report month-end only, so no sentence above describes them. */
  if (storage.measured < storage.published) {
    lines.push(
      `This covers the ${storage.measured} reservoirs that report every day. ` +
      `The other ${storage.published - storage.measured} report once a month and ` +
      "cannot show a weekly change.");
  }
  return lines;
}

/** The movers, each with the measure that makes it the mover. */
export function describeMovers(storage: WeeklyStorage): string[] {
  const lines: string[] = [];
  if (storage.biggestFall) {
    lines.push(`Largest fall by volume: ${describeMove(storage.biggestFall)}.`);
  }
  if (storage.biggestRise) {
    lines.push(`Largest rise by volume: ${describeMove(storage.biggestRise)}.`);
  }
  /* Only worth a line when it is a different reservoir. When the same one
   * leads both, saying it twice reads as two findings. */
  const share = storage.largestShareMove;
  if (share && share.name !== storage.biggestFall?.name
    && share.name !== storage.biggestRise?.name) {
    /* Two sentences, not one clause chained onto another: the single form ran
     * to 28 words, and the two figures answer different questions -- how much
     * of the reservoir moved, and how much of last week's water that was. */
    lines.push(
      `Largest move for its own size: ${describeMove(share)}.` +
      (share.changePercent === null
        ? ""
        : ` That is ${formatPercent(Math.abs(share.changePercent))} of what it ` +
          "held a week earlier."));
  }
  return lines;
}

export function describeSnow(snow: WeeklySnow): string[] {
  if (snow.day === null) {
    return ["No snow measurements are published for this week."];
  }
  if (!snow.comparable) {
    /* The honest reason, not a blank. Percent of normal has no value once the
     * normal for the day is zero, which is every site by late summer. */
    return [
      "There is no snow comparison for this week. Percent of normal measures " +
      "against the middle value for the same day in 1991 through 2020. By late " +
      "summer that value is zero at these sites, so there is nothing to divide by.",
      "The snowpack view carries the whole season, including its high point."
    ];
  }
  const change = (snow.percentNow as number) - (snow.percentBefore as number);
  const direction = change > 0 ? "gained" : change < 0 ? "lost" : "held";
  return [
    `Snow ${direction} ground against normal: ${formatPercent(snow.percentBefore)} of ` +
    `normal on ${formatDate(snow.previousDay as string)}, ` +
    `${formatPercent(snow.percentNow)} on ${formatDate(snow.day)}.`,
    `Measured across ${snow.reporting} sites with a fair value that day.`
  ];
}

/**
 * "196 reservoirs", or nothing at all when there is nothing to count.
 *
 * Zero is the case worth handling. In August every snow site has melted out,
 * so no site has a value to compare against normal and the count is a true
 * zero -- and "Mountain snow — 0 reporting sites" reads as a network failure
 * rather than as summer. The section's own lines already explain melt-out;
 * the heading falls back to the plain name rather than asserting a number
 * that means something else to a reader than it does to the code.
 */
function countOf(value: number | null | undefined, noun: string): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

/** "Mountain snow — 83 reporting sites", or "Mountain snow". */
function headingWith(name: string, count: string | null): string {
  return count ? `${name} — ${count}` : name;
}

export function describeDrought(drought: WeeklyDrought | null): string[] {
  if (!drought) {
    return ["The drought figures could not be read for this week."];
  }
  const lines = [
    `The drought map for the week of ${formatDate(drought.mapDate)} was published on ` +
    `${formatDate(drought.releaseDate)}.`
  ];
  lines.push(drought.worst
    ? `The most severe class with land in it is ${drought.worst.label.toLowerCase()} ` +
      `(${drought.worst.code}). ${drought.areasAtOrWorse} of ${drought.units} drainage ` +
      "areas have land in severe drought or worse."
    : "No drainage area has land in a drought class this week.");
  if (!drought.comparable) {
    /* A fact about this project's data, not about the monitor, and the
     * sentence has to say which. */
    lines.push(
      "This is the first drought map this site keeps, so there is no change " +
      "from last week to report yet. There will be one next week.");
    return lines;
  }

  const since = drought.previousDate ? ` since ${formatDate(drought.previousDate)}` : "";
  if (drought.areasWorse === 0 && drought.areasBetter === 0) {
    lines.push(`No drainage area changed the share of its land in severe drought ` +
      `or worse${since}.`);
  } else {
    /* Counted, not averaged. A share of land averaged across areas of very
     * different sizes is not a quantity anybody can act on. */
    const parts: string[] = [];
    if (drought.areasWorse > 0) {
      parts.push(`${drought.areasWorse} ${drought.areasWorse === 1 ? "area" : "areas"} ` +
        "gained land in severe drought or worse");
    }
    if (drought.areasBetter > 0) {
      parts.push(`${drought.areasBetter} ${drought.areasBetter === 1 ? "area" : "areas"} ` +
        "lost some");
    }
    lines.push(`${parts.join(", and ")}${since}.`);
  }
  if (drought.biggestMove) {
    const move = drought.biggestMove;
    lines.push(`The largest change is ${move.name}, ` +
      `${signedPoints(move.points).replace("no change", "unchanged")} of its land ` +
      "at that class.");
  }
  return lines;
}

export interface WeeklySection {
  heading: string;
  lines: string[];
}

/** The whole digest, in the order a reader wants it: what happened, who
 * moved, then the two contexts. */
export function describeWeek(summary: WeeklySummary): WeeklySection[] {
  return [
    /* Each heading names the population its section is about.
     *
     * The three sections do not share a geography and cannot: storage follows
     * the reservoir scope the reader chose, snow is every site that reported,
     * and drought is every area the monitor measures. Each said so in its own
     * lines, and a reader skimming four headings on one page still absorbs
     * them as one statement about one place. The heading is where that
     * impression forms, so it is where the population belongs.
     */
    { heading: headingWith("Reservoir storage",
        countOf(summary.storage?.published, "reservoir")),
      lines: describeStorage(summary.storage) },
    { heading: "The week's movers, same reservoirs",
      lines: describeMovers(summary.storage) },
    { heading: headingWith("Mountain snow",
        countOf(summary.snow?.reporting, "reporting site")),
      lines: describeSnow(summary.snow) },
    { heading: headingWith("Drought",
        countOf(summary.drought?.units, "drainage area")),
      lines: describeDrought(summary.drought) }
  ].filter((section) => section.lines.length > 0);
}
