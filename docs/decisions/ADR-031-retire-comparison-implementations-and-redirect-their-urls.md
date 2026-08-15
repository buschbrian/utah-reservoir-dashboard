# ADR-031: Retire comparison implementations and redirect their URLs

## Status

Accepted

## Date

2026-08-15

## Context

ADR-019 put the typed ArcGIS 5.1 application at the root while retaining the
ArcGIS 4.34 map, MapLibre map, and earlier overview as working comparison
pages. That made the cut-over reversible and kept renderer evidence available
while the primary application was still settling.

The primary map and storage charts now cover the production behavior. They
share one navigation, validated runtime data, filters, URL state, failure
deadlines, accessible table, and browser release gate. Keeping three older
interfaces working no longer provides a second product benefit. It keeps old
CDN requests, an extra chart dependency, three interface contracts, and a
second browser suite in the deployment.

The old URLs are still a public contract. Removing their implementations does
not require turning saved links into missing pages. The primary application
also no longer needs MapLibre as its service-outage path: its code and data are
published with the site, it tries a bounded basemap chain, and it keeps local
reservoir and boundary layers available when every basemap is refused.

One legacy artifact remains load-bearing in source. ADR-008 makes
`ReservoirViz.CLASSES` in `shared/reservoir-viz.js` the canonical storage color
table, and typed tests use the rest of that frozen module as a porting oracle.
Retiring public pages must not silently move that ownership.

## Decision

1. The ArcGIS 5.1 application is the only maintained dashboard. `/` is the
   storage map, `/overview.html` is storage charts, and `/modern.html` remains
   a stable alias for `/`.
2. Keep the three former application URLs as small, accessible redirect pages:

   - `/legacy/` redirects to `/`;
   - `/maplibre/` redirects to `/`;
   - `/explore.html` redirects to `/overview.html`.

   Keep these redirect paths indefinitely. With scripts disabled, each page
   supplies a timed redirect and a visible link.
3. Preserve recognized view state without forwarding arbitrary parameters.
   Both map redirects retain the reservoir selection and current map filter
   names. They translate older `area` or `huc6` drainage values, `storage`
   class values, and supported `reporting` values. The earlier overview sends
   a reservoir selection to the current search field and translates its
   drainage-area choice. MapLibre-only basemap choices and unknown fields are
   dropped. Redirect navigation replaces the retired URL so Back does not
   create a loop.
4. Remove the retired application implementations from the published output.
   Stop publishing `shared/reservoir-viz.js`; remove Observable Plot from the
   production dependency graph; and replace renderer-parity browser checks
   with redirect-contract checks. Git history and `maplibre/README.md` retain
   the implementation and renderer findings.
5. Keep `shared/reservoir-viz.js` in source, unchanged except for its ownership
   explanation. It remains the ADR-008 color-table owner and a test oracle. A
   later decision may move that table and retire the oracle, but this ADR does
   not combine route retirement with a visual-class migration.
6. The primary application owns basemap-service failure. When one basemap
   fails it tries the next; when all fail it explains the missing background
   and keeps local dashboard data available. The project does not maintain a
   second rendering engine or a second no-SDK interface for a failure of the
   site's own JavaScript files.
7. Retain ADR-019's root application, `modern.html` alias, and successful
   refresh-to-deploy handoff. Supersede its decisions to publish and
   smoke-test complete comparison applications.

## Alternatives considered

### Delete the old URLs

Rejected. Permanent redirect pages are tiny and prevent saved links and
external references from becoming missing pages.

### Keep the implementations as an archive

Rejected. A live archive still downloads third-party code, needs security and
browser maintenance, and reads as a product promise even when it is absent
from navigation. Git history preserves the exact implementations without
publishing them.

### Keep MapLibre only for service outages

Rejected. It depends on its own external script and basemap services, so it is
not an offline copy of the dashboard. The primary application already has a
tested path that draws local data after every basemap candidate fails.

### Move the color table while removing the pages

Rejected for this change. That would supersede ADR-008 and change a visual
data contract inside a route-retirement patch. Keeping the frozen source
oracle costs no production bytes.

## Consequences

- Readers have one maintained interface and old bookmarks reach its closest
  current surface.
- The published artifact no longer contains ArcGIS 4.34, MapLibre, Observable
  Plot, or the shared legacy runtime.
- Browser testing becomes smaller: one suite verifies redirects and one suite
  verifies the complete ArcGIS application, storage charts, public API, and
  service-failure paths.
- A complete failure of the site's own JavaScript no longer has a separately
  maintained interface. The public JSON files remain available as data, not as
  a substitute dashboard.
- `shared/reservoir-viz.js` remains technical debt with an explicit purpose.
  Deleting it requires a later ADR that gives the color table a new canonical
  owner and replaces the parity tests deliberately.
- ADR-019 is superseded. Its root, alias, and deployment decisions continue
  here; its retained-comparison decisions do not.
