/*
 * Browser smoke test for all three dashboard pages.
 *
 * This exists because the dashboards' most damaging failure mode is silent:
 * a page that loads, paints a basemap, and renders no reservoirs at all.
 * That is exactly what happened when `esri/Map` was bound as `Map` and
 * shadowed the global Map constructor -- the ArcGIS page shipped with zero
 * reservoirs on it, and the only symptom was a line of small print in the
 * title panel. Syntax checks and unit tests cannot see that. A real browser
 * can.
 *
 * Serves the repo over HTTP (not file://, which would break fetch) and, for
 * each page, asserts:
 *   - no uncaught exceptions and no console errors
 *   - the page reached its readiness signal, with every reservoir rendered
 *   - the freshness line reports data rather than a failure
 *   - whatever else that page is supposed to have drawn (map layers and the
 *     Utah mask; on the overview, a full table and a working detail dialog)
 *
 * The two map pages pull their SDK from a CDN, so this needs network access.
 * The overview page does not — it is the one page that would still render
 * during a CDN outage.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8137;
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

const PAGES = [
  { name: "ArcGIS Maps SDK", url: `http://127.0.0.1:${PORT}/index.html`, engine: "arcgis", map: true },
  { name: "MapLibre GL JS", url: `http://127.0.0.1:${PORT}/maplibre/index.html`, engine: "maplibre", map: true },
  { name: "Statewide overview", url: `http://127.0.0.1:${PORT}/explore.html`, engine: "explore", map: false }
];

const expectedReservoirs = JSON.parse(
  await readFile(path.join(ROOT, "reservoirs.json"), "utf8")
).reservoirs.length;

await new Promise((resolve) => server.listen(PORT, resolve));
const browser = await chromium.launch();

for (const page of PAGES) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
  tab.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // Basemap tile 404s and font warnings are the CDN's business, not ours.
    if (/favicon|tile|sprite|font/i.test(msg.text())) return;
    errors.push(`console: ${msg.text()}`);
  });

  console.log(`\n=== ${page.name}`);
  try {
    await tab.goto(page.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });

    const ready = await tab.evaluate(() => window.__dashboardReady);
    console.log("  ready:", JSON.stringify(ready));
    check(ready.engine === page.engine, `${page.name}: wrong engine signal`);
    check(ready.reservoirs === expectedReservoirs,
      `${page.name}: rendered ${ready.reservoirs} reservoirs, expected ${expectedReservoirs}`);
    if (page.map) {
      check(ready.layers === 3, `${page.name}: ${ready.layers} reservoir layers, expected 3`);
      // The mask is one static polygon that either drew or didn't; nothing
      // else on the page changes if it silently failed to be added.
      check(ready.masked === true, `${page.name}: Utah mask layer missing`);
    } else {
      check(ready.rows === expectedReservoirs,
        `${page.name}: table has ${ready.rows} rows, expected ${expectedReservoirs}`);
    }

    const freshness = (await tab.locator("#freshness").innerText()).trim();
    console.log("  freshness:", freshness);
    check(/Data refreshed/.test(freshness),
      `${page.name}: freshness line does not report data ("${freshness}")`);
    check(!/failed/i.test(freshness), `${page.name}: freshness line reports a failure`);

    if (page.map) {
      // The legend is generated from the shared class table; if the shared
      // module failed to load, this is empty on both map pages.
      const legendDots = await tab.locator(".rv-dot").count();
      check(legendDots >= 5, `${page.name}: legend rendered ${legendDots} swatches`);
    } else {
      // The overview's own three renderers, each of which can fail on its
      // own: the statewide chart, the worst-first ranking, and the card
      // grid. Then the detail dialog, which is the only path from this page
      // to a reservoir's full record.
      check(await tab.locator("#stateChart svg rect").count() > 0,
        `${page.name}: statewide trend chart drew no bars`);
      const rankRows = await tab.locator(".rank-row").count();
      check(rankRows === expectedReservoirs,
        `${page.name}: ranking has ${rankRows} rows, expected ${expectedReservoirs}`);
      const cards = await tab.locator(".mini").count();
      check(cards === expectedReservoirs,
        `${page.name}: ${cards} sparkline cards, expected ${expectedReservoirs}`);

      await tab.locator(".rank-row").first().click();
      await tab.waitForSelector("dialog#detail[open]", { timeout: 5000 });
      check(await tab.locator("#detailBody .rv-chart").count() === 1,
        `${page.name}: detail dialog opened without a trend chart`);
      check(/reservoir=/.test(tab.url()), `${page.name}: opening a detail did not deep-link`);
      await tab.keyboard.press("Escape");
    }

    await tab.screenshot({ path: `screenshots/${page.engine}.png`, fullPage: false });
  } catch (err) {
    failures.push(`${page.name}: ${err.message}`);
    await tab.screenshot({ path: `screenshots/${page.engine}-failure.png` }).catch(() => {});
  }

  for (const err of errors) {
    console.log("  ERROR", err);
    failures.push(`${page.name}: ${err}`);
  }
  await context.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} smoke failure(s):`);
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log(`\nAll ${PAGES.length} pages rendered cleanly.`);
