---
name: data-refresh
description: Run, debug or change the daily data refresh, its drought computation, its self-healing issues or the long-lived rebuilds.
---

# Data refresh

**Trigger:** the daily job failed, a payload looks wrong, or the refresh
sequence itself needs changing.

## Read first

[`docs/operations/data-refresh.md`](../../../docs/operations/data-refresh.md),
then [`.github/workflows/AGENTS.md`](../../../.github/workflows/AGENTS.md) if
the change touches the workflow.

## Run it

```bash
scripts/refresh-daily.sh --dry-run    # prove the sequence without writing
scripts/refresh-daily.sh              # the whole job, exactly as CI runs it
.venv/bin/python refresh_reservoirs.py --only "Name"   # probe; never writes
```

## Process

1. **Find which stage failed.** Each is independent by design: a provider
   outage costs that provider's file and never the others'.
2. **Prefer the previous verified file to a partial one.** Nothing is deleted
   on a bad day.
3. **Keep the drought pair on one week.** Both levels are computed from one
   download and committed together; `tools/check_drought_pair.py` is the check,
   and recomputing is the remedy — never editing.
4. **Change issue wording in `tools/feed_issue_report.py`**, not in YAML. It is
   deterministic and tested.
5. **Change the published file list in `data/generated-files.json`**, which the
   commit step reads.

## Do not

- hand-edit a payload to make a check pass;
- lower `WITHDRAW_AFTER_DAYS` or a staleness threshold to quiet an issue;
- run `build_normal_baselines.py` as part of the daily job — it is a network
  job and a median over a finished period cannot change;
- publish a withdrawal notice carrying a measurement.

## Done means

`npm run verify:pipeline` passes, the committed drought files describe one
week, and any file the run rewrote is committed with its generator's output
rather than by hand.
