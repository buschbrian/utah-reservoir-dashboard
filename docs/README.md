# Documentation guide

Checked 2026-08-21 against `main`.

## Which file is the current truth?

One authority per question. Nothing else needs to be consulted to answer it.

| Question | Authority |
|---|---|
| How does the system work today? | [`architecture/`](architecture/README.md) |
| Why is it that way, and what superseded it? | [`decisions/`](decisions/README.md) |
| How do I run a recurring procedure? | [`operations/`](operations/) |
| What was tried during the modernization? | [`history/`](history/README.md) |
| What must an agent obey on every task? | [`../AGENTS.md`](../AGENTS.md) |
| What must an agent obey in one subsystem? | the nearest `AGENTS.md`, plus [`../.claude/rules/`](../.claude/rules/) |
| What is the step-by-step for a recurring task? | [`../.claude/skills/`](../.claude/skills/) |
| What is actually enforced? | the tests, validators, types and scripts |
| What does the product do, and how do I run it? | [`../README.md`](../README.md) |
| What changed for readers? | [`../CHANGELOG.md`](../CHANGELOG.md) |

**Executable truth outranks prose.** Where prose and a passing test disagree,
the test is right and the prose is the bug.

## Current architecture

| Document | Owns |
|---|---|
| [Architecture index](architecture/README.md) | Product shape, generated-versus-source ownership, the authority map. |
| [Frontend](architecture/frontend.md) | SDK boundaries, layers, colour, readiness, accessibility, solved layout constraints. |
| [Pipeline](architecture/pipeline.md) | Pipeline modules, runtime-data contract, payload cost, freshness, drought coverage. |
| [Hydrology methods](architecture/hydrology-methods.md) | The seasonal estimator, method version, change intervals, area measurement. |
| [Scopes](architecture/scopes.md) | Drawn, roster, opening and selected scope; levels; URL state; dominant reservoirs. |

## Operations

| Document | Procedure |
|---|---|
| [Verification](operations/verification.md) | Which verify target to run, and what each suite can and cannot see. |
| [Data refresh](operations/data-refresh.md) | The daily job, its failure behaviour, and the long-lived rebuilds. |
| [Source admission](operations/source-admission.md) | Adding, replacing or reviewing a reservoir provider. |

## Maintained references

| Document | Role |
|---|---|
| [Source inventory](AUTHORITATIVE-SOURCE-INVENTORY.md) | Source ownership, endpoints, copy rules, failure behaviour. Read by `src/source-inventory.test.ts`. |
| [Data transfer](data-transfer.md) | Measured payload and hosted-layer costs. Re-measure after payload or layer changes. |
| [Western source candidates](WESTERN-SOURCE-CANDIDATES.md) | Survey of non-federal and additional federal services, fetched live. |
| [Colorado and California API review](CDSS-CDEC-API-REVIEW.md) | Measured source value, limits and integration cost. |
| [Upstream trace scoping](UPSTREAM-TRACE-SCOPING.md) | What it would take to say what drains to a reservoir. Measured against the USGS network index; nothing built. |

## Historical material

Every plan, phase and admission journal is listed in
[`history/README.md`](history/README.md), which also says which ones stayed in
this directory and why. Each carries a banner at the top of the file. They are
evidence about a date, never a description of the present.

## Current work

The typed ArcGIS application, western geography, opening choice, federal and
California reservoir rosters, 637-site snow network, drought views,
accessibility gates and compatibility redirects are in production. The
remaining documented product work is:

1. decide whether Colorado's smaller but broad reservoir network follows
   California;
2. settle the 21 California candidates held for source disagreements, each
   named with its finding in `admitted_cdec_reservoirs.json`;
3. review automatically reported late and withdrawn feeds;
4. re-measure vendor accessibility exceptions and the content policy when the
   SDK changes; and
5. complete the human visual review that headless Chromium cannot supply; and
6. decide whether to build the upstream trace scoped in
   [`UPSTREAM-TRACE-SCOPING.md`](UPSTREAM-TRACE-SCOPING.md).

The repository wiki is a reader-oriented summary. The repository remains the
source of truth for implementation details, measurements and decisions.
