/*
 * Publishes Utah's authoritative administrative boundary as committed
 * GeoJSON. The source is the Utah Geospatial Resource Center (UGRC), which
 * maintains the state boundary with the Lieutenant Governor's Office.
 * Keeping a local copy makes the mask reproducible and prevents a boundary
 * service outage from blanking geographic context.
 *
 *   node scripts/fetch-utah-boundary.mjs
 *   node scripts/fetch-utah-boundary.mjs --dry-run
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SERVICE =
  "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahStateBoundary/FeatureServer/0";
const QUERY = new URLSearchParams({
  // The layer also publishes a precomputed outside-state mask. We keep the
  // Utah polygon itself so the same authoritative geometry can support both
  // the outline and point-in-state validation.
  where: "STATE='Utah'",
  outFields: "*",
  returnGeometry: "true",
  outSR: "4326",
  geometryPrecision: "5",
  // About 10 metres at Utah's latitude: finer than the offsets readers can
  // distinguish at the dashboard's map scales, without shipping survey-grade
  // vertex density to every phone.
  maxAllowableOffset: "0.0001",
  f: "geojson"
});
const OUT = resolve(process.cwd(), "utah-boundary.geojson");
const dryRun = process.argv.includes("--dry-run");

const response = await fetch(`${SERVICE}/query?${QUERY}`);
if (!response.ok) {
  console.error(`The Utah boundary service answered ${response.status}.`);
  process.exit(1);
}
const collection = await response.json();
if (collection.error) {
  console.error(`The Utah boundary service reported: ${collection.error.message}`);
  process.exit(1);
}

const features = (collection.features ?? []).filter((feature) =>
  feature?.geometry?.type === "Polygon" || feature?.geometry?.type === "MultiPolygon");
if (features.length !== 1) {
  console.error(`Expected one Utah boundary feature, received ${features.length}.`);
  process.exit(1);
}

const sourceFeature = features[0];

function signedArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[index + 1];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

function normalizedPolygon(rings) {
  return rings.map((ring, index) => {
    // RFC 7946 right-hand rule: exterior counterclockwise, holes clockwise.
    const shouldReverse = index === 0 ? signedArea(ring) < 0 : signedArea(ring) > 0;
    return shouldReverse ? ring.slice().reverse() : ring;
  });
}

const sourceGeometry = sourceFeature.geometry;
const normalizedGeometry = sourceGeometry.type === "Polygon"
  ? { type: "Polygon", coordinates: normalizedPolygon(sourceGeometry.coordinates) }
  : {
      type: "MultiPolygon",
      coordinates: sourceGeometry.coordinates.map(normalizedPolygon)
    };
const published = {
  type: "FeatureCollection",
  source: SERVICE,
  feature_count: 1,
  features: [{
    type: "Feature",
    properties: { name: "Utah" },
    geometry: normalizedGeometry
  }]
};
const body = `${JSON.stringify(published)}\n`;
console.log(`Utah boundary: ${(body.length / 1024).toFixed(0)} KiB.`);

if (dryRun) {
  console.log("Dry run: nothing written.");
} else {
  const before = await readFile(OUT, "utf8").catch(() => null);
  await writeFile(OUT, body);
  console.log(before === body
    ? "utah-boundary.geojson unchanged."
    : "utah-boundary.geojson written.");
}
