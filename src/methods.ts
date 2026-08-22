/*
 * Where the numbers come from, how they are collected, and how each one is
 * worked out.
 *
 * The facts here already existed in the repository -- in the refresh script,
 * in the README and in the decision records -- and nowhere a reader of the
 * published site could see them. The two legacy maps credit their providers
 * in the panel beside the map; the typed stack credited them only inside a
 * details panel that has to be opened one reservoir at a time.
 *
 * The words are in `ui/methods-template.ts` and the behaviour is here, the
 * same split `ui/shell-template.ts` already makes for the storage map. What
 * is left in this file is the one live fact on the page: the publication date
 * and the provider counts, read from the payload rather than written down,
 * for the same reason the map reads it -- a page that states a number about
 * the data is a page that can be wrong about it. Everything else on the page
 * is a rule, not a reading, so it is text.
 *
 * ADR-006 applies to every word of both files.
 */
import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";

import { loadReservoirs } from "./data/load";
import { sizeBasis } from "./data/rollup";
import { stateName } from "./data/state-vocabulary";
import type { Reservoir, ReservoirPayload } from "./types";
import { methodsMarkup } from "./ui/methods-template";
import { wireTheme } from "./ui/theme";
import { formatAcreFeet, formatDate, formatPercent } from "./viz/format";
import "./styles/methods.css";

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#methods-app");
if (!root) throw new Error("Missing #methods-app root");

root.innerHTML = methodsMarkup(window.location.search);
wireTheme();

/**
 * The one live fact on the page: when the data was published, and how many
 * reservoirs came from each provider.
 *
 * Every path clears `aria-busy`, the failure included. A page that keeps
 * announcing itself busy after the fetch has failed is telling a screen
 * reader to wait for something that is never coming.
 */
function providerCounts(
  reservoirs: readonly Reservoir[]
): { rise: number; awdb: number; cdec: number; cdss: number; usgs: number } {
  return {
    rise: reservoirs.filter((reservoir) => reservoir.source_key === "rise").length,
    awdb: reservoirs.filter((reservoir) => reservoir.source_key === "awdb").length,
    cdec: reservoirs.filter((reservoir) => reservoir.source_key === "cdec").length,
    cdss: reservoirs.filter((reservoir) => reservoir.source_key === "cdss").length,
    usgs: reservoirs.filter((reservoir) => reservoir.source_key === "usgs").length
  };
}

/**
 * The counts this page used to state in prose, read from the payload instead.
 *
 * Every one of them was written as a word -- "four reservoirs", "sixty-three of
 * the sixty-nine" -- and every one of them was wrong by the time it was read.
 * The roster went from 69 reservoirs to 198 without a single sentence here
 * changing, and the page went on telling readers that four reservoirs carried
 * seven tenths of the combined full level when fifteen carried a quarter of it.
 *
 * A count about the data belongs in a slot the data fills. The rules around
 * them stay as text, because a rule cannot drift.
 */
function fillLiveCounts(
  reservoirs: readonly Reservoir[], minimumBaselineYears: number
): void {
  const total = reservoirs.length;
  const fullLevel = reservoirs.reduce((sum, reservoir) => sum + sizeBasis(reservoir), 0);
  const shareOf = (rows: readonly Reservoir[]): string => formatPercent(
    fullLevel > 0 ? rows.reduce((sum, row) => sum + sizeBasis(row), 0) / fullLevel * 100 : null);

  const states = new Set(reservoirs.flatMap((reservoir) =>
    reservoir.waterbody_states ?? [reservoir.state]).filter(Boolean));
  const areas = new Set(reservoirs.map((reservoir) => reservoir.huc6).filter(Boolean));
  const maximum = reservoirs.filter((reservoir) => reservoir.capacity_basis === "max_storage");
  const withClimate = reservoirs.filter((reservoir) => {
    const climate = reservoir.baselines?.climate;
    return climate && climate.sample_years >= minimumBaselineYears;
  });

  const text: Record<string, string> = {
    "scope-counts":
      `Today that is ${total} reservoirs, in ${areas.size} drainage areas and `
      + `reaching ${states.size} states. Their full levels add up to `
      + `${formatAcreFeet(fullLevel)} acre-feet. Other drawn areas hold no `
      + "reservoir this site tracks.",
    "basis-mix":
      `Today ${maximum.length} of the ${total} reservoirs are measured against a maximum `
      + `level. They are ${shareOf(maximum)} of the combined full level every regional `
      + "percentage divides by.",
    "climate-coverage":
      `Today the standard period is available for ${withClimate.length} of the ${total} `
      + `reservoirs, holding ${shareOf(withClimate)} of the combined full level.`
  };
  for (const [name, value] of Object.entries(text)) {
    const element = document.querySelector<HTMLElement>(`[data-live="${name}"]`);
    if (element) element.textContent = value;
  }
}

/** The words for what a state's coverage was reviewed to be. */
const COVERAGE_STATUS: Record<string, string> = {
  "more to add": "More to add",
  "not machine readable": "Published, but not in a form a program can read",
  "none found": "None found",
  "not reviewed": "Not reviewed"
};

/**
 * What this roster holds for each state, beside what it is known to miss.
 *
 * The counts are the payload's own; the gaps are a reviewed judgement it
 * cannot contain. A dashboard that shows the first without the second is not
 * wrong in any single number and is misleading as a whole: California's row
 * reads eight reservoirs, and the state's own service publishes 154.
 *
 * The section is left empty rather than half-filled when a payload predates
 * the coverage block, because a table of counts with the gaps column missing
 * is exactly the impression this exists to prevent.
 */
function fillCoverage(payload: ReservoirPayload): void {
  const section = document.querySelector<HTMLElement>("#coverage");
  const body = document.querySelector<HTMLElement>("#coverage-table tbody");
  const states = payload.coverage?.states;
  if (!section || !body || !states || Object.keys(states).length === 0) {
    if (section) section.hidden = true;
    return;
  }
  const rows = Object.entries(states)
    .sort((a, b) => b[1].tracked_reference_capacity_af - a[1].tracked_reference_capacity_af);
  body.replaceChildren(...rows.map(([code, entry]) => {
    const missing = entry.known_additional_source
      ? `${COVERAGE_STATUS[entry.status] ?? entry.status}: `
        + `${entry.known_additional_source}`
        + (entry.known_additional_about
          ? `, about ${entry.known_additional_about} reservoirs` : "")
      : COVERAGE_STATUS[entry.status] ?? entry.status;
    const row = document.createElement("tr");
    for (const [text, isNumber] of [
      [stateName(code), false],
      [String(entry.tracked_reservoir_count), true],
      [`${formatAcreFeet(entry.tracked_reference_capacity_af)} acre-feet`, true],
      [`${entry.climate_baseline_count} of ${entry.tracked_reservoir_count}`, true],
      [missing, false]
    ] as [string, boolean][]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      if (isNumber) cell.className = "methods-num";
      row.append(cell);
    }
    return row;
  }));
  const note = payload.coverage?.reviewed;
  const element = document.querySelector<HTMLElement>('[data-live="coverage-note"]');
  if (element && note) {
    element.textContent = `The sources were last reviewed on ${formatDate(note)}. `
      + "A reservoir whose water reaches two states is counted in both, so these "
      + "rows do not add up to the roster.";
  }
}

async function showPublishedData(): Promise<void> {
  const status = document.querySelector<HTMLElement>("#methods-status");
  if (!status) return;
  try {
    const data = await loadReservoirs();
    const counts = providerCounts(data.reservoirs);
    fillLiveCounts(data.reservoirs, data.climate_normals?.minimum_years ?? 0);
    fillCoverage(data);
    status.textContent =
      `The data on this site was published on ${formatDate(data.generated_at.slice(0, 10))}. ` +
      `It covers ${data.reservoirs.length} reservoirs. ` +
      `The Bureau of Reclamation measures ${counts.rise}. ` +
      `The Natural Resources Conservation Service measures ${counts.awdb}. ` +
      `The California Department of Water Resources measures ${counts.cdec}.` +
      (counts.cdss > 0
        ? ` The Colorado Division of Water Resources measures ${counts.cdss}.`
        : "") +
      (counts.usgs > 0
        ? ` The U.S. Geological Survey measures ${counts.usgs}.`
        : "");
  } catch (error) {
    console.warn("The published data could not be read for the methods page:", error);
    /* The page is still worth reading without it -- everything else here is
     * a rule rather than a reading -- so this says what is missing and does
     * not pretend the whole page failed. */
    status.textContent = "The published data could not be read just now, "
      + "so the publication date is not shown. The methods below are unaffected.";
  } finally {
    status.setAttribute("aria-busy", "false");
    window.__methodsReady = { published: status.textContent !== "" };
  }
}

void showPublishedData();
