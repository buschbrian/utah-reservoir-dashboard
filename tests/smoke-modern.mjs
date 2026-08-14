/*
 * Browser smoke test for the production ArcGIS 5.1 application at the root.
 *
 * Separate from tests/smoke.mjs on purpose. That file protects the three
 * retained comparison pages; this one protects the primary application.
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
/* An area that holds some of the scope but not all of it, so filtering by it
 * is a real narrowing whichever morning this runs. */
const partialArea = [...new Set(inScope.map((reservoir) => reservoir.huc6))]
  .filter((code) => typeof code === "string")
  .find((code) => {
    const held = inScope.filter((reservoir) => reservoir.huc6 === code).length;
    return held > 0 && held < inScope.length;
  });
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
      return {
        type: layer?.type ?? null,
        count: layer ? await layer.queryFeatureCount() : 0,
        drainageType: drainage?.type ?? null,
        drainageCount: drainage ? await drainage.queryFeatureCount() : 0,
        drainageLabelClasses: drainage?.labelingInfo?.length ?? 0,
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
    check(layerFeatures.drainageLabelClasses === 1,
      `${label}: drainage areas have ${layerFeatures.drainageLabelClasses} label classes, expected 1`);
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
        buttons: ["#overview-link", "#methods-link"].filter(shown),
        menuItems: [...document.querySelectorAll("#page-menu calcite-dropdown-item")]
          .map((item) => item.getAttribute("href")),
        buttonHrefs: ["#overview-link", "#methods-link"]
          .map((selector) => document.querySelector(selector)?.getAttribute("href"))
      };
    });
    const wideBar = viewport.width >= 1024;
    check(pageLinks.menu === !wideBar,
      `${label}: the page menu is ${pageLinks.menu ? "showing" : "hidden"} at ${viewport.width}px`);
    check(pageLinks.buttons.length === (wideBar ? 2 : 0),
      `${label}: ${pageLinks.buttons.length} page link buttons are showing at ${viewport.width}px`);
    check(pageLinks.menuItems.join(",") === "./,./overview.html,./methods.html",
      `${label}: the page menu offers ${pageLinks.menuItems.join(", ")}`);
    check(pageLinks.buttonHrefs.join(",") === "./overview.html,./methods.html",
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
        search: window.location.search
      };
    }, controls);
    check(wider.geography === "connected",
      `${label}: the geography control did not widen the scope`);
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
        map.hitTest = async () => ({
          results: [{ type: "graphic", graphic: { attributes: { name } } }]
        });
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
          new CustomEvent("arcgisViewClick", { detail: { x: 500, y: 300 } }));
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
     * the "Table and charts" label came to 446px of content, which put the
     * reservoir details and theme controls fully off screen with nothing to
     * reveal them. Every control in the bar is measured against the viewport. */
    const navControls = await tab.evaluate(() => {
      /* Whatever is actually on the bar at this width. The link buttons
       * swap for the menu below 64rem, so naming a fixed set here would
       * measure a control that is display:none and pass on a zero box. */
      const ids = ["brand", "page-menu", "overview-link", "methods-link",
        "controls-toggle", "detail-toggle", "theme-toggle"]
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

    /* This page is the only route to the second rendering engine (ADR-007)
     * and to the 4.34 map, both of which the root cut-over left published
     * and unreachable. The header clips rather than scrolls, so its own
     * bounding box cannot prove its contents fit -- and it is why the three
     * outbound links sit in the page rather than in the bar. Measure all of
     * them, and require each to point where its label says. */
    const navLinks = {
      "theme-toggle": null,
      "legacy-link": "./legacy/",
      "maplibre-link": "./maplibre/",
      "explore-link": "./explore.html",
      // The header's own links swap for the menu below 64rem, so only
      // whichever is actually showing at this width is measured.
      ...(viewport.width >= 1024
        ? { "map-link": "./", "methods-link": "./methods.html" }
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
    check(/powell=include/.test(restored.search) && /reporting=late/.test(restored.search),
      `${label}: the address bar dropped the view it restored ("${restored.search}")`);

    /* The drainage-area filter, which is a filter and not a scope: the map
     * keeps every reservoir and greys the ones outside the area, so the
     * count drawn must not move while the count shown does. */
    const area = partialArea;
    await tab.goto(`${URL}?area=${area}`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });
    const narrowed = await tab.evaluate(() => ({
      ready: window.__dashboardReady,
      control: document.querySelector('#start-panel [data-filter="drainage"]')?.value,
      summary: document.querySelector('#start-panel [data-filter="summary"]')?.textContent ?? "",
      where: document.querySelector("arcgis-map")?.map
        ?.findLayerById("reservoirs")?.featureEffect?.filter?.where ?? null
    }));
    check(narrowed.ready.areaFilter === area,
      `${label}: the link's drainage area was not applied (${narrowed.ready.areaFilter})`);
    check(narrowed.control === area,
      `${label}: the drainage-area control shows "${narrowed.control}", not the link's area`);
    check(narrowed.where === `drainage_area = '${area}'`,
      `${label}: the map filter is "${narrowed.where}" after restoring a drainage-area link`);
    check(narrowed.ready.drawn === expectedReservoirs,
      `${label}: filtering by drainage area removed reservoirs from the map`);
    check(narrowed.ready.shown > 0 && narrowed.ready.shown < expectedReservoirs,
      `${label}: a drainage area showed ${narrowed.ready.shown} of ${expectedReservoirs}`);
    check(narrowed.summary.includes("grey"),
      `${label}: the summary does not say the other reservoirs stay on the map`);

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
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));

  await tab.route(/reservoirs\.json/i, async (route) => {
    if (failure.hang) return; // never fulfilled, never aborted: a hang
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
