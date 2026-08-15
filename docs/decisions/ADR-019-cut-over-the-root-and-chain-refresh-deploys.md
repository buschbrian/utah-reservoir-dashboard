# ADR-019: Put ArcGIS 5.1 at the root and deploy successful refreshes

## Status

Superseded by ADR-031

## Date

2026-08-13

## Context

ADR-012 kept the typed application at `modern.html` while it was incomplete.
ADR-016 later made that application the primary product, but it did not move
the root URL. The Pages artifact still copied the ArcGIS 4.34 page to
`index.html`, so the live site opened the legacy implementation even though
the current application was already deployed beside it.

The daily-data contract had a separate gap. `refresh-data.yml` commits its
result with the repository's `GITHUB_TOKEN`, while the Pages workflow listened
only for pushes to `main`. GitHub deliberately does not start another workflow
from most events created with that token. The refresh commits therefore
reached `main` without starting either the Pages workflow or its build. On
2026-08-13 the repository data was two days newer than the published copy.

## Decision

1. `index.html` is a Vite entry for the ArcGIS Maps SDK for JavaScript 5.1 and
   Calcite 5 application. The root URL is the primary production surface.
2. `modern.html` remains as a stable alias for existing links.
3. The ArcGIS 4.34 comparison moves to `legacy/index.html`. MapLibre remains at
   `maplibre/`, and the earlier analysis page remains at `explore.html`.
4. The Pages workflow runs after a successful `Refresh reservoir data`
   workflow as well as after a direct push to `main`. A failed refresh does not
   deploy.
5. Both the root application and every retained comparison URL remain browser
   smoke-test targets.

## Alternatives considered

### Redirect the root to `modern.html`

Rejected. A redirect adds a second navigation and makes the historical file
name the canonical production URL. Building the same application at both
entries keeps old links working without making the alias primary.

### Use a personal access token for refresh commits

Rejected. It would make the push trigger work, but adds a long-lived secret
only to bypass GitHub's recursion protection. `workflow_run` expresses the
intended handoff directly and keeps the repository token limited to the
refresh job.

### Remove the comparison pages

Rejected. They remain useful for renderer and accessibility comparisons. The
cutover changes their location and product status, not their availability.

## Consequences

- The live site opens the typed ArcGIS 5.1 application without a redirect.
- Bookmarks to `modern.html`, `maplibre/`, and `explore.html` keep working.
- The old ArcGIS root bookmark now opens the current application; the old
  implementation has a new explicit `/legacy/` URL.
- Each successful scheduled refresh starts one Pages build after the refresh
  workflow completes. A direct human push to `main` still deploys through the
  existing push trigger.
- The Pages build checks the current default branch, which is the branch the
  scheduled refresh updates.
