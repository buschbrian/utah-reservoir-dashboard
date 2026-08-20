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

  /*
   * The roster went from 69 reservoirs connected to Utah to 198 across the
   * west, and the methods page went on describing the old rule for weeks: it
   * told readers that areas draining to the Columbia River system were left
   * out while 82 of the published reservoirs sat in them. Prose does not know
   * when the data changes, so the rules stay as prose and every count about
   * the data is read from the payload.
   */
  it("does not restore the retired reservoir inclusion rule", async () => {
    const methods = await readFile(resolve(root, "src/methods.ts"), "utf8");

    // The admission rule that stopped being true.
    expect(methods).not.toMatch(/drainage area must touch Utah/);
    expect(methods).not.toMatch(/Columbia River system are left out/);
    // And the counts that were written as words and went stale as words.
    expect(methods).not.toMatch(/sixty-nine reservoirs/i);
    expect(methods).not.toMatch(/Four reservoirs are measured against a maximum/);
  });

  /*
   * Every count about the published data is a slot the payload fills. A test
   * on the slots rather than on the numbers, because the numbers are the
   * thing that is allowed to change.
   */
  it("reads its counts from the payload rather than stating them", async () => {
    const methods = await readFile(resolve(root, "src/methods.ts"), "utf8");
    for (const slot of ["scope-counts", "basis-mix", "climate-coverage"]) {
      expect(methods, `${slot} must stay a payload-filled slot`)
        .toContain(`data-live="${slot}"`);
    }
    expect(methods).toContain("function fillLiveCounts");
  });

  /*
   * Three claims about what the sources are, each of which a reader needs in
   * order to read the numbers as what they are rather than as what the rest
   * of the page's framing implies.
   */
  it("keeps the source and denominator caveats a reader needs", async () => {
    const methods = await readFile(resolve(root, "src/methods.ts"), "utf8");

    // The outlet area is not the land that fills the reservoir.
    expect(methods).toContain("outlet drainage area");
    expect(methods).toMatch(/not the land that fills the reservoir/i);
    // The drought map is a judgement, and its first class is not drought.
    expect(methods).toMatch(/judgement, not a reading/i);
    expect(methods).toContain("D0 means abnormally dry");
    expect(methods).toMatch(/D1 to D4 are the drought classes/);
    // A combined figure spans dates, and divides by mixed full levels.
    expect(methods).toMatch(/not all taken on the same day/i);
    expect(methods).toMatch(/do not all mean the same thing/i);
    // The snow figure is about the sites, not the land.
    expect(methods).toMatch(/every site counts once/i);
    expect(methods).toMatch(/not a measure of the snow lying across the whole area/i);
    // The colours are display bands rather than operating thresholds.
    expect(methods).toMatch(/display bands, not thresholds/i);
    // And the refresh time is not stated as one fixed mountain clock time.
    expect(methods).not.toMatch(/runs at 5 in the morning/);
    expect(methods).toContain("mountain daylight time");
  });

  /*
   * The snow page draws a choropleth from a station average, which is the one
   * place a reader is most likely to read it as a measure of the whole area.
   */
  it("says the snow map's areas are averages of their sites", async () => {
    const snow = await readFile(resolve(root, "src/snow.ts"), "utf8");
    expect(snow).toMatch(/plain average of the sites reporting/i);
    expect(snow).toMatch(/not a measure of the snow lying across the whole area/i);
    // Snow is a source of inflow, not next summer's storage by itself.
    expect(snow).not.toMatch(/this winter's snow is next summer's storage/);
    expect(snow).toMatch(/Not all of it gets there/);
  });

  /*
   * The Drought Monitor considers water-supply conditions when it is drawn,
   * so a chart of storage against drought class is not a test of one against
   * the other and must not be described as one.
   */
  it("describes drought against storage as contextual", async () => {
    const drought = await readFile(resolve(root, "src/drought.ts"), "utf8");
    expect(drought).toMatch(/related pictures rather than independent measurements/i);
    expect(drought).toMatch(/not a test of one against the other/i);
  });

  /*
   * Three P1 corrections, each of which a later edit could quietly undo
   * because the page reads fine without them.
   */
  it("keeps the statistical caveats the estimators earned", async () => {
    const methods = await readFile(resolve(root, "src/methods.ts"), "utf8");

    // A percent of normal needs a normal worth dividing by.
    expect(methods).toMatch(/266% of normal/);
    expect(methods).toMatch(/below one inch/);
    // How complete the roster is, and that "none found" is not "complete".
    expect(methods).toContain("How complete this is");
    expect(methods).toMatch(/does not mean complete/i);
    expect(methods).toContain('data-live="coverage-note"');
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
