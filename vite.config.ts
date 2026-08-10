import { copyFile, cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const root = process.cwd();
const outDir = resolve(root, "dist");

function preserveRuntimeAndLegacyFiles(): Plugin {
  return {
    name: "preserve-runtime-data-and-legacy-pages",
    apply: "build",
    async closeBundle() {
      await mkdir(resolve(outDir, "data"), { recursive: true });
      await mkdir(resolve(outDir, "maplibre"), { recursive: true });
      await cp(resolve(root, "shared"), resolve(outDir, "shared"), { recursive: true });

      // huc6.geojson joins the runtime data for the same reason as the other
      // two: it is fetched, never imported. It is also what lets the pages
      // stop querying the USGS service on every load -- a page that draws
      // its own committed boundaries cannot disagree with the assignments in
      // reservoirs.json, and cannot go blank when that service is down.
      for (const file of ["reservoirs.json", "capacities.json", "huc6.geojson"]) {
        await copyFile(resolve(root, file), resolve(outDir, file));
        await copyFile(resolve(root, file), resolve(outDir, "data", file));
      }
      await copyFile(resolve(root, "index.html"), resolve(outDir, "index.html"));
      await copyFile(resolve(root, "maplibre", "index.html"),
        resolve(outDir, "maplibre", "index.html"));
    }
  };
}

export default defineConfig({
  base: "./",
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        modern: resolve(root, "modern.html"),
        explore: resolve(root, "explore.html")
      }
    }
  },
  plugins: [preserveRuntimeAndLegacyFiles()]
});
