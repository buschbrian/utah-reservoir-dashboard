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

/* What the build publishes. No boundary polygon file is in it, deliberately:
 * they are the reviewed sources the pipeline assigns and measures with, they
 * stay committed, and no page has fetched one since ADR-047 moved the
 * outlines to the hosted layer and ADR-048 stopped publishing them.
 *
 * `west-huc6.geojson` is the drawn scope's and the largest of them at 3.7 MB
 * (ADR-063); `huc6.geojson` is the roster scope's; `west-huc2.geojson` is the
 * region scope's, registered in S1
 * (OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md) so `reference.json` can publish
 * the five region names -- its own polygons are exactly as unwanted in a
 * deploy as the other two, since the region roster it feeds
 * `build_watershed_sections` carries codes, names and boxes, never rings;
 * `us-land.geojson` is the mask the drought engine reads offline.
 * `utah-boundary.geojson` joined this list under ADR-067: no map draws the
 * translucent mask it used to fill any more, so the state polygon is
 * reviewed by Python's `in_utah` and `intersects_utah` classification and
 * nothing else, the same arrangement `normals.json` has had all along. Each
 * would be 2 copies in every deploy for nobody (ADR-048, ADR-049, ADR-059,
 * ADR-067). */
const COMMITTED_BUT_UNPUBLISHED = [
  "huc6.geojson", "data/watersheds/west-huc6.geojson",
  "data/watersheds/west-huc2.geojson", "data/us-land.geojson",
  "utah-boundary.geojson"
];

/* Reviewed pipeline inputs. The public reference export carries the evidence
 * readers need; copying either roster would publish a second application
 * contract beside it. */
const SOURCE_ONLY_ROSTERS = [
  "admitted_reservoirs.json", "admitted_rise_reservoirs.json"
];

const RUNTIME_DATA = [
  "reservoirs.json", "snow_sites.json", "snowpack.json",
  "reference.json", "capacities.json"
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

  /*
   * The refresh sequence moved out of the workflow and into
   * `scripts/refresh-daily.sh`, so these assertions follow it: what they hold
   * is a property of the job, not of YAML. The workflow still has to call it.
   */
  it("commits the payload that the deploy publishes", async () => {
    const refresh = await read("scripts/refresh-daily.sh");
    const workflow = await read(".github/workflows/refresh-data.yml");

    expect(workflow).toContain("scripts/refresh-daily.sh");
    expect(refresh).toContain("git add");
    expect(refresh).toMatch(/git push/);
    /* The staged set is read from the manifest rather than typed here. It was
     * typed into the workflow, and usdm-huc4.json -- computed every morning --
     * was left out of it for its whole first week. */
    expect(refresh).toContain("generated-files.json");
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
    const refresh = await read("scripts/refresh-daily.sh");
    const download = refresh.indexOf("tools/fetch_drought_monitor.py");
    const recompute = refresh.indexOf("tools/compute_drought_coverage.py");

    expect(download).toBeGreaterThanOrEqual(0);
    expect(recompute, "the coverage must be recomputed after the download")
      .toBeGreaterThan(download);
  });

  it("stages every drought file together, or none of them", async () => {
    /* One `git add`, every file. Staging them in separate commands would let
     * a failure between two of them commit one week of polygons beside
     * another week of coverage, which is the exact state the page refuses to
     * draw. The list is the manifest's, so a level added to the site cannot
     * be left out of the commit. */
    const manifest = JSON.parse(await read("data/generated-files.json")) as {
      files: { path: string; staged_by_refresh: boolean }[];
    };
    const staged = manifest.files
      .filter((entry) => entry.staged_by_refresh).map((entry) => entry.path);

    for (const file of ["data/drought/usdm-current.geojson",
      "data/drought/usdm-huc6.json", "data/drought/usdm-huc4.json"]) {
      expect(staged, `${file} is computed every morning and must be committed`)
        .toContain(file);
    }

    const refresh = await read("scripts/refresh-daily.sh");
    expect(refresh.slice(refresh.indexOf("git add"))).toContain("published_files");
  });

  it("checks the week before the commit and can put every file back", async () => {
    const refresh = await read("scripts/refresh-daily.sh");
    const check = refresh.indexOf("tools/check_drought_pair.py");
    const commit = refresh.indexOf("git add");

    expect(check).toBeGreaterThanOrEqual(0);
    expect(check, "the week is checked while every file can still be restored")
      .toBeLessThan(commit);
    /* One coverage file per offered level (ADR-064), and the restore has to
     * name all of them: a reader who changes the level fetches a different
     * file, so leaving one behind puts them on another week silently. */
    for (const file of ["data/drought/usdm-current.geojson",
      "data/drought/usdm-huc6.json", "data/drought/usdm-huc4.json"]) {
      expect(refresh, `${file} is not restored when the week disagrees`)
        .toContain(file);
    }
  });

  it("recomputes the coverage at every level the site offers", async () => {
    const refresh = await read("scripts/refresh-daily.sh");
    /* Both from the one download. Either failing means both are suspect,
     * which is why they share a revert. */
    expect(refresh).toContain("tools/compute_drought_coverage.py --scope west-huc4");
    /* The archive is one level (ADR-063); `merge_history` refuses otherwise,
     * and this is the caller saying so out loud. */
    expect(refresh).toContain("--scope west-huc4 --no-history");
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
      "data/snowpack.json", "data/reference.json"]) {
      expect(workflow, `the deploy must verify dist/${path}`).toContain(path);
    }
    // The rule that makes a data-only deploy meaningful, checked in CI as
    // well as here: the payload must not appear inside the built assets.
    expect(workflow).toContain("dist/assets");
  });

  it("publishes stable API aliases as copies outside the module graph", async () => {
    const config = await read("vite.config.ts");
    expect(config).toContain('resolve(outDir, "api")');
    expect(config).toContain('resolve(outDir, "api", file)');
    for (const file of ["reservoirs.json", "snowpack.json", "reference.json"]) {
      expect(config, `the API alias list must name ${file}`).toContain(`"${file}"`);
    }
    expect(config).toContain('data: resolve(root, "data.html")');
  });

  it("links readers to the public data reference", async () => {
    /* The methods page's copy lives in its template module; the entry point
     * next to it holds behaviour and links to nothing. */
    for (const file of ["src/ui/methods-template.ts", "src/ui/shell-template.ts",
      "README.md"]) {
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
   * bar around it to supply the context, so it says "Western Snowpack —
   * Western Water Dashboard". Both are checked here because the failure mode
   * is one of them being changed and the other forgotten, which nothing else
   * sees.
   */
  it("names every page by its subject, in the tab and in the bar", async () => {
    const header = await read("src/ui/page-header.ts");
    // Short in the bar, where the width is the constraint.
    expect(header).toContain('text: "Storage map", menuText: "Storage map"');
    expect(header).toContain('text: "Storage charts", menuText: "Storage charts"');

    const titles: Record<string, string> = {
      "index.html": "Western Reservoir Storage",
      "modern.html": "Western Reservoir Storage",
      "overview.html": "Western Storage Charts",
      "snow.html": "Western Snowpack",
      "drought.html": "Western Drought",
      "methods.html": "Methods and Sources",
      "data.html": "Public Data API"
    };
    for (const [file, subject] of Object.entries(titles)) {
      expect(await read(file), `${file} must name its own subject`)
        .toContain(`<title>${subject} — Western Water Dashboard</title>`);
      // And the subject the page header writes must be the same one.
      expect(header, `${file}'s subject is missing from the header table`)
        .toContain(`"${subject}"`);
    }
    /* The site is named once, in one place. A second literal spelling of it
     * is how the bar and the tab drift apart. */
    expect(header).toContain('export const SITE_NAME = "Western Water Dashboard"');
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

  it("keeps the analysis-only geometry out of the deploy", async () => {
    const config = await read("vite.config.ts");
    for (const file of COMMITTED_BUT_UNPUBLISHED) {
      /* The build copies a fixed list. This asserts the list does not grow to
       * include these, which is the plausible well-meant change: a new
       * committed GeoJSON looks like the others and is not. */
      expect(config, `${file} is copied into the deploy`)
        .not.toContain(`"${file}"`);
    }
  });

  it("keeps reviewed admission rosters source-only", async () => {
    const config = await read("vite.config.ts");
    for (const file of SOURCE_ONLY_ROSTERS) {
      expect(config, `${file} is copied into the deploy`).not.toContain(`"${file}"`);
    }
  });
});
