# Pipeline architecture

The Python side: two daily refreshes, a weekly drought computation, and a set
of on-demand builders and audits. Scoped agent rules are in
[`.claude/rules/python-pipeline.md`](../../.claude/rules/python-pipeline.md)
and [`tools/AGENTS.md`](../../tools/AGENTS.md).

## Modules

`refresh_reservoirs.py` is the **orchestrator**. Read it first: it is the
sequence, not the arithmetic. The specialised concerns live behind named
modules in `pipeline/`:

| Module | Owns |
|---|---|
| `pipeline/constants.py` | Paths, thresholds, schema and method versions, source-coverage review. |
| `pipeline/roster.py` | The committed rosters, capacity evidence and the full-level precedence rule. |
| `pipeline/providers.py` | One adapter per provider: Reclamation, the Conservation Service, California. |
| `pipeline/seasonal.py` | The seasonal estimator: window, annual votes, normals, rank, percentile. |
| `pipeline/freshness.py` | Carry-forward, the withdrawal threshold and the withdrawal notice. |
| `pipeline/geography.py` | County and drainage-area assignment onto finished records. |
| `refresh_reservoirs.py` | Fetch, summarize, assemble, validate, write, and report to CI. |

`refresh_reservoirs` re-exports every public name from those modules, so
`import refresh_reservoirs as R` still reaches all of them and no tool or test
had to learn a new import path.

Other entry points: `refresh_snowpack.py` (snow payload), `watershed_scopes.py`
and `huc.py` (named scopes, drainage assignment, grouping), `admission.py`
(candidate screening), `tools/` (audits, boundary fetches, drought
computation, normals).

## Runtime data contract

**Data is fetched at runtime, never imported** (ADR-002). `reservoirs.json` is
rewritten every morning and that commit *is* the deploy. The build copies it;
nothing imports it. *Enforced:* `src/deploy.test.ts` and a `dist/assets` grep
in the Pages workflow.

**Measure payload cost gzipped, never raw** (ADR-051, ADR-052). GitHub Pages
compresses the JSON, so a raw byte count overstates what a reader pays several
times over — `snowpack.json` is 3,607 KB on disk and 322 KB on the wire. The
size guards measure the same way: the reference export's budget, in
`tests/test_refresh.py` and `src/data/boundaries.test.ts` alike, is 30 KB
gzipped, and was a raw byte count until R3 — which would have failed on 142
reservoirs of reviewed capacity while the figure a reader pays was still
inside it. A budget in the wrong unit fails on the wrong thing.

Runtime fetches use `cache: "no-cache"`, which is not "do not cache": it means
never use a stored copy without asking, so the morning's rewrite can never be
served stale and an unchanged file costs a 304 instead of the whole payload.

**The snow series publishes the water-year calendar once** and each site
indexes into it; `validateSnowpackPayload` rebuilds the rows so nothing
downstream knows. Never encode a missing day as a null value — a null reading
is a row that exists, and thousands of absent days are not. The grid is 637
sites by 323 published dates, and 1,477 of those cells had no reading on
2026-08-20. The count moves every morning, which is the point: it is never
zero.

`docs/data-transfer.md` holds the measurements and is the file to update when
they change.

## Freshness: late and withdrawn are different faults

**`carry_forward`** keeps publishing a quiet feed's last value, because a point
vanishing with no explanation is worse. True for days, false for months.

Past `WITHDRAW_AFTER_DAYS` (60) a record is **withdrawn** from the payload
entirely (ADR-056), because `statewideRollup` sums `current_storage_af` with no
freshness filter — so a spring figure is not merely shown out of season, it is
added into a total presented as now. A withdrawal is always stated
(`withdrawn`, `withdrawn_count`, `withdraw_after_days`) and **must never carry
a measurement**: the validator rejects a notice holding `current_storage_af`.

Nothing is deleted. The roster is committed and the judgement is remade every
run, so a reservoir returns on its own the morning its source resumes.
**A drainage area may therefore be empty**; `storageAgainstDrought` omits it
rather than drawing it at zero. Tests about *where* a reservoir is must read
the roster, never `reservoirs.json`, or a quiet feed silently retires an
assertion.

**Being listed is not reporting, and neither is having reported.** The audit's
dormant check asks whether a station has ever answered; the candidate screen
asks whether it has answered **within the year**. This is deliberately not
`WITHDRAW_AFTER_DAYS`: 60 days is about a published reservoir going quiet, a
year is about never admitting one that already has.

## Drought coverage

Coverage is computed per level into `data/drought/usdm-huc{level}.json` from
the committed polygons, the committed scope boundaries and the committed land
mask. It is deterministic and carries no timestamps, so an unchanged week
writes an unchanged file.

**Every coverage file must describe one week.** `tools/check_drought_pair.py`
globs them all, because a reader who changes the level fetches a different
file. **The archive is one level** — `merge_history` refuses a payload at
another rather than joining two series on one set of codes.

**A week-over-week change needs two files and uses one.** The current coverage
file carries the week before it, about a kilobyte, and that is all a change
needs. Never fetch `usdm-huc6-history.json` to compute one subtraction.
`previous` is always strictly older than `map_date`; the validator refuses a
file comparing a week with itself.

**Not measured is not no drought** (ADR-059). Cells outside
`data/us-land.geojson` are dropped before any class is counted. Class shares
divide by the **measured** land; `measured.percent_of_area` divides by the
whole area and lives in its own block so nothing can sum the two (ADR-046). An
area with no measured land publishes no share at all, not zeros. **A missing
mask stops the run** — without one the engine reports every border basin's far
half as drought-free and looks like a clean run.

## Versioning

**A method version is not a schema version.** A field can keep its name, type
and units while the estimator under it changes, and `schema_version` cannot see
that. `METHOD_VERSION` can. See
[`hydrology-methods.md`](hydrology-methods.md#method-version) for the three
places that refuse to mix, and the one exception.

## Long-lived reference data

**Long-lived reference data carries the date it was checked.**
`tools/check_reference_freshness.py` reads each committed reference file's own
date field against a review interval and reports what is due. It is a tool and
**must never become a test**: a test that fails when a date passes turns the
build red on a morning when no code changed, and a red build freezes the
published numbers. What *is* tested is that every file carries a date and a
policy at all. The generators stamp `retrieved` themselves.

## CI signals

`emit_ci_signals` writes the counts and tables the refresh workflow turns into
self-healing issues — late feeds, withdrawn feeds. The issue bodies are built
by `tools/feed_issue_report.py`, which is deterministic and tested; the
workflow only calls `gh`. See
[`docs/operations/data-refresh.md`](../operations/data-refresh.md).
