# Current architecture

What is true of the repository **now**. Four documents, each owning one
subsystem, each short enough to read before starting work in it.

| Document | Owns |
|---|---|
| [`frontend.md`](frontend.md) | The typed ArcGIS/Calcite application: pages, layers, symbology, layout, readiness, retired routes. |
| [`pipeline.md`](pipeline.md) | The Python data pipelines: modules, generated files, payload cost, freshness, drought coverage. |
| [`hydrology-methods.md`](hydrology-methods.md) | The scientific method behind every published number, and what may not be done to it. |
| [`scopes.md`](scopes.md) | The four different geographic scopes, hydrologic levels, URL state and remembered place. |

## Where authority lives

Agents and humans both need one answer to "which file is current?". This is
it:

| Question | Authority |
|---|---|
| How does the system work today? | `docs/architecture/` |
| Why was it decided that way, and what superseded it? | [`docs/decisions/`](../decisions/README.md) |
| How do I run a recurring procedure? | [`docs/operations/`](../operations/) |
| What happened during the modernization? | [`docs/history/`](../history/README.md) |
| What must every agent obey on every task? | [`AGENTS.md`](../../AGENTS.md) |
| What must an agent obey in *this* directory? | the nearest `AGENTS.md`, and `.claude/rules/` |
| What is the procedure for this recurring task? | `.claude/skills/<name>/SKILL.md` |
| What is actually enforced? | the tests, validators, types and scripts named below |

**Executable truth outranks prose.** Where a rule below is enforced, the
enforcing check is named beside it. If prose and a passing test disagree, the
test is right and the prose is a bug.

## Product shape

One typed ArcGIS 5.1 + Calcite 5 application with four analytical surfaces,
three documentation pages, three compatibility redirects, one frozen source
oracle, and two Python pipelines.

| Path | Role |
|---|---|
| `index.html`, `modern.html`, `src/main.ts` | Primary reservoir storage map, and its stable alias. |
| `overview.html`, `src/overview*` | ArcGIS Charts storage workspace. |
| `snow.html`, `src/snow*` | Snow curves, drainage-area map, site map, detail views. |
| `drought.html`, `src/drought*` | Weekly drought map and comparison charts. |
| `methods.html`, `data.html`, `terms.html` | Methods, public data API, terms. |
| `legacy/`, `maplibre/`, `explore.html` | Compatibility redirects only (ADR-031). |
| `public/retired-route.js` | Allowlisted URL-state translation for those redirects. |
| `shared/reservoir-viz.js` | Frozen source-only colour-table owner and test oracle. Never published. |
| `src/` | Strict TypeScript, including the complete runtime data validator. |
| `pipeline/`, `refresh_reservoirs.py`, `refresh_snowpack.py` | Reservoir and snow refresh pipelines. |
| `huc.py`, `watershed_scopes.py`, `admission.py` | Drainage assignment, named scopes, candidate admission. |
| `tools/` | Audits, boundary work, drought computation, measurement. |

## Generated and source-owned files

Never hand-edit a generated file: the next pipeline run overwrites it, and an
edit that survives review is an unreproducible number on a public page.

| File | Owner | Written by |
|---|---|---|
| `reservoirs.json` | generated daily | `refresh_reservoirs.py` |
| `snowpack.json`, `snow_sites.json` | generated daily | `refresh_snowpack.py` |
| `data/drought/usdm-current.geojson` | generated weekly | `tools/fetch_drought_monitor.py` |
| `data/drought/usdm-huc{4,6}.json` | generated daily | `tools/compute_drought_coverage.py` |
| `data/drought/usdm-huc6-history.json` | generated archive | `tools/compute_drought_coverage.py` |
| `reference.json` | long-lived derived | `tools/build_reference_export.py` (`--check` guards drift) |
| `normals.json` | long-lived derived | `tools/build_normal_baselines.py`, on demand only |
| `counties.json` | long-lived derived | `tools/build_county_assignments.py` |
| `capacities.json` | long-lived derived | `tools/build_capacity_table.py` |
| `data/watersheds/*.geojson`, `data/us-land.geojson` | long-lived derived | `tools/fetch_watershed_scope.py`, `tools/fetch_us_land_mask.py` |
| `admitted_*.json` | **hand-maintained, reviewed** | a person, with evidence |
| `huc6.geojson`, `utah-boundary.geojson` | frozen historical | nothing; kept for parity |

`data/generated-files.json` is the machine-readable copy of this table, and
`tests/test_generated_files.py` holds it to the repository.
