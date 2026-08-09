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
 *     HUC6 mask; on the overview, a full table and a working detail dialog)
 *
 * Every assertion runs at desktop and phone widths. This catches the map
 * panels and controls that previously covered most of a mobile viewport.
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
const reservoirPayload = JSON.parse(
  await readFile(path.join(ROOT, "reservoirs.json"), "utf8")
);
const largestReservoir = reservoirPayload.reservoirs.slice().sort((a, b) =>
  (b.capacity_af || b.record_max_af || 0) - (a.capacity_af || a.record_max_af || 0)
)[0].name;

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 }
];

await new Promise((resolve) => server.listen(PORT, resolve));
const browser = await chromium.launch();

for (const page of PAGES) {
 for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport });
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
  tab.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // Basemap tile 404s and font warnings are the CDN's business, not ours.
    if (/favicon|tile|sprite|font/i.test(msg.text())) return;
    errors.push(`console: ${msg.text()}`);
  });

  const label = `${page.name} (${viewport.name})`;
  console.log(`\n=== ${label}`);
  try {
    await tab.goto(page.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });

    const ready = await tab.evaluate(() => window.__dashboardReady);
    console.log("  ready:", JSON.stringify(ready));
    check(ready.engine === page.engine, `${label}: wrong engine signal`);
    check(ready.reservoirs === expectedReservoirs,
      `${label}: rendered ${ready.reservoirs} reservoirs, expected ${expectedReservoirs}`);
    if (page.map) {
      check(ready.layers === 3, `${label}: ${ready.layers} reservoir layers, expected 3`);
      check(ready.masked === true, `${label}: HUC6 mask layer missing`);
      check(ready.huc6 === true, `${label}: HUC6 boundary layer missing`);
    } else {
      check(ready.rows === expectedReservoirs,
        `${label}: table has ${ready.rows} rows, expected ${expectedReservoirs}`);
    }

    const freshness = (await tab.locator("#freshness").innerText()).trim();
    console.log("  freshness:", freshness);
    check(/Data refreshed/.test(freshness),
      `${label}: freshness line does not report data ("${freshness}")`);
    check(!/failed/i.test(freshness), `${label}: freshness line reports a failure`);

    const layout = await tab.evaluate(() => {
      const box = document.querySelector("#titleDiv")?.getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        title: box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null
      };
    });
    check(layout.scroll <= layout.viewport + 1,
      `${label}: page overflows horizontally (${layout.scroll}px in ${layout.viewport}px)`);
    if (page.map && viewport.name === "mobile") {
      check(layout.title && layout.title.left >= 0 && layout.title.right <= layout.viewport + 1,
        `${label}: title panel extends outside the phone viewport`);
    }

    if (page.map) {
      // The legend is generated from the shared class table; if the shared
      // module failed to load, this is empty on both map pages.
      const legendDots = await tab.locator(".rv-dot").count();
      check(legendDots >= 5, `${label}: legend rendered ${legendDots} swatches`);
      check(/Without Lake Powell:/.test(await tab.locator("#statewideTotal").innerText()),
        `${label}: no statewide percentage excluding Lake Powell`);
    } else {
      // The overview's own three renderers, each of which can fail on its
      // own: the statewide chart, the size-first ranking, and the card
      // grid. Then the detail dialog, which is the only path from this page
      // to a reservoir's full record.
      check(await tab.locator("#stateChart svg rect").count() > 0,
        `${label}: statewide trend chart drew no bars`);
      const rankRows = await tab.locator(".rank-row").count();
      check(rankRows === expectedReservoirs,
        `${label}: ranking has ${rankRows} rows, expected ${expectedReservoirs}`);
      check((await tab.locator(".rank-row").first().innerText()).includes(largestReservoir),
        `${label}: ranking is not largest-first`);
      check((await tab.locator("#kpis").innerText()).includes("WITHOUT LAKE POWELL"),
        `${label}: no statewide KPI excluding Lake Powell`);
      const cards = await tab.locator(".mini").count();
      check(cards === expectedReservoirs,
        `${label}: ${cards} sparkline cards, expected ${expectedReservoirs}`);

      await tab.locator(".rank-row").first().click();
      await tab.waitForSelector("dialog#detail[open]", { timeout: 5000 });
      check(await tab.locator("#detailBody .rv-chart").count() === 1,
        `${label}: detail dialog opened without a trend chart`);
      check(/reservoir=/.test(tab.url()), `${label}: opening a detail did not deep-link`);
      await tab.keyboard.press("Escape");
    }

    await tab.screenshot({ path: `screenshots/${page.engine}-${viewport.name}.png`, fullPage: false });
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
    await tab.screenshot({ path: `screenshots/${page.engine}-${viewport.name}-failure.png` }).catch(() => {});
  }

  for (const err of errors) {
    console.log("  ERROR", err);
    failures.push(`${label}: ${err}`);
  }
  await context.close();
 }
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} smoke failure(s):`);
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log(`\nAll ${PAGES.length} pages rendered cleanly at ${VIEWPORTS.length} viewport sizes.`);
