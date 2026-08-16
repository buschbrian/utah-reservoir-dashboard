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
  // Which period "normal" means, and the sentence that says so. Every
  // comparison the details panel makes is worded here.
  "src/state/baseline.ts",
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
  // The two charts that rank and count the drainage areas. Both write their
  // own descriptions, which a screen reader reads as the chart.
  "src/viz/drought-gap.ts",
  "src/viz/drought-severity.ts",
  // The weekly digest writes sentences about every other surface.
  "src/viz/weekly-summary.ts",
  "src/weekly-model.ts",
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

  /*
   * The comparison period is now the reader's choice, so the disclosure it
   * needs is bigger than it was, not smaller.
   *
   * The page used to disclose one period and warn that it was a dry one. It
   * now offers two and opens on the standard one, which means a reader has to
   * be told three things instead: that both exist, that the choice moves the
   * answer, and by how much. The worked example is the load-bearing part --
   * "the years matter" is a claim, "44.6% against one period and 35.0%
   * against the other" is the evidence for it -- and it is exactly the kind
   * of paragraph a later edit trims for length.
   */
  it("keeps the reservoir comparison periods and window visible", async () => {
    const methods = await readFile(resolve(root, "src/methods.ts"), "utf8");
    expect(methods).toMatch(/within seven days before or after/);
    // Both periods, named.
    expect(methods).toContain("1991 through 2020");
    expect(methods).toContain("2015 through last year");
    // That the recent period is a dry one, which is why it is not the default.
    expect(methods).toContain("unusually dry");
    // The worked example that shows how much the choice is worth.
    expect(methods).toContain("44.6% of normal");
    expect(methods).toContain("35.0%");
    // And that the history rank does not follow the control.
    expect(methods).toMatch(/history rank .{0,60}always uses the years this site/s);
  });

  /*
   * Three caveats added after a methods review, each of which a reader needs
   * in order to read the numbers correctly, and each of which is the kind of
   * thing a later edit quietly drops because the page is long.
   */
  /* The site names a dozen federal and state agencies and reads their public
   * services. A reader who lands on it must not be able to mistake it for one
   * of their products, and a credit list must not read as an endorsement.
   *
   * Asserted as plain substrings rather than a pattern spanning the source's
   * own line wrapping: a test that breaks when a paragraph is re-flowed is a
   * test somebody deletes. */
  it("keeps the statement that this is not an official product", async () => {
    const methods = await readFile(resolve(root, "src/methods.ts"), "utf8");

    expect(methods).toContain("This is not an official product");
    expect(methods).toContain("sponsored or checked by any government agency");
    expect(methods).toContain("Where this site and an agency disagree, the agency is right");
    // Naming a provider credits it; it must not read as an endorsement.
    expect(methods).toContain("It does not mean the");
    // And how the project is built is stated rather than left to be found.
    expect(methods).toContain("by AI agents working from stated requirements");
  });

  it("keeps the caveats that make the numbers readable", async () => {
    const methods = await readFile(resolve(root, "src/methods.ts"), "utf8");

    // These reservoirs are operated: storage is releases as well as weather.
    expect(methods).toContain("operated");
    expect(methods).toMatch(/releases as well as weather|what was let out/);
    // Snow and storage are compared against different periods.
    expect(methods).toContain("1991 through 2020");
    expect(methods).toMatch(/different periods/);
    // "Full" is measured against more than one kind of full level.
    expect(methods).toContain("normal full level");
    expect(methods).toContain("maximum level");
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
