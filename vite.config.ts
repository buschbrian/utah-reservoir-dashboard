import { copyFile, cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
// From vitest/config rather than vite: it is the same defineConfig with the
// `test` block added to the type. Vite's own does not know that key exists.
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const root = process.cwd();
const outDir = resolve(root, "dist");

function preserveRuntimeDataAndRedirects(): Plugin {
  return {
    name: "preserve-runtime-data-and-retired-route-redirects",
    apply: "build",
    async closeBundle() {
      await mkdir(resolve(outDir, "data"), { recursive: true });
      await mkdir(resolve(outDir, "api"), { recursive: true });
      await mkdir(resolve(outDir, "legacy"), { recursive: true });
      await mkdir(resolve(outDir, "maplibre"), { recursive: true });
      await cp(resolve(root, "data", "drought"), resolve(outDir, "data", "drought"),
        { recursive: true });

      // Boundary GeoJSON joins the runtime data for the same reason as the
      // other files: it is fetched, never imported. It is also what lets the pages
      // stop querying the USGS service on every load -- a page that draws
      // its own committed boundaries cannot disagree with the assignments in
      // reservoirs.json, and cannot go blank when that service is down.
      // `reference.json` is the capacity table and the geography in one
      // versioned payload (ADR-018), and it is what the typed stack fetches.
      //
      // No boundary polygon file is here and that is deliberate (ADR-048).
      // `data/watersheds/west-huc6.geojson` is the drawn scope the pipeline
      // assigns and measures against and `huc6.geojson` the roster scope the
      // map opens on (ADR-063); both stay committed -- but no page has
      // fetched a polygon file since the outlines became the hosted layer's,
      // and publishing one put megabytes in every deploy, twice, for nobody. It is reviewable in the repository
      // like `normals.json`, which is the same arrangement for the same
      // reason. `utah-boundary.geojson` stays: the mask is still drawn from
      // the reviewed polygon, republished inside `reference.json`.
      for (const file of [
        "reservoirs.json", "snow_sites.json", "snowpack.json",
        "reference.json", "capacities.json",
        "utah-boundary.geojson"
      ]) {
        await copyFile(resolve(root, file), resolve(outDir, file));
        await copyFile(resolve(root, file), resolve(outDir, "data", file));
      }
      // Stable public API aliases. These are second copies of the same
      // runtime files, never imports and never a second source of truth.
      for (const file of ["reservoirs.json", "snowpack.json", "reference.json"]) {
        await copyFile(resolve(root, file), resolve(outDir, "api", file));
      }
      await copyFile(resolve(root, "legacy", "index.html"),
        resolve(outDir, "legacy", "index.html"));
      await copyFile(resolve(root, "maplibre", "index.html"),
        resolve(outDir, "maplibre", "index.html"));
    }
  };
}

export default defineConfig({
  base: "./",
  // Agent worktrees are checkouts of this repository inside this repository,
  // so an unqualified test glob collects every copy of every test file and
  // reports five times the real count -- passing, and meaningless.
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"]
  },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        modern: resolve(root, "modern.html"),
        overview: resolve(root, "overview.html"),
        snow: resolve(root, "snow.html"),
        drought: resolve(root, "drought.html"),
        methods: resolve(root, "methods.html"),
        data: resolve(root, "data.html"),
        explore: resolve(root, "explore.html"),
        terms: resolve(root, "terms.html")
      }
    }
  },
  plugins: [preserveRuntimeDataAndRedirects()]
});
