import { access, readFile, readdir } from "node:fs/promises";
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
  it("installs anonymous auth before the shell constructs a map", async () => {
    const source = await readFile(resolve(root, "src/main.ts"), "utf8");
    const policy = source.indexOf("installAnonymousAuthPolicy(");
    const startMap = source.indexOf("loadMap(", policy);

    expect(policy).toBeGreaterThanOrEqual(0);
    expect(startMap).toBeGreaterThan(policy);
  });

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
        // Calcite's package root exports only asset-path configuration in 5.1;
        // it does not register components. The local path keeps component
        // icons available when a content blocker rejects the public CDN.
        const isPackageUtility = specifier === "@esri/calcite-components"
          || specifier === "@arcgis/charts-components"
          || specifier === "@arcgis/charts-components/model/shared/setup-utils";
        const isPackageStylesheet = specifier === `${packageName}/main.css`;
        if (packageName && !specifier.startsWith(`${packageName}/components/`) &&
            !isPackageStylesheet && !isPackageUtility) {
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

  it("ships the small local Calcite asset contract used by the shell", async () => {
    const icons = [
      "arrowRightLeft", "basemap", "brightness", "chevronDown", "chevronsRight", "cursorSelection",
      /* The shell panel's resize handle. It arrived with `resizable` on the
       * table row, and its absence was a 404 and a console error on every
       * width rather than a missing glyph -- which is why this list is a
       * test and not a comment. */
      "dragResizeVertical", "erase",
      /* The compass needle and the locate control's two states. Same trap as
       * the resize handle: switching a component on pulls in an icon that is
       * a 404 and a console error at every width, not a missing glyph. */
      "compassNeedle", "gpsOff", "gpsOn",
      "exclamationMarkTriangle",
      "export", "extentFilter", "fullScreen", "fullScreenExit", "gauge", "hamburger", "home",
      "information", "legend", "magnifyingGlass", "map", "minus", "plus", "question",
      "rotate", "selectionFilter", "slidersHorizontal", "snow",
      "table", "waterDrop", "x", "zoomInFixed", "zoomOutFixed"
    ];
    const messages = [
      "action", "action-bar", "action-group", "button", "notice", "panel", "popover",
      "scrim", "select", "sheet", "shell-panel", "slider"
    ];
    const paths = [
      ...icons.flatMap((icon) => [16, 24, 32].map((size) => {
        const fill = icon === "exclamationMarkTriangle" ? "F" : "";
        return resolve(root, `public/assets/icon/${icon}${size}${fill}.json`);
      })),
      ...messages.map((component) =>
        resolve(root, `public/assets/${component}/t9n/messages.en.json`))
    ];

    await expect(Promise.all(paths.map((path) => access(path)))).resolves.toBeDefined();
  });

  /*
   * The headline is made from the reservoirs the map drew, and from no
   * other set.
   *
   * `inScope` has already applied all three of ADR-011's and ADR-062's scope
   * dimensions. `updateSummary` passed its own literal options in with
   * `geography` pinned to `utah` and `lakeMead` left absent, so
   * `reservoirInScope` ran a second time and narrowed a set that was already
   * narrowed: the card read "Every reservoir" above 59 of the 196 the map had
   * drawn, and the reader's Lake Mead switch could not move it.
   *
   * This used to be held by reading the call's option object out of the
   * source and checking it spread `WIDEST_SCOPE`. The guarantee is in the
   * type system now -- `rollupOfScoped` accepts a branded `ScopedReservoirs`
   * and no scope dimensions at all, so the second narrowing cannot be
   * written. What is left to check is that the surfaces which total an
   * already-scoped set actually use it, rather than reaching back for the
   * options-object form that can.
   */
  it("totals an already-scoped set through the API that cannot re-scope", async () => {
    const files = await productionTypeScriptFiles(resolve(root, "src"));
    const offenders: string[] = [];

    for (const file of files) {
      // The module that owns both names is where they are defined, and where
      // `rollupOfScoped` is built out of them.
      if (file.endsWith("src/data/rollup.ts")) continue;
      const source = await readFile(file, "utf8");
      if (source.includes("statewideRollup(") && source.includes("WIDEST_SCOPE")) {
        offenders.push(file);
      }
    }

    expect(offenders,
      "an already-scoped set is totalled with rollupOfScoped, not statewideRollup + WIDEST_SCOPE"
    ).toEqual([]);
  });

  it("keeps the storage headline on the scope the map already applied", async () => {
    const source = await readFile(resolve(root, "src/main.ts"), "utf8");
    expect(source).toContain("rollupOfScoped(inScope, {");
    for (const dimension of ["geography:", "lakePowell:", "lakeMead:"]) {
      expect(source.slice(source.indexOf("rollupOfScoped(inScope, {"),
        source.indexOf("rollupOfScoped(inScope, {") + 200)).not.toContain(dimension);
    }
  });

  it("keeps exact optional property checking enabled", async () => {
    const config = JSON.parse(await readFile(resolve(root, "tsconfig.json"), "utf8")) as {
      compilerOptions?: { exactOptionalPropertyTypes?: boolean };
    };
    expect(config.compilerOptions?.exactOptionalPropertyTypes).toBe(true);
  });
});
