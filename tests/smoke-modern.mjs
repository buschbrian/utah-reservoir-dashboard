/*
 * Browser smoke test for the production ArcGIS 5.1 application at the root.
 *
 * Separate from tests/smoke.mjs on purpose. That file protects compatibility
 * redirects; this one protects the complete primary application.
 *
 * What only a real browser can answer here:
 *
 *   - Every reservoir in the connected scope actually drew. A shell that
 *     loads, paints a basemap and renders no points looks correct in a
 *     screenshot; the readiness signal counts them.
 *   - The page never asks for ArcGIS credentials. The SDK's sign-in prompt
 *     is a custom element that mounts itself into a shadow root, so an
 *     `innerText` check over the light DOM cannot see it. This walks open
 *     shadow roots, and it runs with the first basemap answering 401 --
 *     the exact condition that produces a prompt when the anonymous-auth
 *     policy is missing.
 *   - Nothing scrolls sideways and the interactive map controls stay in a
 *     clear touch lane at 1280, 390 and 360 pixels.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createContext, runInContext } from "node:vm";

/*
 * Playwright is deliberately not in `package.json` (see issue #18): CI
 * installs it with `--no-save --no-package-lock` so the lockfile stays
 * exactly what `npm ci` produced. The consequence is that any ordinary
 * `npm install` prunes it as extraneous and this file stops resolving --
 * with a module-resolution stack trace that looks nothing like the action
 * that caused it. Adding `axe-core` once deleted the test runner.
 *
 * So the failure is caught here and answered with the command that fixes it.
 */
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error([
    "",
    "Playwright is not installed. It is deliberately not a dependency, so an",
    "ordinary `npm install` removes it. Put it back with:",
    "",
    "  npm install --no-save --no-package-lock playwright",
    ""
  ].join("\n"));
  process.exit(1);
}


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(REPO_ROOT, "dist");
const PORT = 8138;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript",
  ".json": "application/json", ".css": "text/css"
};

const server = createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  /* axe, served from this origin rather than injected as inline script.
   * The pages carry a content policy without `unsafe-inline`, and
   * `addScriptTag({ content })` is inline script -- correctly refused. A
   * same-origin file satisfies `script-src 'self'`, which is also a small
   * proof that the policy is doing its job. */
  if (rel === "/__axe.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(AXE_SOURCE);
    return;
  }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "text/plain" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const payload = JSON.parse(await readFile(path.join(REPO_ROOT, "reservoirs.json"), "utf8"));
/* The scope the shell draws, computed the way src/main.ts computes it: the
 * waterbodies that touch Utah, without Lake Powell (ADR-011). Derived from
 * the payload rather than written down, so the morning refresh cannot turn
 * this red on its own. */
const inScope = payload.reservoirs.filter((reservoir) =>
  reservoir.intersects_utah === true &&
  reservoir.rise_item_id !== 509 &&
  reservoir.name.trim().toLowerCase() !== "lake powell");
const expectedReservoirs = inScope.length;
/* The reservoirs the ranking chart can rank: those with a readable headline
 * percentage, computed the way src/viz/symbols.ts computes it. Derived from
 * the payload rather than written down, like the scope above. */
const expectedRanked = inScope.filter((reservoir) =>
  Number.isFinite(reservoir.pct_of_capacity ?? reservoir.pct_of_record_max)).length;
const legacyContext = createContext({ window: {} });
runInContext(await readFile(path.join(REPO_ROOT, "shared/reservoir-viz.js"), "utf8"),
  legacyContext);
const storageClasses = legacyContext.window.ReservoirViz.CLASSES;
const classOf = (reservoir) => {
  const percent = reservoir.pct_of_capacity ?? reservoir.pct_of_record_max;
  if (!Number.isFinite(percent)) return null;
  let index = 0;
  storageClasses.forEach((entry, candidate) => {
    if (percent >= entry.min) index = candidate;
  });
  return index;
};
/* One area-and-class intersection that is non-empty but not the full scope.
 * The class breaks come from the legacy source of truth, not a copied list
 * in this test. */
const sharedFilter = [...new Set(inScope.map((reservoir) => reservoir.huc6))]
  .filter((code) => typeof code === "string")
  .flatMap((drainage) => storageClasses.map((_, storageClass) => ({
    drainage,
    storageClass,
    count: inScope.filter((reservoir) =>
      reservoir.huc6 === drainage && classOf(reservoir) === storageClass).length
  })))
  .find((candidate) => candidate.count > 0 && candidate.count < inScope.length);
/* The drawn scope's areas, found through the reference export rather than by
 * file name: which file holds the drawn geography moved once already
 * (ADR-063), and a count read from the roster scope's file would have gone on
 * passing while the maps drew five times as many. */
const referenceWatersheds = JSON.parse(
  await readFile(path.join(REPO_ROOT, "reference.json"), "utf8"))
  .geography.watersheds;
const drawnScope = referenceWatersheds.scopes[referenceWatersheds.default_scope];
if (!drawnScope) {
  throw new Error(
    `reference.json names ${referenceWatersheds.default_scope} and does not publish it`);
}
const expectedAreas = JSON.parse(
  await readFile(path.join(REPO_ROOT, drawnScope.source_file), "utf8")).features.length;
/* The drainage areas the drought view can put a storage figure beside: the
 * ones holding a published reservoir, which is 14 of the 75 drawn. Derived
 * from the two committed payloads the way src/drought-model.ts derives it --
 * `storageByArea` groups every published reservoir by its code and does not
 * filter by scope -- so the morning refresh cannot turn this red, and a
 * roster that expands west moves it on its own. */
const droughtAreas = new Set(JSON.parse(
  await readFile(path.join(REPO_ROOT, "data/drought/usdm-huc6.json"), "utf8"))
  .units.map((unit) => unit.huc6));
const expectedStorageJoined = new Set(payload.reservoirs
  .map((reservoir) => reservoir.huc6)
  .filter((huc6) => typeof huc6 === "string" && droughtAreas.has(huc6))).size;

/* The geographic filters, derived the way src/overview-model.ts derives
 * them: a state means the water (ADR-060, waterbody_states falling back to
 * the point's state), a subregion is the first four digits of the drainage
 * code, and a county is its FIPS code. The state, subregion and county to
 * exercise are chosen from the payload -- each one narrowing the default
 * scope without emptying it -- so the morning refresh cannot turn this red
 * on its own. */
const statesOf = (reservoir) => (reservoir.waterbody_states?.length
  ? reservoir.waterbody_states
  : (reservoir.state ? [reservoir.state] : []));
const filterState = [...new Set(inScope.flatMap(statesOf))].sort()
  .map((code) => ({
    code,
    count: inScope.filter((reservoir) => statesOf(reservoir).includes(code)).length
  }))
  .find((candidate) => candidate.count > 0 && candidate.count < inScope.length);
const stateRows = filterState
  ? inScope.filter((reservoir) => statesOf(reservoir).includes(filterState.code))
  : [];
const expectedStateSubregions = [...new Set(stateRows
  .filter((reservoir) => typeof reservoir.huc6 === "string")
  .map((reservoir) => reservoir.huc6.slice(0, 4)))].sort();
const subregionCandidates = expectedStateSubregions.map((code) => ({
  code,
  count: stateRows.filter((reservoir) => reservoir.huc6?.startsWith(code)).length
}));
/* Prefer a subregion that narrows the state's rows further, so the wait
 * below has a row-count change to observe; any non-empty one still proves
 * the control and the address. */
const filterSubregion =
  subregionCandidates.find((c) => c.count > 0 && c.count < stateRows.length)
  ?? subregionCandidates.find((c) => c.count > 0);
const filterCounty = [...new Set(inScope.map((reservoir) => reservoir.county_fips)
  .filter((code) => typeof code === "string"))].sort()
  .map((code) => ({
    code,
    count: inScope.filter((reservoir) => reservoir.county_fips === code).length
  }))
  .find((candidate) => candidate.count > 0 && candidate.count < inScope.length);
/* Everything the connected scope holds once both dominant controls are
 * open, except Lake Powell, which stays excluded in this exercise -- the
 * two toggles are independent and the test drives exactly one. */
const lakeMeadRow = payload.reservoirs.find((reservoir) =>
  reservoir.rise_item_id === 6124 ||
  reservoir.name.trim().toLowerCase() === "lake mead");
const expectedConnectedWithMead = payload.reservoirs.filter((reservoir) =>
  reservoir.rise_item_id !== 509 &&
  reservoir.name.trim().toLowerCase() !== "lake powell").length;

const URL = `http://127.0.0.1:${PORT}/`;

/*
 * axe-core, injected into each page rather than run as a Playwright plugin.
 *
 * One dependency instead of a plugin chain, and the same file the browser
 * would load: `axe.run` walks the composed tree, so it pierces the open
 * shadow roots that Calcite and the ArcGIS components put their real
 * controls inside -- which is the whole reason a DOM-only check was never
 * going to be enough here. The slider handle this found is a `div` three
 * levels inside a shadow root.
 */
const AXE_SOURCE = await readFile(
  path.join(REPO_ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");

/* WCAG 2.0 and 2.1, levels A and AA. Not the "best-practice" rules: those
 * are opinions worth reading and not worth failing a build over. */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/*
 * The one accepted exception, kept as narrow as a selector can make it.
 *
 * `arcgis-chart` renders an inner `div` carrying an `aria-label` and no role,
 * which `aria-prohibited-attr` correctly reports: the label is inert, because
 * a bare `div` has no role for a name to attach to. It is Esri's markup, in
 * their component, and the honest options were to leave their label inert or
 * to reach into a vendor subtree and add a role to it -- and the second is
 * how you end up owning someone else's component.
 *
 * Nothing is lost by leaving it. Every chart sits in a `section` named by
 * `aria-labelledby` against a real heading, with a sentence under it, so the
 * chart is announced by our markup rather than theirs. Re-check this on the
 * next SDK upgrade; if Esri adds the role, this exception starts matching
 * nothing and should be deleted.
 */
const AXE_EXCEPTIONS = [
  { rule: "aria-prohibited-attr", target: "-arcgis-chart" }
];

function axeViolations(violations) {
  return violations
    .map((violation) => ({
      ...violation,
      nodes: violation.nodes.filter((node) => !AXE_EXCEPTIONS.some((allowed) =>
        allowed.rule === violation.id
        && node.target.join(" ").includes(allowed.target)))
    }))
    .filter((violation) => violation.nodes.length > 0);
}

/**
 * Runs axe over a settled page and reports every violation as its own check,
 * so a failure names the rule and the element rather than a count.
 */
/*
 * Label fonts, watched on the wire rather than in the DOM.
 *
 * A 2D label font is a glyph atlas fetched from Esri's font host under a slug
 * the SDK builds from the family *and* the weight. Ask for one that does not
 * exist and nothing breaks: the request 404s, the labels quietly fall back to
 * the default sans, and the page looks fine. That is exactly what happened
 * when the typeface was first set from the SDK's documented display names --
 * "Atkinson Hyperlegible Next Regular" at normal weight asked for
 * `atkinson-hyperlegible-next-regular-regular`.
 *
 * Nothing in the DOM shows it, and the console message for a 404 carries no
 * URL, so the existing console filter could not tell it from a missing tile.
 * The only place the mistake is visible is the request itself.
 */
/*
 * The lazily-loaded chunks, watched on the wire.
 *
 * The storage map's ranking chart is behind a dynamic import that only runs
 * when the reader opens that row, and the charts package it pulls in is the
 * largest thing this repository can ask a browser for -- roughly 440 KiB
 * gzipped on its own. An ordinary import added anywhere in the entry graph
 * would move all of it onto the first load of the primary page and nothing
 * would look wrong: the page would still work, just slower, for everyone who
 * never opens the row.
 *
 * The build budget cannot see this. It measures the entry's static graph in
 * bytes, and 440 KiB moving from "lazy" to "eager" inside a 2.13 MiB budget
 * does not breach it. Only the request tells you.
 */
const LAZY_CHUNK_MARKERS = ["overview-charts", "charts-components"];

function watchLazyChunks(tab) {
  const loaded = [];
  tab.on("request", (request) => {
    const url = request.url();
    if (LAZY_CHUNK_MARKERS.some((marker) => url.includes(marker))) loaded.push(url);
  });
  return loaded;
}

function checkLazyChunks(check, label, loaded) {
  check(loaded.length === 0,
    `${label}: a lazily-loaded chart chunk was fetched on the first load, ` +
    `so every reader now waits for it: ${[...new Set(loaded)].join(", ")}`);
}

function watchLabelFonts(tab) {
  const missing = [];
  tab.on("response", (response) => {
    const url = response.url();
    if (!url.includes("/fonts/")) return;
    if (response.status() >= 400) missing.push(`${response.status()} ${url}`);
  });
  return missing;
}

function checkLabelFonts(check, label, missing) {
  check(missing.length === 0,
    `${label}: a label font did not resolve, so labels fell back silently: ` +
    [...new Set(missing)].join(", "));
}

async function checkAccessibility(tab, check, label) {
  await tab.addScriptTag({ url: `${URL}__axe.js` });
  const violations = await tab.evaluate(async (tags) => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: tags }
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({ target: node.target }))
    }));
  }, AXE_TAGS);

  const remaining = axeViolations(violations);
  check(remaining.length === 0,
    `${label}: axe-core found ${remaining.length} accessibility violation(s): ` +
    remaining.map((violation) =>
      `${violation.id} (${violation.impact}) on ${violation.nodes.length} node(s) ` +
      `e.g. ${violation.nodes[0]?.target.join(" ")}`).join("; "));
  if (remaining.length === 0) {
    console.log(`  axe: clean (${violations.length} exception(s) allowed)`);
  }
}
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
  { name: "small-phone", width: 360, height: 780 }
];

const RETIRED_TERMS =
  /\bcadence\b|stale feed|period-of-record|seasonal percentile|\baf\b|\bRISE\b|\bAWDB\b/i;

/* Text a reader can see, including inside every open shadow root. Calcite
 * and the ArcGIS components render their own labels in shadow DOM, so the
 * vocabulary rule and the credential check both have to look there. */
const COLLECT_SHADOW_TEXT = `(() => {
  const parts = [];
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) parts.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.hidden || node.getAttribute?.("aria-hidden") === "true") return;
    for (const attribute of ["aria-label", "label", "placeholder", "title"]) {
      const value = node.getAttribute?.(attribute);
      if (value) parts.push(value);
    }
    if (node.shadowRoot) visit(node.shadowRoot);
    for (const child of node.childNodes) visit(child);
  };
  visit(document.body);
  return parts.join(" | ");
})()`;

/* The sign-in surfaces the SDK can raise. Element names first, because the
 * prompt exists as an element before it has any text in it. */
const FIND_CREDENTIAL_UI = `(() => {
  const found = [];
  const suspectElement = /^(arcgis|esri|calcite)-.*(login|sign-in|signin|credential|identity|oauth)/i;
  const visit = (root) => {
    for (const element of root.querySelectorAll("*")) {
      const name = element.localName;
      if (suspectElement.test(name)) found.push(name);
      if (name === "input" && element.type === "password") found.push("input[type=password]");
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(document);
  return found;
})()`;

await new Promise((resolve) => server.listen(PORT, resolve));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
  : {});

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport });
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
  const labelFonts = watchLabelFonts(tab);
  const lazyChunks = watchLazyChunks(tab);
  tab.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const diagnostic = `${msg.text()} ${msg.location().url}`.trim();
    if (/favicon|tile|sprite|font/i.test(diagnostic)) return;
    errors.push(`console: ${diagnostic}`);
  });

  const label = `Primary ArcGIS application (${viewport.name})`;
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction(() => window.__dashboardReady !== undefined, { timeout: 60000 });
    /* Read here, before this block opens the ranking row. That row is what
     * legitimately triggers the dynamic import, so asserting at the end of
     * the block would only ever prove the test clicked it. First load is the
     * claim, so first load is where it is measured. */
    checkLazyChunks(check, label, [...lazyChunks]);

    const ready = await tab.evaluate(() => window.__dashboardReady);
    console.log("  ready:", JSON.stringify(ready));
    check(ready.engine === "arcgis-5", `${label}: wrong engine signal`);
    check(ready.reservoirs === expectedReservoirs,
      `${label}: scope holds ${ready.reservoirs} reservoirs, expected ${expectedReservoirs}`);
    check(ready.drawn === expectedReservoirs,
      `${label}: drew ${ready.drawn} reservoirs, expected ${expectedReservoirs}`);
    /* The renderer no longer holds one symbol per feature -- size is an
     * expression and colour is the key, so it holds one per storage class
     * per late state. The fact worth asserting is not the count but that
     * every feature has a symbol: a key the renderer does not carry draws
     * nothing, which is exactly the silent failure the old count-based
     * check existed to catch. */
    const symbology = await tab.evaluate(async () => {
      const layer = document.querySelector("arcgis-map")?.map?.findLayerById("reservoirs");
      const renderer = layer?.renderer;
      if (!layer || !renderer) return null;
      const known = new Set((renderer.uniqueValueInfos ?? []).map((info) => String(info.value)));
      const features = await layer.queryFeatures({
        where: "1=1", outFields: ["symbol_key"], returnGeometry: false
      });
      const keys = features.features.map((feature) => String(feature.attributes.symbol_key));
      return {
        symbols: known.size,
        field: renderer.field,
        features: keys.length,
        unsymbolised: keys.filter((key) => !known.has(key)).length
      };
    });
    check(symbology !== null, `${label}: the reservoir renderer is missing`);
    check(symbology?.unsymbolised === 0,
      `${label}: ${symbology?.unsymbolised} reservoirs carry a symbol key the renderer does not have`);
    check(symbology?.features === expectedReservoirs,
      `${label}: the layer holds ${symbology?.features} features, expected ${expectedReservoirs}`);
    check((symbology?.symbols ?? 0) > 1 && (symbology?.symbols ?? 0) < expectedReservoirs,
      `${label}: the renderer holds ${symbology?.symbols} symbols; one per feature is the ` +
      "design this replaced, and it is what made re-symbolising slow");
    check(ready.symbols === symbology?.symbols,
      `${label}: the readiness signal reports ${ready.symbols} symbols, the renderer has ` +
      `${symbology?.symbols}`);
    /* The twelve months the payload has always carried, which this map has
     * only ever shown the newest of. The slider's rightmost position is the
     * newest reading, not a month, which is why `month` opens as null. */
    check(ready.months > 1, `${label}: the month slider offers ${ready.months} positions`);
    check(ready.month === null,
      `${label}: the map opened on ${ready.month} instead of the newest reading`);
    check(ready.listItems === expectedReservoirs,
      `${label}: the reservoir list has ${ready.listItems} entries, expected ${expectedReservoirs}`);
    check(await tab.locator('[data-reservoir="Lake Powell"]').count() === 0,
      `${label}: Lake Powell appears in the default reservoir list`);
    check(ready.basemap === true, `${label}: no basemap resolved`);
    check(ready.basemapDegraded === false,
      `${label}: the preferred basemap did not serve`);
    check(ready.masked === true, `${label}: the Utah mask is missing`);
    /* `aria-busy` reports one fact: the map is still starting. Once it has
     * started, every path out of that has to clear it -- the visible loader
     * is replaced by the map element well before the view is ready, so a
     * stuck flag is a screen reader told "busy" with nothing to read. */
    check(await tab.getAttribute("#map-host", "aria-busy") === "false",
      `${label}: the map still reports itself as loading after it started`);
    /* Both production maps already refuse to leave the region. Without the
     * constraint a reader can pan a Utah dashboard into open ocean and find
     * an empty basemap with no way back except reloading. */
    check(ready.navigationBounds === true,
      `${label}: map navigation is not held inside the region`);
    check(ready.minZoom === 5,
      `${label}: the map can zoom out to ${ready.minZoom}, expected 5`);
    /* The basemap's own reference stack draws above every operational layer,
     * so a boundary in it lands on top of the reservoirs no matter how the
     * operational layers are ordered. Moving it below them is the only fix,
     * and this is the count that says it happened. */
    check(ready.basemapReferenceSunk >= 1,
      `${label}: ${ready.basemapReferenceSunk} basemap reference layers were ` +
      "moved below this project's own layers, expected at least one");
    check(ready.boundaryPoints > 100,
      `${label}: authoritative Utah boundary was not drawn (${ready.boundaryPoints} points)`);
    check(ready.drainageAreas === expectedAreas,
      `${label}: drew ${ready.drainageAreas} drainage areas, expected ${expectedAreas}`);
    check(ready.drainageLabels === expectedAreas,
      `${label}: configured ${ready.drainageLabels} drainage-area labels, expected ${expectedAreas}`);
    /* ADR-047 replaced the position guarantee with a placement guarantee.
     * The names are the label engine's now, so they draw in its pass above
     * every layer and the ADR-030 field reports false -- and the check that
     * matters is that something is still placing them, because a layer that
     * quietly lost its `labelingInfo` looks exactly like a clean map. */
    /* The size of the drawn areas, from the payload rather than from a
     * constant in the client. A scope published at another level would draw
     * shapes that no figure on the page describes, because every figure here
     * is keyed six digits deep. */
    check(ready.drainageLevel === 6,
      `${label}: the drainage areas drew at hydrologic level ` +
      `${ready.drainageLevel}, and every figure on this page is keyed at 6`);
    check(ready.drainageLabelsDeconflicted === true,
      `${label}: drainage-area names are not being placed by the label engine`);
    check(ready.drainageLabelsUnderReservoirs === false,
      `${label}: a drainage text-symbol layer came back alongside the ` +
      "engine-placed names, which would draw every name twice");

    /* The renderer count above proves what the page built. This proves the
     * layer accepted it: a client-side feature layer whose source is
     * rejected still exists, still reports its renderer, and holds nothing.
     * `queryFeatureCount` answers from the layer, not from a view, so it
     * settles in headless Chromium where the render loop does not run. */
    const layerFeatures = await tab.evaluate(async () => {
      const layer = document.querySelector("arcgis-map")?.map
        ?.findLayerById("reservoirs");
      const drainage = document.querySelector("arcgis-map")?.map
        ?.findLayerById("drainage-areas");
      const drainageLabels = document.querySelector("arcgis-map")?.map
        ?.findLayerById("drainage-labels");
      const labelClass = drainage?.labelingInfo?.at(0);
      const map = document.querySelector("arcgis-map")?.map;
      return {
        type: layer?.type ?? null,
        count: layer ? await layer.queryFeatureCount() : 0,
        drainageType: drainage?.type ?? null,
        drainageCount: drainage ? await drainage.queryFeatureCount() : 0,
        drainageLabelClasses: drainage?.labelingInfo?.length ?? 0,
        drainageLabelsVisible: drainage?.labelsVisible === true,
        drainageDeconfliction: labelClass?.deconflictionStrategy ?? null,
        drainageLabelType: drainageLabels?.type ?? null,
        drainageUnderReservoirs: map && drainage && layer
          ? map.layers.indexOf(drainage) < map.layers.indexOf(layer)
          : false,
        drainageHaloAlpha: labelClass?.symbol?.haloColor?.a ?? null,
        symbolUsesViewScale: JSON.stringify(layer?.renderer?.toJSON?.() ?? layer?.renderer ?? {})
          .includes("$view.scale")
      };
    });
    check(layerFeatures.type === "feature",
      `${label}: the reservoirs layer is "${layerFeatures.type}", expected a feature layer`);
    check(layerFeatures.count === expectedReservoirs,
      `${label}: the reservoir layer holds ${layerFeatures.count} features, ` +
      `expected ${expectedReservoirs}`);
    check(layerFeatures.drainageType === "feature",
      `${label}: the drainage-area layer is "${layerFeatures.drainageType}", expected feature`);
    check(layerFeatures.drainageCount === expectedAreas,
      `${label}: the drainage-area layer holds ${layerFeatures.drainageCount}, ` +
      `expected ${expectedAreas}`);
    /* ADR-047. The names are one label class on the drainage layer itself,
     * so the count is fixed at one however many areas are in scope -- which
     * is the whole point, and what fourteen fixed text symbols could not
     * say about a hundred and eighty-one. */
    check(layerFeatures.drainageLabelClasses === 1,
      `${label}: the drainage layer carries ${layerFeatures.drainageLabelClasses} ` +
      "label classes, expected exactly one");
    check(layerFeatures.drainageLabelsVisible,
      `${label}: the drainage layer has labels configured but switched off`);
    /* The guarantee itself. Without this the engine draws every name it is
     * given, which at western scale is the failure ADR-047 exists to end --
     * and it would look identical at fourteen. */
    check(layerFeatures.drainageDeconfliction === "dynamic",
      `${label}: drainage names use "${layerFeatures.drainageDeconfliction}" ` +
      "placement, expected dynamic deconfliction");
    check(layerFeatures.drainageLabelType === null,
      `${label}: a drainage text-symbol layer is still on the map ` +
      `("${layerFeatures.drainageLabelType}"), so every name draws twice`);
    /* ADR-030's intent, kept. The label pass resolves conflicts between
     * layers in operational order, so a reservoir's own name outranks a
     * drainage name where the two compete for the same pixels. */
    check(layerFeatures.drainageUnderReservoirs,
      `${label}: the drainage layer rose above the reservoirs, which hands ` +
      "drainage names priority over reservoir names in the label pass");
    /* ADR-030 was right about this half and it carries over unchanged: a
     * near-opaque halo covered more of the map than the text it separated. */
    check(layerFeatures.drainageHaloAlpha === 0.5,
      `${label}: drainage-area label halo opacity is ${layerFeatures.drainageHaloAlpha}, expected 0.5`);
    check(layerFeatures.symbolUsesViewScale === false,
      `${label}: reservoir symbols still grow with the view scale`);

    const visibleText = await tab.evaluate(COLLECT_SHADOW_TEXT);
    check(!RETIRED_TERMS.test(visibleText),
      `${label}: retired vocabulary is visible ` +
      `("${(visibleText.match(RETIRED_TERMS) || [""])[0]}")`);

    const credentialUi = await tab.evaluate(FIND_CREDENTIAL_UI);
    check(credentialUi.length === 0,
      `${label}: a credential prompt exists (${credentialUi.join(", ")})`);
    /* The page links are buttons on a wide bar and one menu on a narrow one,
     * because this bar clips rather than wraps. Exactly one of the two has
     * to be showing: both is a duplicated control, neither is a page with no
     * way out. The menu carries every link either way, so it is the one that
     * has to hold the full set. */
    const pageLinks = await tab.evaluate(() => {
      const shown = (selector) => {
        const element = document.querySelector(selector);
        return Boolean(element) && getComputedStyle(element).display !== "none";
      };
      return {
        menu: shown("#page-menu"),
        buttons: ["#overview-link", "#snow-link", "#drought-link", "#methods-link"].filter(shown),
        menuItems: [...document.querySelectorAll("#page-menu calcite-dropdown-item")]
          .map((item) => item.getAttribute("href")),
        buttonHrefs: ["#overview-link", "#snow-link", "#drought-link", "#methods-link"]
          .map((selector) => document.querySelector(selector)?.getAttribute("href"))
      };
    });
    const wideBar = viewport.width >= 1024;
    check(pageLinks.menu === !wideBar,
      `${label}: the page menu is ${pageLinks.menu ? "showing" : "hidden"} at ${viewport.width}px`);
    check(pageLinks.buttons.length === (wideBar ? 4 : 0),
      `${label}: ${pageLinks.buttons.length} page link buttons are showing at ${viewport.width}px`);
    check(pageLinks.menuItems.join(",") === "./,./overview.html,./snow.html,./drought.html,./methods.html",
      `${label}: the page menu offers ${pageLinks.menuItems.join(", ")}`);
    check(pageLinks.buttonHrefs.join(",") === "./overview.html,./snow.html,./drought.html,./methods.html",
      `${label}: the page link buttons point at ${pageLinks.buttonHrefs.join(", ")}`);
    check(await tab.locator(".map-stage > .map-alternative").count() === 0,
      `${label}: the old table and charts overlay still covers the map`);

    /* The analysis controls. The map greys what is excluded rather than
     * removing it, so the assertion is that the panel's count, the dimmed
     * rows and the layer's own effect all describe one filter -- three
     * surfaces disagreeing is the failure this catches. */
    // The surface a reader can actually reach at this width; a scripted
    // change on the hidden desktop panel would make the phone run meaningless.
    const mobile = viewport.width < 768;
    const controls = mobile ? "#start-sheet" : "#start-panel";
    check(await tab.locator(`${controls} [data-filter="storage"]`).isVisible(),
      `${label}: the storage level filter is not visible`);
    /* Both of ADR-011's dimensions are the reader's to choose. Geography was
     * pinned to Utah, which is why Fontenelle and Woodruff Narrows were
     * published every morning and drawn nowhere. */
    const wider = await tab.evaluate(async (selector) => {
      const geography = document.querySelector(`${selector} [data-scope="geography"]`);
      geography.value = "connected";
      geography.dispatchEvent(new CustomEvent("calciteSelectChange", { bubbles: true }));
      await new Promise((resolve) => { setTimeout(resolve, 900); });
      return {
        drawn: window.__dashboardReady.drawn,
        geography: window.__dashboardReady.geography,
        selectionOnTop: window.__dashboardReady.selectionOnTop,
        drainageLabelsDeconflicted:
          window.__dashboardReady.drainageLabelsDeconflicted,
        search: window.location.search
      };
    }, controls);
    check(wider.geography === "connected",
      `${label}: the geography control did not widen the scope`);
    /* The selection ring is added over the reservoirs on the first draw and
     * has to stay there through every redraw the scope control causes. It
     * was added to the map once, so it sat above the opening layer and
     * below each layer that replaced it, and no counted field could tell. */
    check(wider.selectionOnTop,
      `${label}: the selection ring fell beneath the reservoirs after a scope change`);
    check(wider.drainageLabelsDeconflicted,
      `${label}: the drainage names stopped being placed after a scope change`);
    check(wider.drawn > expectedReservoirs,
      `${label}: every connected reservoir drew ${wider.drawn}, no more than Utah's ` +
      `${expectedReservoirs} -- the reservoirs outside Utah are still unreachable`);
    check(/reservoirs=connected/.test(wider.search),
      `${label}: the wider scope is missing from a shareable link`);
    await tab.evaluate(async (selector) => {
      const geography = document.querySelector(`${selector} [data-scope="geography"]`);
      geography.value = "utah";
      geography.dispatchEvent(new CustomEvent("calciteSelectChange", { bubbles: true }));
      await new Promise((resolve) => { setTimeout(resolve, 900); });
    }, controls);
    check(ready.selectionOnTop,
      `${label}: the selection ring is beneath the reservoirs on the first draw`);
    check(ready.filtered === false,
      `${label}: the map starts filtered`);
    check(ready.shown === expectedReservoirs,
      `${label}: the unfiltered panel reports ${ready.shown} of ${expectedReservoirs}`);

    await tab.evaluate((selector) => {
      const select = document.querySelector(`${selector} [data-filter="reporting"]`);
      select.value = "late";
      select.dispatchEvent(new CustomEvent("calciteSelectChange", { bubbles: true }));
    }, controls);
    await tab.waitForFunction(() => window.__dashboardReady.filtered === true, { timeout: 5000 });

    const filtered = await tab.evaluate(async (selector) => {
      const layer = document.querySelector("arcgis-map")?.map?.findLayerById("reservoirs");
      const effect = layer?.featureEffect;
      return {
        shown: window.__dashboardReady.shown,
        where: effect?.filter?.where ?? null,
        excludedEffect: effect?.excludedEffect ?? null,
        // Counted from the layer, under the same clause the effect uses.
        included: await layer.queryFeatureCount({ where: effect?.filter?.where }),
        dimmed: document.querySelectorAll(`${selector} .list-btn-excluded`).length,
        listed: document.querySelectorAll(`${selector} .list-btn`).length,
        summary: document.querySelector(`${selector} [data-filter="summary"]`)?.textContent ?? ""
      };
    }, controls);
    check(filtered.where === "late = 1",
      `${label}: the layer filter is "${filtered.where}", expected "late = 1"`);
    check(/grayscale/.test(filtered.excludedEffect ?? ""),
      `${label}: excluded reservoirs are not greyed (${filtered.excludedEffect})`);
    check(filtered.included === filtered.shown,
      `${label}: the map includes ${filtered.included} reservoirs, the panel says ${filtered.shown}`);
    check(filtered.listed - filtered.dimmed === filtered.shown,
      `${label}: ${filtered.listed - filtered.dimmed} rows stayed bright, ` +
      `the panel says ${filtered.shown}`);
    check(filtered.listed === expectedReservoirs,
      `${label}: the filter removed rows from the list instead of dimming them`);
    check(filtered.summary.includes(String(filtered.shown)),
      `${label}: the panel does not report how many reservoirs are shown`);

    /* Moving the slider has to move the map, the list and the headline
     * together. A headline still reporting today while the map draws last
     * November is the page saying two things at once. */
    const monthView = await tab.evaluate(async (selector) => {
      const before = document.querySelector(`${selector} [data-value="percent"]`)?.textContent;
      const slider = document.querySelector(`${selector} [data-month="slider"]`);
      slider.value = 0;
      slider.dispatchEvent(new CustomEvent("calciteSliderChange", { bubbles: true }));
      await new Promise((resolve) => { setTimeout(resolve, 800); });
      return {
        before,
        month: window.__dashboardReady.month,
        drawn: window.__dashboardReady.drawn,
        percent: document.querySelector(`${selector} [data-value="percent"]`)?.textContent,
        updated: document.querySelector(`${selector} [data-value="updated"]`)?.textContent,
        caption: document.querySelector(`${selector} [data-month="label"]`)?.textContent,
        search: window.location.search
      };
    }, controls);
    check(typeof monthView.month === "string" && /^\d{4}-\d{2}$/.test(monthView.month),
      `${label}: the slider did not move the map to a month (${monthView.month})`);
    check(monthView.drawn === expectedReservoirs,
      `${label}: a past month drew ${monthView.drawn} reservoirs, expected ${expectedReservoirs}`);
    check(/[Aa]verage through/.test(monthView.updated ?? ""),
      `${label}: the headline still reads "${monthView.updated}" in a past month`);
    check((monthView.caption ?? "").includes("Showing the average through"),
      `${label}: the slider caption does not say which month is on screen`);
    check(monthView.search.includes(`month=${monthView.month}`),
      `${label}: the month is missing from a shareable link ("${monthView.search}")`);

    // Back to the newest reading, which is what every other number is about.
    await tab.evaluate(async (selector) => {
      document.querySelector(`${selector} [data-month="now"]`).click();
      await new Promise((resolve) => { setTimeout(resolve, 800); });
    }, controls);
    const backToNow = await tab.evaluate((selector) => ({
      month: window.__dashboardReady.month,
      percent: document.querySelector(`${selector} [data-value="percent"]`)?.textContent,
      search: window.location.search
    }), controls);
    check(backToNow.month === null,
      `${label}: the map stayed on ${backToNow.month} after returning to the newest reading`);
    check(backToNow.percent === monthView.before,
      `${label}: the headline came back as ${backToNow.percent}, was ${monthView.before}`);
    check(!backToNow.search.includes("month="),
      `${label}: the newest reading is written into the link as a month`);

    // Excluded reservoirs stay on the map, so their rows stay reachable.
    const dimmedButton = tab.locator(`${controls} .list-btn-excluded`).first();
    if (await dimmedButton.count()) {
      check(await dimmedButton.isEnabled(),
        `${label}: a filtered-out reservoir cannot be selected from the list`);
    }

    await tab.locator(`${controls} [data-filter="reset"]`).first().click();
    await tab.waitForFunction(() => window.__dashboardReady.filtered === false, { timeout: 5000 });
    const cleared = await tab.evaluate((selector) => ({
      effect: document.querySelector("arcgis-map")?.map
        ?.findLayerById("reservoirs")?.featureEffect ?? null,
      dimmed: document.querySelectorAll(`${selector} .list-btn-excluded`).length
    }), controls);
    check(cleared.effect === null,
      `${label}: clearing the filter left an effect on the layer`);
    check(cleared.dimmed === 0,
      `${label}: clearing the filter left ${cleared.dimmed} rows dimmed`);

    if (viewport.name === "desktop") {
      const pointerName = await tab.locator("#start-panel .list-btn").first()
        .getAttribute("data-reservoir");
      await tab.evaluate((name) => {
        const map = document.querySelector("arcgis-map");
        const layer = map.map.findLayerById("reservoirs");
        const objectid = layer.source.find((graphic) =>
          graphic.attributes?.name === name)?.attributes?.objectid;
        map.hitTest = async (_point, options) => {
          /* An array now, reservoirs first: the drainage outlines answer
           * too, so a reader gets the area's combined storage where they
           * are not over a reservoir. Order is the priority. */
          window.__reservoirHitIncluded = Array.isArray(options?.include)
            && options.include[0] === layer;
          return ({
            /* A newly materialized client-side layer view can return only the
             * object ID even though the source carries every field. Selection
             * must work on the first draw, before a scope change rebuilds it.
             * `layer` sits on the hit result itself, per the SDK's `GraphicHit`
             * type -- not on `graphic.layer`, which the 2D feature layer view
             * only ever sets for track and aggregate hits. */
            results: [{ type: "graphic", layer, graphic: {
              attributes: { objectid }
            } }]
          });
        };
        map.dispatchEvent(new CustomEvent("arcgisViewPointerMove", {
          detail: { x: 500, y: 300 }
        }));
      }, pointerName);
      await tab.waitForFunction(
        () => document.querySelector("#map-hover")?.hidden === false,
        { timeout: 5000 });
      const hoverText = (await tab.locator("#map-hover").innerText()).trim();
      check(hoverText.includes(pointerName) && hoverText.includes("%"),
        `${label}: pointer hover did not summarize ${pointerName}`);
      check(await tab.evaluate(() => window.__reservoirHitIncluded === true),
        `${label}: pointer hit test did not put the reservoir layer first`);
      const hoverBounds = await tab.evaluate(() => {
        const stage = document.querySelector(".map-stage").getBoundingClientRect();
        const card = document.querySelector("#map-hover").getBoundingClientRect();
        return {
          inside: card.left >= stage.left && card.top >= stage.top &&
            card.right <= stage.right && card.bottom <= stage.bottom
        };
      });
      check(hoverBounds.inside, `${label}: pointer hover card extends outside the map`);

      await tab.evaluate(() => {
        document.querySelector("arcgis-map").dispatchEvent(
          new CustomEvent("arcgisViewImmediateClick", { detail: { x: 500, y: 300 } }));
      });
      await tab.waitForFunction(
        (name) => window.__dashboardReady.selected === name,
        pointerName,
        { timeout: 5000 });
      check(await tab.locator("#detail-panel [data-detail]").innerText()
        .then((text) => text.includes(pointerName)),
      `${label}: map pointer selection did not open ${pointerName}`);
    }

    /* The drainage area under the pointer when no reservoir is. This card
     * went silently dark once already: the resolver read `area_name`, a
     * field the hosted features never carry (they answer with `name`), so
     * every drainage hover resolved to nothing while the reservoir hover
     * above kept passing. Driven through the shared helper so the
     * attributes come from the layer's own service fields, the same way
     * the snow and drought maps are checked. */
    await checkViewMapHover(tab, check, label, "map-host", "map-hover",
      "drainage-areas", "reservoir");

    /* Which period "normal" means.
     *
     * The two facts worth a browser check are the ones no unit test can see:
     * that the control is actually on screen with both periods in it, and
     * that changing it reaches the details panel and the address bar. The
     * arithmetic behind each period is held by the unit tests. */
    const baselineSelect = mobile
      ? "#start-sheet [data-baseline=\"period\"]"
      : "#start-panel [data-baseline=\"period\"]";
    const baselineState = await tab.evaluate((selector) => {
      const select = document.querySelector(selector);
      return {
        present: Boolean(select),
        options: select
          ? [...select.querySelectorAll("calcite-option")].map((option) => option.value)
          : [],
        value: select ? select.value : null,
        note: document.querySelector('[data-baseline="note"]')?.textContent ?? "",
        signal: window.__dashboardReady.baseline,
        choices: window.__dashboardReady.baselineChoices
      };
    }, baselineSelect);
    check(baselineState.present, `${label}: the comparison period control is missing`);
    check(baselineState.choices >= 2,
      `${label}: only ${baselineState.choices} comparison period on offer`);
    check(baselineState.options.includes("climate") && baselineState.options.includes("recent"),
      `${label}: the comparison period control offers ${baselineState.options.join(", ")}`);
    check(baselineState.value === baselineState.signal,
      `${label}: the control shows ${baselineState.value} while the page uses ` +
      `${baselineState.signal}`);
    /* The sentence is the control's whole point -- the two periods produce
     * different numbers and nothing in the number says which is which. */
    check(baselineState.note.length > 40,
      `${label}: the comparison period has no explanation beside it`);

    // Selection, through the list rather than the map: `hitTest` is resolved
    // by the render loop, which does not run reliably in headless Chromium.
    const listSelector = mobile ? "#start-sheet .list-btn" : "#start-panel .list-btn";
    const detailSelector = mobile ? "#detail-sheet [data-detail]" :
      "#detail-panel [data-detail]";
    const firstButton = tab.locator(listSelector).first();
    check(await firstButton.isVisible(), `${label}: the active reservoir list is not visible`);
    const firstName = await firstButton.getAttribute("data-reservoir");
    await firstButton.click();
    const selected = await tab.evaluate(() => window.__dashboardReady.selected);
    check(selected === firstName,
      `${label}: selecting ${firstName} left the signal at ${selected}`);
    /* The address bar describes the current view; it is not a log of how
     * the reader got here. Comparing five reservoirs means five clicks, and
     * with pushState the back button would then walk back through all five
     * instead of leaving the page. */
    const shared = await tab.evaluate(() => ({
      search: window.location.search,
      historyLength: window.history.length
    }));
    check(shared.search === `?reservoir=${encodeURIComponent(firstName)}`,
      `${label}: selecting ${firstName} left the address bar at "${shared.search}"`);

    const afterMore = await tab.evaluate((selector) => {
      const before = window.history.length;
      const buttons = [...document.querySelectorAll(selector)].slice(0, 4);
      buttons.forEach((button) => button.click());
      return {
        grewBy: window.history.length - before,
        search: window.location.search,
        last: buttons.at(-1)?.dataset.reservoir ?? null
      };
    }, listSelector);
    check(afterMore.grewBy === 0,
      `${label}: four more selections added ${afterMore.grewBy} history entries`);
    check(afterMore.search === `?reservoir=${encodeURIComponent(afterMore.last)}`,
      `${label}: the address bar lagged behind the selection`);

    /* Changing the period has to reach the open panel and the address bar.
     * The panel is the surface it changes, and the selection store refuses to
     * re-announce an unchanged name, so this is the exact path that would go
     * quiet if the panel were ever redrawn through the store again. */
    const switched = await tab.evaluate(async (args) => {
      const [selector, detail] = args;
      const before = document.querySelector(detail).innerText;
      const select = document.querySelector(selector);
      const other = select.value === "climate" ? "recent" : "climate";
      select.value = other;
      select.dispatchEvent(new CustomEvent("calciteSelectChange", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        other,
        changed: document.querySelector(detail).innerText !== before,
        signal: window.__dashboardReady.baseline,
        search: window.location.search,
        names: document.querySelector(detail).innerText.includes("through")
      };
    }, [baselineSelect, detailSelector]);
    check(switched.signal === switched.other,
      `${label}: the page stayed on ${switched.signal} after choosing ${switched.other}`);
    check(switched.changed,
      `${label}: choosing ${switched.other} did not change the details panel`);
    check(switched.search.includes(`baseline=${switched.other}`),
      `${label}: the chosen period is missing from "${switched.search}"`);
    check(switched.names,
      `${label}: the comparison does not name the years it came from`);

    if (mobile) {
      // The detail sheet is modal. Close it before exercising another real
      // list click; clicking through its overlay tests an impossible user
      // path and lets programmatic DOM clicks hide the mistake.
      await tab.locator("#detail-sheet-close").click();
      await tab.waitForFunction(
        "!document.querySelector('#detail-sheet')?.hasAttribute('opened')",
        { timeout: 5000 });
    }
    await tab.locator(listSelector).first().click();

    const detailHost = tab.locator(detailSelector);
    check(await detailHost.isVisible(), `${label}: the active detail surface is not visible`);
    const detail = (await detailHost.innerText()).trim();
    /* The readings the legacy popup carried. The panel replaced that popup
     * when 5.1 went to the root, and shipped with five of these -- so the
     * reader lost the comparison with a normal year, the two change figures
     * and the history entirely. */
    for (const expected of [firstName, "%", "Stored now", "Reading date", "Measured by",
      "Normal for this week", "History rank", "Change in 30 days", "Change in 1 year",
      "Highest value this year", "Update schedule", "The last 12 months"]) {
      check(detail.includes(expected),
        `${label}: the details panel does not report ${expected}`);
    }
    const detailExport = detailHost.locator("[data-export-reservoir]");
    check(await detailExport.count() === 1,
      `${label}: reservoir details have no CSV file control`);
    check(await detailExport.evaluate((element) => {
      const target = element.shadowRoot?.querySelector("button");
      return Boolean(target && target.tabIndex >= 0 && !target.disabled);
    }),
      `${label}: reservoir CSV file control is not keyboard reachable`);
    const [detailDownload] = await Promise.all([
      tab.waitForEvent("download", { timeout: 5000 }),
      detailExport.click()
    ]);
    const detailCsv = await readFile(await detailDownload.path(), "utf8");
    check(detailCsv.includes(firstName) && detailCsv.includes("History month"),
      `${label}: reservoir CSV file does not contain the selected record and history`);
    const history = await tab.evaluate((selector) => {
      const host = document.querySelector(selector);
      const chart = host?.querySelector(".trend-chart");
      return {
        bars: host?.querySelectorAll(".trend-chart rect").length ?? 0,
        rows: host?.querySelectorAll(".trend-table tbody tr").length ?? 0,
        // A chart with no accessible name is a picture of numbers that a
        // reader who cannot see it is simply not given.
        chartLabel: chart?.getAttribute("aria-label") ?? "",
        // The table is the text alternative, so it has to be reachable
        // rather than merely present in the markup.
        summary: host?.querySelector(".trend-details summary")?.textContent ?? ""
      };
    }, detailSelector);
    check(history.bars > 0, `${label}: the twelve-month chart drew no bars`);
    check(history.rows > 0, `${label}: the twelve-month table has no rows`);
    check(history.chartLabel.includes(firstName),
      `${label}: the twelve-month chart has no accessible name`);
    check(history.summary.length > 0,
      `${label}: the twelve-month table has no control to open it`);

    /* The map key, which the 5.1 application shipped without. Generated from
     * the class table, so the count is the assertion that matters: a sixth
     * class added to that table with no legend entry would mean the map
     * draws a colour the key does not explain. */
    const legend = await tab.evaluate((selector) => ({
      entries: document.querySelectorAll(`${selector} .legend-classes li`).length,
      colors: [...document.querySelectorAll(`${selector} .legend-classes .legend-swatch`)]
        .map((swatch) => getComputedStyle(swatch).backgroundColor),
      notes: document.querySelectorAll(`${selector} .legend-notes li`).length
    }), mobile ? "#start-sheet" : "#start-panel");
    check(legend.entries === 5,
      `${label}: the map key has ${legend.entries} storage classes, not 5`);
    check(legend.notes === 3,
      `${label}: the map key does not explain size, late data and no data`);
    check(new Set(legend.colors).size === 5,
      `${label}: the map key repeats a colour across its classes`);

    const layout = await tab.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null;
      };
      return {
        viewport: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        // The map's own controls sit in the component's shadow root; the
        // alternative link and the navigation are the light-DOM surfaces
        // that have covered them before.
        navigation: rect("calcite-navigation"),
        home: rect("arcgis-home"),
        fullscreen: rect("arcgis-fullscreen")
      };
    });
    check(layout.scroll <= layout.viewport + 1,
      `${label}: page overflows horizontally (${layout.scroll}px in ${layout.viewport}px)`);

    /* The header lays its contents out in one row and clips what does not
     * fit, so an overflowing header never widens the page -- the check above
     * cannot see this, and did not: at 375px the title, its description and
     * the former full link label came to 446px of content, which put the
     * reservoir details and theme controls fully off screen with nothing to
     * reveal them. Every control in the bar is measured against the viewport. */
    const navControls = await tab.evaluate(() => {
      /* Whatever is actually on the bar at this width. The link buttons
       * swap for the menu below 64rem, so naming a fixed set here would
       * measure a control that is display:none and pass on a zero box. */
      const ids = ["brand", "page-menu", "overview-link", "snow-link", "drought-link", "methods-link",
        "controls-toggle", "detail-toggle", "table-toggle", "theme-toggle"]
        .filter((id) => {
          const element = document.getElementById(id);
          return element && getComputedStyle(element).display !== "none";
        });
      return ids.map((id) => {
        const box = document.getElementById(id)?.getBoundingClientRect();
        return {
          id,
          left: box ? Math.round(box.left) : null,
          right: box ? Math.round(box.right) : null,
          width: box ? Math.round(box.width) : 0
        };
      });
    });
    for (const control of navControls) {
      check(control.width > 0, `${label}: the ${control.id} control has no size`);
      check(control.left !== null && control.left >= -1 &&
        control.right !== null && control.right <= layout.viewport + 1,
      `${label}: the ${control.id} control sits at ${control.left}-${control.right}, ` +
      `outside the ${layout.viewport}px viewport`);
    }

    /* The analysis controls have to come before the reservoir list, which
     * scrolls inside its own box: a control behind a nested scroller is a
     * control most readers never find. Asserted as document order rather
     * than as screen position, because by this point the tests above have
     * driven the slider and the list and the panel has scrolled -- position
     * would be measuring the test, not the layout. */
    const controlsBeforeList = await tab.evaluate((selector) => {
      const filters = document.querySelector(`${selector} .filters`);
      const list = document.querySelector(`${selector} .reservoir-list`);
      if (!filters || !list) return null;
      return Boolean(
        filters.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, controls);
    check(controlsBeforeList === true,
      `${label}: the analysis controls are not before the reservoir list`);
    /* The table under the map.
     *
     * Its rows are the filter's answer rendered a third way, beside the map
     * effect and the panel's sentence, so the assertion that matters is that
     * all three agree -- a table quietly listing a different set from the
     * circles above it is the failure this exists to catch. The export
     * button writes the same array the rows were drawn from, so a count that
     * agrees here is a file that agrees too. */
    const table = await tab.evaluate(async () => {
      const closedRows = document.querySelectorAll(".reservoir-table tbody tr").length;
      const startedClosed = document.getElementById("table-row").collapsed === true;
      document.getElementById("table-toggle").click();
      await new Promise((resolve) => { setTimeout(resolve, 500); });

      const heading = (index) =>
        document.querySelectorAll(".reservoir-table thead th")[index];
      const names = () => [...document.querySelectorAll(".reservoir-table tbody tr")]
        .map((row) => row.dataset.reservoir);
      const before = names();
      // The second column is Full; two presses take it to descending.
      heading(1).querySelector(".table-sort").click();
      await new Promise((resolve) => { setTimeout(resolve, 200); });
      heading(1).querySelector(".table-sort").click();
      await new Promise((resolve) => { setTimeout(resolve, 200); });

      const tools = document.querySelector(".table-tools");
      const scroller = document.querySelector(".table-scroll");
      return {
        startedClosed,
        closedRows,
        openRows: names().length,
        reordered: names().join("|") !== before.join("|"),
        ariaSort: heading(1).getAttribute("aria-sort"),
        unsortedAria: heading(0).getAttribute("aria-sort"),
        sortInUrl: /sort=percent-desc/.test(window.location.search),
        openInUrl: /table=open/.test(window.location.search),
        toolsBeforeRows: Boolean(tools && scroller &&
          (tools.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING)),
        // The scroller owns the sideways overflow; the page may not have any.
        scrollerScrolls: scroller ? scroller.scrollWidth >= scroller.clientWidth : false,
        ready: {
          rows: window.__dashboardReady.tableRows,
          shown: window.__dashboardReady.shown,
          sort: window.__dashboardReady.tableSort,
          open: window.__dashboardReady.tableOpen
        }
      };
    });
    check(table.startedClosed,
      `${label}: the table under the map is open before the reader asks for it`);
    check(table.closedRows === 0 || table.openRows === table.closedRows,
      `${label}: the table changed its rows when it was opened`);
    check(table.openRows === table.ready.rows,
      `${label}: the table drew ${table.openRows} rows and reports ${table.ready.rows}`);
    check(table.ready.rows === table.ready.shown,
      `${label}: the table holds ${table.ready.rows} reservoirs while the map ` +
      `effect includes ${table.ready.shown} -- two answers to one filter`);
    check(table.ready.open === true,
      `${label}: the header control did not open the table`);
    check(table.reordered, `${label}: sorting the Full column did not reorder the table`);
    check(table.ariaSort === "descending",
      `${label}: the sorted column announces ${table.ariaSort}, not descending`);
    check(table.unsortedAria === "none",
      `${label}: an unsorted column does not announce that it can be sorted`);
    check(table.sortInUrl && table.openInUrl,
      `${label}: the table's order and open state are missing from a shareable link`);
    /* The rows scroll inside their own box, so a control placed after them
     * sits behind a nested scroller -- the trap the analysis controls were
     * moved out of above the reservoir list. */
    check(table.toolsBeforeRows,
      `${label}: the table's export control is behind the row scroller`);

    /* The split between the map and this row.
     *
     * The separator is the component's own, so what is checked is that it is
     * there, that it is reachable and described, and that moving it actually
     * moves the row -- the parts that would go silently missing if the
     * `resizable` attribute were dropped or the panel's display mode changed.
     * The keyboard path is the one exercised because it is the only one that
     * works without a compositing render loop. */
    const split = await tab.evaluate(async () => {
      const row = document.getElementById("table-row");
      const separator = row.shadowRoot?.querySelector('[role="separator"]');
      if (!separator) return { present: false };
      const before = row.getBoundingClientRect().height;
      separator.focus();
      for (let press = 0; press < 8; press += 1) {
        separator.dispatchEvent(new KeyboardEvent("keydown",
          { key: "ArrowUp", bubbles: true, composed: true }));
        await new Promise((resolve) => { setTimeout(resolve, 60); });
      }
      separator.dispatchEvent(new KeyboardEvent("keyup",
        { key: "ArrowUp", bubbles: true, composed: true }));
      await new Promise((resolve) => { setTimeout(resolve, 300); });
      return {
        present: true,
        named: Boolean(separator.ariaLabel),
        focusable: separator.tabIndex >= 0,
        orientation: separator.ariaOrientation,
        before: Math.round(before),
        after: Math.round(row.getBoundingClientRect().height),
        stored: window.localStorage.getItem("utah-reservoir-dashboard-split")
      };
    });
    check(split.present, `${label}: the table row has no resize separator`);
    if (split.present) {
      check(split.named && split.focusable,
        `${label}: the resize separator is not named or not reachable by keyboard`);
      check(split.after > split.before,
        `${label}: the keyboard did not move the split (${split.before} to ${split.after})`);
      /* Remembered as a share of the window, never as pixels -- a position
       * from one screen has to mean the same share of another. */
      check(split.stored !== null && Number(split.stored) > 0 && Number(split.stored) < 1,
        `${label}: the split was stored as "${split.stored}"`);
    }

    const afterTable = await tab.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth
    }));
    check(afterTable.scroll <= afterTable.viewport + 1,
      `${label}: the open table widens the page ` +
      `(${afterTable.scroll}px in ${afterTable.viewport}px)`);

    /* Phase 4's ranking chart, in the same row. It is built from the same
     * rows the table renders, so the assertion that matters is the count:
     * every reservoir the filter matches that has a readable percentage,
     * and only those -- a chart ranking unknowns at zero would invent a
     * drought. Opening the row is what builds it, so this waits on the
     * readiness field the render writes last. */
    await tab.waitForFunction(() => window.__dashboardReady.rankingBars > 0, { timeout: 60000 });
    const ranking = await tab.evaluate(() => {
      const chart = document.querySelector('[data-ranking="host"] arcgis-chart');
      return {
        bars: window.__dashboardReady.rankingBars,
        shown: window.__dashboardReady.shown,
        busy: document.querySelector('[data-ranking="host"]')?.getAttribute("aria-busy"),
        chartLabel: chart?.aria?.label ?? "",
        caption: document.querySelector('[data-ranking="caption"]')?.textContent ?? "",
        marks: [...(chart?.shadowRoot?.querySelectorAll("svg rect, svg path") ?? [])]
          .filter((node) => node.getBoundingClientRect().width > 3).length,
        /* The chart's box and the table's box, which must not overlap: the
         * chart's scroller was once painted straight through the table
         * region below it, because the grid holding both was allowed to
         * shrink beneath its content. Scroll positions do not move these --
         * both rects are the boxes themselves, not their contents. */
        overlap: (() => {
          const a = document.querySelector(".ranking-scroll")?.getBoundingClientRect();
          const b = document.querySelector(".table-scroll")?.getBoundingClientRect();
          if (!a || !b) return null;
          return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        })(),
        viewport: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth
      };
    });
    check(ranking.bars === expectedRanked,
      `${label}: the ranking chart holds ${ranking.bars} bars, expected ${expectedRanked}`);
    check(ranking.bars <= ranking.shown,
      `${label}: the ranking chart holds more bars (${ranking.bars}) than the filter ` +
      `matches (${ranking.shown})`);
    check(ranking.busy === "false",
      `${label}: the ranking chart still reports itself as loading after it drew`);
    check(ranking.chartLabel.length > 0,
      `${label}: the ranking chart has no accessible name`);
    check(ranking.caption.includes(String(ranking.bars)),
      `${label}: the ranking caption does not say how many reservoirs are ranked`);
    check(ranking.marks > 0, `${label}: the ranking chart drew no marks`);
    check(ranking.overlap === 0,
      `${label}: the ranking chart's box overlaps the table's by ${ranking.overlap}pxÂ²`);
    check(ranking.scroll <= ranking.viewport + 1,
      `${label}: the ranking chart widens the page ` +
      `(${ranking.scroll}px in ${ranking.viewport}px)`);

    await tab.evaluate(async () => {
      document.getElementById("table-close").click();
      await new Promise((resolve) => { setTimeout(resolve, 300); });
    });

    check(layout.navigation && layout.navigation.right <= layout.viewport + 1,
      `${label}: the navigation is clipped`);
    for (const [control, box] of [["Home", layout.home], ["Fullscreen", layout.fullscreen]]) {
      check(box && box.left >= 0 && box.right <= layout.viewport + 1 &&
        box.top >= (layout.navigation?.bottom ?? 0) && box.bottom <= viewport.height + 1,
      `${label}: the ${control} map control is clipped or covered by navigation`);
    }

    if (mobile) {
      await tab.locator("#detail-sheet-close").click();
      await tab.waitForFunction(
        "!document.querySelector('#detail-sheet')?.hasAttribute('opened')",
        { timeout: 5000 });
      // The application restores focus on the next animation frame so it
      // runs after Calcite's own close lifecycle has finished.
      await tab.waitForFunction(
        "document.activeElement?.matches(" +
          "'#start-sheet .list-btn[aria-pressed=\"true\"]') === true",
        { timeout: 5000 });
    }

    /* Last, on a settled page: every control is wired, every table is
     * filled, and the shadow roots have rendered their real controls. */
    checkLabelFonts(check, label, labelFonts);
    await checkAccessibility(tab, check, label);
    await tab.screenshot({ path: `screenshots/modern-${viewport.name}.png`, fullPage: false });
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
    await tab.screenshot({ path: `screenshots/modern-${viewport.name}-failure.png` }).catch(() => {});
  }

  for (const err of errors) {
    console.log("  ERROR", err);
    failures.push(`${label}: ${err}`);
  }
  await context.close();
}

for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
  const context = await browser.newContext({ viewport });
  const tab = await context.newPage();
  const errors = [];
  /* One vendor teardown race is accepted here, like AXE_EXCEPTIONS and for
   * the same reason. `mountChart` stops waiting for
   * `arcgisRenderingComplete` after a deadline because the event has been
   * observed never to arrive, so a filter change can replace a chart the
   * SDK is still measuring -- and the disposed component's pending
   * callback then reads getComputedStyle of an element it no longer has.
   * The chart is already off the page when it fires, nothing a reader can
   * see is affected, and the component exposes no dispose to cancel the
   * callback with. Only this exact message is excepted; any other uncaught
   * error still fails the run. */
  const CHART_TEARDOWN_ERROR = "Failed to execute 'getComputedStyle' on " +
    "'Window': parameter 1 is not of type 'Element'.";
  tab.on("pageerror", (err) => {
    if (err.message.includes(CHART_TEARDOWN_ERROR)) return;
    errors.push(`uncaught: ${err.message}`);
  });
  const labelFonts = watchLabelFonts(tab);
  tab.on("console", (msg) => {
    const diagnostic = `${msg.text()} ${msg.location().url}`.trim();
    if (msg.type() === "error" && !/favicon/i.test(diagnostic)) {
      errors.push(`console: ${diagnostic}`);
    }
  });
  const label = `ArcGIS data workspace (${viewport.name})`;
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(`http://127.0.0.1:${PORT}/overview.html`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    const CHART_HOSTS = ["#capacity-chart", "#watershed-chart", "#trend-chart",
      "#normal-chart", "#distribution-chart", "#spread-chart"];
    /* A real function, not a string. Playwright evaluates a string as an
       expression, so an arrow-function source text evaluates to a Function
       object -- which is truthy, so the wait returned at once and the next
       line read `undefined.lakePowellExcluded`. */
    await tab.waitForFunction(
      (expected) => window.__overviewReady?.charts === expected, CHART_HOSTS.length,
      { timeout: 120000 });
    const overviewReady = await tab.evaluate(() => window.__overviewReady);
    check(overviewReady.lakePowellExcluded === true,
      `${label}: readiness signal reports Lake Powell in scope`);
    check(await tab.locator("arcgis-chart").count() === CHART_HOSTS.length,
      `${label}: ${await tab.locator("arcgis-chart").count()} of ${CHART_HOSTS.length} charts rendered`);
    check(await tab.locator("arcgis-charts-action-bar").count() === 0,
      `${label}: an empty collapsible chart rail is still rendered`);
    const chartSettings = await tab.evaluate(() => {
      const row = document.querySelector(".chart-settings");
      const grid = document.querySelector(".overview-chart-grid");
      return {
        rows: document.querySelectorAll(".chart-settings").length,
        controls: row?.querySelectorAll("select").length ?? 0,
        insideFirstCard: document.querySelector(".overview-chart-grid .overview-card select") !== null,
        beforeCharts: Boolean(row && grid && (row.compareDocumentPosition(grid)
          & Node.DOCUMENT_POSITION_FOLLOWING)),
        copy: row?.textContent ?? ""
      };
    });
    check(chartSettings.rows === 1 && chartSettings.controls === 3,
      `${label}: chart display settings are not in one three-control row`);
    check(chartSettings.insideFirstCard === false && chartSettings.beforeCharts === true,
      `${label}: chart display settings still read as part of the first chart`);
    check(chartSettings.copy.includes("filters above change every chart")
      && chartSettings.copy.includes("Storage charts measure")
      && chartSettings.copy.includes("Largest reservoirs"),
    `${label}: chart setting scope is not explained`);

    const rankedChart = await tab.locator("#capacity-chart arcgis-chart").evaluate((chart) => ({
      sort: chart.model?.getSortOrder(),
      order: [...(chart.model?.orderByList ?? [])],
      source: chart.layer?.source?.toArray()
        ?.map((graphic) => graphic.attributes?.label) ?? []
    }));
    check(rankedChart.sort === "customSort",
      `${label}: the reservoir chart overrides the selected rank with ${rankedChart.sort}`);
    check(JSON.stringify(rankedChart.order) === JSON.stringify(rankedChart.source),
      `${label}: the reservoir chart did not preserve its selected rank`);
    for (const host of ["#capacity-chart", "#trend-chart", "#normal-chart",
      "#distribution-chart", "#spread-chart"]) {
      check(await tab.locator(`${host} arcgis-chart`).evaluate((chart) =>
        typeof chart.tooltipFormatter === "function"),
      `${label}: ${host} has no arranged pointer summary`);
    }

    /* The bar and box charts draw into SVG; the scatterplot and the
     * histogram draw into a canvas, which paints nothing at all in a
     * browser that is not compositing -- the same quirk that leaves the map
     * canvas blank in headless Chromium. So the drawn check applies to the
     * SVG charts, and the canvas ones are held to what they computed: the
     * SDK reports its own statistics on `arcgisDataProcessComplete`, which
     * is a stronger claim than "some pixels are lit" anyway. */
    const svgCharts = ["#capacity-chart", "#watershed-chart", "#trend-chart", "#spread-chart"];
    for (const host of svgCharts) {
      check(await tab.locator(`${host} arcgis-chart`).evaluate((chart) =>
        [...(chart.shadowRoot?.querySelectorAll("svg rect, svg path, svg circle") ?? [])]
          .some((node) => node.getBoundingClientRect().width > 3)),
      `${label}: ${host} drew no marks`);
    }
    const computed = await tab.evaluate(async (hosts) => {
      const out = {};
      await Promise.all(hosts.map((host) => new Promise((resolve) => {
        const chart = document.querySelector(`${host} arcgis-chart`);
        if (!chart) { out[host] = null; resolve(); return; }
        const done = setTimeout(() => { out[host] = out[host] ?? "no event"; resolve(); }, 20000);
        chart.addEventListener("arcgisDataProcessComplete", (event) => {
          out[host] = event.detail?.chartData ?? "empty";
          clearTimeout(done);
          resolve();
        }, { once: true });
        void chart.refresh();
      })));
      const trend = out["#trend-chart"];
      return {
        histogramBins: Array.isArray(out["#distribution-chart"]?.bins)
          ? out["#distribution-chart"].bins.length : 0,
        histogramMean: out["#distribution-chart"]?.mean ?? null,
        scatterPoints: Array.isArray(out["#normal-chart"]?.dataItems)
          ? out["#normal-chart"].dataItems.length : 0,
        /* The months the line is actually drawn from, in the order the SDK
           will draw them. Read here rather than off the axis: the tick
           labels are <p> elements scattered through a shadow tree with a
           hidden readout among them carrying the same text, so scraping
           them measured the tooltip as if it were a tick. */
        trendMonths: Array.isArray(trend?.dataItems)
          ? trend.dataItems.map((item) => item.month_label ?? item.x ?? null)
          : []
      };
    }, ["#distribution-chart", "#normal-chart", "#trend-chart"]);
    check(computed.histogramBins > 0,
      `${label}: the distribution chart computed no bins`);
    check(typeof computed.histogramMean === "number" && computed.histogramMean > 0,
      `${label}: the distribution chart computed no mean`);
    check(computed.scatterPoints > 0,
      `${label}: the storage-against-normal chart computed no points`);

    check(await tab.locator("#reservoir-rows tr").count() === expectedReservoirs,
      `${label}: table does not match the map scope`);
    check(!(await tab.locator("#reservoir-rows").innerText()).includes("Lake Powell"),
      `${label}: Lake Powell appears in the default overview table`);
    const overviewExport = tab.locator("#download-overview-csv");
    check(await overviewExport.count() === 1,
      `${label}: filtered overview has no CSV file control`);
    check(await overviewExport.evaluate((element) => {
      const target = element.shadowRoot?.querySelector("button");
      return Boolean(target && target.tabIndex >= 0 && !target.disabled);
    }),
      `${label}: filtered overview CSV file control is not keyboard reachable`);
    // A chart host that finished drawing must stop announcing itself busy.
    for (const host of CHART_HOSTS) {
      check(await tab.getAttribute(host, "aria-busy") === "false",
        `${label}: ${host} still reports itself as loading`);
    }
    for (const host of CHART_HOSTS) {
      check(await tab.locator(`${host} arcgis-chart`)
        .evaluate((chart) => Boolean(chart.aria?.label)),
      `${label}: ${host} has no accessible name`);
    }

    /* The month axis, which sorted alphabetically twice before it sorted by
     * time: first as month names, then as year-plus-abbreviation. The
     * labels are the payload's own month keys, so ascending text order is
     * chronological order -- and this asserts the order the line is drawn
     * in rather than the label format, because the format is only the
     * means. */
    check(computed.trendMonths.length > 1,
      `${label}: the trend chart drew no months`);
    check(computed.trendMonths.every((month) => /^\d{4}-\d{2}$/.test(String(month))),
      `${label}: the trend chart months are not month keys: ` +
      `${computed.trendMonths.join(", ")}`);
    check(JSON.stringify(computed.trendMonths)
      === JSON.stringify([...computed.trendMonths].sort()),
    `${label}: the trend chart months are out of order: ${computed.trendMonths.join(", ")}`);
    /* Twelve at most. Each reservoir carries twelve months, but a late
       reservoir's window is older, so the union across the set can span
       fifteen -- and this chart's title says "the last 12 months". */
    check(computed.trendMonths.length <= 12,
      `${label}: the trend chart draws ${computed.trendMonths.length} months ` +
      "under a twelve-month title");

    /* The scatter summary names its reservoir and drainage area. The SDK
       queries the scatter layer for numeric fields and the renderer's field
       only, so the drainage-area string never arrives in `dataContext`; the
       formatter has to find it another way. This hands the formatter what
       the SDK actually passes -- the plotted values and a context without
       `watershed` -- and expects the drainage area named anyway. */
    const scatterTooltip = await tab.locator("#normal-chart arcgis-chart")
      .evaluate((chart) => {
        const graphic = chart.layer?.source?.toArray()?.[0];
        if (!graphic || typeof chart.tooltipFormatter !== "function") return null;
        const point = graphic.attributes;
        return {
          expectedName: point.label,
          expectedArea: point.watershed,
          summary: chart.tooltipFormatter(
            point.normal_af, point.percent_of_normal, undefined, {
              ObjectID: point.ObjectID,
              normal_af: point.normal_af,
              percent_of_normal: point.percent_of_normal,
              storage_af: point.storage_af,
              label: point.label
            })
        };
      });
    check(Boolean(scatterTooltip?.summary?.includes(scatterTooltip.expectedName)),
      `${label}: the scatter summary does not name its reservoir`);
    check(Boolean(scatterTooltip?.summary?.includes(scatterTooltip.expectedArea))
      && !scatterTooltip?.summary?.includes("Not reported"),
    `${label}: the scatter summary does not name its drainage area ` +
      `(${scatterTooltip?.summary})`);
    await tab.locator("#reservoir-search").fill("Jordan");
    await tab.waitForFunction(
      (expected) => window.__overviewReady?.visible > 0
        && window.__overviewReady?.visible < expected, expectedReservoirs,
      { timeout: 60000 });
    const filtered = await tab.locator("#reservoir-rows tr").count();
    check(filtered > 0 && filtered < expectedReservoirs,
      `${label}: drainage-area search did not filter the table`);
    const [overviewDownload] = await Promise.all([
      tab.waitForEvent("download", { timeout: 5000 }),
      overviewExport.click()
    ]);
    const overviewCsv = await readFile(await overviewDownload.path(), "utf8");
    const overviewCsvRows = overviewCsv.trim().split(/\r?\n/);
    check(overviewCsvRows.length === filtered + 1,
      `${label}: filtered CSV file has ${overviewCsvRows.length - 1} rows, expected ${filtered}`);
    check(overviewCsvRows[0]?.startsWith("Reservoir,Drainage area,Full (percent)"),
      `${label}: filtered CSV file columns do not match the table`);

    /* The link. This page carried no URL state at all, so no view of it
     * could be handed to anybody -- and the more the six charts can say,
     * the more a view is worth sending. The assertion is the whole promise:
     * open the address the page produced, get the view back. */
    await tab.waitForFunction(() => window.location.search.includes("q="),
      null, { timeout: 30000 });
    const shared = await tab.evaluate(() => window.location.href);
    check(shared.includes("q=Jordan"),
      `${label}: the filtered view is not in the address (${shared})`);

    const recipient = await context.newPage();
    try {
      await recipient.goto(shared, { waitUntil: "domcontentloaded", timeout: 60000 });
      await recipient.waitForFunction((expected) =>
        window.__overviewReady?.charts === expected, CHART_HOSTS.length, { timeout: 120000 });
      const restored = await recipient.evaluate(() => ({
        rows: document.querySelectorAll("#reservoir-rows tr").length,
        query: document.querySelector("#reservoir-search")?.value ?? "",
        search: window.location.search
      }));
      check(restored.query === "Jordan",
        `${label}: a shared link did not restore the search (${restored.query})`);
      check(restored.rows === filtered,
        `${label}: a shared link restored ${restored.rows} rows, not ${filtered}`);
      /* Restoring must not rewrite the address. A link that changes the
         moment it is opened is a link that cannot be shared twice.
         `URL` is a string constant at the top of this file, so the query is
         taken off the href directly rather than parsed. */
      const sharedQuery = shared.slice(shared.indexOf("?"));
      check(restored.search === sharedQuery,
        `${label}: opening a shared link rewrote ${sharedQuery} to ${restored.search}`);
    } finally {
      await recipient.close();
    }

    /* The geographic filters, driven the way a reader drives them. These
     * controls shipped inert once -- present in the markup, missing from
     * the update() wiring -- and nothing here noticed, so every step waits
     * on a consequence the reader can see (rows, the address, the
     * readiness signal), never on the select's own value. */
    check(Boolean(filterState && filterSubregion),
      `${label}: no state and subregion in the payload narrow the scope`);
    if (filterState && filterSubregion) {
      await tab.locator("#reset-filters").click();
      await tab.waitForFunction((expected) => window.__overviewReady?.visible === expected,
        expectedReservoirs, { timeout: 60000 });

      // Picking a state narrows the table and writes the address, on its own.
      await tab.selectOption("#state-filter", filterState.code);
      await tab.waitForFunction((expected) => window.__overviewReady?.visible === expected,
        filterState.count, { timeout: 60000 });
      check((await tab.evaluate(() => window.location.search))
        .includes(`state=${filterState.code}`),
      `${label}: the state choice is not in the address`);

      // The subregion list is repopulated from what the state leaves.
      const offeredSubregions = await tab.evaluate(() =>
        [...document.querySelectorAll("#subregion-filter option")]
          .map((option) => option.value));
      check(offeredSubregions[0] === "all"
        && JSON.stringify(offeredSubregions.slice(1))
          === JSON.stringify(expectedStateSubregions),
      `${label}: the subregion list is not what the state leaves ` +
        `(${offeredSubregions.join(",")} vs all,${expectedStateSubregions.join(",")})`);

      // Picking a subregion narrows further and survives its own repopulation.
      await tab.selectOption("#subregion-filter", filterSubregion.code);
      await tab.waitForFunction((expected) =>
        window.__overviewReady?.visible === expected
        && window.location.search.includes("huc4="),
      filterSubregion.count, { timeout: 60000 });
      check(await tab.locator("#subregion-filter").inputValue() === filterSubregion.code,
        `${label}: the subregion choice did not survive its own repopulation`);

      // A keystroke in the search box must not reset the geographic choices.
      await tab.locator("#reservoir-search").fill("zzz-no-such-reservoir");
      await tab.waitForFunction(() => window.__overviewReady?.visible === 0,
        null, { timeout: 60000 });
      const kept = await tab.evaluate(() => ({
        state: document.querySelector("#state-filter")?.value,
        subregion: document.querySelector("#subregion-filter")?.value
      }));
      check(kept.state === filterState.code && kept.subregion === filterSubregion.code,
        `${label}: a keystroke reset the geographic filters ` +
        `(${kept.state}, ${kept.subregion})`);

      /* A shared link carrying the state and the subregion restores both --
       * the subregion needs its options to exist before the restore runs,
       * which a link is the only way to exercise. */
      const geoLink = `${URL}overview.html` +
        `?state=${filterState.code}&huc4=${filterSubregion.code}`;
      const geoRecipient = await context.newPage();
      try {
        await geoRecipient.goto(geoLink,
          { waitUntil: "domcontentloaded", timeout: 60000 });
        await geoRecipient.waitForFunction((expected) =>
          window.__overviewReady?.charts === expected, CHART_HOSTS.length,
        { timeout: 120000 });
        const restored = await geoRecipient.evaluate(() => ({
          state: document.querySelector("#state-filter")?.value,
          subregion: document.querySelector("#subregion-filter")?.value,
          rows: document.querySelectorAll("#reservoir-rows tr").length
        }));
        check(restored.state === filterState.code
          && restored.subregion === filterSubregion.code,
        `${label}: a shared link restored (${restored.state}, ${restored.subregion}), ` +
          `not (${filterState.code}, ${filterSubregion.code})`);
        check(restored.rows === filterSubregion.count,
          `${label}: a shared geographic link restored ${restored.rows} rows, ` +
          `not ${filterSubregion.count}`);
      } finally {
        await geoRecipient.close();
      }

      // The county axis, offered exactly when the payload carries counties.
      await tab.locator("#reset-filters").click();
      await tab.waitForFunction((expected) => window.__overviewReady?.visible === expected,
        expectedReservoirs, { timeout: 60000 });
      if (filterCounty) {
        check(await tab.evaluate(() =>
          document.querySelector("#county-field")?.hidden) === false,
        `${label}: the payload carries counties and the county control is hidden`);
        await tab.selectOption("#county-filter", filterCounty.code);
        await tab.waitForFunction((expected) => window.__overviewReady?.visible === expected,
          filterCounty.count, { timeout: 60000 });
        await tab.locator("#reset-filters").click();
        await tab.waitForFunction((expected) => window.__overviewReady?.visible === expected,
          expectedReservoirs, { timeout: 60000 });
      }

      /* Lake Mead's own control (ADR-062): excluded by default and reported
       * so, and when a reader lets it in, the page has to say so in the one
       * sentence it states its scope with -- 28 million acre-feet entering
       * every total is not a footnote. Lake Powell's toggle stays off, so
       * this drives exactly one of the two independent controls. */
      check((await tab.evaluate(() => window.__overviewReady?.lakeMeadExcluded)) === true,
        `${label}: readiness signal does not report Lake Mead excluded by default`);
      await tab.selectOption("#geography-filter", "connected");
      await tab.locator("#lake-mead-toggle").check();
      await tab.waitForFunction((expected) =>
        window.__overviewReady?.visible === expected
        && window.__overviewReady?.lakeMeadExcluded === false,
      expectedConnectedWithMead, { timeout: 60000 });
      const meadStatus = await tab.locator("#filter-status").innerText();
      check(meadStatus.includes("Lake Powell excluded")
        && meadStatus.includes("Lake Mead included"),
      `${label}: the status line does not state both dominant controls (${meadStatus})`);
      if (lakeMeadRow) {
        check((await tab.locator("#reservoir-rows").innerText()).includes(lakeMeadRow.name),
          `${label}: Lake Mead is toggled in and absent from the table`);
      }
      check((await tab.evaluate(() => window.location.search)).includes("mead=include"),
        `${label}: the Lake Mead choice is not in the address`);

      // Leave the page as the reader first found it.
      await tab.locator("#reset-filters").click();
      await tab.waitForFunction((expected) => window.__overviewReady?.visible === expected,
        expectedReservoirs, { timeout: 60000 });
    }
    const layout = await tab.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      nav: document.querySelector(".overview-nav")?.getBoundingClientRect().toJSON(),
      chart: document.querySelector("#capacity-chart")?.getBoundingClientRect().toJSON()
    }));
    check(layout.scroll <= layout.viewport + 1,
      `${label}: page overflows horizontally (${layout.scroll}px in ${layout.viewport}px)`);
    check(layout.nav?.left >= 0 && layout.nav?.right <= layout.viewport + 1,
      `${label}: navigation is clipped`);

    /* Only primary ArcGIS surfaces belong in this page's flow. The former
     * paths remain compatibility URLs, but a comparison card here would
     * still present retired implementations as equal product choices. */
    const promotedComparisons = await tab.locator(
      'a[href="./legacy/"], a[href="./maplibre/"], a[href="./explore.html"]'
    ).count();
    check(promotedComparisons === 0,
      `${label}: the overview promotes ${promotedComparisons} comparison-page links`);
    const navLinks = {
      "theme-toggle": null,
      // The header's own links swap for the menu below 64rem, so only
      // whichever is actually showing at this width is measured.
      ...(viewport.width >= 1024
        ? { "map-link": "./", "snow-link": "./snow.html", "drought-link": "./drought.html", "methods-link": "./methods.html" }
        : { "page-menu-trigger": null })
    };
    const navControls = await tab.evaluate((ids) => ids.map((id) => {
      const element = document.getElementById(id);
      const box = element?.getBoundingClientRect();
      return {
        id,
        href: element?.getAttribute("href") ?? null,
        left: box ? Math.round(box.left) : null,
        right: box ? Math.round(box.right) : null,
        width: box ? Math.round(box.width) : 0
      };
    }), Object.keys(navLinks));
    for (const control of navControls) {
      check(control.width > 0, `${label}: the ${control.id} control has no size`);
      check(control.left !== null && control.left >= -1 &&
        control.right !== null && control.right <= layout.viewport + 1,
      `${label}: the ${control.id} control sits at ${control.left}-${control.right}, ` +
      `outside the ${layout.viewport}px viewport`);
      const expected = navLinks[control.id];
      if (expected !== null) {
        check(control.href === expected,
          `${label}: the ${control.id} control points at ${control.href}, not ${expected}`);
      }
    }
    check(layout.chart?.left >= 0 && layout.chart?.right <= layout.viewport + 1,
      `${label}: chart card is clipped`);
    /* Last, on a settled page: every control is wired, every table is
     * filled, and the shadow roots have rendered their real controls. */
    await checkAccessibility(tab, check, label);
    await tab.screenshot({ path: `screenshots/overview-${viewport.name}.png`, fullPage: false });
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
  }
  for (const err of errors) failures.push(`${label}: ${err}`);
  await context.close();
}

/* The public data reference is a build entry, not part of the map runtime.
 * Its readiness counts protect against a page that paints the shared shell
 * but silently loses one file or a section of field documentation. */
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport });
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
  const labelFonts = watchLabelFonts(tab);
  tab.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  const label = `Public data reference (${viewport.name} ${viewport.width}px)`;
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(`${URL}data.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction(() => window.__dataDocsReady !== undefined, { timeout: 60000 });
    const state = await tab.evaluate(() => ({
      ready: window.__dataDocsReady,
      files: document.querySelectorAll(".api-file").length,
      groups: document.querySelectorAll(".api-field-group").length,
      links: [...document.querySelectorAll(".api-file a")]
        .map((link) => link.getAttribute("href")),
      text: document.querySelector("#access")?.textContent ?? "",
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth
    }));
    console.log("  ready:", JSON.stringify(state.ready));
    check(state.ready?.files === 4 && state.files === 4,
      `${label}: rendered ${state.files} file cards, readiness reported ${state.ready?.files}`);
    check(state.ready?.groups === state.groups && state.groups >= 20,
      `${label}: rendered ${state.groups} field groups, readiness reported ${state.ready?.groups}`);
    check(JSON.stringify(state.links) === JSON.stringify([
      "./api/reservoirs.json", "./",
      "./api/snowpack.json", "./snow.html",
      "./data/drought/usdm-huc6.json", "./drought.html",
      "./data/drought/usdm-current.geojson",
      // The same week over larger areas, published because the reader can
      // choose the level (ADR-064). Named on the page rather than left to be
      // guessed at from the other file's name.
      "./data/drought/usdm-huc4.json",
      "./api/reference.json"
    ]), `${label}: file card links are ${JSON.stringify(state.links)}`);
    check(state.text.includes("Access-Control-Allow-Origin: *"),
      `${label}: cross-origin browser access is not disclosed`);
    check(state.text.includes("10 minutes") && state.text.includes("no uptime guarantee"),
      `${label}: cache or availability terms are missing`);
    check(state.scroll <= state.viewport + 1,
      `${label}: page overflows horizontally (${state.scroll}px in ${state.viewport}px)`);
    /* Last, on a settled page: every control is wired, every table is
     * filled, and the shadow roots have rendered their real controls. */
    await checkAccessibility(tab, check, label);
    await tab.screenshot({ path: `screenshots/data-${viewport.name}.png`, fullPage: false });
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
  }
  for (const err of errors) failures.push(`${label}: ${err}`);
  await context.close();
}


/*
 * The parity every view map is held to against the storage map.
 *
 * Three maps of the same fourteen drainage areas that each open at a
 * different box, carry a different control set, or let a reader pan to a
 * different place are three maps a reader cannot flip between. Each fact is
 * measured rather than assumed -- the framing especially, because it depends
 * on the shape of the card, and the last time it was written as a zoom the
 * component snapped it to an integer and the region spanned a continent.
 */
async function checkViewMapParity(tab, check, label, hostId, cardId, layerIds) {
  const frame = await tab.evaluate(({ hostId, cardId }) => {
    const element = document.querySelector("#" + hostId + " arcgis-map");
    const view = element?.view;
    if (!view?.ready) return null;
    const host = document.querySelector("#" + hostId).getBoundingClientRect();
    return {
      controls: [...element.children].map((child) => child.tagName.toLowerCase()),
      layers: view.map.layers.map((layer) => layer.id).toArray(),
      bounded: Boolean(view.constraints.geometry),
      minZoom: view.constraints.effectiveMinZoom,
      scale: Math.round(view.scale),
      card: Boolean(document.querySelector("#" + cardId)),
      /* The card is placed inside the host, so the host has to be the box
       * it is positioned against. A static host would put every card at the
       * top left of the page instead. */
      hostPositioned: getComputedStyle(document.querySelector("#" + hostId))
        .position === "relative",
      controlsInside: [...element.querySelectorAll(
        "arcgis-zoom,arcgis-home,arcgis-fullscreen,arcgis-scale-bar")]
        .every((control) => {
          const box = control.getBoundingClientRect();
          return box.right <= host.right + 1 && box.left >= host.left - 1
            && box.bottom <= host.bottom + 1;
        })
    };
  }, { hostId, cardId });
  check(frame !== null, `${label}: ${hostId} has no ready view to measure`);
  if (!frame) return;
  /* Navigation on the right edge, appearance on the left, and no locate.
   * The storage map's six-control stack measures about 240px, which a
   * full-viewport map holds down its edge and a 416px card mostly cannot,
   * so these cards split it: zoom, home and compass -- what a lost reader
   * reaches for -- stay top-right, and the basemap expand and fullscreen
   * take the otherwise-empty top-left, above the legend's corner. Locate
   * is gone on purpose: the view is constrained to the region, so for any
   * reader outside it the control is an error with a button on it. The
   * compass is there because rotation is not disabled, so a reader can
   * turn the map and needs a way back to north. */
  check(frame.controls.join(",") ===
    "arcgis-zoom,arcgis-home,arcgis-compass,arcgis-expand," +
    "arcgis-fullscreen,arcgis-scale-bar",
  `${label}: ${hostId} carries ${frame.controls.join(",")}`);
  check(frame.controlsInside,
    `${label}: a map control on ${hostId} sits outside the card`);
  /* The expected list is what this project draws, in order. The basemap's
   * own reference layer is sunk to the bottom of the same stack (see
   * `arcgis/basemap-reference.ts`), so it is stripped before comparing --
   * checking it is there at all is a separate assertion below, and folding
   * the two together would let either one go missing unnoticed. */
  /* A basemap's reference layers are either sunk below this project's data
   * or removed outright, and which one is right depends on the map: the
   * drought map draws and labels states and counties itself, so a sunk copy
   * there is a buried duplicate of its own names rather than context. What
   * must never happen is one of them left drawing *above* the data, so the
   * check is that none is in the operational stack after our own layers. */
  const ownLayers = frame.layers.filter((id) => !/-reference-layer$/.test(id));
  const strayIndex = frame.layers.findIndex((id) => /-reference-layer$/.test(id));
  check(strayIndex === -1 || strayIndex === 0,
    `${label}: ${hostId} draws a basemap reference layer at position ` +
    `${strayIndex}, which is above its own data`);
  check(ownLayers.join(",") === layerIds.join(","),
    `${label}: ${hostId} draws ${ownLayers.join(",")}, expected ${layerIds.join(",")}`);
  check(frame.bounded && frame.minZoom === 5,
    `${label}: ${hostId} navigation bounds ${frame.bounded}, minimum zoom ${frame.minZoom}`);
  /* The storage map opens near 1:10,700,000. A card is a different shape,
   * so this is a band rather than a number -- but a view that has fallen
   * out to the minimum zoom, which is what an unframed short card does,
   * lands at 1:18,000,000 and fails it. */
  check(frame.scale > 3000000 && frame.scale < 16000000,
    `${label}: ${hostId} opens at 1:${frame.scale}, outside the storage map's band`);
  check(frame.card && frame.hostPositioned,
    `${label}: ${hostId} hover card ${frame.card}, host positioned ${frame.hostPositioned}`);
}

/*
 * One hover on a view map, driven the way the storage map's is.
 *
 * `hitTest` is settled by the render loop, so it is stubbed here rather than
 * pointed at a real feature: what is being proved is that a pointer move
 * reaches the shared hover module, that the module limits the test to the
 * map's own layers, and that the card it builds describes what was under
 * the pointer and stays inside the map it belongs to.
 */
async function checkViewMapHover(tab, check, label, hostId, cardId, layerId, expected) {
  await tab.evaluate(async ({ hostId, cardId, layerId }) => {
    const element = document.querySelector("#" + hostId + " arcgis-map");
    /* Put the card back to "nothing hovered" first.
     *
     * The wait below is for the card to become visible, and a card left
     * open by the previous hover is already visible -- so without this the
     * wait returns at once and the assertion reads the last hover's text.
     * It passed for as long as every resolve settled within a microtask,
     * and stopped passing the moment one of these layers had to ask a
     * server for the attributes to hover over. */
    const previous = document.querySelector("#" + cardId);
    if (previous) previous.hidden = true;
    const layer = element.view.map.findLayerById(layerId);
    /* Three kinds of layer answer this differently. A client-side feature
     * layer holds its features in `source`, a graphics layer in `graphics`,
     * and a hosted layer's features are on a server, so the attributes have
     * to be asked for. The hosted case is detected by capability rather
     * than by absence: once a hosted layer has loaded, `source` is the
     * SDK's internal source object -- truthy, and not a collection -- so
     * "is there a collection with features in it" is the only test that
     * answers the same before and after load. `queryFeatures` answers from
     * the layer rather than from a view, so it settles here where the
     * render loop does not run. */
    const source = layer.type === "feature" ? layer.source : layer.graphics;
    const first = typeof source?.at === "function" ? source.at(0) : null;
    const attributes = first
      ? first.attributes
      : (await layer.queryFeatures({
          where: layer.definitionExpression || "1=1",
          outFields: ["*"],
          num: 1,
          returnGeometry: false
        })).features[0]?.attributes;
    const graphic = { attributes, layer };
    element.hitTest = async (_point, options) => {
      const included = options?.include;
      window.__viewMapHitIncluded = Array.isArray(included)
        ? included.includes(layer)
        : included === layer;
      return { results: [{ type: "graphic", layer, graphic }] };
    };
    element.dispatchEvent(new CustomEvent("arcgisViewPointerMove",
      { detail: { x: 220, y: 140 } }));
  }, { hostId, cardId, layerId });
  await tab.waitForFunction(
    (cardId) => document.querySelector("#" + cardId)?.hidden === false,
    cardId, { timeout: 10000 });
  const hover = await tab.evaluate(({ hostId, cardId }) => {
    const host = document.querySelector("#" + hostId).getBoundingClientRect();
    const card = document.querySelector("#" + cardId);
    const box = card.getBoundingClientRect();
    return {
      text: card.innerText.trim(),
      lines: card.querySelectorAll("span").length,
      included: window.__viewMapHitIncluded,
      inside: box.left >= host.left && box.top >= host.top
        && box.right <= host.right && box.bottom <= host.bottom
    };
  }, { hostId, cardId });
  check(hover.included === true,
    `${label}: the ${hostId} hit test was not limited to the map's own layers`);
  check(hover.text.includes(expected),
    `${label}: the ${layerId} card reads ${JSON.stringify(hover.text)}`);
  check(hover.lines > 0, `${label}: the ${layerId} card has no detail lines`);
  check(hover.inside, `${label}: the ${layerId} card extends outside the map`);
}

/* The snowpack view (ADR-021). Loaded through a drainage-area deep link so
 * the shared `?area=` vocabulary is proven, then switched to the whole
 * region. The readiness counts protect against a page that paints the shell
 * and draws no snow at all; the curve check is consistency, not presence,
 * because in the first days of October no day has met the reporting floor
 * yet and an empty chart with an explanation is the correct page. */
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport });
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
  const labelFonts = watchLabelFonts(tab);
  tab.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  const label = `Snowpack view (${viewport.name} ${viewport.width}px)`;
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(`${URL}snow.html?area=140100`, {
      waitUntil: "domcontentloaded", timeout: 60000
    });
    await tab.waitForFunction(() => window.__snowReady !== undefined, { timeout: 60000 });
    const linked = await tab.evaluate(() => ({
      ready: window.__snowReady,
      tableRows: document.querySelectorAll("#snow-site-rows tr").length,
      areaControl: document.querySelector("#snow-area")?.value
    }));
    console.log("  ready:", JSON.stringify(linked.ready));
    check(linked.ready?.area === "140100" && linked.areaControl === "140100",
      `${label}: the shared link restored area ${linked.ready?.area}, control ${linked.areaControl}`);
    check(linked.tableRows === linked.ready?.tableRows && linked.tableRows > 0,
      `${label}: ${linked.tableRows} site rows rendered, readiness reported ${linked.ready?.tableRows}`);
    check(linked.tableRows < linked.ready?.sites,
      `${label}: a narrowed view shows ${linked.tableRows} of ${linked.ready?.sites} sites`);

    await tab.selectOption("#snow-area", "all");
    await tab.waitForFunction(
      () => window.__snowReady && window.__snowReady.area === null, { timeout: 10000 });
    const state = await tab.evaluate(() => ({
      ready: window.__snowReady,
      tableRows: document.querySelectorAll("#snow-site-rows tr").length,
      monthRows: document.querySelectorAll("#snow-month-rows tr").length,
      curveDrawn: Boolean(document.querySelector("#snow-curve-host svg")),
      search: window.location.search,
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth
    }));
    check(state.tableRows === state.ready?.sites && state.tableRows > 0,
      `${label}: the whole region renders ${state.tableRows} of ${state.ready?.sites} sites`);
    check(state.curveDrawn === (state.ready?.curvePoints > 0),
      `${label}: curve drawn ${state.curveDrawn}, readiness holds ${state.ready?.curvePoints} points`);
    check(state.ready?.curvePoints === 0 || state.monthRows > 0,
      `${label}: a drawn curve published no month table rows`);
    check(!state.search.includes("area="),
      `${label}: the whole region still carries ${state.search}`);
    check(state.scroll <= state.viewport + 1,
      `${label}: page overflows horizontally (${state.scroll}px in ${state.viewport}px)`);

    /* The map half. Its readiness fields arrive after the figures, so this
     * is a second wait; the counts prove the choropleth and the sites were
     * actually built, which a blank-canvas screenshot cannot. */
    await tab.waitForFunction(
      () => window.__snowReady && window.__snowReady.mapDay !== undefined,
      { timeout: 60000 });
    const mapState = await tab.evaluate(() => ({
      ready: window.__snowReady,
      slider: Boolean(document.querySelector("#snow-day")),
      legendItems: document.querySelectorAll(".snow-map-legend .drought-legend-item").length
    }));
    console.log("  map:", JSON.stringify({
      basins: mapState.ready?.mapBasins,
      sites: mapState.ready?.mapSites,
      withValues: mapState.ready?.mapBasinsWithValues,
      day: mapState.ready?.mapDay,
      basemap: mapState.ready?.mapBasemap
    }));
    check(mapState.ready?.mapBasins === mapState.ready?.basins,
      `${label}: the map drew ${mapState.ready?.mapBasins} basins of ${mapState.ready?.basins}`);
    check(mapState.ready?.mapSites === mapState.ready?.sites,
      `${label}: the map drew ${mapState.ready?.mapSites} sites of ${mapState.ready?.sites}`);
    check(mapState.ready?.mapBasinsWithValues > 0 && mapState.ready?.mapSitesWithValues > 0,
      `${label}: the shown day coloured ${mapState.ready?.mapBasinsWithValues} basins ` +
      `and ${mapState.ready?.mapSitesWithValues} sites`);
    check(typeof mapState.ready?.mapDay === "string",
      `${label}: the map has no shown day`);
    /* One chip per class, plus one for a day with no fair value. Read from
     * the table the page publishes rather than written here: this assertion
     * was a hardcoded 6 and it broke the moment the table gained a class,
     * which is a test measuring itself rather than the page. */
    const expectedChips = (mapState.ready?.mapClasses ?? 0) + 1;
    check(mapState.slider && mapState.legendItems === expectedChips,
      `${label}: day control ${mapState.slider}, legend ${mapState.legendItems} ` +
      `chips for ${mapState.ready?.mapClasses} classes plus no-value`);
    /* The reservoirs are deliberately absent here. This map already carries
     * fourteen filled basins and 217 site markers; the same points that are
     * useful context on the drought map buried the readings on this one. */
    await checkViewMapParity(tab, check, label, "snow-map-host", "snow-map-hover",
      ["snow-basins", "snow-sites"]);
    /* Two layers, two cards, one check each: the resolver walks the hits in
     * layer order, so a mistake there shows up as one kind of feature
     * answering with another kind of description. */
    await checkViewMapHover(tab, check, label, "snow-map-host", "snow-map-hover",
      "snow-basins", "of normal");
    await checkViewMapHover(tab, check, label, "snow-map-host", "snow-map-hover",
      "snow-sites", "of normal");

    /* One site's season. Chosen through the picker the way a reader would;
     * the drawn-point count is what proves a curve, not a prompt, is on
     * screen, and the address bar has to carry the choice. */
    const firstStation = await tab.evaluate(() =>
      document.querySelector("#snow-site optgroup option")?.getAttribute("value") ?? null);
    check(typeof firstStation === "string" && firstStation.length > 0,
      `${label}: the site picker offers no sites`);
    await tab.selectOption("#snow-site", firstStation);
    await tab.waitForFunction(
      () => window.__snowReady && window.__snowReady.site !== null, { timeout: 10000 });
    const siteState = await tab.evaluate(() => ({
      ready: window.__snowReady,
      chart: Boolean(document.querySelector("#snow-site-detail svg")),
      normalLine: Boolean(document.querySelector("#snow-site-detail .site-curve-normal")),
      monthRows: document.querySelectorAll("#snow-site-detail tbody tr").length,
      search: window.location.search,
      nameButtons: document.querySelectorAll(".site-name-button").length
    }));
    check(siteState.ready?.site === firstStation,
      `${label}: readiness reports site ${siteState.ready?.site}`);
    check(siteState.chart && siteState.ready?.siteCurvePoints > 0,
      `${label}: the site curve drew ${siteState.ready?.siteCurvePoints} points`);
    check(siteState.normalLine,
      `${label}: the site curve has no normal line to compare against`);
    check(siteState.monthRows > 0,
      `${label}: the site card published no month table rows`);
    check(siteState.search.includes("site="),
      `${label}: the chosen site is not in the address bar (${siteState.search})`);
    check(siteState.nameButtons === siteState.ready?.tableRows,
      `${label}: ${siteState.nameButtons} site name buttons for ${siteState.ready?.tableRows} rows`);
    /* Last, on a settled page: every control is wired, every table is
     * filled, and the shadow roots have rendered their real controls. */
    checkLabelFonts(check, label, labelFonts);
    await checkAccessibility(tab, check, label);
    await tab.screenshot({ path: `screenshots/snow-${viewport.name}.png`, fullPage: false });
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
  }
  for (const err of errors) failures.push(`${label}: ${err}`);
  await context.close();
}

/* The drought view. The readiness counts protect against a page that paints
 * the shell and renders no drainage areas; the storage join is asserted
 * separately because it is allowed to fail without failing the page, and a
 * silent join failure would quietly remove the page's whole point. */
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport });
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
  const labelFonts = watchLabelFonts(tab);
  tab.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  const label = `Drought view (${viewport.name} ${viewport.width}px)`;
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(`${URL}drought.html`, {
      waitUntil: "domcontentloaded", timeout: 60000
    });
    await tab.waitForFunction(() => window.__droughtReady !== undefined, { timeout: 60000 });
    const state = await tab.evaluate(() => ({
      ready: window.__droughtReady,
      rows: document.querySelectorAll(".drought-row").length,
      bars: document.querySelectorAll(".drought-bar").length,
      tableRows: document.querySelectorAll("#drought-table-rows tr").length,
      legendItems: document.querySelectorAll(".drought-legend-item").length,
      gapRows: document.querySelectorAll(".drought-gap-row").length,
      severityBars: document.querySelectorAll(".drought-severity-bar").length,
      /* Every row and every bar carries its own sentence. A chart whose
       * marks a screen reader cannot read is half a chart on this page. */
      gapTitles: document.querySelectorAll(".drought-gap-row > title").length,
      severityTitles: document.querySelectorAll(".drought-severity-bar > title").length,
      /* The label lane is fixed, so a long drainage-area name can start left
       * of the canvas and lose its first word -- which is what 140 units of
       * padding did to "Escalante Desert-Sevier Lake". */
      clippedNames: [...document.querySelectorAll(".drought-gap-name")]
        .filter((node) => node.getBBox().x < 0).length,
      areaLinks: [...document.querySelectorAll(".drought-row-links a")]
        .map((link) => link.getAttribute("href")),
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth
    }));
    console.log("  ready:", JSON.stringify(state.ready));
    check(state.ready?.units > 0 && state.rows === state.ready?.rows,
      `${label}: rendered ${state.rows} area rows, readiness reported ${state.ready?.rows}`);
    check(state.bars === state.rows && state.tableRows === state.rows,
      `${label}: ${state.bars} bars and ${state.tableRows} table rows for ${state.rows} areas`);
    check(expectedStorageJoined > 0
      && state.ready?.storageJoined === expectedStorageJoined,
      `${label}: storage joined ${state.ready?.storageJoined} areas, expected `
      + `${expectedStorageJoined} of ${state.ready?.units} drawn`);
    const badLink = state.areaLinks.find((href) =>
      !/^\.\/(snow\.html)?\?area=\d{6}$/.test(href));
    check(state.areaLinks.length === state.rows * 2 && badLink === undefined,
      `${label}: cross links are malformed (${badLink ?? "count " + state.areaLinks.length})`);

    /* The two charts that rank and count the areas.
     *
     * They answer different questions over different sets, which is why the
     * counts are checked separately rather than against each other: the
     * ranked comparison covers the areas that have a reservoir reading, and
     * the severity distribution covers every published area. */
    check(state.gapRows === state.ready?.gapRows && state.gapRows > 0,
      `${label}: drew ${state.gapRows} ranked rows, readiness reported ` +
      `${state.ready?.gapRows}`);
    check(state.ready?.severityAreas === state.ready?.units,
      `${label}: the severity chart accounted for ${state.ready?.severityAreas} ` +
      `of ${state.ready?.units} areas`);
    /* Every published class plus the no-drought bucket, whether or not any
     * area is at it -- a chart with different bars each week cannot be
     * compared with last week's. */
    check(state.severityBars === 6,
      `${label}: the severity chart drew ${state.severityBars} levels, expected 6`);
    check(state.gapTitles === state.gapRows
      && state.severityTitles === state.severityBars,
    `${label}: ${state.gapTitles}/${state.gapRows} ranked rows and ` +
    `${state.severityTitles}/${state.severityBars} severity bars carry a description`);
    check(state.clippedNames === 0,
      `${label}: ${state.clippedNames} drainage-area names are cut off by the chart edge`);
    check(state.scroll <= state.viewport + 1,
      `${label}: page overflows horizontally (${state.scroll}px in ${state.viewport}px)`);

    /* The map half: the weekly polygons in the monitor's palette under the
     * drainage outlines. Counted, because a blank canvas screenshots fine. */
    await tab.waitForFunction(
      () => window.__droughtReady && window.__droughtReady.mapClassesDrawn !== undefined,
      { timeout: 60000 });
    const mapState = await tab.evaluate(() => ({ ready: window.__droughtReady }));
    console.log("  map:", JSON.stringify({
      classes: mapState.ready?.mapClassesDrawn,
      outlines: mapState.ready?.mapOutlines,
      basemap: mapState.ready?.mapBasemap
    }));
    check(mapState.ready?.mapClassesDrawn > 0 && mapState.ready?.mapClassesDrawn <= 5,
      `${label}: the map drew ${mapState.ready?.mapClassesDrawn} drought classes`);
    check(mapState.ready?.mapOutlines === mapState.ready?.units,
      `${label}: ${mapState.ready?.mapOutlines} outlines for ${mapState.ready?.units} areas`);
    check(mapState.ready?.mapAreaLabels === mapState.ready?.units,
      `${label}: ${mapState.ready?.mapAreaLabels} names for ` +
      `${mapState.ready?.units} drainage areas`);
    check(mapState.ready?.mapAreaLabelsDeconflicted === true,
      `${label}: the drainage names are not being placed by the label engine`);
    check(mapState.ready?.mapReservoirs > 0,
      `${label}: the drought map placed ${mapState.ready?.mapReservoirs} reservoirs`);
    /* The key now lives on the map rather than above it, so it is attached
     * once the component has claimed the host -- checked here rather than
     * with the figures, which is where it used to be. It is attached on the
     * failure path too, because a key still describes the bars below. */
    const legend = await tab.evaluate(() => {
      const host = document.querySelector("#drought-map-host")?.getBoundingClientRect();
      const inset = document.querySelector(".map-inset-legend");
      const box = inset?.getBoundingClientRect();
      return {
        items: document.querySelectorAll(".drought-legend-item").length,
        /* Whether it is *actually* over the map, not whether it carries the
         * class: below 42rem the same element is deliberately laid out under
         * the map instead, because a card that short would lose a third of
         * itself to a key sitting on it. */
        inset: Boolean(inset) && getComputedStyle(inset).position === "absolute",
        insideMap: box && host
          ? box.left >= host.left - 1 && box.right <= host.right + 1
            && box.top >= host.top - 1 && box.bottom <= host.bottom + 1
          : null,
        /* The right of the map is the zoom control's lane, the same rule the
         * title card follows on the storage map. */
        clearsControls: box && host ? box.right <= host.right - 40 : null
      };
    });
    check(legend.items === 6,
      `${label}: the legend shows ${legend.items} classes, expected 6`);
    if (legend.inset) {
      check(legend.insideMap === true,
        `${label}: the inset legend is not inside the map it explains`);
      check(legend.clearsControls === true,
        `${label}: the inset legend reaches into the map control lane`);
    }
    check(mapState.ready?.mapReservoirLabels === true,
      `${label}: the drought map drew reservoirs without their names`);

    /* The hosted boundaries are optional, so the layer list is checked
     * against what actually loaded rather than against a fixed list -- a
     * refused state service is a supported outcome, and a test that failed
     * on it would be testing Esri's uptime. */
    /* On this map the borrowed geography draws *above* the classes, because
     * the classes are continuous (ADR-061) -- so the states and counties come
     * late in the layer list here and early on the maps whose subject is a
     * point. Their labels are unaffected either way: the SDK paints those
     * above every layer whatever the operational order. */
    const boundaryLayers = [
      ...(mapState.ready?.mapStateBoundaries ? ["reference-states"] : []),
      ...(mapState.ready?.mapCountyBoundaries ? ["reference-counties"] : [])
    ];
    console.log("  boundaries:", JSON.stringify({
      states: mapState.ready?.mapStateBoundaries,
      counties: mapState.ready?.mapCountyBoundaries
    }));
    await checkViewMapParity(tab, check, label, "drought-map-host", "drought-map-hover",
      /* No terrain, and the borrowed boundaries above the classes rather
       * than beneath them (ADR-061). Drought classes are a continuous
       * surface: they tile the region with no gaps, so a line over them
       * always has fill on both sides and partitions the subject instead of
       * hiding it. That is why this order is safe here and why the storage
       * and snow maps, whose subject is a point, keep theirs sunk -- a line
       * across a point occludes it, which is the Flaming Gorge failure
       * ADR-042 was written from. */
      /* The boundary is cased: a wide bright pass under a narrow dark one,
       * so the outline reads on the palest class and on the darkest. They
       * are two layers over one service because a casing has to be down
       * before any core is drawn, and one layer cannot order that across
       * features -- a neighbour's casing would paint over a shared edge.
       * The names ride the core layer's label pass (ADR-047). */
      ["usdm-classes", "drainage-outline-casing", "drainage-outlines",
        ...boundaryLayers, "reservoir-reference"]);
    /* The label ladder: at the opening view the states and the drainage areas
     * are named and the reservoirs are not, which is the whole point of the
     * thresholds -- the drainage areas are this map's subject and the
     * reservoirs are reference points with a map of their own. The counties
     * are not even fetched yet. */
    const ladder = await tab.evaluate(() => {
      const view = document.querySelector("#drought-map-host arcgis-map").view;
      const at = (id) => {
        const layer = view.map.findLayerById(id);
        if (!layer) return null;
        const info = layer.labelingInfo?.[0];
        return {
          layerHidden: (layer.minScale > 0 && view.scale > layer.minScale),
          labelsOn: Boolean(info)
            && (info.minScale === 0 || view.scale <= info.minScale)
            && (info.maxScale === 0 || view.scale >= info.maxScale),
          size: info?.symbol?.font?.size ?? null
        };
      };
      return {
        scale: Math.round(view.scale),
        areaNames: at("drainage-outlines"),
        states: at("reference-states"),
        counties: at("reference-counties"),
        reservoirs: at("reservoir-reference")
      };
    });
    check(ladder.reservoirs?.labelsOn === false,
      `${label}: reservoir names are already on at 1:${ladder.scale}`);
    /* What this map does name at its opening view is the drainage areas,
     * which is what every figure below it is keyed to. Without them a reader
     * matches an outline to a table row by position. */
    check(ladder.areaNames?.labelsOn === true,
      `${label}: the drainage areas are not named at 1:${ladder.scale}, which ` +
      "leaves a reader matching an outline to a table row by position");
    /* A name inside another name's shape is never larger than it, and a
     * drainage area sits inside a state. */
    check(ladder.states === null
      || ladder.states.size > ladder.areaNames?.size,
    `${label}: state names (${ladder.states?.size}) are not larger than ` +
      `drainage-area names (${ladder.areaNames?.size})`);
    check(ladder.counties === null || ladder.counties.layerHidden === true,
      `${label}: county outlines are already drawn at 1:${ladder.scale}`);
    check(ladder.states === null || ladder.states.labelsOn === true,
      `${label}: state names are not on at 1:${ladder.scale}`);
    /* A name inside another name's shape is never larger than it. */
    check(ladder.states === null
      || ladder.states.size > ladder.reservoirs.size,
    `${label}: state names (${ladder.states?.size}) are not larger than ` +
      `reservoir names (${ladder.reservoirs?.size})`);
    await checkViewMapHover(tab, check, label, "drought-map-host", "drought-map-hover",
      "drainage-outlines", "of the land is");
    await checkViewMapHover(tab, check, label, "drought-map-host", "drought-map-hover",
      "usdm-classes", "Drought class");
    await checkViewMapHover(tab, check, label, "drought-map-host", "drought-map-hover",
      "reservoir-reference", "Reservoir,");
    /* Last, on a settled page: every control is wired, every table is
     * filled, and the shadow roots have rendered their real controls. */
    checkLabelFonts(check, label, labelFonts);
    await checkAccessibility(tab, check, label);
    await tab.screenshot({ path: `screenshots/drought-${viewport.name}.png`, fullPage: false });
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
  }
  for (const err of errors) failures.push(`${label}: ${err}`);
  await context.close();
}

/*
 * The basemap fallback, with the first choice answering 401.
 *
 * 401 rather than a dropped connection because 401 is the case that used to
 * open a sign-in dialog: the SDK reads it as "this resource is secured" and,
 * without the anonymous-only policy installed before any layer is built,
 * asks the reader for an ArcGIS account they do not have and cannot get.
 * The first portal item the page requests is the first basemap candidate,
 * so refusing exactly that one leaves the rest of the chain to answer.
 */
{
  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  const tab = await context.newPage();
  const errors = [];
  const refused = [];
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
  const labelFonts = watchLabelFonts(tab);

  let firstItem = null;
  await tab.route(/\/sharing\/rest\/content\/items\/[0-9a-f]+/i, async (route) => {
    const id = /items\/([0-9a-f]+)/i.exec(route.request().url())?.[1];
    if (firstItem === null) firstItem = id;
    if (id !== firstItem) return route.continue();
    refused.push(route.request().url());
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: 401, message: "You do not have permissions to access this resource." }
      })
    });
  });

  const label = "Primary ArcGIS application (first basemap refused)";
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction(() => window.__dashboardReady !== undefined, { timeout: 60000 });
    const ready = await tab.evaluate(() => window.__dashboardReady);
    console.log("  ready:", JSON.stringify(ready), `\n  refused: ${refused.length} request(s)`, refused.slice(0,4));

    check(refused.length > 0, `${label}: nothing was refused, so nothing was tested`);
    // Without this the test can pass by refusing something the page never
    // needed: the fallback has to have actually engaged.
    check(ready.basemapDegraded === true,
      `${label}: the refusal did not push the page onto a later basemap`);
    check(ready.drawn === expectedReservoirs,
      `${label}: drew ${ready.drawn} reservoirs, expected ${expectedReservoirs}`);

    // Given a second or two for a prompt to mount, which it would do
    // asynchronously after the refusal.
    await tab.waitForTimeout(2000);
    const credentialUi = await tab.evaluate(FIND_CREDENTIAL_UI);
    check(credentialUi.length === 0,
      `${label}: a credential prompt appeared (${credentialUi.join(", ")})`);

    const visibleText = await tab.evaluate(COLLECT_SHADOW_TEXT);
    check(!/sign in|username|password/i.test(visibleText),
      `${label}: the page asks the reader to sign in`);

    await tab.screenshot({ path: "screenshots/modern-basemap-refused.png" });
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
    await tab.screenshot({ path: "screenshots/modern-basemap-refused-failure.png" }).catch(() => {});
  }
  for (const err of errors) {
    console.log("  ERROR", err);
    failures.push(`${label}: ${err}`);
  }
  await context.close();
}

/* A reader may block every ArcGIS background through a privacy extension,
 * network policy or temporary service outage. The reservoir and boundary
 * layers are local, so losing geographic context must not delete the map's
 * actual subject. */
{
  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  const tab = await context.newPage();
  const errors = [];
  const refused = [];
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
  const labelFonts = watchLabelFonts(tab);
  tab.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // These are the SDK and Chromium reporting the failures this block
    // intentionally injects. Anything else remains an unexpected error.
    if (/401 \(Unauthorized\)|\[@arcgis\/core\/layers\/VectorTileLayer\]/
      .test(msg.text())) return;
    errors.push(`console: ${msg.text()}`);
  });
  await tab.route(/\/sharing\/rest\/content\/items\/[0-9a-f]+/i, async (route) => {
    refused.push(route.request().url());
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: 401, message: "This background is unavailable anonymously." }
      })
    });
  });

  const label = "Primary ArcGIS application (all basemaps refused)";
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction(() => window.__dashboardReady !== undefined, { timeout: 60000 });
    const ready = await tab.evaluate(() => window.__dashboardReady);
    console.log("  ready:", JSON.stringify(ready), `\n  refused: ${refused.length} request(s)`);
    check(refused.length >= 3, `${label}: the complete fallback chain was not exercised`);
    check(ready.basemap === false, `${label}: a refused basemap was reported as available`);
    check(ready.drawn === expectedReservoirs,
      `${label}: drew ${ready.drawn} reservoirs, expected ${expectedReservoirs}`);
    check(await tab.locator("arcgis-map").count() === 1,
      `${label}: the local map was removed with the background`);
    check(/background is unavailable/i.test(await tab.locator("#map-host").innerText()),
      `${label}: the missing background is not explained`);
    check((await tab.evaluate(FIND_CREDENTIAL_UI)).length === 0,
      `${label}: a credential prompt appeared`);
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
  }
  for (const err of errors) failures.push(`${label}: ${err}`);
  await context.close();
}

/* A shared link, which is the one part of a view a reader can hand to
 * somebody else. Loaded in its own context because it is a different first
 * paint: the selection resolves before the view is ready, and the map has
 * to move anyway. Deliberately spelled the awkward way -- lower case, with
 * a "+" for the space -- because that is what a link typed by hand or
 * pasted out of a chat window looks like, and the shared parser has
 * accepted both spellings since explore.html. */
{
  /* Reduced motion, for two reasons that happen to agree. It is the branch
   * the plan asks for -- the view still moves, it just arrives -- and it is
   * the only branch this environment can observe: an eased `goTo` is driven
   * by the same render loop that leaves the ArcGIS canvas blank here, so an
   * animated move would never progress and the assertion below would be
   * measuring the headless renderer rather than the application. */
  const context = await browser.newContext({
    viewport: VIEWPORTS[0],
    reducedMotion: "reduce"
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL });
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
  const labelFonts = watchLabelFonts(tab);
  tab.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/favicon|tile|sprite|font/i.test(msg.text())) return;
    errors.push(`console: ${msg.text()}`);
  });

  const wanted = payload.reservoirs.find((reservoir) =>
    reservoir.intersects_utah === true &&
    reservoir.name.trim().toLowerCase() !== "lake powell" &&
    reservoir.name.includes(" "));
  const label = `Primary ArcGIS application (shared link to ${wanted?.name})`;
  console.log(`\n=== ${label}`);
  try {
    check(Boolean(wanted), `${label}: no two-word reservoir to build a link from`);
    const link = `${URL}?reservoir=${wanted.name.toLowerCase().replace(/ /g, "+")}`;
    await tab.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction(() => window.__dashboardReady !== undefined, { timeout: 60000 });
    const ready = await tab.evaluate(() => window.__dashboardReady);
    console.log("  ready:", JSON.stringify(ready));

    check(ready.deepLink === wanted.name,
      `${label}: the link resolved to ${ready.deepLink}`);
    check(ready.selected === wanted.name,
      `${label}: the link did not select ${wanted.name}`);
    check(await tab.locator("#detail-panel [data-detail]").innerText()
      .then((text) => text.includes(wanted.name)),
    `${label}: the details panel does not describe the linked reservoir`);

    // The awkward spelling is rewritten to the one the overview produces,
    // so a link copied back out of the address bar is the canonical one.
    const search = await tab.evaluate(() => window.location.search);
    check(search === `?reservoir=${encodeURIComponent(wanted.name)}`,
      `${label}: the address bar reads "${search}" after restoring the link`);

    /* The map has to move, not just the panel. `goTo` is rejected outright
     * by a view that is not ready, and the selection from a link routinely
     * lands before that -- which is a link that silently opens the details
     * and leaves the map where it started. */
    await tab.waitForFunction(
      (target) => {
        const view = document.querySelector("arcgis-map")?.view;
        if (!view?.ready) return false;
        return Math.abs(view.center.longitude - target.lon) < 0.5 &&
          Math.abs(view.center.latitude - target.lat) < 0.5;
      },
      { lon: wanted.lon, lat: wanted.lat },
      { timeout: 15000 }
    ).catch(() => {});
    const moved = await tab.evaluate(() => {
      const view = document.querySelector("arcgis-map")?.view;
      return view ? { zoom: view.zoom, lon: view.center.longitude, lat: view.center.latitude } : null;
    });
    check(moved !== null && Math.abs(moved.lon - wanted.lon) < 0.5 &&
      Math.abs(moved.lat - wanted.lat) < 0.5,
    `${label}: the map stayed at ${moved?.lon}, ${moved?.lat} instead of moving to ` +
      `${wanted.lon}, ${wanted.lat}`);
    check(moved !== null && moved.zoom >= 8 - 0.01,
      `${label}: the map ended at zoom ${moved?.zoom}, closer than 8 was expected`);

    /* The rest of the view, not just the selection. A filtered link that
     * opened on an unfiltered dashboard would show numbers that disagree
     * with the words printed beside them. */
    await tab.goto(`${URL}?reservoir=${wanted.name.toLowerCase().replace(/ /g, "+")}` +
      "&reporting=late&powell=include",
    { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction(() => window.__dashboardReady !== undefined, { timeout: 60000 });
    const restored = await tab.evaluate(() => ({
      ready: window.__dashboardReady,
      search: window.location.search,
      reporting: document.querySelector('#start-panel [data-filter="reporting"]')?.value,
      scope: document.querySelector('#start-panel [data-scope="powell"]')?.checked
        ? "include" : "exclude",
      where: document.querySelector("arcgis-map")?.map
        ?.findLayerById("reservoirs")?.featureEffect?.filter?.where ?? null
    }));
    check(restored.ready.lakePowell === "include",
      `${label}: the link's scope was not restored`);
    check(restored.scope === "include",
      `${label}: the Lake Powell switch does not show the scope the link asked for`);
    check(restored.reporting === "late",
      `${label}: the reporting control does not show the filter the link asked for`);
    check(restored.ready.filtered === true,
      `${label}: the link's filter was not applied`);
    check(restored.where === "late = 1",
      `${label}: the map filter is "${restored.where}" after restoring a filtered link`);
    check(/powell=include/.test(restored.search) && /late=true/.test(restored.search),
      `${label}: the address bar dropped the view it restored ("${restored.search}")`);

    /* The drainage-area filter, which is a filter and not a scope: the map
     * keeps every reservoir and greys the ones outside the area, so the
     * count drawn must not move while the count shown does. */
    check(Boolean(sharedFilter), `${label}: no non-empty area and class combination exists`);
    const area = sharedFilter?.drainage;
    const storageClass = sharedFilter?.storageClass;
    await tab.goto(`${URL}?drainage=${area}&class=${storageClass}`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction(() => window.__dashboardReady !== undefined, { timeout: 60000 });
    const narrowed = await tab.evaluate(() => ({
      ready: window.__dashboardReady,
      control: document.querySelector('#start-panel [data-filter="drainage"]')?.value,
      storage: document.querySelector('#start-panel [data-filter="storage"]')?.value,
      summary: document.querySelector('#start-panel [data-filter="summary"]')?.textContent ?? "",
      listShown: document.querySelectorAll(
        '#start-panel .list-btn:not(.list-btn-excluded)').length,
      where: document.querySelector("arcgis-map")?.map
        ?.findLayerById("reservoirs")?.featureEffect?.filter?.where ?? null
    }));
    check(narrowed.ready.areaFilter === area,
      `${label}: the link's drainage area was not applied (${narrowed.ready.areaFilter})`);
    check(narrowed.control === area,
      `${label}: the drainage-area control shows "${narrowed.control}", not the link's area`);
    check(narrowed.storage === String(storageClass),
      `${label}: the storage control shows "${narrowed.storage}", not class ${storageClass}`);
    check(narrowed.where?.includes(`drainage_area = '${area}'`) &&
      /fill_percent/.test(narrowed.where),
    `${label}: the map filter is "${narrowed.where}" after restoring both filters`);
    check(narrowed.ready.drawn === expectedReservoirs,
      `${label}: filtering by drainage area removed reservoirs from the map`);
    check(narrowed.ready.shown === sharedFilter?.count,
      `${label}: map filter showed ${narrowed.ready.shown}, expected ${sharedFilter?.count}`);
    check(narrowed.listShown === narrowed.ready.shown,
      `${label}: list showed ${narrowed.listShown}, map reported ${narrowed.ready.shown}`);
    check(narrowed.summary.includes("grey"),
      `${label}: the summary does not say the other reservoirs stay on the map`);

    const beforeHistory = await tab.evaluate(() => history.length);
    await tab.locator('#start-panel [data-filter="reporting"]').evaluate((select) => {
      select.value = "late";
      select.dispatchEvent(new CustomEvent("calciteSelectChange", { bubbles: true }));
    });
    await tab.waitForFunction(() => window.location.search.includes("late=true"));
    check(await tab.evaluate(() => history.length) === beforeHistory,
      `${label}: a filter change added an entry to browser history`);

    const share = tab.locator('#start-panel [data-share="copy"]');
    check(await share.evaluate(async (button) => {
      await button.setFocus();
      return document.activeElement === button || Boolean(button.shadowRoot?.activeElement);
    }),
      `${label}: copy-link control cannot receive keyboard focus`);
    await tab.keyboard.press("Enter");
    await tab.waitForFunction(() =>
      document.querySelector('#start-panel [data-share="copy"]')?.textContent?.includes("Link copied"));
    const copied = await tab.evaluate(() => navigator.clipboard.readText());
    check(copied === tab.url(), `${label}: copied "${copied}" instead of "${tab.url()}"`);

    // A link that names nothing this page draws is not an error; it is no
    // selection, and the reader gets the ordinary starting view.
    await tab.goto(`${URL}?reservoir=Not+A+Reservoir`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction(() => window.__dashboardReady !== undefined, { timeout: 60000 });
    const unknown = await tab.evaluate(() => ({
      ready: window.__dashboardReady,
      search: window.location.search
    }));
    check(unknown.ready.deepLink === null,
      `${label}: an unknown name resolved to ${unknown.ready.deepLink}`);
    check(unknown.ready.selected === null,
      `${label}: an unknown name selected ${unknown.ready.selected}`);
    check(unknown.ready.drawn === expectedReservoirs,
      `${label}: an unknown name cost the map its reservoirs`);
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
  }
  for (const err of errors) failures.push(`${label}: ${err}`);
  await context.close();
}

/* The data state, which nothing asserted on until now.
 *
 * "Replace loading copy with loader states *without hiding error
 * explanations*" is only meaningful if a failure actually produces an
 * explanation. Two failures are worth separating: a file that answers with
 * an error, and a file that never answers at all. The second used to be a
 * spinner forever -- there was no deadline on the data path, so the promise
 * never settled and the panel never left "Loading reservoir data". */
for (const failure of [
  { name: "data refused", fulfil: { status: 503, body: "" } },
  { name: "data never answers", hang: true }
]) {
  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  const tab = await context.newPage();
  const errors = [];
  let heldRoute = null;
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
  const labelFonts = watchLabelFonts(tab);

  await tab.route(/reservoirs\.json/i, async (route) => {
    if (failure.hang) {
      heldRoute = route;
      return; // held until the application deadline proves it can recover
    }
    return route.fulfill(failure.fulfil);
  });

  const label = `Primary ArcGIS application (${failure.name})`;
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction(() => window.__dashboardReady !== undefined, { timeout: 60000 });
    const ready = await tab.evaluate(() => window.__dashboardReady);
    console.log("  ready:", JSON.stringify(ready));

    check(ready.drawn === 0, `${label}: drew ${ready.drawn} reservoirs from a failed load`);

    const state = await tab.evaluate(() => {
      const element = document.querySelector("#start-panel .data-state");
      if (!element) return null;
      return {
        hidden: element.hidden,
        role: element.getAttribute("role"),
        text: element.textContent.trim(),
        // A spinner on an error is a promise the page cannot keep.
        spinner: element.querySelectorAll("calcite-loader").length
      };
    });
    check(state !== null, `${label}: the data state element is gone`);
    check(state?.hidden === false, `${label}: the failure is hidden from the reader`);
    check(state?.role === "alert",
      `${label}: the failure is announced as "${state?.role}", expected an alert`);
    check(Boolean(state?.text) && /unavailable/i.test(state?.text ?? ""),
      `${label}: no explanation on screen, only "${state?.text}"`);
    check(state?.spinner === 0,
      `${label}: still spinning after the load failed`);

    // The map is a separate path and must survive a data failure.
    check(await tab.locator("arcgis-map").count() === 1,
      `${label}: the map was removed along with the data`);
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
  }
  for (const err of errors) failures.push(`${label}: ${err}`);
  /* The application has already proved that it leaves its loading state.
   * Release the request the test held on purpose before closing the browser
   * context; newer Chromium builds otherwise wait forever for that route. */
  if (heldRoute) await heldRoute.abort("aborted").catch(() => {});
  await context.close();
}

/*
 * The second area size, on all three maps.
 *
 * The control changes what every figure on a page counts, so the check is
 * that each surface really is drawn over the coarser areas -- not that a
 * select exists. Every expected number is derived from the committed payloads
 * the way the client derives it: codes are fixed-width and nest, so a
 * subregion is the first four digits of a basin code (ADR-064), and the
 * morning refresh cannot turn this red on its own.
 */
{
  const coarse = JSON.parse(
    await readFile(path.join(REPO_ROOT, "data/drought/usdm-huc4.json"), "utf8"));
  const snowPayload = JSON.parse(
    await readFile(path.join(REPO_ROOT, "snowpack.json"), "utf8"));
  const coarseScope = referenceWatersheds.scopes[referenceWatersheds.drawn_scopes["4"]];
  const expectedCoarseAreas = JSON.parse(
    await readFile(path.join(REPO_ROOT, coarseScope.source_file), "utf8")).features.length;
  const coarseSnowBasins = new Set(
    snowPayload.sites.map((site) => site.huc6.slice(0, 4))).size;
  const coarseDroughtAreas = new Set(coarse.units.map((unit) => unit.huc4));
  const coarseStorageJoined = new Set(payload.reservoirs
    .map((reservoir) => reservoir.huc6?.slice(0, 4))
    .filter((code) => typeof code === "string" && coarseDroughtAreas.has(code))).size;

  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
  tab.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  const cases = [
    {
      label: "Storage map at subregions",
      url: `${URL}?level=4`,
      signal: "__dashboardReady",
      /* The storage map publishes its readiness once, with the map already
       * drawn, so the signal appearing is enough here. */
      drawn: "drainageAreas",
      check: (ready) => {
        check(ready.level === 4,
          `the storage map reports level ${ready.level}, expected 4`);
        check(ready.drainageAreas === expectedCoarseAreas,
          `the storage map drew ${ready.drainageAreas} areas, expected ${expectedCoarseAreas}`);
        check(ready.drainageLevel === 4,
          `the storage map drew level ${ready.drainageLevel}, expected 4`);
        check(ready.reservoirs === expectedReservoirs,
          `the storage map lost reservoirs at the coarser level: ${ready.reservoirs}`);
      }
    },
    {
      label: "Snowpack at subregions",
      url: `${URL}snow.html?level=4`,
      signal: "__snowReady",
      /* The map starts after the figures are on screen by design, so its own
       * fields arrive on a later publish than the page's. */
      drawn: "mapBasins",
      check: (ready) => {
        check(ready.level === 4,
          `the snow page reports level ${ready.level}, expected 4`);
        check(ready.basins === coarseSnowBasins,
          `the snow page grouped ${ready.basins} areas, expected ${coarseSnowBasins}`);
        check(ready.mapBasins === coarseSnowBasins,
          `the snow map drew ${ready.mapBasins} areas, expected ${coarseSnowBasins}`);
        check(ready.sites === snowPayload.site_count,
          `the snow page lost sites at the coarser level: ${ready.sites}`);
      }
    },
    {
      label: "Drought at subregions",
      url: `${URL}drought.html?level=4`,
      signal: "__droughtReady",
      drawn: "mapOutlines",
      check: (ready) => {
        check(ready.level === 4,
          `the drought page reports level ${ready.level}, expected 4`);
        check(ready.units === coarse.unit_count && ready.rows === coarse.unit_count,
          `the drought page read ${ready.units} areas, expected ${coarse.unit_count}`);
        check(ready.storageJoined === coarseStorageJoined,
          `storage joined ${ready.storageJoined} subregions, expected ${coarseStorageJoined}`);
        check(ready.mapOutlines === coarse.unit_count,
          `the drought map drew ${ready.mapOutlines} outlines, expected ${coarse.unit_count}`);
      }
    }
  ];

  for (const scenario of cases) {
    console.log(`
=== ${scenario.label}`);
    await tab.goto(scenario.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction(
      (key) => window[key] !== undefined, scenario.signal, { timeout: 90000 });
    /* Two later publishes to wait for, both of which arrive after the figures
     * are on screen by design: the control, which needs the reference export,
     * and the map's own count of what it drew. */
    await tab.waitForFunction(
      ([key, field]) => window[key]?.levelsOffered !== undefined
        && window[key]?.[field] !== undefined,
      [scenario.signal, scenario.drawn], { timeout: 90000 });
    const state = await tab.evaluate((key) => ({
      ready: window[key],
      control: document.querySelectorAll(".level-control calcite-select").length,
      chosen: document.querySelector(".level-control calcite-select")?.value ?? null,
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth
    }), scenario.signal);
    console.log("  ready:", JSON.stringify({
      level: state.ready?.level, levelsOffered: state.ready?.levelsOffered,
      control: state.control, chosen: state.chosen
    }));
    scenario.check(state.ready ?? {});
    check(state.ready?.levelsOffered === 2,
      `${scenario.label}: reported ${state.ready?.levelsOffered} area sizes on offer`);
    check(state.control >= 1,
      `${scenario.label}: no area-size control was built`);
    check(state.chosen === "4",
      `${scenario.label}: the control shows ${state.chosen}, not the level in the address`);
    check(state.scroll <= state.viewport + 1,
      `${scenario.label}: the page scrolls sideways at the coarser level`);
  }

  /* The default is the absence of the parameter, so a page with no `?level=`
   * must be the basins page it always was. */
  await tab.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await tab.waitForFunction(() => window.__dashboardReady !== undefined, { timeout: 90000 });
  const fallback = await tab.evaluate(() => window.__dashboardReady?.level);
  check(fallback === 6, `the storage map opens at level ${fallback}, expected 6`);

  for (const message of errors) failures.push(`Area size: ${message}`);
  await context.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nThe primary ArcGIS application rendered cleanly at ${VIEWPORTS.length} viewport sizes, ` +
  "kept local data when every basemap was refused, and never asked for credentials.");
