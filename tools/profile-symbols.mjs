/*
 * Measures what the composed CIM symbol and the filter effect cost, on the
 * machine you run it on.
 *
 * Phase 3.5 asks whether the baseline symbology is affordable on integrated
 * graphics. The decision rule was pre-registered in docs/PHASE-3-PLAN.md
 * before this file existed, deliberately: a threshold chosen after seeing
 * the number is not a threshold.
 *
 * WHY THIS IS NOT A TEST AND NOT A CI JOB
 *
 * The ArcGIS canvas renders blank in headless Chromium and
 * `requestAnimationFrame` never fires in a hidden browser pane (see
 * CLAUDE.md). A frame-time measurement taken there would report a perfect
 * score from a renderer that never drew anything, which is worse than no
 * measurement -- it would carry the authority of a number. So this refuses
 * to run rather than lie, it is excluded from `npm run build`, and it
 * asserts nothing. It prints a table for a human to paste into
 * MODERNIZATION_PLAN.md.
 *
 * It also reads the live payload only to have something to draw. It makes
 * no claim about reservoir counts or percentages, so a morning's refresh
 * cannot make it wrong.
 *
 *   npm run build && node tools/profile-symbols.mjs
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(REPO_ROOT, "dist");
const PORT = 8139;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript",
  ".json": "application/json", ".css": "text/css"
};

/** Repeats per arm. The first is discarded: it pays for shader compilation. */
const RUNS = 4;
/** How long each sampling window watches frames. */
const SAMPLE_MS = 3000;

if (process.env.CI) {
  console.error(
    "Refusing to run in CI. The ArcGIS canvas is blank in headless Chromium and\n" +
    "requestAnimationFrame does not fire, so any number produced here would be\n" +
    "measuring a renderer that never drew. Run it on a real machine.");
  process.exit(2);
}

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

/** Installs a frame sampler and a long-task observer in the page. */
const START_SAMPLER = `(() => {
  window.__samples = [];
  window.__longTasks = [];
  window.__sampling = true;
  let last = performance.now();
  const tick = (now) => {
    if (!window.__sampling) return;
    window.__samples.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    window.__observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(entry.duration);
    });
    window.__observer.observe({ entryTypes: ["longtask"] });
  } catch { /* older engines: long tasks simply go unreported */ }
})()`;

const STOP_SAMPLER = `(() => {
  window.__sampling = false;
  window.__observer?.disconnect();
  const samples = window.__samples.slice(1);
  return { samples, longTasks: window.__longTasks.slice() };
})()`;

function quantile(sorted, q) {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[index];
}

function summarise(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    frames: sorted.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95)
  };
}

const round = (value) => Math.round(value * 100) / 100;

async function assertPainting(tab, where) {
  const alive = await tab.evaluate(`new Promise((resolve) => {
    let fired = 0;
    const stop = setTimeout(() => resolve(fired), 1000);
    const tick = () => { fired += 1; if (fired > 2) { clearTimeout(stop); resolve(fired); }
      else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })`);
  if (!alive || alive < 2) {
    throw new Error(
      `The page is not painting (${where}): requestAnimationFrame fired ${alive} times in 1s.\n` +
      "Bring the browser window to the front and leave it visible for the run.");
  }
}

/** One sampling window, with the page driven through a fixed path. */
async function measure(tab, { withLayer }) {
  await tab.evaluate((keep) => {
    const map = document.querySelector("arcgis-map")?.map;
    const layer = map?.findLayerById("reservoirs");
    if (layer) layer.visible = keep;
  }, withLayer);

  await assertPainting(tab, withLayer ? "with layer" : "without layer");
  await tab.evaluate(START_SAMPLER);

  // A fixed pan/zoom path inside the constrained extent, then the filter
  // path, which is the only interaction that touches every feature at once.
  await tab.evaluate(async (ms) => {
    const view = document.querySelector("arcgis-map").view;
    const legs = [
      { center: [-112.5, 40.5], zoom: 7 },
      { center: [-110.5, 38.5], zoom: 8 },
      { center: [-111.6, 39.6], zoom: 6.5 }
    ];
    const started = performance.now();
    let leg = 0;
    while (performance.now() - started < ms) {
      await view.goTo(legs[leg % legs.length], { animate: true, duration: 700 })
        .catch(() => undefined);
      leg += 1;
    }
  }, SAMPLE_MS);

  const pan = await tab.evaluate(STOP_SAMPLER);

  // Filter apply, measured on its own so a long task can be attributed.
  await tab.evaluate(START_SAMPLER);
  const applied = await tab.evaluate(async () => {
    const select = document.querySelector('#start-panel [data-filter="reporting"]');
    const marks = [];
    for (const value of ["late", "current", "all"]) {
      const before = performance.now();
      select.value = value;
      select.dispatchEvent(new CustomEvent("calciteSelectChange", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      marks.push(performance.now() - before);
    }
    return marks;
  });
  const filter = await tab.evaluate(STOP_SAMPLER);

  return {
    pan: summarise(pan.samples),
    panLongTasks: pan.longTasks,
    filter: summarise(filter.samples),
    filterLongTasks: filter.longTasks,
    filterApplyMs: applied
  };
}

await new Promise((resolve) => server.listen(PORT, resolve));
const browser = await chromium.launch({
  headless: false,
  args: ["--window-position=0,0", "--window-size=1400,1000"],
  // The same escape hatch the two browser gates carry: a machine with Google
  // Chrome installed does not need a second Chromium downloaded to measure
  // its own GPU. The number is about the renderer, not about the wrapper.
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {})
});

const results = { baselineIdle: null, withLayer: [], withoutLayer: [] };

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tab = await context.newPage();
  await tab.goto(`http://127.0.0.1:${PORT}/modern.html`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await tab.bringToFront();
  await tab.waitForFunction("window.__dashboardReady !== undefined", { timeout: 60000 });
  await tab.waitForFunction("window.__dashboardReady.drawn > 0", { timeout: 60000 });

  await assertPainting(tab, "startup");

  // The frame budget of THIS machine. Every threshold below is in units of
  // this, not in milliseconds picked from the air.
  await tab.evaluate(START_SAMPLER);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const idle = await tab.evaluate(STOP_SAMPLER);
  results.baselineIdle = summarise(idle.samples);

  for (let run = 0; run < RUNS; run += 1) {
    results.withLayer.push(await measure(tab, { withLayer: true }));
    results.withoutLayer.push(await measure(tab, { withLayer: false }));
  }
} finally {
  await browser.close();
  server.close();
}

// The first run of each arm pays for shader compilation; drop it.
const kept = (arm) => arm.slice(1);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const budget = results.baselineIdle.p50;
const withPan = kept(results.withLayer).map((r) => r.pan);
const withoutPan = kept(results.withoutLayer).map((r) => r.pan);
const withP95 = median(withPan.map((p) => p.p95));
const withP50 = median(withPan.map((p) => p.p50));
const withoutP50 = median(withoutPan.map((p) => p.p50));
const spread = Math.max(...withoutPan.map((p) => p.p50)) - Math.min(...withoutPan.map((p) => p.p50));
const longTasks = kept(results.withLayer)
  .flatMap((r) => [...r.panLongTasks, ...r.filterLongTasks]).filter((d) => d > 50);

console.log(`
| Measurement | Value |
|---|---|
| Frame budget (median idle interval) | ${round(budget)} ms |
| Pan p50, reservoirs drawn | ${round(withP50)} ms |
| Pan p95, reservoirs drawn | ${round(withP95)} ms |
| Pan p50, reservoirs hidden | ${round(withoutP50)} ms |
| Layer's share of the median frame | ${round(withP50 - withoutP50)} ms |
| Run-to-run spread (noise floor) | ${round(spread)} ms |
| Tasks over 50 ms | ${longTasks.length} |
| Filter apply, per change | ${kept(results.withLayer).flatMap((r) => r.filterApplyMs).map(round).join(", ")} ms |

Pre-registered rule (docs/PHASE-3-PLAN.md 3.5):
  pan p95 <= 2x budget            -> ${round(withP95)} <= ${round(budget * 2)}  ${withP95 <= budget * 2 ? "PASS" : "FAIL"}
  layer share <= 0.25x budget     -> ${round(withP50 - withoutP50)} <= ${round(budget * 0.25)}  ${(withP50 - withoutP50) <= budget * 0.25 ? "PASS" : "FAIL"}
  no task over 50 ms              -> ${longTasks.length} found  ${longTasks.length === 0 ? "PASS" : "FAIL"}

A difference smaller than the noise floor above is not a result.
Record the machine, the GPU and the browser version alongside this table.
`);
