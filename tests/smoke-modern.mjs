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

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createContext, runInContext } from "node:vm";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(REPO_ROOT, "dist");
const PORT = 8138;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript",
  ".json": "application/json", ".css": "text/css"
};

const server = createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
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
const expectedAreas = JSON.parse(
  await readFile(path.join(REPO_ROOT, "huc6.geojson"), "utf8")).features.length;

const URL = `http://127.0.0.1:${PORT}/`;
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
    await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });

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
    check(ready.minZoom === 4,
      `${label}: the map can zoom out to ${ready.minZoom}, expected 4`);
    check(ready.boundaryPoints > 100,
      `${label}: authoritative Utah boundary was not drawn (${ready.boundaryPoints} points)`);
    check(ready.drainageAreas === expectedAreas,
      `${label}: drew ${ready.drainageAreas} drainage areas, expected ${expectedAreas}`);
    check(ready.drainageLabels === expectedAreas,
      `${label}: configured ${ready.drainageLabels} drainage-area labels, expected ${expectedAreas}`);
    check(ready.drainageLabelsUnderReservoirs === true,
      `${label}: drainage-area labels are not below the reservoir symbols`);

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
      const firstLabel = drainageLabels?.graphics?.at(0)?.symbol;
      return {
        type: layer?.type ?? null,
        count: layer ? await layer.queryFeatureCount() : 0,
        drainageType: drainage?.type ?? null,
        drainageCount: drainage ? await drainage.queryFeatureCount() : 0,
        drainageLabelClasses: drainage?.labelingInfo?.length ?? 0,
        drainageLabelType: drainageLabels?.type ?? null,
        drainageLabelCount: drainageLabels?.graphics?.length ?? 0,
        drainageHaloAlpha: firstLabel?.haloColor?.a ?? null,
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
    check(layerFeatures.drainageLabelClasses === 0,
      `${label}: drainage-area text still uses the foreground label pass`);
    check(layerFeatures.drainageLabelType === "graphics",
      `${label}: the background label layer is "${layerFeatures.drainageLabelType}", expected graphics`);
    check(layerFeatures.drainageLabelCount === expectedAreas,
      `${label}: the label layer holds ${layerFeatures.drainageLabelCount} symbols, ` +
      `expected ${expectedAreas}`);
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
        drainageLabelsUnderReservoirs:
          window.__dashboardReady.drainageLabelsUnderReservoirs,
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
    check(wider.drainageLabelsUnderReservoirs,
      `${label}: drainage-area labels rose above reservoirs after a scope change`);
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
    await tab.waitForFunction("window.__dashboardReady.filtered === true", { timeout: 5000 });

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
    await tab.waitForFunction("window.__dashboardReady.filtered === false", { timeout: 5000 });
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
          window.__reservoirHitIncluded = options?.include === layer;
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
        "document.querySelector('#map-hover')?.hidden === false",
        { timeout: 5000 });
      const hoverText = (await tab.locator("#map-hover").innerText()).trim();
      check(hoverText.includes(pointerName) && hoverText.includes("%"),
        `${label}: pointer hover did not summarize ${pointerName}`);
      check(await tab.evaluate(() => window.__reservoirHitIncluded === true),
        `${label}: pointer hit test was not limited to the reservoir layer`);
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
    await tab.waitForFunction("window.__dashboardReady.rankingBars > 0", { timeout: 60000 });
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
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
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
  tab.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  const label = `Public data reference (${viewport.name} ${viewport.width}px)`;
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(`${URL}data.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction("window.__dataDocsReady !== undefined", { timeout: 60000 });
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
      "./api/reference.json"
    ]), `${label}: file card links are ${JSON.stringify(state.links)}`);
    check(state.text.includes("Access-Control-Allow-Origin: *"),
      `${label}: cross-origin browser access is not disclosed`);
    check(state.text.includes("10 minutes") && state.text.includes("no uptime guarantee"),
      `${label}: cache or availability terms are missing`);
    check(state.scroll <= state.viewport + 1,
      `${label}: page overflows horizontally (${state.scroll}px in ${state.viewport}px)`);
    await tab.screenshot({ path: `screenshots/data-${viewport.name}.png`, fullPage: false });
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
  }
  for (const err of errors) failures.push(`${label}: ${err}`);
  await context.close();
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
  tab.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  const label = `Snowpack view (${viewport.name} ${viewport.width}px)`;
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(`${URL}snow.html?area=140100`, {
      waitUntil: "domcontentloaded", timeout: 60000
    });
    await tab.waitForFunction("window.__snowReady !== undefined", { timeout: 60000 });
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
      "window.__snowReady && window.__snowReady.area === null", { timeout: 10000 });
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
      "window.__snowReady && window.__snowReady.mapDay !== undefined",
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
    check(mapState.slider && mapState.legendItems === 6,
      `${label}: day control ${mapState.slider}, legend ${mapState.legendItems} of 6`);

    /* One site's season. Chosen through the picker the way a reader would;
     * the drawn-point count is what proves a curve, not a prompt, is on
     * screen, and the address bar has to carry the choice. */
    const firstStation = await tab.evaluate(() =>
      document.querySelector("#snow-site optgroup option")?.getAttribute("value") ?? null);
    check(typeof firstStation === "string" && firstStation.length > 0,
      `${label}: the site picker offers no sites`);
    await tab.selectOption("#snow-site", firstStation);
    await tab.waitForFunction(
      "window.__snowReady && window.__snowReady.site !== null", { timeout: 10000 });
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
  tab.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  const label = `Drought view (${viewport.name} ${viewport.width}px)`;
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(`${URL}drought.html`, {
      waitUntil: "domcontentloaded", timeout: 60000
    });
    await tab.waitForFunction("window.__droughtReady !== undefined", { timeout: 60000 });
    const state = await tab.evaluate(() => ({
      ready: window.__droughtReady,
      rows: document.querySelectorAll(".drought-row").length,
      bars: document.querySelectorAll(".drought-bar").length,
      tableRows: document.querySelectorAll("#drought-table-rows tr").length,
      legendItems: document.querySelectorAll(".drought-legend-item").length,
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
    check(state.legendItems === 6,
      `${label}: the legend shows ${state.legendItems} classes, expected 6`);
    check(state.ready?.storageJoined === state.ready?.units,
      `${label}: storage joined ${state.ready?.storageJoined} of ${state.ready?.units} areas`);
    const badLink = state.areaLinks.find((href) =>
      !/^\.\/(snow\.html)?\?area=\d{6}$/.test(href));
    check(state.areaLinks.length === state.rows * 2 && badLink === undefined,
      `${label}: cross links are malformed (${badLink ?? "count " + state.areaLinks.length})`);
    check(state.scroll <= state.viewport + 1,
      `${label}: page overflows horizontally (${state.scroll}px in ${state.viewport}px)`);
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
    await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });
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
    await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });
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
    await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });
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
    await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });
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
    await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });
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
    await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });
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
    await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });
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

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nThe primary ArcGIS application rendered cleanly at ${VIEWPORTS.length} viewport sizes, ` +
  "kept local data when every basemap was refused, and never asked for credentials.");
