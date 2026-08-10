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
| [ADR-005](ADR-005-commit-generalized-watershed-boundaries.md) | Commit one generalized watershed boundary file | Accepted |
| [ADR-006](ADR-006-simplified-technical-english.md) | Write all visible text in Simplified Technical English | Accepted |
| [ADR-007](ADR-007-two-rendering-engines.md) | Keep two rendering engines, and keep the old pages live | Accepted |
| [ADR-008](ADR-008-one-class-break-table.md) | One class-break table is the single source of truth for colour | Accepted |
| [ADR-009](ADR-009-geography-is-drainage-areas-that-touch-utah.md) | The dashboard's geography is drainage areas that intersect Utah | Superseded by ADR-010 |
| [ADR-010](ADR-010-colorado-and-great-basin-systems-only.md) | Narrow the geography to the Colorado and Great Basin systems | Accepted |
| [ADR-011](ADR-011-separate-location-scope-from-lake-powell.md) | Separate reservoir location from Lake Powell inclusion | Superseded by ADR-013 |
| [ADR-012](ADR-012-build-phase-2-beside-production.md) | Build the Phase 2 shell beside the production pages | Accepted |
| [ADR-013](ADR-013-count-reservoirs-whose-waterbody-intersects-utah.md) | Count reservoirs whose waterbody intersects Utah | Accepted |
| [ADR-014](ADR-014-use-the-ugrc-utah-state-boundary.md) | Use the maintained UGRC Utah state boundary | Accepted |
| [ADR-015](ADR-015-confirm-a-dam-by-position-before-name.md) | Confirm a reservoir's dam by position before name | Accepted |

## Relationship to the modernization plan

[`MODERNIZATION_PLAN.md`](../../MODERNIZATION_PLAN.md) is a working document:
it changes as phases land, and it records measurements, spikes and things
noticed while testing. These records are the opposite — each one is fixed at
the moment of decision.

Where the two overlap, the plan is the narrative and the record is the
decision. Neither replaces the other.
