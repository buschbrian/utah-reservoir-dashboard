/*
 * Publishes the six-digit hydrologic units that intersect Utah as a
 * versioned, committed GeoJSON file.
 *
 * The map pages currently query the USGS service live on every page load.
 * That is fine for a background outline and wrong for an assignment source:
 * which unit a reservoir belongs to must be reproducible, and it cannot be
 * if the polygons can change under us between two runs. Committing the file
 * is the same argument as `capacities.json` -- a boundary that shifts
 * silently underneath you is worse than one that is a year old.
 *
 *   node scripts/fetch-huc6.mjs            # writes huc6.geojson
 *   node scripts/fetch-huc6.mjs --dry-run  # report only, writes nothing
 *
 * The pages keep their live query for now. Phase 1.5 switches them to this
 * file once the reservoir records carry their assignments.
 *
 * **One generalized file serves both the assignment and the map**, which is
 * not what this script originally assumed. `tools/probe_huc_points.py`
 * measured the thing the guess was missing: no tracked reservoir sits closer
 * than 2.72 km to a unit boundary (median 14.04 km). Generalizing to roughly
 * 500 m is therefore five times finer than the closest call anyone has to
 * make, and it was verified directly -- all 53 assignments are identical to
 * the ungeneralized geometry.
 *
 * Measured 2026-08-09, 15 units, assignment mismatches against full
 * precision in the last column:
 *
 *     geometryPrecision=5, no generalization    718 KiB   33,646 pts   0
 *     maxAllowableOffset=0.001  (~100 m)        601 KiB   28,155 pts   0
 *     maxAllowableOffset=0.005  (~500 m)        146 KiB    6,764 pts   0   <- used
 *     maxAllowableOffset=0.01   (~1 km)          75 KiB    3,414 pts   0
 *
 * 0.01 also loses nothing today, and is not worth the extra 71 KiB of
 * margin: at ~1 km it is within the same order as the 2.72 km closest
 * approach, so one reservoir added near a divide could quietly flip. 0.005
 * keeps a real margin at a size that is still fine to commit and to send to
 * a phone.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SERVICE = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/3";
const QUERY = new URLSearchParams({
  where: "states LIKE '%UT%'",
  outFields: "huc6,name,states",
  returnGeometry: "true",
  outSR: "4326",
  geometryPrecision: "5",
  // Roughly 500 m. See the size/accuracy table above; this is a measured
  // choice, not a default.
  maxAllowableOffset: "0.005",
  f: "geojson"
});
const OUT = resolve(process.cwd(), "huc6.geojson");
const EXPECTED_UNITS = 15;
const dryRun = process.argv.includes("--dry-run");

const response = await fetch(`${SERVICE}/query?${QUERY}`);
if (!response.ok) {
  console.error(`The watershed service answered ${response.status}.`);
  process.exit(1);
}
const collection = await response.json();

// An ArcGIS service reports its own failures with HTTP 200 and an `error`
// body, so a status check alone is not enough.
if (collection.error) {
  console.error(`The watershed service reported: ${collection.error.message}`);
  process.exit(1);
}

const features = (collection.features ?? []).filter((feature) =>
  feature?.geometry && feature.properties?.huc6);
if (features.length !== EXPECTED_UNITS) {
  console.error(
    `Expected ${EXPECTED_UNITS} units that touch Utah, received ${features.length}. ` +
    "The service's `states` field or its layer numbering has changed; check " +
    "before committing a different set of boundaries."
  );
  process.exit(1);
}

features.sort((a, b) => a.properties.huc6.localeCompare(b.properties.huc6));
const published = {
  type: "FeatureCollection",
  // Not the run date: a timestamp that changes on every run would make this
  // file look modified when the boundaries did not move.
  source: SERVICE,
  filter: QUERY.get("where"),
  unit_count: features.length,
  features: features.map((feature) => ({
    type: "Feature",
    properties: {
      huc6: feature.properties.huc6,
      name: feature.properties.name,
      states: feature.properties.states
    },
    geometry: feature.geometry
  }))
};

// Compact, not pretty-printed: one space of indent per line nearly doubles
// the file for a payload nobody reads by eye.
const body = `${JSON.stringify(published)}\n`;
for (const feature of published.features) {
  console.log(`  ${feature.properties.huc6}  ${feature.properties.name}` +
    `  (${feature.properties.states})`);
}
console.log(`\n${features.length} units, ${(body.length / 1024).toFixed(0)} KiB.`);

if (dryRun) {
  console.log("Dry run: nothing written.");
} else {
  const before = await readFile(OUT, "utf8").catch(() => null);
  await writeFile(OUT, body);
  console.log(before === body ? "huc6.geojson unchanged." : "huc6.geojson written.");
}
