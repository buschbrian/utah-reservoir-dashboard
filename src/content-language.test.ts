import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const userTextFiles = [
  "index.html",
  "legacy/index.html",
  "maplibre/index.html",
  "explore.html",
  "modern.html",
  "shared/reservoir-viz.js",
  "src/main.ts",
  "src/data/export.ts",
  // The shell's own visible text, and the words the details panel puts
  // around a reservoir -- the provider names in the payload are written as
  // acronyms, so this is where one is most likely to reach a reader.
  "src/state/detail.ts",
  // The analysis controls: every label and the sentence that reports what
  // the filter is doing are written here, not in the template.
  "src/state/filters.ts",
  "src/ui/shell.ts",
  "src/ui/shell-template.ts",
  // The map key and the twelve-month history: both were written against the
  // legacy popup, which is where several of the retired terms were coined.
  "src/ui/legend.ts",
  "src/viz/trend.ts",
  // The page that explains the pipeline, which is where the retired
  // vocabulary is native: the script it describes calls things by their
  // acronyms throughout.
  "src/methods.ts",
  // API field names are exact machine identifiers under ADR-026, but all
  // surrounding explanations on the page still follow ADR-006.
  "src/data-docs.ts",
  "src/ui/page-header.ts",
  // The snowpack view writes all of its own visible text, including the
  // seasonal caveat and the axis words on the curve.
  "snow.html",
  "src/snow.ts",
  "src/snow-model.ts",
  "src/viz/snow-curve.ts",
  "src/viz/snow-classes.ts",
  "src/viz/site-curve.ts",
  "src/ui/snow-map.ts",
  "src/ui/drought-map.ts",
  // Every hover card on every map: the sentences the pointer produces are
  // visible text like any other, and they are all written in one file.
  "src/ui/hover-content.ts",
  "src/ui/map.ts",
  // The state and county names come from Esri's services, but the words
  // around them -- and the layers' own descriptions -- are written here.
  "src/arcgis/reference-layers.ts",
  "src/viz/label-scales.ts",
  "src/ui/view-map.ts",
  "src/ui/theme-basemap.ts",
  // The drought view's visible text, and the class table whose labels are
  // the monitor's own official names.
  "drought.html",
  "src/drought.ts",
  "src/drought-model.ts",
  "src/viz/drought-classes.ts",
  // The filter labels, the sentence that reports what each page is showing,
  // and the axis titles on the storage-against-drought chart.
  "src/viz/drought-scatter.ts",
  "src/state/drought-url.ts"
];

const oldUnexplainedTerms = [
  "Source cadence",
  "Stale feeds only",
  "Period-of-record max",
  "Seasonal percentile",
  "Mean af",
  "Storage af",
  "Capacity af",
  "provisional and subject to revision",
  "monitored reservoirs",
  "Dashboard failed to render",
  "Overview failed to render",
  "Reclamation RISE + NRCS AWDB"
];

describe("user text", () => {
  it("does not restore the old unexplained terms", async () => {
    const sources = await Promise.all(userTextFiles.map(async (file) => ({
      file,
      text: await readFile(resolve(root, file), "utf8")
    })));
    const found = sources.flatMap(({ file, text }) => oldUnexplainedTerms
      .filter((term) => text.includes(term))
      .map((term) => `${file}: ${term}`));

    expect(found).toEqual([]);
  });

  it("keeps the reservoir comparison period and window visible", async () => {
    const methods = await readFile(resolve(root, "src/methods.ts"), "utf8");
    expect(methods).toMatch(/from 2015 through the year before the current\s+reading/);
    expect(methods).toMatch(/within seven days before or after/);
    expect(methods).toContain("dry-period normal");
  });

  it("keeps the current value explanations on the methods page", async () => {
    const methods = await readFile(resolve(root, "src/methods.ts"), "utf8");
    for (const term of ["Percent full", "Normal for this week", "History rank", "Late data"]) {
      expect(methods, `${term} must remain explained`).toContain(`<dt>${term}</dt>`);
    }
  });

  it("keeps the glossary the retired overview used to carry", async () => {
    // explore.html defined these before it became a redirect. The definitions
    // moved here; this test is what notices if they are dropped again.
    const methods = await readFile(resolve(root, "src/methods.ts"), "utf8");
    for (const term of ["Capacity", "Acre-foot", "Update schedule", "CSV file"]) {
      expect(methods, `${term} must remain defined`).toContain(`<dt>${term}</dt>`);
    }
  });
});
