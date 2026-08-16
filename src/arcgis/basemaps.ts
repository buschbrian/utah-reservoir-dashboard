/* The one place the SDK singletons are touched.
 *
 * ./auth and ./fallback are deliberately SDK-free so the policy they encode
 * can be tested without a browser. This module is the seam: it passes the
 * real IdentityManager in, and expresses the basemap chain in terms of real
 * Basemap objects.
 */
import identityManager from "@arcgis/core/identity/IdentityManager";
import Basemap from "@arcgis/core/Basemap";
import VectorTileLayer from "@arcgis/core/layers/VectorTileLayer";
import { disableInteractiveAuth, type AuthPolicy, type SecuredResourceError } from "./auth";
import { resolveFirstLoadable, type Candidate, type Resolution } from "./fallback";

/** Public AGOL vector tile item behind `topo-vector`; verified to serve anonymously. */
const TOPOGRAPHIC_ITEM_ID = "7dc6cea0b1764a1f9af2e679f642f0f5";

/**
 * Installs the anonymous-only credential policy. Call once, before any layer
 * or basemap is constructed.
 */
export function installAnonymousAuthPolicy(
  onRefusal?: (error: SecuredResourceError) => void
): AuthPolicy {
  return disableInteractiveAuth(identityManager, onRefusal);
}

/**
 * Basemaps in preference order, per theme.
 *
 * The calm canvas that matches the page's theme leads: light gray canvas
 * for the light theme, dark gray canvas for the dark one, so the map is not
 * a bright rectangle on a dark page. Topographic and the light canvas stay
 * in every chain as fallbacks -- the dark canvas is the same keyless
 * well-known-id family as the two the spike verified, and if Esri ever
 * gates it the chain falls through to a background that still serves rather
 * than failing dark readers specifically. The last candidate reaches the
 * topographic tiles as a plain portal item, which survives the well-known
 * id being retired or re-gated. There is no further fallback: running with
 * no basemap and saying so is better than a modal.
 */
export type BasemapTheme = "light" | "dark";

/* `Basemap.fromId` is typed `Basemap | null | undefined` and really does
 * return null for an id it does not know -- notably any `arcgis/*` style id,
 * which reads like an auth failure and is not one. Throwing converts that
 * silent null into a candidate failure the chain can fall through, instead
 * of a null basemap handed to a MapView.
 */
function fromId(id: string): Basemap {
  const basemap = Basemap.fromId(id);
  if (!basemap) throw new Error(`"${id}" is not a known basemap id in this SDK version`);
  return basemap;
}

/* `Basemap.load()` resolves from the item description alone. `loadAll()`
 * loads the layers under it, which is where a key-gated or moved style
 * actually fails -- so this is the question the chain has to ask before
 * calling a candidate good. Without it the first choice "succeeds" onto a
 * blank frame and no fallback is ever taken. */
const verifyBasemap = (basemap: Basemap): Promise<unknown> => basemap.loadAll();

export function basemapCandidates(theme: BasemapTheme = "light"): Candidate<Basemap>[] {
  const darkCanvas: Candidate<Basemap> = {
    name: "Dark gray canvas", create: () => fromId("dark-gray-vector"), verify: verifyBasemap
  };
  const lightCanvas: Candidate<Basemap> = {
    name: "Light gray canvas", create: () => fromId("gray-vector"), verify: verifyBasemap
  };
  const topographic: Candidate<Basemap> = {
    name: "Topographic", create: () => fromId("topo-vector"), verify: verifyBasemap
  };
  const directItem: Candidate<Basemap> = {
    name: "Topographic (direct item)",
    create: () => new Basemap({
      baseLayers: [new VectorTileLayer({ portalItem: { id: TOPOGRAPHIC_ITEM_ID } })]
    }),
    verify: verifyBasemap
  };
  return theme === "dark"
    ? [darkCanvas, lightCanvas, topographic, directItem]
    : [lightCanvas, topographic, directItem];
}

export function resolveBasemap(
  theme: BasemapTheme = "light",
  candidates: readonly Candidate<Basemap>[] = basemapCandidates(theme)
): Promise<Resolution<Basemap>> {
  return resolveFirstLoadable(candidates);
}
