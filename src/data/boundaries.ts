/*
 * The geographic context the maps draw from this project's own files: the
 * roster of drainage areas in the published scope.
 *
 * Fetched at runtime, never imported (ADR-002), and arrives in
 * `reference.json`. The drainage areas are no longer geometry at all --
 * their outlines come from the hosted Watershed Boundary Dataset, and what
 * travels here is which areas are in scope and what each is called, read
 * out of the same committed file the pipeline assigns reservoirs with. That
 * file went from 1,001 KB to 21 KB when the polygons left it.
 *
 * The translucent mask over everything outside Utah that used to live here
 * is gone (ADR-067): a grey overlay outside one state contradicted a
 * dashboard that now draws 75 basins across 11 states. `utah-boundary.geojson`
 * still exists and is still reviewed -- it just stopped travelling to the
 * browser, the same state `normals.json` is already in -- because Python's
 * `in_utah` and `intersects_utah` classification still reads it directly.
 *
 * Failure here is deliberately soft. A missing or malformed boundary file
 * costs the reader context; it must not cost them the reservoirs, which are
 * the point of the page.
 */

import { fetchWithin } from "./fetch";

export const DRAINAGE_FILL = "rgba(226,232,239,0.22)";
export const DRAINAGE_LINE = "#6f8498";

/**
 * One drainage area in the published scope: which it is and what it is
 * called. No geometry.
 *
 * The outlines come from the hosted Watershed Boundary Dataset now, quantized
 * to the view (`arcgis/watershed-layers.ts`), so what this file carries is
 * the roster rather than the shapes. The codes are read out of the same
 * committed GeoJSON the pipeline assigns reservoirs with, which is what keeps
 * a drawn outline from disagreeing with the area a reservoir was assigned to
 * -- the guarantee ADR-018 was written for, kept without shipping a megabyte
 * to keep it.
 */
/**
 * A drainage area's published box: west, south, east and north corners as
 * one pair of coordinates each, in the shape `src/viz/extent.ts` already
 * writes `HUC6_BOUNDS` and `MAP_BOUNDS` in.
 *
 * The wire format is the flat four-number `bbox` GeoJSON already uses for
 * this; this is that array reshaped once, on the way in, so every caller
 * downstream works with corners rather than remembering which index is
 * which.
 */
export type DrainageAreaBox = readonly [readonly [number, number], readonly [number, number]];

/**
 * One drainage area in the published scope: which it is, what it is
 * called, and roughly where it sits. No geometry.
 *
 * The outlines come from the hosted Watershed Boundary Dataset now, quantized
 * to the view (`arcgis/watershed-layers.ts`), so what this file carries is
 * the roster rather than the shapes. The codes are read out of the same
 * committed GeoJSON the pipeline assigns reservoirs with, which is what keeps
 * a drawn outline from disagreeing with the area a reservoir was assigned to
 * -- the guarantee ADR-018 was written for, kept without shipping a megabyte
 * to keep it.
 *
 * `box` is optional rather than required for the same reason `name` falls
 * back to the code instead of failing the whole area: an area with a name
 * and no usable box is still an area worth drawing and worth listing, just
 * not one a chooser can open a map on by itself (`src/viz/extent.ts`).
 */
export interface DrainageArea {
  huc6: string;
  name: string;
  /** State codes as the national boundary dataset publishes them. */
  states: string;
  /** West, south, east, north -- present when the export published a usable
   * one for this area. */
  box?: DrainageAreaBox;
}

/**
 * Exported so `data/opening-scope.ts` -- which walks this same
 * `geography.watersheds.scopes` shape to reach the one scope
 * `referenceGeography` cannot resolve for it (region, deliberately absent
 * from `drawn_scopes`) -- checks a payload's shape the identical way this
 * file does, rather than keeping a second, separately-maintained copy of
 * the same guard that could silently drift from this one.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reshapes a published `[west, south, east, north]` array into the corner
 * pair this codebase already writes boxes in, or returns `null` for
 * anything that is not a usable box.
 *
 * Checked rather than trusted, the same way every other field arriving from
 * `reference.json` is: four finite numbers, west no greater than east and
 * south no greater than north. A box failing that last check is not a
 * smaller area, it is a sign the four numbers do not describe a box at all
 * -- worth dropping rather than handing a caller an inverted extent that
 * silently contains everywhere except the area it names.
 */
function toBox(value: unknown): DrainageAreaBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [west, south, east, north] = value as unknown[];
  if (typeof west !== "number" || typeof south !== "number"
    || typeof east !== "number" || typeof north !== "number") return null;
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west > east || south > north) return null;
  return [[west, south], [east, north]];
}

/** Where the reference export is published (ADR-018). */
const REFERENCE_URL = import.meta.env.DEV ? "./reference.json" : "./data/reference.json";

/**
 * The export shape this build understands.
 *
 * Checked rather than assumed. A payload written to a later shape is not a
 * payload with a few unfamiliar keys in it -- it is one whose outlines may
 * live somewhere else entirely, and drawing whatever happens to parse out of
 * it is how a map ends up confidently wrong. An unrecognised version reads
 * as no boundaries, which is a case both callers already handle.
 *
 * 4 since ADR-067 dropped the state outline: a reader still on 3 would
 * otherwise be handed a `state` field that silently stopped meaning
 * anything, and that is exactly the confidently-wrong case this version
 * check exists to refuse.
 */
export const REFERENCE_SCHEMA_VERSION = 4;

export interface ReferenceGeography {
  /** The levels a reader may choose between, ascending. Empty when the export
   * offers none, in which case the default scope's level is the only one. */
  levels: number[];
  /** The published scope's hydrologic level, which decides both the service
   * layer the outlines come from and the attribute each code arrives in.
   * Read from the payload rather than assumed: which geography this site
   * draws is the export's answer to give (ADR-018), and the size of it is
   * part of that answer. */
  level: number;
  /** The published scope's roster, for `parseDrainageUnits`. Codes and
   * names; the outlines are the hosted layer's. */
  drainage: unknown;
}

/**
 * The two collections the maps draw, taken from the reference export.
 *
 * Which scope is the published one is the export's answer to give, not this
 * module's: it names it in `default_scope`, and the research scopes travel
 * in the same file without being drawn (ADR-018). Reading the scope by name
 * from a constant here would be a second place deciding the dashboard's
 * geography, and the two would eventually disagree.
 */
export function referenceGeography(
  value: unknown, wanted?: number
): ReferenceGeography | null {
  if (!isObject(value) || value.schema_version !== REFERENCE_SCHEMA_VERSION) return null;
  const geography = isObject(value.geography) ? value.geography : null;
  if (!geography) return null;
  const watersheds = isObject(geography.watersheds) ? geography.watersheds : null;
  const scopes = watersheds && isObject(watersheds.scopes) ? watersheds.scopes : null;
  /* Which scope is drawn at which level is the export's answer to give
   * (ADR-064). A client scanning the scopes for one at the right level would
   * find `utah-connected` or `west-huc6` by dictionary order, which is a
   * geography chosen by accident. */
  const offered = isObject(watersheds?.drawn_scopes) ? watersheds.drawn_scopes : {};
  const levels = Object.entries(offered)
    .filter(([key, name]) => typeof name === "string" && Number.isInteger(Number(key))
      && !!scopes && isObject(scopes[name]))
    .map(([key]) => Number(key))
    .sort((a, b) => a - b);
  /* The reader's level when the export offers it, and the default otherwise:
   * a saved link to a level this site has stopped offering opens the map it
   * has rather than an empty one. */
  const name = wanted !== undefined && levels.includes(wanted)
    ? offered[String(wanted)]
    : watersheds?.default_scope;
  const scope = scopes && typeof name === "string" && isObject(scopes[name])
    ? scopes[name]
    : null;
  const level = scope && typeof scope.level === "number" ? scope.level : 0;
  return { drainage: scope ? scope.units : null, level, levels };
}

/* One request, not one per caller: `loadDrainageScope` and
 * `loadOfferedLevels` both want the same file, so the request is shared
 * while the failure is not -- each caller still decides on its own what to
 * do without its boundaries. Keyed by URL so a test can ask for a different
 * file without being handed the previous answer. */
const inFlight = new Map<string, Promise<unknown>>();

/** The reference export, fetched once per URL for as long as the page lives. */
export function loadReference(url = REFERENCE_URL): Promise<unknown> {
  let request = inFlight.get(url);
  if (!request) {
    request = fetchWithin(url).then((response) => response.json() as Promise<unknown>);
    inFlight.set(url, request);
  }
  return request;
}

/**
 * Reads the scope's roster, keeping every area it can understand and dropping
 * the ones it cannot. A single malformed entry must not cost the reader the
 * other thirteen.
 *
 * This replaced `parseDrainageAreas`, which read the same list out of a
 * GeoJSON collection and type-checked every coordinate pair on the main
 * thread on the way past -- about 982 KB of walking, on every map page, for
 * geometry the maps no longer draw from.
 */
export function parseDrainageUnits(value: unknown, level: number): DrainageArea[] {
  if (!Array.isArray(value) || !level) return [];
  /* The attribute follows the level, the same rule `watershed_scopes.py`
   * applies on the other side: a HUC-4 scope publishes `huc4`. Reading a
   * fixed `huc6` would parse a level-4 payload as no areas at all, which is
   * a blank map rather than an error. */
  const field = `huc${level}`;
  const areas: DrainageArea[] = [];
  for (const entry of value as unknown[]) {
    if (!isObject(entry)) continue;
    const code = entry[field];
    if (typeof code !== "string") continue;
    const area: DrainageArea = {
      huc6: code,
      name: typeof entry.name === "string" && entry.name !== "" ? entry.name : code,
      states: typeof entry.states === "string" ? entry.states : ""
    };
    /* A missing or malformed box costs this area its box, and nothing else
     * -- `toBox` returns `null` rather than throwing, and `box` stays
     * `undefined` rather than being set to a value nothing downstream can
     * trust. The area itself, and its 74 siblings, are unaffected either
     * way: only a chooser that wants to open a map on this one area loses
     * anything (`src/viz/extent.ts`). */
    const box = toBox(entry.bbox);
    if (box) area.box = box;
    areas.push(area);
  }
  return areas;
}

/**
 * The published scope: how big its areas are, and which they are.
 *
 * The level travels with the areas because every caller needs both and
 * neither is derivable from the other. A caller that took the areas alone
 * would have to assume a level to ask the hosted service for the right
 * outlines, and assuming six is what this exists to stop.
 */
export interface DrainageScope {
  level: number;
  areas: DrainageArea[];
}

/**
 * The levels this site's figures exist at.
 *
 * Six is where every figure is keyed and where the maps open. Four and two
 * are the others a reader may choose (ADR-064, ADR-073), and they are on this
 * list because the figures are *published* there -- drought coverage computed
 * per level, storage regrouped on a code prefix, snow recomputed from its
 * sites -- and not because the outlines can be drawn at them.
 *
 * That is the whole condition. Drawing a scope at a size no figure describes
 * puts shapes on the map whose hover cards come back empty, so a level that
 * is not on this list draws and says so out loud (ADR-050).
 */
export const JOINABLE_LEVELS: readonly number[] = [2, 4, 6];

/** Where every map opens, and what a reader who chooses nothing gets. */
export const DEFAULT_LEVEL = 6;

export async function loadDrainageScope(
  level?: number, url = REFERENCE_URL
): Promise<DrainageScope> {
  const geography = referenceGeography(await loadReference(url), level);
  const drawn = geography?.level ?? 0;
  const areas = parseDrainageUnits(geography?.drainage, drawn);
  if (drawn && !JOINABLE_LEVELS.includes(drawn)) {
    console.warn(
      `The published scope is at hydrologic level ${drawn}, and this site's ` +
      `figures exist at ${JOINABLE_LEVELS.join(" and ")}. The areas will draw ` +
      "and their numbers will not join.");
  }
  return { level: drawn, areas };
}

/**
 * The levels the export offers, for a control to be built from.
 *
 * Never written down in the client: a level with no roster behind it is a
 * control that empties the map, and which levels have one is the pipeline's
 * answer. An export offering none leaves the reader with the default alone,
 * which is the state this site was in before ADR-064.
 */
export async function loadOfferedLevels(url = REFERENCE_URL): Promise<number[]> {
  const geography = referenceGeography(await loadReference(url));
  const offered = (geography?.levels ?? []).filter(
    (level) => JOINABLE_LEVELS.includes(level));
  return offered.length > 1 ? offered : [];
}
