import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { build } from "vite";

/*
 * The budget is measured against the real shell entry (`modern.html`), not
 * against a fixture listing the imports the shell was expected to make. A
 * fixture answers "is the planned import surface affordable"; only the entry
 * answers "is what we ship affordable", and the two drifted apart the moment
 * the shell started importing layers and geometry the fixture never named.
 *
 * Baseline measured on 2026-08-10, with P2.3's reservoir layers in place:
 *
 *   15.33 MiB raw / 5.39 MiB gzip across 1444 files
 *   2.07 MiB gzip on the static entry path
 *
 * Re-baselined on 2026-08-15, when Phase 4's ranking chart brought
 * @arcgis/charts-components into the primary entry behind a dynamic import:
 *
 *   23.58 MiB raw / 8.22 MiB gzip across 1547 files
 *   2.13 MiB gzip on the static entry path
 *
 * The growth is entirely lazily-loaded chart chunks -- the largest are the
 * charts package's own PDF-export machinery, which nothing here calls but
 * its chunk graph carries -- and the static entry path moved by 0.06 MiB.
 * The limits below sit above that deliberately. Most of the raw total is
 * lazily-loaded SDK the shell never requests, so the number that governs
 * what a reader waits for is the last one: the chunks the entry pulls in
 * statically. The headroom absorbs dependency patch releases; a change that
 * pushes past it is a change worth reading, not a threshold worth raising
 * without one.
 */
const MAX_RAW_BYTES = 26 * 1024 * 1024;
const MAX_GZIP_BYTES = 9 * 1024 * 1024;
const MAX_INITIAL_GZIP_BYTES = 2.3 * 1024 * 1024;

const result = await build({
  configFile: false,
  logLevel: "error",
  build: {
    minify: true,
    write: false,
    rollupOptions: {
      input: resolve("modern.html")
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
