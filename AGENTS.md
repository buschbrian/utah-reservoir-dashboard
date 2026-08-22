# Working in this repository

A public dashboard for reservoir storage, mountain snow and drought across the
western United States: one typed ArcGIS 5.1 + Calcite 5 application, and Python
pipelines that rewrite its payloads every morning.

**This file is a routing layer, not the rule book.** Load the rules for the
area you are working in and nothing else. If a rule is not here, it is either
in a scoped file below or enforced by a test — both are cheaper to obey than to
rediscover.

## Where to go first

| Working on | Read |
|---|---|
| Anything | this file, then the nearest `AGENTS.md` to the files you are editing |
| `src/`, `*.html`, `src/styles/` | [`src/AGENTS.md`](src/AGENTS.md), [`docs/architecture/frontend.md`](docs/architecture/frontend.md) |
| `*.py`, `pipeline/`, `tools/` | [`pipeline/AGENTS.md`](pipeline/AGENTS.md) or [`tools/AGENTS.md`](tools/AGENTS.md), [`docs/architecture/pipeline.md`](docs/architecture/pipeline.md) |
| A published number's method | [`docs/architecture/hydrology-methods.md`](docs/architecture/hydrology-methods.md) |
| Geography, levels, URL state | [`docs/architecture/scopes.md`](docs/architecture/scopes.md) |
| `tests/` | [`tests/AGENTS.md`](tests/AGENTS.md) |
| `data/`, any `*.json` payload | [`data/AGENTS.md`](data/AGENTS.md) |
| `docs/` | [`docs/AGENTS.md`](docs/AGENTS.md) |
| `.github/workflows/` | [`.github/workflows/AGENTS.md`](.github/workflows/AGENTS.md) |

Procedures for recurring work are skills in [`.claude/skills/`](.claude/skills/):
`verify`, `reservoir-source`, `science-method-change`, `dashboard-ui`,
`scope-state`, `data-refresh`, `adr`. Path-scoped rule files are in
[`.claude/rules/`](.claude/rules/). Both systems read the same documents; the
agent files route, the documents explain.

## The shape of the project

| Path | Role |
|---|---|
| `index.html` + `modern.html`, `src/main.ts` | Primary reservoir storage map and its stable alias. |
| `overview.html`, `snow.html`, `drought.html` | Storage charts, snowpack, weekly drought. |
| `reservoir.html`, `src/reservoir*` | One reservoir's own page; link resolution and provenance. |
| `methods.html`, `data.html`, `terms.html` | Methods, public data API, terms. |
| `legacy/`, `maplibre/`, `explore.html`, `public/retired-route.js` | Compatibility redirects and their URL translation. Bookmarks, not runtimes (ADR-031). |
| `src/` | Strict TypeScript, including the complete runtime data validator. |
| `shared/reservoir-viz.js` | Frozen source-only colour-table owner and test oracle. Never published, never edited. |
| `refresh_reservoirs.py` + `pipeline/` | The daily reservoir pipeline: orchestrator, then one module per concern. |
| `refresh_snowpack.py`, `watershed_scopes.py`, `huc.py`, `admission.py` | Snow pipeline, named scopes, drainage assignment, candidate screening. |
| `tools/` | Audits, boundary fetches, drought computation, normals, measurement. |
| `data/`, root `*.json` | Payloads and reference data. See `data/generated-files.json` for who owns each. |
| `docs/` | Architecture, decisions, operations, history. Start at [`docs/README.md`](docs/README.md). |

## Universal invariants

These apply to almost every task. Everything else is scoped.

1. **Generated files are never hand-edited.** `data/generated-files.json` lists
   every generated path and its writer; `tests/test_generated_files.py` holds it
   true. Change the generator, then run it.
2. **Data is fetched at runtime, never imported** (ADR-002). The morning's data
   commit *is* the deploy. Enforced by `src/deploy.test.ts` and the Pages
   workflow.
3. **Tests must not depend on today's numbers.** A test asserting a literal
   percentage turns the build red on a morning when no code changed, and a red
   build freezes the published numbers. Compare against the frozen oracle
   through `src/data/legacy-harness.ts`, or against the payload's own fields.
4. **Visible text is Simplified Technical English** (ADR-006). The vocabulary is
   in [`.claude/rules/visible-language.md`](.claude/rules/visible-language.md);
   `src/content-language.test.ts` and the smoke suite enforce it, `aria-label`s
   and live regions included.
5. **Accepted architecture decision records are history.** Never rewrite one to
   match later work. Add a successor and change only the old record's status.
6. **Do not change published behaviour incidentally.** Storage and seasonal
   methods, admission thresholds, source precedence, freshness thresholds,
   roster membership, URL compatibility, symbology and published terminology
   each need their own justification, and usually an ADR.
7. **Anything that can wait forever needs a deadline**, and every way of no
   longer being busy has to clear `aria-busy`.
8. **A term that names two things gets two names.** Scope, level, state and
   capacity each mean several different things here; the distinctions are in
   [`docs/architecture/scopes.md`](docs/architecture/scopes.md) and are encoded
   in the types. Do not collapse them.

## Verification

Pick a target; do not reconstruct commands.

```bash
npm run verify:fast       # typecheck + unit tests — the inner loop
npm run verify:frontend   # + SDK budget + production build
npm run verify:pipeline   # pytest + committed drought-pair check
npm run verify:browser    # build, then both Playwright smoke suites
npm run verify:all        # everything, before a cross-cutting merge
```

Run the smallest target that can fail on your change, and `verify:browser` for
anything a browser renders — nothing else can see layout, visible text or
console errors. Prerequisites, the on-demand tools, and what the suites cannot
prove are in [`docs/operations/verification.md`](docs/operations/verification.md).

## What not to change casually

- `shared/reservoir-viz.js` — frozen oracle; source-only.
- `huc6.geojson`, `utah-boundary.geojson` — frozen historical geography.
- `OPENING_SCOPE_HUC6_BOUNDS` in `src/viz/extent.ts` — a contract with saved
  links (ADR-044).
- The `admitted_*.json` rosters — reviewed evidence; each entry names the screen
  it passed or the finding that held it.
- Accepted ADR bodies, and the daily payloads.
