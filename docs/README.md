# Documentation guide

Checked 2026-08-20 against `main`.

This directory contains three kinds of document. Their dates matter:

- **Maintained references** describe the repository as it works now.
- **Implementation journals and plans** preserve the state and reasoning from
  a particular slice. A status note at the top says what later work completed
  or superseded.
- **Architecture decision records** are historical records. Accepted ADR
  bodies are not rewritten; a later ADR supersedes an earlier one.

## Start here

| Document | Role | Current state |
|---|---|---|
| [Project README](../README.md) | Product overview, setup, architecture, and current work | Maintained |
| [Changelog](../CHANGELOG.md) | Notable user-facing changes | Maintained |
| [Source inventory](AUTHORITATIVE-SOURCE-INVENTORY.md) | Source ownership, endpoints, copy rules, and failure behavior | Maintained |
| [Data transfer](data-transfer.md) | Measured payload and hosted-layer costs | Maintained; re-measure after payload or layer changes |
| [Decision index](decisions/README.md) | Status and successor for every ADR | Maintained |
| [Modernization plan](../MODERNIZATION_PLAN.md) | Original roadmap plus the dated implementation journal | Historical journal; phases complete |

## Current work

The typed ArcGIS application, western geography, state and drainage-area
opening choice, federal western reservoir roster, 637-site snow network,
drought views, accessibility gates, and compatibility redirects are in
production.

The remaining documented product work is:

1. resolve the California capacity and source disagreements before publishing
   a third reservoir provider;
2. decide whether Colorado's smaller but broad reservoir network follows;
3. review automatically reported late and withdrawn feeds;
4. re-measure vendor accessibility exceptions and the content policy when the
   SDK changes; and
5. complete the human visual review that headless Chromium cannot supply.

## Product and interface records

| Document | What it records | Status |
|---|---|---|
| [Modern overview](MODERN-OVERVIEW-PLAN.md) | Storage Charts direction and delivery order | Delivered |
| [Phase 2](PHASE-2-PLAN.md) | Typed ArcGIS shell and release gates | Delivered; later cutover decisions superseded its URL boundary |
| [Phase 3](PHASE-3-PLAN.md) | Storage symbology and map interactions | Delivered |
| [Initial scope selection](INITIAL-SCOPE-SELECTION.md) | State/region opening choice and splash design | Delivered |
| [Opening scope and western roster](OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md) | Coupled rollout of the chooser and federal western roster | Delivered |
| [Open backlog scoping](OPEN-BACKLOG-SCOPING.md) | County, district, permanent-page, and source follow-ups | County/source slices delivered; permanent-page and district questions remain |

## Geography and pipeline records

| Document | What it records | Status |
|---|---|---|
| [Phase 1.6](PHASE-1.6-PLAN.md) | Connected reservoirs and the first snow pipeline | Delivered; later western work expanded it |
| [Upper Colorado pipeline](UPPER-COLORADO-PIPELINE.md) | Ten-basin research scope and station audit | Research scope retained |
| [Western expansion](WESTERN-EXPANSION-SCOPING.md) | Western drainage scope, level choice, transfer, and compute cost | Geography and snow expansion delivered |
| [Western reservoir admission](WESTERN-RESERVOIR-ADMISSION.md) | First federal western candidate audit | Delivered through later admission reviews |
| [Western roster review](WESTERN-ROSTER-ADMISSION-REVIEW.md) | Candidate-by-candidate capacity and deduplication review | Delivered |
| [Bureau of Reclamation review](RISE-ADMISSION-REVIEW.md) | Federal source-only western additions | Delivered |

## Future source research

| Document | What it records | Status |
|---|---|---|
| [Western source candidates](WESTERN-SOURCE-CANDIDATES.md) | Survey of non-federal and additional federal services | Research inventory |
| [Colorado and California API review](CDSS-CDEC-API-REVIEW.md) | Measured source value, limits, and integration cost | Current source decision input |

## Historical records

The accepted records in [`decisions/`](decisions/) are immutable history.
Do not edit an accepted ADR to describe later code. Add a successor, update
only the old record's status, and update the index.

The repository wiki is a reader-oriented summary of these maintained
documents. The repository remains the source of truth for implementation
details, measurements, and decisions.
