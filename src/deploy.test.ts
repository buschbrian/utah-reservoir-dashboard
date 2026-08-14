/*
 * The operating model, asserted rather than remembered.
 *
 * `reservoirs.json` is rewritten every morning by the refresh workflow and
 * that commit *is* the deploy: the pages fetch the file at runtime, so new
 * numbers go live without a line of application source changing (ADR-002).
 * Every part of that sentence is something a plausible, well-meant change
 * can break -- a `paths:` filter added to the deploy workflow to "save CI
 * minutes", an `import reservoirs from "../reservoirs.json"` that typechecks
 * and bundles cleanly, a build step that stops copying the payload. None of
 * them fail a browser test; all of them freeze the published numbers.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string): Promise<string> => readFile(resolve(root, file), "utf8");

const RUNTIME_DATA = [
  "reservoirs.json", "reference.json", "capacities.json",
  "huc6.geojson", "utah-boundary.geojson"
];

describe("a data-only commit deploys on its own", () => {
  it("lets both browser gates use an installed Chromium executable", async () => {
    for (const file of ["tests/smoke.mjs", "tests/smoke-modern.mjs"]) {
      const smoke = await read(file);
      expect(smoke, `${file} ignores PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`)
        .toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH");
    }
  });

  it("deploys every push to main, with no path filter to skip data commits", async () => {
    const workflow = await read(".github/workflows/deploy-pages.yml");
    const trigger = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));

    expect(trigger).toContain('branches: ["main"]');
    // `paths:` or `paths-ignore:` here would mean a morning whose only change
    // is reservoirs.json publishes nothing.
    expect(trigger).not.toMatch(/^\s*paths(-ignore)?:/m);
  });

  it("commits the payload that the deploy publishes", async () => {
    const refresh = await read(".github/workflows/refresh-data.yml");
    expect(refresh).toContain("git add reservoirs.json");
    expect(refresh).toMatch(/git push/);
  });

  it("copies the runtime data into the published output instead of bundling it", async () => {
    const config = await read("vite.config.ts");
    for (const file of RUNTIME_DATA) {
      expect(config, `${file} must be copied into dist/`).toContain(`"${file}"`);
    }
    expect(config).toContain('resolve(outDir, "data")');
  });

  it("keeps the payload out of every application module", async () => {
    // The application graph, entries included. A test fixture may read the
    // payload from disk; nothing that ships may import it.
    const sources = await Promise.all(
      ["src/main.ts", "src/data/load.ts", "src/data/boundaries.ts", "modern.html"]
        .map(async (file) => ({ file, text: await read(file) })));

    /* An import of the file, not a mention of its name: `load.ts` names
     * `reservoirs.json` in the URL it fetches, which is the whole point. */
    const offenders = sources.flatMap(({ file, text }) => RUNTIME_DATA
      .filter((data) => new RegExp(
        `(from|import\\s*\\(|require\\s*\\()\\s*["'\`][^"'\`]*${data}`).test(text))
      .map((data) => `${file} imports ${data}`));

    expect(offenders, "data is fetched at runtime, never imported (ADR-002)").toEqual([]);
  });

  it("fetches the payload from a published path at runtime", async () => {
    const load = await read("src/data/load.ts");
    const boundaries = await read("src/data/boundaries.ts");
    /* Through the shared helper, which is where the deadline lives: a bare
     * `fetch` here would be a runtime load that can hang forever, and a
     * loading state that never resolves is an error nobody is told about. */
    expect(load).toContain("fetchWithin(");
    expect(load).toContain("./data/reservoirs.json");
    expect(boundaries).toContain("fetchWithin(");
    expect(boundaries).toContain("./data/reference.json");
    // The helper is still a fetch, which is the ADR-002 claim: the payload
    // arrives at runtime and is never part of the module graph.
    expect(await read("src/data/fetch.ts")).toContain("fetch(");
  });

  it("gives every runtime load a deadline", async () => {
    for (const file of ["src/data/load.ts", "src/data/boundaries.ts"]) {
      const source = await read(file);
      expect(source, `${file} calls fetch directly, without a deadline`)
        .not.toMatch(/[^a-zA-Z]fetch\(/);
    }
  });

  it("still checks the published output for every current URL, the shell included", async () => {
    const workflow = await read(".github/workflows/deploy-pages.yml");
    for (const path of ["index.html", "explore.html", "maplibre/index.html", "modern.html",
      "data/reservoirs.json", "data/reference.json", "data/huc6.geojson",
      "data/utah-boundary.geojson"]) {
      expect(workflow, `the deploy must verify dist/${path}`).toContain(path);
    }
    // The rule that makes a data-only deploy meaningful, checked in CI as
    // well as here: the payload must not appear inside the built assets.
    expect(workflow).toContain("dist/assets");
  });
});
