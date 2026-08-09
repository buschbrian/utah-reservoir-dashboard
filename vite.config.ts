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

      for (const file of ["reservoirs.json", "capacities.json"]) {
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
