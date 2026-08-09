import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const userTextFiles = [
  "index.html",
  "maplibre/index.html",
  "explore.html",
  "modern.html",
  "shared/reservoir-viz.js",
  "src/main.ts"
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
