/*
 * Browser smoke test for the Phase 2 shell at modern.html.
 *
 * Separate from tests/smoke.mjs on purpose. That file is the production
 * contract for three pages whose markup is frozen; this one covers a page
 * that is still being built, and mixing them would mean every change to the
 * workbench edits the test protecting production.
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
const expectedReservoirs = payload.reservoirs.filter((reservoir) =>
  reservoir.intersects_utah === true &&
  reservoir.rise_item_id !== 509 &&
  reservoir.name.trim().toLowerCase() !== "lake powell").length;
const expectedAreas = JSON.parse(
  await readFile(path.join(REPO_ROOT, "huc6.geojson"), "utf8")).features.length;

const URL = `http://127.0.0.1:${PORT}/modern.html`;
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
    if (/favicon|tile|sprite|font/i.test(msg.text())) return;
    errors.push(`console: ${msg.text()}`);
  });

  const label = `Phase 2 shell (${viewport.name})`;
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
    // One composed symbol per feature. A renderer that quietly kept fewer
    // draws a plausible map of sizes and colours nobody chose.
    check(ready.symbols === expectedReservoirs,
      `${label}: the renderer holds ${ready.symbols} symbols, expected ${expectedReservoirs}`);
    check(ready.listItems === expectedReservoirs,
      `${label}: the reservoir list has ${ready.listItems} entries, expected ${expectedReservoirs}`);
    check(await tab.locator('[data-reservoir="Lake Powell"]').count() === 0,
      `${label}: Lake Powell appears in the default reservoir list`);
    check(ready.basemap === true, `${label}: no basemap resolved`);
    check(ready.basemapDegraded === false,
      `${label}: the preferred basemap did not serve`);
    check(ready.masked === true, `${label}: the Utah mask is missing`);
    check(ready.boundaryPoints > 100,
      `${label}: authoritative Utah boundary was not drawn (${ready.boundaryPoints} points)`);
    check(ready.drainageAreas === expectedAreas,
      `${label}: drew ${ready.drainageAreas} drainage areas, expected ${expectedAreas}`);

    /* The renderer count above proves what the page built. This proves the
     * layer accepted it: a client-side feature layer whose source is
     * rejected still exists, still reports its renderer, and holds nothing.
     * `queryFeatureCount` answers from the layer, not from a view, so it
     * settles in headless Chromium where the render loop does not run. */
    const layerFeatures = await tab.evaluate(async () => {
      const layer = document.querySelector("arcgis-map")?.map
        ?.findLayerById("reservoirs");
      if (!layer) return { type: null, count: 0 };
      return { type: layer.type, count: await layer.queryFeatureCount() };
    });
    check(layerFeatures.type === "feature",
      `${label}: the reservoirs layer is "${layerFeatures.type}", expected a feature layer`);
    check(layerFeatures.count === expectedReservoirs,
      `${label}: the reservoir layer holds ${layerFeatures.count} features, ` +
      `expected ${expectedReservoirs}`);

    const visibleText = await tab.evaluate(COLLECT_SHADOW_TEXT);
    check(!RETIRED_TERMS.test(visibleText),
      `${label}: retired vocabulary is visible ` +
      `("${(visibleText.match(RETIRED_TERMS) || [""])[0]}")`);

    const credentialUi = await tab.evaluate(FIND_CREDENTIAL_UI);
    check(credentialUi.length === 0,
      `${label}: a credential prompt exists (${credentialUi.join(", ")})`);
    const overviewLink = tab.locator("#overview-link");
    check(await overviewLink.isVisible(), `${label}: the table and charts link is not visible`);
    check(await overviewLink.getAttribute("href") === "./overview.html",
      `${label}: the table and charts link has the wrong destination`);
    check(await tab.locator(".map-stage > .map-alternative").count() === 0,
      `${label}: the old table and charts overlay still covers the map`);

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
    // Use the surface a reader can actually reach at this width; a scripted
    // click on the hidden desktop panel would make the phone run meaningless.
    const mobile = viewport.width < 768;
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
    const detailHost = tab.locator(detailSelector);
    check(await detailHost.isVisible(), `${label}: the active detail surface is not visible`);
    const detail = (await detailHost.innerText()).trim();
    for (const expected of [firstName, "%", "Stored now", "Reading date", "Measured by"]) {
      check(detail.includes(expected),
        `${label}: the details panel does not report ${expected}`);
    }

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
        overviewLink: rect("#overview-link"),
        navigation: rect("calcite-navigation"),
        home: rect("arcgis-home"),
        fullscreen: rect("arcgis-fullscreen")
      };
    });
    check(layout.scroll <= layout.viewport + 1,
      `${label}: page overflows horizontally (${layout.scroll}px in ${layout.viewport}px)`);
    check(layout.overviewLink &&
      layout.overviewLink.left >= 0 &&
      layout.overviewLink.right <= layout.viewport + 1,
      `${label}: the table and charts link extends outside the header`);
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
    if (msg.type() === "error" && !/favicon/i.test(msg.text())) {
      errors.push(`console: ${msg.text()}`);
    }
  });
  const label = `Modern overview (${viewport.name})`;
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(`http://127.0.0.1:${PORT}/overview.html`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction("window.__overviewReady?.charts === 2", { timeout: 60000 });
    const overviewReady = await tab.evaluate(() => window.__overviewReady);
    check(overviewReady.lakePowellExcluded === true,
      `${label}: readiness signal reports Lake Powell in scope`);
    check(await tab.locator("arcgis-chart").count() === 2,
      `${label}: both ArcGIS charts did not render`);
    check(await tab.locator("arcgis-chart").evaluateAll((charts) => charts.every((chart) =>
      [...(chart.shadowRoot?.querySelectorAll("svg rect") ?? [])].some((rect) =>
        Number(rect.getAttribute("width")) > 20 && Number(rect.getAttribute("height")) > 3))),
    `${label}: an ArcGIS chart has no visible data bars`);
    check(await tab.locator("#reservoir-rows tr").count() === expectedReservoirs,
      `${label}: table does not match the map scope`);
    check(!(await tab.locator("#reservoir-rows").innerText()).includes("Lake Powell"),
      `${label}: Lake Powell appears in the default overview table`);
    check(await tab.locator("#capacity-chart arcgis-chart")
      .evaluate((chart) => Boolean(chart.aria?.label)),
      `${label}: chart has no accessible name`);
    await tab.locator("#reservoir-search").fill("Jordan");
    await tab.waitForFunction(
      `(expected) => window.__overviewReady?.visible > 0 &&
        window.__overviewReady?.visible < expected`, expectedReservoirs,
      { timeout: 60000 });
    const filtered = await tab.locator("#reservoir-rows tr").count();
    check(filtered > 0 && filtered < expectedReservoirs,
      `${label}: drainage-area search did not filter the table`);
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

  const label = "Phase 2 shell (first basemap refused)";
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

  const label = "Phase 2 shell (all basemaps refused)";
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

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nThe Phase 2 shell rendered cleanly at ${VIEWPORTS.length} viewport sizes, ` +
  "kept local data when every basemap was refused, and never asked for credentials.");
