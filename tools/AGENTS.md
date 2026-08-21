# Tools rules (`tools/`)

Each tool is a **probe or a builder**, and the difference matters: a probe
prints and writes nothing; a builder rewrites a committed file and must merge
rather than replace.

- Audits and probes (`audit_*.py`, `probe_*.py`, `check_*.py`,
  `measure_*.py`) never write repository data. Keep it that way.
- Builders (`build_*.py`, `fetch_*.py`, `compute_drought_coverage.py`) own the
  files listed in [`data/generated-files.json`](../data/generated-files.json).
  **Every run merges; none replaces** — `--only` and `--missing` must not drop
  the records they were not asked about.
- `check_reference_freshness.py` is a tool and **must never become a test**: a
  test that fails when a date passes turns the build red on a morning when no
  code changed, and a red build freezes the published numbers.
- Network jobs (`build_normal_baselines.py`, the `fetch_*` tools) are not part
  of any build or CI target. They are network-bound, not slow; keep `--workers`
  small, because the providers are public services this project does not pay
  for.
- `compute_drought_coverage.py` is deterministic and writes no timestamps.
  `--output` implies `--no-history`. Measure before moving `DEFAULT_STEP`:
  `measure_drought_convergence.py` exists for that and writes nothing.
- Procedures: [`docs/operations/data-refresh.md`](../docs/operations/data-refresh.md)
  and [`docs/operations/source-admission.md`](../docs/operations/source-admission.md).

Verify: `npm run verify:pipeline`.
