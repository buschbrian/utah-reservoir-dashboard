# Architecture decision records

Why the project is built the way it is. Code shows what was built; these
explain why, and what was rejected on the way.

Each record is written when the decision is made and **not edited afterwards**
except to change its status. When a decision changes, add a new record that
supersedes the old one — the history is the point.

| | Decision | Status |
|---|---|---|
| [ADR-001](ADR-001-adopt-a-build-step.md) | Adopt a build step, retiring the zero-build constraint | Accepted |
| [ADR-002](ADR-002-data-is-copied-never-bundled.md) | Runtime data is copied into the published output, never bundled | Accepted |
| [ADR-003](ADR-003-capacity-from-the-national-inventory-of-dams.md) | Take reservoir capacity from the National Inventory of Dams | Accepted |
| [ADR-004](ADR-004-no-api-key-and-refuse-credential-challenges.md) | Run the ArcGIS map without an API key, and refuse credential challenges | Accepted |
| [ADR-005](ADR-005-commit-generalized-watershed-boundaries.md) | Commit one generalized watershed boundary file | Superseded by ADR-037 |
| [ADR-006](ADR-006-simplified-technical-english.md) | Write all visible text in Simplified Technical English | Accepted |
| [ADR-007](ADR-007-two-rendering-engines.md) | Keep two rendering engines, and keep the old pages live | Superseded by ADR-016 |
| [ADR-008](ADR-008-one-class-break-table.md) | One class-break table is the single source of truth for colour | Accepted |
| [ADR-009](ADR-009-geography-is-drainage-areas-that-touch-utah.md) | The dashboard's geography is drainage areas that intersect Utah | Superseded by ADR-010 |
| [ADR-010](ADR-010-colorado-and-great-basin-systems-only.md) | Narrow the geography to the Colorado and Great Basin systems | Accepted |
| [ADR-011](ADR-011-separate-location-scope-from-lake-powell.md) | Separate reservoir location from Lake Powell inclusion | Superseded by ADR-013 |
| [ADR-012](ADR-012-build-phase-2-beside-production.md) | Build the Phase 2 shell beside the production pages | Superseded by ADR-019 |
| [ADR-013](ADR-013-count-reservoirs-whose-waterbody-intersects-utah.md) | Count reservoirs whose waterbody intersects Utah | Accepted |
| [ADR-014](ADR-014-use-the-ugrc-utah-state-boundary.md) | Use the maintained UGRC Utah state boundary | Accepted |
| [ADR-015](ADR-015-confirm-a-dam-by-position-before-name.md) | Confirm a reservoir's dam by position before name | Accepted |
| [ADR-016](ADR-016-arcgis-is-the-primary-application.md) | Make ArcGIS the primary application and keep legacy pages for comparison | Superseded by ADR-019 |
| [ADR-017](ADR-017-map-geography-comes-from-the-drainage-areas.md) | The map's geography is derived from the drainage areas | Accepted |
| [ADR-018](ADR-018-reference-data-ships-as-one-versioned-export.md) | Capacity and geography ship as one versioned reference export | Accepted |
| [ADR-019](ADR-019-cut-over-the-root-and-chain-refresh-deploys.md) | Put ArcGIS 5.1 at the root and deploy successful refreshes | Superseded by ADR-031 |
| [ADR-020](ADR-020-every-published-reservoir-is-reachable.md) | Every published reservoir is reachable from the map | Accepted |
| [ADR-021](ADR-021-snow-telemetry-goes-on-a-view-of-its-own.md) | Snow telemetry goes on a view of its own | Accepted |
| [ADR-022](ADR-022-scale-the-reservoir-symbols-with-the-view.md) | Scale the reservoir symbols with the view | Superseded by ADR-025 |
| [ADR-023](ADR-023-fill-the-empty-drainage-areas.md) | Add reviewed sites to the empty drainage areas | Accepted |
| [ADR-024](ADR-024-use-full-resolution-watersheds-for-snow-sites.md) | Use full-resolution watersheds for snow sites | Accepted |
| [ADR-025](ADR-025-keep-map-symbols-fixed-and-label-each-drainage-area-once.md) | Keep map symbols fixed and label each drainage area once | Superseded by ADR-027 |
| [ADR-026](ADR-026-quote-machine-identifiers-in-api-documentation.md) | Quote machine identifiers in API documentation | Accepted |
| [ADR-027](ADR-027-use-css-pixels-for-map-symbols-and-opening-labels.md) | Use CSS pixels for map symbols and opening labels | Superseded by ADR-030 |
| [ADR-028](ADR-028-use-equal-bands-and-a-colorblind-safe-ramp.md) | Use equal storage bands and a colorblind-safe ramp | Accepted |
| [ADR-029](ADR-029-the-table-narrows-where-the-map-dims.md) | The table narrows where the map dims | Accepted |
| [ADR-030](ADR-030-draw-drainage-area-names-below-reservoirs.md) | Draw drainage-area names below reservoir symbols | Accepted |
| [ADR-031](ADR-031-retire-comparison-implementations-and-redirect-their-urls.md) | Retire comparison implementations and redirect their URLs | Accepted |
| [ADR-032](ADR-032-one-colour-language-per-map-across-pages.md) | One colour language per map, enforced across pages | Accepted |
| [ADR-033](ADR-033-open-every-map-on-the-oceans-basemap.md) | Open every map on the Oceans basemap | Accepted |
| [ADR-034](ADR-034-hosted-boundary-layers-with-a-deadline.md) | Take state and county boundaries from hosted services, against a deadline | Accepted |
| [ADR-035](ADR-035-a-label-ladder-tied-to-containment.md) | A label ladder tied to containment, shared with the symbols | Accepted |
| [ADR-036](ADR-036-accessibility-is-a-gate-and-a-measured-content-policy.md) | Make accessibility a gate, and write the content policy from measurement | Accepted |
| [ADR-037](ADR-037-refetch-the-boundaries-at-the-resolution-the-source-stops-adding.md) | Refetch the drainage boundaries at the resolution the source stops adding detail | Accepted |
| [ADR-038](ADR-038-split-the-snow-classes-and-move-to-a-scientific-colour-map.md) | Split the bottom snow class, and take the ramp from a scientific colour map | Accepted |
| [ADR-039](ADR-039-draw-percent-full-with-a-sequential-ramp.md) | Draw percent full with a sequential ramp, and free the ring from it | Accepted |
| [ADR-040](ADR-040-open-the-snow-map-on-the-season-peak.md) | Open the snow map on the season's peak snow | Accepted |

## Relationship to the modernization plan

[`MODERNIZATION_PLAN.md`](../../MODERNIZATION_PLAN.md) is a working document:
it changes as phases land, and it records measurements, spikes and things
noticed while testing. These records are the opposite — each one is fixed at
the moment of decision.

Where the two overlap, the plan is the narrative and the record is the
decision. Neither replaces the other.
