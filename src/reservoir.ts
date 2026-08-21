/*
 * The one-reservoir page: a static shell, the runtime payload, and nothing
 * generated.
 *
 * The shape was decided before it was built (docs/OPEN-BACKLOG-SCOPING.md,
 * decision 4): one entry at `reservoir.html?name=...` rather than a build-time
 * shell per reservoir. The page fetches like every other surface here
 * (ADR-002), and because it reads the *published payload* rather than a
 * generated file, a reservoir withdrawn for a quiet feed (ADR-056) still has
 * a page -- one that says the reading was withdrawn instead of one that
 * stopped existing.
 *
 * What is live on this page is everything about the named reservoir; what is
 * text is the rules. As on the methods page, a page that states a number
 * about the data fills that number from the data.
 *
 * ADR-006 applies to every word of the template and of the model's rows.
 */
import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";

import { downloadCsv } from "./data/download";
import {
  reservoirCsvFilename, reservoirHistoryCsv
} from "./data/export";
import { loadReservoirs } from "./data/load";
import {
  baselineRows, provenanceRows, resolveReservoirPage
} from "./reservoir-model";
import type { ReservoirPageState } from "./reservoir-model";
import type { ReservoirPayload } from "./types";
import { renderTrendChart, renderTrendTable } from "./viz/trend";
import { formatAcreFeet } from "./viz/format";
import { storageColor } from "./viz/classes";
import { headlinePercent } from "./viz/symbols";
import {
  describeReservoir
} from "./state/detail";
import {
  baselineChoices
} from "./state/baseline";
import { reservoirTemplate } from "./ui/reservoir-template";
import { wireTheme } from "./ui/theme";
import "./styles/reservoir.css";

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#reservoir-app");
if (!root) throw new Error("Missing #reservoir-app root");

root.innerHTML = reservoirTemplate(window.location.search);
wireTheme();

const found = root.querySelector<HTMLElement>("#reservoir-main");
if (!found) throw new Error("Missing #reservoir-main");
/* A narrowed alias: the render helpers below run after this guard, and the
 * checker does not carry a narrowing into another function body. */
const main: HTMLElement = found;

function finish(state: ReservoirPageState["status"]): void {
  main.setAttribute("aria-busy", "false");
  window.__reservoirReady = { status: state };
}

/** A paragraph with the class every other state message on this page wears. */
function note(text: string, className = "reservoir-note"): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

function definitionList(rows: readonly { label: string; value: string }[],
  className: string): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = className;
  for (const row of rows) {
    const term = document.createElement("dt");
    term.textContent = row.label;
    const definition = document.createElement("dd");
    definition.textContent = row.value;
    list.append(term, definition);
  }
  return list;
}

function sectionHeading(text: string): HTMLHeadingElement {
  const heading = document.createElement("h2");
  heading.className = "reservoir-subhead";
  heading.textContent = text;
  return heading;
}

/**
 * The page for a reservoir in this morning's payload.
 *
 * The reading and its comparisons come from the same builders the storage
 * map's details panel uses, so one page cannot drift from the other: the
 * wording is a rule, and the rule lives in one module.
 */
function renderFound(payload: ReservoirPayload,
  state: Extract<ReservoirPageState, { status: "found" }>): void {
  const { reservoir, label } = state;
  document.title = `${label} — Western Water Dashboard`;

  const view = describeReservoir(
    reservoir, storageColor(headlinePercent(reservoir)),
    payload.default_baseline ?? "recent",
    baselineChoices(payload),
    payload.climate_normals?.minimum_years ?? 0);

  const heading = document.createElement("h1");
  heading.className = "reservoir-name";
  heading.textContent = label;

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Reservoir details";

  const headline = document.createElement("p");
  headline.className = "detail-headline";
  headline.style.setProperty("--detail-class-color", view.color);
  const value = document.createElement("strong");
  value.textContent = view.percent;
  const basis = document.createElement("span");
  basis.textContent = view.basis;
  headline.append(value, basis);

  const children: (HTMLElement | SVGElement)[] = [eyebrow, heading];
  if (view.late) children.push(note(view.late, "detail-late"));
  children.push(headline, definitionList(view.rows, "detail-rows"));

  // Both comparisons, each saying how many years stand behind it. A reader
  // who wants only one is on the map page; here they can see what choosing
  // would change.
  const baselines = baselineRows(reservoir).map((row) => ({
    label: row.label,
    value: row.normalAf === null
      ? "No comparison available."
      : `${formatAcreFeet(row.normalAf)} acre-feet, ${row.percentOfNormal ?? 0}% `
        + `of normal now, from ${row.sampleYears} year${row.sampleYears === 1 ? "" : "s"}`
        + `${row.coversFullPeriod ? "" : " (part of the period)"}`
  }));
  if (baselines.length) {
    children.push(sectionHeading("Comparisons"));
    children.push(definitionList(baselines, "detail-rows"));
  }

  // The twelve months, drawn by the same SVG builder the details panel uses.
  const chart = renderTrendChart(view.months, view.name);
  const table = renderTrendTable(view.months);
  if (chart || table) {
    children.push(sectionHeading("The last 12 months"));
    if (chart) children.push(chart);
    if (table) children.push(table);
  }

  // Where the numbers come from, plus the record itself.
  const record = [
    { label: "Record starts", value: reservoir.first_obs },
    {
      label: "Readings held",
      value: `${reservoir.n_obs} readings over ${reservoir.years_of_record} years`
    }
  ];
  children.push(sectionHeading("Source"));
  children.push(definitionList([...provenanceRows(reservoir), ...record],
    "detail-rows"));
  children.push(note(view.note));

  const mapLink = document.createElement("p");
  mapLink.className = "reservoir-links";
  const link = document.createElement("a");
  link.href = `./?reservoir=${encodeURIComponent(label)}`;
  link.textContent = "See this reservoir on the storage map";
  mapLink.append(link);
  children.push(mapLink);

  const exportButton = document.createElement("calcite-button");
  exportButton.className = "detail-export";
  exportButton.setAttribute("appearance", "outline");
  exportButton.setAttribute("icon-start", "export");
  exportButton.textContent = "Download this reservoir (CSV file)";
  exportButton.addEventListener("click", () => void downloadCsv(
    reservoirHistoryCsv(reservoir, label),
    reservoirCsvFilename(label, payload.generated_at.slice(0, 10))));
  children.push(exportButton);

  main.replaceChildren(...children);
  finish("found");
}

/**
 * The page for a reservoir the roster withdrew (ADR-056).
 *
 * The notice carries no measurement, so neither does this page: the name,
 * when the reading was last real, and who published it. That is enough to
 * keep a shared link honest without publishing a figure the pipeline no
 * longer stands behind.
 */
function renderWithdrawn(
  state: Extract<ReservoirPageState, { status: "withdrawn" }>): void {
  document.title = `${state.name} — Western Water Dashboard`;
  const heading = document.createElement("h1");
  heading.className = "reservoir-name";
  heading.textContent = state.name;

  const children: HTMLElement[] = [
    note("Reservoir details", "eyebrow"),
    heading,
    note("This reservoir is not in the current published data. Its feed went "
      + "quiet for longer than the publication window, so the site stopped "
      + `showing it. It was last read ${
        state.lastRead ?? "at an unknown date"}.`, "reservoir-withdrawn")
  ];
  if (state.sourceLabel) {
    children.push(note(`Its readings came from the ${state.sourceLabel}.`,
      "reservoir-note"));
  }
  children.push(note("If readings start again, the reservoir comes back, "
    + "and this link will show it."));
  main.replaceChildren(...children);
  finish("withdrawn");
}

/** No such name, and no withdrawal either. */
function renderUnknown(
  state: Extract<ReservoirPageState, { status: "unknown" }>): void {
  const heading = document.createElement("h1");
  heading.className = "reservoir-name";
  heading.textContent = "No reservoir by that name";
  const requested = note(`The link asked for \u201C${state.requested}\u201D, `
    + "and no published reservoir carries that name or identifier. If two "
    + "reservoirs share a name, the link must carry the state as well -- "
    + "\u201CLost Creek, OR\u201D, the way the storage map writes it.");
  main.replaceChildren(
    note("Reservoir details", "eyebrow"), heading, requested,
    note("Every published reservoir is listed in the storage charts, and "
      + "every name on it links from there.", "reservoir-links"));
  finish("unknown");
}

/** A bare `reservoir.html` link: say what the page is for. */
function renderLanding(): void {
  const heading = document.createElement("h1");
  heading.className = "reservoir-name";
  heading.textContent = "One reservoir at a time";
  main.replaceChildren(
    note("Reservoir details", "eyebrow"),
    heading,
    note("This page shows one reservoir's storage, its comparisons and its "
      + "sources. Add ?name= to the address, with the reservoir's name -- or "
      + "open the storage map and choose one; every reservoir has a page "
      + "like this one."),
    note("A name shared by two reservoirs needs the state too, exactly as "
      + "the storage map writes it: \u201CLost Creek, OR\u201D.",
      "reservoir-links"));
  finish("none");
}

async function run(): Promise<void> {
  try {
    const payload = await loadReservoirs();
    const state = resolveReservoirPage(payload, window.location.search);
    switch (state.status) {
      case "found": return renderFound(payload, state);
      case "withdrawn": return renderWithdrawn(state);
      case "unknown": return renderUnknown(state);
      case "none": return renderLanding();
    }
  } catch (error) {
    console.error("The published data could not be read:", error);
    main.replaceChildren(
      note("Reservoir details", "eyebrow"),
      note("The published data could not be read just now, so this page has "
        + "nothing to show. It is worth reloading later.", "reservoir-error"));
    finish("unknown");
  }
}

void run();
