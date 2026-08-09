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
 * Basemaps in preference order.
 *
 * The first two are what the current dashboard uses and were measured to
 * serve without credentials on 5.1.15. The third is the same underlying
 * tiles reached as a plain portal item, which survives the well-known id
 * being retired or re-gated. There is no fourth: running with no basemap and
 * saying so is better than a modal.
 */
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

export function basemapCandidates(): Candidate<Basemap>[] {
  return [
    { name: "Topographic", create: () => fromId("topo-vector") },
    { name: "Light gray canvas", create: () => fromId("gray-vector") },
    {
      name: "Topographic (direct item)",
      create: () => new Basemap({
        baseLayers: [new VectorTileLayer({ portalItem: { id: TOPOGRAPHIC_ITEM_ID } })]
      })
    }
  ];
}

export function resolveBasemap(
  candidates: readonly Candidate<Basemap>[] = basemapCandidates()
): Promise<Resolution<Basemap>> {
  return resolveFirstLoadable(candidates);
}
