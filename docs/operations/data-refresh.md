# The daily data refresh

The scheduled job that rewrites the published payloads. Its commit **is** the
deploy: the Pages workflow chains off a successful refresh, and the pages fetch
the files at runtime (ADR-002).

## What runs, in order

`scripts/refresh-daily.sh` is the whole sequence, and
[`refresh-data.yml`](../../.github/workflows/refresh-data.yml) calls it. Run it
locally with the same steps:

```bash
scripts/refresh-daily.sh          # everything, exactly as the workflow does
```

1. **Reservoirs** — `refresh_reservoirs.py`, retried three times with 1/3/9
   minute backoff. A failure leaves `reservoirs.json` untouched rather than
   publishing a partial roster.
2. **Drought polygons** — `tools/fetch_drought_monitor.py`. A failure keeps the
   last verified GeoJSON; it must not block current reservoir readings.
3. **Drought coverage, once per offered level** —
   `tools/compute_drought_coverage.py` for HUC-6 (with history) and HUC-4
   (`--no-history`). Both are computed from the one download, so either failing
   means both are suspect and the polygons are reverted.
4. **Pair check** — `tools/check_drought_pair.py`. If any coverage file
   disagrees with the polygons, every drought file is restored from the last
   commit. Publishing yesterday's week is a small honest loss; publishing two
   different weeks is a broken page.
5. **Snow** — `refresh_snowpack.py`. A failure keeps the last complete payload.
6. **Commit** — the published set, staged together, so the drought files can
   never be committed apart. The list lives in `data/generated-files.json` and
   `scripts/refresh-daily.sh` reads it; do not retype it into a workflow.

## The self-healing issues

Three conditions open a GitHub issue, keep it updated, and close it themselves:
a late Drought Monitor release, late reservoir feeds, and withdrawn reservoir
feeds. Late and withdrawn are different facts with different remedies —
"watch this" against "this reservoir left the map and someone has to decide
whether the feed is coming back".

The workflow calls `gh`. Every title and body is built by
`tools/feed_issue_report.py`, which is pure, deterministic and covered by
`tests/test_feed_issue_report.py`:

```bash
.venv/bin/python tools/feed_issue_report.py stale --count 3 --names "A, B" --table "..."
```

Change the wording there, not in YAML. The reason is reproducibility: a body
built in a shell heredoc indented to match a YAML block carries those spaces
into the issue, and four leading spaces is a Markdown code block.

## Failure behaviour to preserve

- A provider outage costs the run that provider's file, never the others'.
- Nothing is deleted on a bad day; the previous verified file stays.
- A withdrawal notice carries no measurement. The validator rejects one that
  does.
- The two drought levels always describe one week. `check_drought_pair.py`
  globs every coverage file, because a reader who changes the level fetches a
  different one.

## Rebuilding the long-lived derived files

These are **not** part of the daily run:

```bash
.venv/bin/python tools/build_normal_baselines.py --missing   # only what has no normal yet
.venv/bin/python tools/build_normal_baselines.py --only "Name"
.venv/bin/python tools/build_county_assignments.py
.venv/bin/python tools/fetch_watershed_scope.py
```

`build_normal_baselines.py` fetches thirty years of readings for every
reservoir in `reservoirs.json`. It is network-bound, not slow: one reservoir is
12.2 seconds of wall clock for 0.8 seconds of processor, so it fetches
`--workers` at a time (six by default, kept small because both providers are
public services this project does not pay for). Run it when the standard
climate period moves (2021-2050 becomes standard in 2031) or when a reservoir
joins the roster.

**Every run merges; none replaces.** A reservoir absent from today's payload
keeps its normal and the run says so — the roster it reads is what the
providers answered *this morning*, and a reservoir withdrawn for a quiet feed
would otherwise have a thirty-year fact deleted over a fortnight of silence. **A
reservoir with no record is not asked again**: "no readings in the period" is a
finding about a dam built in 2011, not a fetch to retry; only "the provider did
not answer" is retryable.
