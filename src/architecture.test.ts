import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

async function productionTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      return [path];
    }
    return [];
  }));
  return files.flat();
}

function importsIn(source: string): string[] {
  const imports: string[] = [];
  const importSpecifier = /\b(?:from\s+|import\s*(?:\(\s*)?)(["'])([^"']+)\1/g;
  for (const match of source.matchAll(importSpecifier)) {
    const specifier = match[2];
    if (specifier) imports.push(specifier);
  }
  return imports;
}

describe("SDK architecture boundaries", () => {
  it("uses components instead of deprecated ArcGIS widgets", async () => {
    const files = await productionTypeScriptFiles(resolve(root, "src"));
    const offenders: string[] = [];

    for (const file of files) {
      const imports = importsIn(await readFile(file, "utf8"));
      for (const specifier of imports) {
        if (specifier.startsWith("@arcgis/core/widgets/")) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
    }

    expect(offenders, "widget imports are removed in ArcGIS 6.0").toEqual([]);
  });

  it("imports individual web components rather than package-wide loaders", async () => {
    const files = await productionTypeScriptFiles(resolve(root, "src"));
    const componentPackages = [
      "@arcgis/map-components",
      "@arcgis/common-components",
      "@arcgis/charts-components",
      "@esri/calcite-components"
    ];
    const offenders: string[] = [];

    for (const file of files) {
      const imports = importsIn(await readFile(file, "utf8"));
      for (const specifier of imports) {
        const packageName = componentPackages.find((name) =>
          specifier === name || specifier.startsWith(`${name}/`));
        if (packageName && !specifier.startsWith(`${packageName}/components/`)) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
    }

    expect(offenders, "use one side-effect import per custom element").toEqual([]);
  });

  it("locks a single Calcite installation for the app and ArcGIS peers", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    const calciteInstallations = Object.entries(lock.packages)
      .filter(([path]) => path.endsWith("node_modules/@esri/calcite-components"))
      .map(([path, value]) => ({ path, version: value.version }));

    expect(calciteInstallations).toHaveLength(1);
    expect(calciteInstallations[0]?.path).toBe("node_modules/@esri/calcite-components");
    expect(calciteInstallations[0]?.version).toMatch(/^5\.1\./);
  });

  it("keeps exact optional property checking enabled", async () => {
    const config = JSON.parse(await readFile(resolve(root, "tsconfig.json"), "utf8")) as {
      compilerOptions?: { exactOptionalPropertyTypes?: boolean };
    };
    expect(config.compilerOptions?.exactOptionalPropertyTypes).toBe(true);
  });
});
