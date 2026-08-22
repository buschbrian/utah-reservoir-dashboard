# Historical implementation journals

> **Nothing in this directory, or in the journals listed below, is a
> specification of current architecture.** These files record what was true,
> measured or believed on a particular date. They keep their rejected
> directions and superseded numbers on purpose. Current architecture is
> [`docs/architecture/`](../architecture/README.md); current decisions are
> [`docs/decisions/`](../decisions/README.md).

An agent reading a journal to answer "how does this work now?" will get an
answer that was correct in August 2026 and may not be correct today. Read one
only to answer "why was this tried, and what did it measure?".

| Journal | Slice it records |
|---|---|
| [modernization-2026.md](modernization-2026.md) | Phases 0–7: the zero-build pages becoming the typed ArcGIS 5.1 application, plus the dated review passes. Moved here from the repository root on 2026-08-21. |

## Journals that stayed in `docs/`

These are journals too. They were not moved because accepted architecture
decision records cite them by path, and an accepted record is not rewritten to
follow a file.

| Journal | Slice it records |
|---|---|
| [`../MODERN-OVERVIEW-PLAN.md`](../MODERN-OVERVIEW-PLAN.md) | Storage Charts direction and delivery order. |
| [`../PHASE-1.6-PLAN.md`](../PHASE-1.6-PLAN.md) | Connected reservoirs and the first snow pipeline. |
| [`../PHASE-2-PLAN.md`](../PHASE-2-PLAN.md) | Typed ArcGIS shell and release gates. |
| [`../PHASE-3-PLAN.md`](../PHASE-3-PLAN.md) | Storage symbology and map interactions. |
| [`../INITIAL-SCOPE-SELECTION.md`](../INITIAL-SCOPE-SELECTION.md) | State/region opening choice and splash design. |
| [`../OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md`](../OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md) | Coupled rollout of the chooser and the federal western roster. |
| [`../OPEN-BACKLOG-SCOPING.md`](../OPEN-BACKLOG-SCOPING.md) | County, district, permanent-page and source follow-ups. |
| [`../UPPER-COLORADO-PIPELINE.md`](../UPPER-COLORADO-PIPELINE.md) | Ten-basin research scope and station audit. |
| [`../WESTERN-EXPANSION-SCOPING.md`](../WESTERN-EXPANSION-SCOPING.md) | Western drainage scope, level choice, transfer and compute cost. |
| [`../WESTERN-RESERVOIR-ADMISSION.md`](../WESTERN-RESERVOIR-ADMISSION.md) | First federal western candidate audit. |
| [`../WESTERN-ROSTER-ADMISSION-REVIEW.md`](../WESTERN-ROSTER-ADMISSION-REVIEW.md) | Candidate-by-candidate capacity and deduplication review. |
| [`../RISE-ADMISSION-REVIEW.md`](../RISE-ADMISSION-REVIEW.md) | Federal source-only western additions. |
| [`../COLORADO-ADMISSION-REVIEW.md`](../COLORADO-ADMISSION-REVIEW.md) | The state network scoped to the drawn drainages, and the quota it costs. |
| [`../WATER-BODY-AND-NAVIGATION-SCOPING.md`](../WATER-BODY-AND-NAVIGATION-SCOPING.md) | Names, water-body type, nested menus, chooser reopen, the six thin-roster states. |

The four **maintained references** that also live in `docs/` are not journals
and are kept current: `AUTHORITATIVE-SOURCE-INVENTORY.md`, `data-transfer.md`,
`WESTERN-SOURCE-CANDIDATES.md` and `CDSS-CDEC-API-REVIEW.md`.

## One stale path, left deliberately

`shared/reservoir-viz.js` is the frozen source-only oracle (ADR-008). Two of
its comments still name `MODERNIZATION_PLAN.md` at its old root path. The file
is frozen, so the comments were not edited to follow the move.
