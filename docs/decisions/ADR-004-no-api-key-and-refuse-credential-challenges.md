# ADR-004: Run the ArcGIS map without an API key, and refuse credential challenges

## Status

Accepted

## Date

2026-08-09

## Context

Moving to ArcGIS Maps SDK 5.x raised a question the plan could not answer from
a desk: do the basemaps this dashboard uses still work without authentication?
The dashboard is a public page with no sign-in and no secrets to hold.

Measured against `@arcgis/core` 5.1.15 in a browser with no API key and no
ArcGIS session, loading each basemap and then fetching the service URLs it
resolved to. Two identical runs:

| Construction | Result |
|---|---|
| `Basemap.fromId("topo-vector")` | **Keyless.** 2 layers loaded, both service URLs 200 |
| `Basemap.fromId("gray-vector")` | **Keyless.** 2 layers loaded, both service URLs 200 |
| `new VectorTileLayer({ portalItem })` | **Keyless.** Public AGOL item, 200 |
| `new Basemap({ style: { id: "arcgis/topographic" } })` | **401**, then an interactive sign-in prompt |
| `new Basemap({ style: { id: "arcgis/outdoor" } })` | **401**, same |

The split is by *service*, not by SDK version: the well-known 4.x ids still
resolve to public ArcGIS Online vector tile items. It is the **basemap styles
service** that is key-gated, and nothing forces us onto it.

The more important finding was the *failure mode*. A 401 did not produce a
blank basemap. It produced a **username and password modal on a public
dashboard**, and then left the load promise pending — a measured 20-second
hang. Basemaps are only the example; any secured resource funnels through the
same path, and later phases add exactly those.

## Decision

1. **No API key.** Keep the keyless well-known basemap ids (`topo-vector`,
   `gray-vector`, `streets-vector`, `satellite`).
2. **Refuse credential challenges outright**, in `src/arcgis/auth.ts`, by
   overriding `IdentityManager.getCredential` to reject.
3. **Fall through a chain of candidates** rather than failing to a blank map:
   `topo-vector` → `gray-vector` → the same tiles as a direct portal item →
   nothing, with a notice.

## Alternatives Considered

### Take an API key and use the modern `arcgis/*` styles

- Pros: access to the current basemap styles and the gallery built on them.
- Cons: a credential to hold, rotate and leak; metering; and it buys only
  styling.
- Rejected for now. A key remains an optional upgrade, worth taking only if
  those styles are judged visibly better.

### Hide the credential dialog instead of rejecting

- Rejected on measurement. Hiding the dialog leaves the load promise **pending
  forever**, which is the 20-second hang with the symptom removed. The policy
  must reject so the caller gets an answer.

## Consequences

- Measured after the change: a key-gated style fails in **54 ms with no
  modal**, and the fallback chain renders `topo-vector`.
- **The SDK rewraps the error.** Callers receive `[request:server]: <our
  message>` — an esri request error, not ours — so `instanceof` checks are
  false downstream. Detection must match on content, via
  `isSecuredResourceRefusal()`, never `instanceof`.
- **`Basemap.fromId()` returns `Basemap | null | undefined`** and really does
  return null for an unknown id. That reads like an auth failure and is not
  one. `src/arcgis/basemaps.ts` converts a null into a thrown candidate failure
  so it can never reach a `MapView`. Never call `Basemap.fromId()` with a
  *style* id.
- Residual risk: Esri could meter or retire the public AGOL basemap items.
  Re-run the spike at each SDK upgrade.
- The end-to-end guard is still missing. The policy is unit-tested against a
  fake `IdentityManager`, but nothing yet asserts in a browser that no password
  input can appear. That belongs in the Playwright run.
