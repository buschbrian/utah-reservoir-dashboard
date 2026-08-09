import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { build } from "vite";

// Initial ceiling for the planned Phase 2 import surface. This deliberately
// has headroom over the measured baseline so dependency patch releases do not
// create noise. Phase 2 must switch the input to the real shell and re-baseline.
const MAX_RAW_BYTES = 18 * 1024 * 1024;
const MAX_GZIP_BYTES = 6 * 1024 * 1024;
const MAX_INITIAL_GZIP_BYTES = 2.5 * 1024 * 1024;

const result = await build({
  configFile: false,
  logLevel: "error",
  build: {
    minify: true,
    write: false,
    rollupOptions: {
      input: resolve("src/arcgis/sdk-bundle.fixture.ts")
    }
  }
});

const builds = Array.isArray(result) ? result : [result];
const files = builds.flatMap((item) => item.output);
const builtFiles = files.flatMap((file) => {
  let payload;
  if (file.type === "chunk") payload = Buffer.from(file.code);
  if (typeof file.source === "string") payload = Buffer.from(file.source);
  if (file.source instanceof Uint8Array) payload = Buffer.from(file.source);
  return payload ? [{ name: file.fileName, payload }] : [];
});
const payloads = builtFiles.map(({ payload }) => payload);
const rawBytes = payloads.reduce((sum, payload) => sum + payload.byteLength, 0);
const gzipBytes = payloads.reduce((sum, payload) => sum + gzipSync(payload).byteLength, 0);

const chunksByName = new Map(
  files.filter((file) => file.type === "chunk").map((file) => [file.fileName, file])
);
const staticFiles = new Set();
function visitStaticImports(fileName) {
  if (staticFiles.has(fileName)) return;
  staticFiles.add(fileName);
  const chunk = chunksByName.get(fileName);
  if (!chunk) return;
  for (const imported of chunk.imports) visitStaticImports(imported);
  for (const css of chunk.viteMetadata?.importedCss ?? []) staticFiles.add(css);
  for (const asset of chunk.viteMetadata?.importedAssets ?? []) staticFiles.add(asset);
}
for (const entry of files.filter((file) => file.type === "chunk" && file.isEntry)) {
  visitStaticImports(entry.fileName);
}
const initialGzipBytes = builtFiles
  .filter(({ name }) => staticFiles.has(name))
  .reduce((sum, { payload }) => sum + gzipSync(payload).byteLength, 0);

const mib = (bytes) => (bytes / 1024 / 1024).toFixed(2);
const largest = builtFiles
  .map(({ name, payload }) => ({ name, gzipBytes: gzipSync(payload).byteLength }))
  .sort((a, b) => b.gzipBytes - a.gzipBytes)
  .slice(0, 5)
  .map(({ name, gzipBytes: bytes }) => `${name} (${mib(bytes)} MiB gzip)`)
  .join(", ");
console.log(
  `SDK shell baseline: ${mib(rawBytes)} MiB raw / ${mib(gzipBytes)} MiB gzip ` +
  `across ${builtFiles.length} files; ${mib(initialGzipBytes)} MiB gzip on the static entry path` +
  `\nLargest: ${largest}`
);

if (rawBytes > MAX_RAW_BYTES || gzipBytes > MAX_GZIP_BYTES ||
    initialGzipBytes > MAX_INITIAL_GZIP_BYTES) {
  throw new Error(
    `SDK shell bundle exceeds budget: ${rawBytes} raw / ${gzipBytes} gzip / ` +
    `${initialGzipBytes} initial gzip bytes (limits ${MAX_RAW_BYTES} / ` +
    `${MAX_GZIP_BYTES} / ${MAX_INITIAL_GZIP_BYTES})`
  );
}
