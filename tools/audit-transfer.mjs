/*
 * What a reader actually downloads to open each page, and from where.
 *
 * The SDK budget in `scripts/check-sdk-bundle.mjs` measures the bundler's
 * graph: what the entry *could* pull in. This measures the other thing, which
 * is the one a reader experiences -- what the browser really requested before
 * the page was usable, how many bytes came over the wire, and which hosts were
 * involved. The two disagree in both directions and both are worth knowing:
 * the graph counts chunks a reader may never fetch, and the wire counts
 * basemap tiles and font atlases that appear in no bundle at all.
 *
 * It answers three questions the modernization plan asks:
 *
 *   - are the lazily-loaded chunks actually lazy, or is something importing
 *     them on the way in;
 *   - what does each page weigh on first load;
 *   - which hosts does the application contact, which is the measurement a
 *     Content-Security-Policy has to be written from rather than guessed at.
 *
 * On demand, like `profile-symbols.mjs`. It needs a built `dist/` and a real
 * Chromium, and it reports rather than asserts -- the assertions that protect
 * the project live in the build budget and the browser suite.
 *
 *   npm run build
 *   node tools/audit-transfer.mjs
 *   node tools/audit-transfer.mjs --json    # for diffing between runs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
const DIST = path.join(REPO_ROOT, "dist");
const asJson = process.argv.includes("--json");

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".geojson": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
  ".pbf": "application/x-protobuf", ".wasm": "application/wasm"
};

const server = createServer(async (request, response) => {
  try {
    let file = decodeURIComponent(new URL(request.url, "http://local").pathname);
    if (file.endsWith("/")) file += "index.html";
    const full = path.join(DIST, file);
    const body = await readFile(full);
    response.writeHead(200, {
      "content-type": TYPES[path.extname(full)] ?? "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;

/* Each page, with the readiness signal that says it has finished its own
 * work. Waiting on a timer instead would measure the machine. */
const PAGES = [
  { name: "Storage map", file: "index.html", ready: "window.__dashboardReady !== undefined" },
  { name: "Storage charts", file: "overview.html", ready: "window.__overviewReady !== undefined" },
  { name: "Snowpack", file: "snow.html", ready: "window.__snowReady !== undefined" },
  { name: "Drought", file: "drought.html", ready: "window.__droughtReady !== undefined" },
  { name: "Methods", file: "methods.html", ready: "window.__methodsReady !== undefined" },
  { name: "Data reference", file: "data.html", ready: "window.__dataDocsReady !== undefined" }
];

/* Chunks that must not be on a page's first-load path, per page.
 *
 * Scoped rather than global, because "lazy" is a claim about a particular
 * entry. The charts module is the storage map's ranking chart, behind a
 * dynamic import that only runs when the reader opens that row -- so seeing
 * it there is a regression. Seeing it on the charts workspace is not: that
 * page is the charts. */
const LAZY_MARKERS = ["overview-charts", "charts-components"];
const LAZY_EXEMPT = new Set(["overview.html"]);

const kib = (bytes) => `${(bytes / 1024).toFixed(0)} KiB`;

async function auditPage(browser, page) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tab = await context.newPage();

  const requests = [];
  tab.on("response", async (response) => {
    const request = response.request();
    let bytes = 0;
    try {
      const header = (await response.allHeaders())["content-length"];
      bytes = header ? Number(header) : (await response.body().catch(() => Buffer.alloc(0))).length;
    } catch { bytes = 0; }
    requests.push({
      url: response.url(),
      host: new URL(response.url()).host,
      type: request.resourceType(),
      status: response.status(),
      bytes: Number.isFinite(bytes) ? bytes : 0
    });
  });

  await tab.goto(BASE + page.file, { waitUntil: "domcontentloaded", timeout: 60000 });
  await tab.waitForFunction(page.ready, { timeout: 60000 });
  /* A moment past readiness: the map and the charts keep fetching after the
   * page reports itself done, and those bytes are still a reader's bytes. */
  await tab.waitForTimeout(4000);

  const local = requests.filter((entry) => entry.host === new URL(BASE).host);
  const remote = requests.filter((entry) => entry.host !== new URL(BASE).host);
  const byHost = new Map();
  for (const entry of remote) {
    const current = byHost.get(entry.host) ?? { count: 0, bytes: 0 };
    byHost.set(entry.host, {
      count: current.count + 1, bytes: current.bytes + entry.bytes
    });
  }

  const lazyLoaded = LAZY_EXEMPT.has(page.file) ? [] : local.filter((entry) =>
    LAZY_MARKERS.some((marker) => entry.url.includes(marker)));
  const failures = requests.filter((entry) => entry.status >= 400);

  await context.close();
  return {
    page: page.name,
    file: page.file,
    requests: requests.length,
    localBytes: local.reduce((sum, entry) => sum + entry.bytes, 0),
    remoteBytes: remote.reduce((sum, entry) => sum + entry.bytes, 0),
    hosts: [...byHost.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([host, value]) => ({ host, ...value })),
    lazyLoaded: lazyLoaded.map((entry) => path.basename(new URL(entry.url).pathname)),
    failures: failures.map((entry) => `${entry.status} ${entry.url}`)
  };
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
});
const results = [];
for (const page of PAGES) results.push(await auditPage(browser, page));
await browser.close();
server.close();

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const result of results) {
    console.log(`\n=== ${result.page} (${result.file})`);
    /* Uncompressed: this static server sends no gzip, where GitHub Pages
     * does. The local figure is therefore an upper bound and is useful for
     * comparing runs, not for predicting what a reader waits for. */
    console.log(`  ${result.requests} requests · ${kib(result.localBytes)} from this site` +
      ` (uncompressed) · ${kib(result.remoteBytes)} from other hosts`);
    for (const host of result.hosts) {
      console.log(`    ${host.host}: ${host.count} request(s), ${kib(host.bytes)}`);
    }
    console.log(`  lazy chunks on the first-load path: ` +
      (result.lazyLoaded.length === 0 ? "none" : result.lazyLoaded.join(", ")));
    if (result.failures.length > 0) {
      console.log(`  FAILED REQUESTS:`);
      for (const failure of [...new Set(result.failures)]) console.log(`    ${failure}`);
    }
  }
  const everyHost = new Set(results.flatMap((r) => r.hosts.map((h) => h.host)));
  console.log(`\n=== Every host the application contacted`);
  for (const host of [...everyHost].sort()) console.log(`  ${host}`);
}
