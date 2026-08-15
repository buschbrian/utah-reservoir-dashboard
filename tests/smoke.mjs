/* Browser contract for the three retired application paths (ADR-031).
 *
 * Their implementations are gone, but saved links still need to reach the
 * closest current surface without carrying retired or unknown settings. The
 * destination documents are fulfilled with tiny fixtures: this suite tests
 * redirects, while smoke-modern.mjs owns the complete current applications.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(REPO_ROOT, "dist");
const PORT = 8137;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript" };

const server = createServer(async (request, response) => {
  let relative = decodeURIComponent(request.url.split("?")[0]);
  if (relative.endsWith("/")) relative += "index.html";
  const file = path.join(ROOT, relative);
  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] || "text/plain" });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});

const cases = [
  {
    name: "ArcGIS 4.34 map",
    path: "/legacy/?reservoir=Flaming+Gorge&area=140401&storage=2&reporting=late&basemap=streets&unknown=drop",
    destination: "/",
    query: { reservoir: "Flaming Gorge", drainage: "140401", class: "2", late: "true" }
  },
  {
    name: "MapLibre map",
    path: "/maplibre/?reservoir=Ken%27s+Lake&huc6=160300&late=false&basemap=voyager",
    destination: "/",
    query: { reservoir: "Ken's Lake", drainage: "160300", late: "false" }
  },
  {
    name: "earlier overview",
    path: "/explore.html?reservoir=Deer+Creek&area=140600&storage=1&reporting=monthly&sort=percent&unknown=drop",
    destination: "/overview.html",
    query: {
      q: "Deer Creek", area: "140600", storage: "1",
      reporting: "monthly", sort: "percent"
    }
  }
];

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
  { name: "small-phone", width: 360, height: 780 }
];

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

// The script-free path is part of the contract as well: one timed redirect
// and one ordinary link on every retired route.
for (const item of [
  ["legacy/index.html", "../"],
  ["maplibre/index.html", "../"],
  ["explore.html", "./overview.html"]
]) {
  const source = await readFile(path.join(REPO_ROOT, item[0]), "utf8");
  check(source.includes(`http-equiv="refresh" content="1; url=${item[1]}"`),
    `${item[0]} has no script-free redirect to ${item[1]}`);
  check(source.includes(`id="continue-link" href="${item[1]}"`),
    `${item[0]} has no visible link to ${item[1]}`);
}

await new Promise((resolve) => server.listen(PORT, resolve));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
  : {});

async function runCase(viewport, testCase) {
  const label = `${testCase.name} redirect (${viewport.name})`;
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  const retiredRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (/js\.arcgis\.com|unpkg\.com|cartocdn|observablehq/i.test(request.url())) {
      retiredRequests.push(request.url());
    }
  });

  // The current surfaces have their own complete smoke suite. A small
  // response here makes this test about compatibility routing only.
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/" || url.pathname === "/overview.html") {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><body><main id='destination'>Current dashboard</main></body></html>"
      });
    } else {
      await route.continue();
    }
  });

  try {
    await page.goto(`${ORIGIN}${testCase.path}`, { waitUntil: "commit", timeout: 10000 });
    await page.waitForURL((value) => value.pathname === testCase.destination,
      { timeout: 10000 });
    const final = new URL(page.url());
    const actual = Object.fromEntries(final.searchParams);
    const actualEntries = Object.entries(actual).sort(([a], [b]) => a.localeCompare(b));
    const expectedEntries = Object.entries(testCase.query).sort(([a], [b]) => a.localeCompare(b));
    check(JSON.stringify(actualEntries) === JSON.stringify(expectedEntries),
      `${label}: redirected with ${JSON.stringify(actual)}, expected ${JSON.stringify(testCase.query)}`);
    check(await page.locator("#destination").count() === 1,
      `${label}: did not reach the current dashboard`);
    check(retiredRequests.length === 0,
      `${label}: requested a retired runtime (${retiredRequests.join(", ")})`);
    check(errors.length === 0, `${label}: browser errors: ${errors.join("; ")}`);
    console.log(`✓ ${label} → ${final.pathname}${final.search}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  } finally {
    await context.close();
  }
}

try {
  // Every case has its own context, route stub and assertions; nothing
  // orders them, so they all run at once.
  await Promise.all(viewports.flatMap((viewport) =>
    cases.map((testCase) => runCase(viewport, testCase))));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exitCode = 1;
} else {
  console.log("\nAll retired routes reached the correct current surface at 3 viewport sizes.");
}
