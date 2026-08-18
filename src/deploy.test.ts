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

/* What the build publishes. `huc6.geojson` is deliberately absent: it is the
 * reviewed source the pipeline assigns every reservoir with, and it stays
 * committed, but no page has fetched it since ADR-047 moved the outlines to
 * the hosted layer and ADR-048 stopped publishing it. */
const RUNTIME_DATA = [
  "reservoirs.json", "snow_sites.json", "snowpack.json",
  "reference.json", "capacities.json",
  "utah-boundary.geojson"
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

  it("deploys after the refresh workflow that writes with GITHUB_TOKEN", async () => {
    /* GitHub suppresses push-triggered workflow runs for commits made with
     * GITHUB_TOKEN. The explicit workflow_run handoff is what makes the
     * refresh commit a deploy instead of a main-branch-only update. */
    const workflow = await read(".github/workflows/deploy-pages.yml");
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain('workflows: ["Refresh reservoir data"]');
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it("commits the payload that the deploy publishes", async () => {
    const refresh = await read(".github/workflows/refresh-data.yml");
    expect(refresh).toContain("git add reservoirs.json");
    expect(refresh).toMatch(/git push/);
  });

  /*
   * The drought view refuses to draw when the weekly polygons and the
   * coverage figures name different weeks, which is correct and is also why
   * the refresh must never commit one without the other.
   *
   * It used to. The polygons were downloaded here from the day this job
   * learned about drought; the coverage was only ever recomputed by hand. So
   * the first Thursday the monitor published, this job would have committed
   * new polygons beside week-old coverage -- and because the deploy chains
   * off this workflow completing rather than off CI passing, the broken pair
   * would have gone live and CI would only have turned red afterwards.
   */
  /*
   * The policy is written from measurement -- `tools/audit-transfer.mjs`
   * reports every host the running application contacted -- and the whole
   * browser suite runs against these pages with it in place, including the
   * basemap fallback chain, which is the path most likely to reach a host the
   * happy path never does.
   *
   * A `meta` policy cannot express `frame-ancestors`, `report-uri` or
   * `sandbox`; those are header-only and GitHub Pages serves no custom
   * headers. This asserts the enforceable subset, and that every page carries
   * it -- a page added without one is a page with no policy at all.
   */
  it("gives every published page the same content policy", async () => {
    const pages = ["index.html", "modern.html", "overview.html", "snow.html",
      "drought.html", "methods.html", "data.html", "explore.html",
      "legacy/index.html", "maplibre/index.html"];
    const policies = new Set<string>();

    for (const page of pages) {
      const html = await read(page);
      const match = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
      expect(match, `${page} has no content policy`).not.toBeNull();
      policies.add(match![1]!);
    }

    expect(policies.size, "every page must carry the same policy").toBe(1);
  });

  /*
   * What the policy is actually for, given that `script-src` had to be
   * permissive. The SDK starts workers that import their own code from its
   * CDN and the charts package compiles schemas with `new Function`; both
   * were confirmed by removing them and watching the pages fail. So the
   * directives worth asserting are the ones that still do work: an injected
   * image or fetch cannot reach an attacker's host, no plugin can load, no
   * `base` tag can re-point relative URLs, and no form can post anywhere.
   */
  it("confines every fetch, image and font to this origin and named hosts", async () => {
    const html = await read("index.html");
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'none'");
    for (const directive of ["connect-src", "img-src", "font-src"]) {
      const sources = new RegExp(`${directive} ([^;"]+)`).exec(policy)?.[1] ?? "";
      expect(sources, `${directive} must be an allowlist`).toContain("'self'");
      expect(sources, `${directive} must not be open`).not.toContain("*;");
      expect(sources).not.toMatch(/\shttps:\s|\shttps:$/);
    }
  });

  it("recomputes the drought coverage from the polygons it just downloaded", async () => {
    const refresh = await read(".github/workflows/refresh-data.yml");
    const download = refresh.indexOf("tools/fetch_drought_monitor.py");
    const recompute = refresh.indexOf("tools/compute_drought_coverage.py");

    expect(download).toBeGreaterThanOrEqual(0);
    expect(recompute, "the coverage must be recomputed after the download")
      .toBeGreaterThan(download);
  });

  it("stages both drought files together, or neither", async () => {
    const refresh = await read(".github/workflows/refresh-data.yml");
    /* One `git add`, both files. Staging them in separate commands would let
     * a failure between the two commit one week of polygons beside another
     * week of coverage, which is the exact state the page refuses to draw. */
    const staged = refresh.slice(refresh.indexOf("git add reservoirs.json"));
    const line = staged.slice(0, staged.indexOf("if git diff"));

    expect(line).toContain("data/drought/usdm-current.geojson");
    expect(line).toContain("data/drought/usdm-huc6.json");
  });

  it("checks the pair before the commit and can put both files back", async () => {
    const refresh = await read(".github/workflows/refresh-data.yml");
    const check = refresh.indexOf("tools/check_drought_pair.py");
    const commit = refresh.indexOf("git add reservoirs.json");

    expect(check).toBeGreaterThanOrEqual(0);
    expect(check, "the pair is checked while both files can still be restored")
      .toBeLessThan(commit);
    expect(refresh).toContain(
      "git checkout -- data/drought/usdm-current.geojson data/drought/usdm-huc6.json");
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
      ["src/main.ts", "src/data/load.ts", "src/data/boundaries.ts", "src/data-docs.ts",
        "index.html", "modern.html", "data.html"]
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
    for (const path of ["index.html", "modern.html", "legacy/index.html",
      "overview.html", "snow.html", "drought.html", "methods.html", "explore.html",
      "data/drought/usdm-huc6.json",
      "data.html", "api/reservoirs.json", "api/snowpack.json", "api/reference.json",
      "maplibre/index.html", "retired-route.js",
      "data/reservoirs.json", "data/snow_sites.json",
      "data/snowpack.json", "data/reference.json",
      "data/utah-boundary.geojson"]) {
      expect(workflow, `the deploy must verify dist/${path}`).toContain(path);
    }
    // The rule that makes a data-only deploy meaningful, checked in CI as
    // well as here: the payload must not appear inside the built assets.
    expect(workflow).toContain("dist/assets");
  });

  it("publishes stable API aliases as copies outside the module graph", async () => {
    const config = await read("vite.config.ts");
    expect(config).toContain('resolve(outDir, "api")');
    for (const file of ["reservoirs.json", "snowpack.json", "reference.json"]) {
      expect(config).toContain(`resolve(outDir, "api", file)`);
    }
    expect(config).toContain('data: resolve(root, "data.html")');
  });

  it("links readers to the public data reference", async () => {
    for (const file of ["src/methods.ts", "src/ui/shell-template.ts", "README.md"]) {
      expect(await read(file), `${file} does not link to the public data reference`)
        .toContain("data.html");
    }
  });

  it("publishes ArcGIS 5.1 at the root and redirects the retired pages", async () => {
    const rootEntry = await read("index.html");
    const modernEntry = await read("modern.html");
    const legacyEntry = await read("legacy/index.html");
    const maplibreEntry = await read("maplibre/index.html");
    const exploreEntry = await read("explore.html");
    const config = await read("vite.config.ts");

    expect(rootEntry).toContain('src="/src/main.ts"');
    expect(modernEntry).toContain('src="/src/main.ts"');
    expect(legacyEntry).toContain('data-target="../" data-contract="map"');
    expect(maplibreEntry).toContain('data-target="../" data-contract="map"');
    expect(exploreEntry)
      .toContain('data-target="./overview.html" data-contract="overview"');
    expect(exploreEntry)
      .toContain('<link vite-ignore rel="canonical" href="./overview.html"');
    expect(legacyEntry).not.toContain("https://js.arcgis.com/");
    expect(maplibreEntry).not.toContain("unpkg.com/maplibre");
    expect(exploreEntry).not.toContain("@observablehq/plot");
    // The two map redirects are one page maintained in two places. An edit
    // that reaches only one of them is a drift no per-file check can see.
    expect(maplibreEntry, "legacy/ and maplibre/ redirect pages must stay identical")
      .toEqual(legacyEntry);
    expect(config).toContain('index: resolve(root, "index.html")');
    expect(config).toContain('resolve(root, "legacy", "index.html")');
  });

  /*
   * Two names per page, and they are not the same name.
   *
   * The bar's button text has to stay short because `calcite-navigation`
   * clips rather than scrolls, so it says "Snowpack". A browser tab has no
   * bar around it to supply the context, so it says "Utah Snowpack — Utah
   * Water Dashboard". Both are checked here because the failure mode is one
   * of them being changed and the other forgotten, which nothing else sees.
   */
  it("names every page by its subject, in the tab and in the bar", async () => {
    const header = await read("src/ui/page-header.ts");
    // Short in the bar, where the width is the constraint.
    expect(header).toContain('text: "Storage map", menuText: "Storage map"');
    expect(header).toContain('text: "Storage charts", menuText: "Storage charts"');

    const titles: Record<string, string> = {
      "index.html": "Utah Reservoir Storage",
      "modern.html": "Utah Reservoir Storage",
      "overview.html": "Utah Storage Charts",
      "snow.html": "Utah Snowpack",
      "drought.html": "Utah Drought",
      "methods.html": "Methods and Sources",
      "data.html": "Public Data API"
    };
    for (const [file, subject] of Object.entries(titles)) {
      expect(await read(file), `${file} must name its own subject`)
        .toContain(`<title>${subject} — Utah Water Dashboard</title>`);
      // And the subject the page header writes must be the same one.
      expect(header, `${file}'s subject is missing from the header table`)
        .toContain(`"${subject}"`);
    }
    /* The site is named once, in one place. A second literal spelling of it
     * is how the bar and the tab drift apart. */
    expect(header).toContain('export const SITE_NAME = "Utah Water Dashboard"');
  });

  /* Redirect paths remain public contracts, but complete comparison runtimes
   * are neither promoted nor shipped. The frozen shared module remains in
   * source only because ADR-008 and the parity tests still use it. */
  it("keeps retired paths but no retired runtime in the primary application", async () => {
    const primarySources = await Promise.all([
      "src/ui/page-header.ts", "src/ui/shell-template.ts", "src/overview.ts",
      "src/methods.ts", "src/data-docs.ts"
    ].map(read));
    const primary = primarySources.join("\n");

    for (const href of ["./legacy/", "./maplibre/", "./explore.html"]) {
      expect(primary, `${href} is still promoted from the primary application`)
        .not.toContain(`href="${href}"`);
    }

    const config = await read("vite.config.ts");
    expect(config).toContain('resolve(root, "legacy", "index.html")');
    expect(config).toContain('resolve(root, "maplibre", "index.html")');
    expect(config).toContain('explore: resolve(root, "explore.html")');
    expect(config).not.toContain('resolve(root, "shared")');
    expect(await read("package.json")).not.toContain("@observablehq/plot");
  });
});
