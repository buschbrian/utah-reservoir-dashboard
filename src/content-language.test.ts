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
  // The shell's own visible text, and the words the details panel puts
  // around a reservoir -- the provider names in the payload are written as
  // acronyms, so this is where one is most likely to reach a reader.
  "src/state/detail.ts",
  // The analysis controls: every label and the sentence that reports what
  // the filter is doing are written here, not in the template.
  "src/state/filters.ts",
  "src/ui/shell.ts",
  "src/ui/shell-template.ts"
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

  it("defines each required technical term", async () => {
    const overview = await readFile(resolve(root, "explore.html"), "utf8");
    for (const term of [
      "Capacity",
      "Acre-foot",
      "Normal",
      "History rank",
      "Update schedule",
      "CSV file"
    ]) {
      expect(overview, `${term} must be in the terms section`).toContain(`<dt>${term}</dt>`);
    }
  });
});

describe("production page runtime references", () => {
  it("builds the MapLibre hover lookup before the pointer handler uses it", async () => {
    const source = await readFile(resolve(root, "maplibre/index.html"), "utf8");
    const declaration = source.indexOf("const byName = new Map(");
    const hoverUse = source.indexOf("hoverCard.show(byName.get(name)");

    expect(declaration).toBeGreaterThanOrEqual(0);
    expect(hoverUse).toBeGreaterThan(declaration);
  });
});
