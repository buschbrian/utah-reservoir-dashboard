import { copyFile, cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
// From vitest/config rather than vite: it is the same defineConfig with the
// `test` block added to the type. Vite's own does not know that key exists.
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const root = process.cwd();
const outDir = resolve(root, "dist");

function preserveRuntimeAndLegacyFiles(): Plugin {
  return {
    name: "preserve-runtime-data-and-legacy-pages",
    apply: "build",
    async closeBundle() {
      await mkdir(resolve(outDir, "data"), { recursive: true });
      await mkdir(resolve(outDir, "legacy"), { recursive: true });
      await mkdir(resolve(outDir, "maplibre"), { recursive: true });
      await cp(resolve(root, "shared"), resolve(outDir, "shared"), { recursive: true });

      // Boundary GeoJSON joins the runtime data for the same reason as the
      // other files: it is fetched, never imported. It is also what lets the pages
      // stop querying the USGS service on every load -- a page that draws
      // its own committed boundaries cannot disagree with the assignments in
      // reservoirs.json, and cannot go blank when that service is down.
      // `reference.json` is the capacity table and every boundary in one
      // versioned payload (ADR-018), and it is what the typed stack fetches.
      // The four files it is built from stay published beside it: they are
      // the reviewed sources, and the two legacy map pages still read the
      // Utah outline directly.
      for (const file of [
        "reservoirs.json", "reference.json", "capacities.json",
        "huc6.geojson", "utah-boundary.geojson"
      ]) {
        await copyFile(resolve(root, file), resolve(outDir, file));
        await copyFile(resolve(root, file), resolve(outDir, "data", file));
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
        explore: resolve(root, "explore.html")
      }
    }
  },
  plugins: [preserveRuntimeAndLegacyFiles()]
});
