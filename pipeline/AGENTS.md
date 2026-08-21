# Reservoir pipeline rules (`pipeline/`, `refresh_reservoirs.py`)

Authority: [`docs/architecture/pipeline.md`](../docs/architecture/pipeline.md)
and, for anything a number means,
[`docs/architecture/hydrology-methods.md`](../docs/architecture/hydrology-methods.md).

`refresh_reservoirs.py` is the orchestrator and re-exports every module here,
so `import refresh_reservoirs as R` still reaches all of it. Put new logic in
the module that owns the concern, not in the orchestrator.

| Module | Owns |
|---|---|
| `constants.py` | Paths, thresholds, `RESERVOIR_SCHEMA_VERSION`, `METHOD_VERSION`, source coverage. |
| `roster.py` | Committed rosters, capacity evidence, full-level precedence. |
| `providers.py` | One adapter per provider. A fifth provider starts here. |
| `seasonal.py` | The estimator: window, annual votes, normals, rank, percentile. |
| `freshness.py` | Carry-forward, withdrawal threshold, withdrawal notice. |
| `geography.py` | County and drainage-area assignment onto finished records. |

- **A method version is not a schema version.** Changing an estimator means
  `METHOD_VERSION`, a normals rebuild and an ADR — use the
  `science-method-change` skill. Changing a field's shape means
  `RESERVOIR_SCHEMA_VERSION` or `EXPORT_SCHEMA_VERSION`.
- **Never hand-edit a generated payload.** Change the writer and run it.
- **A withdrawal notice carries no measurement**; the validator rejects one that
  does (ADR-056).
- **The calendar is corrected, never the reading.** Every published date means
  when the water was measured.
- **A roster addition needs a refresh in the same change** — there is no
  "pending" state, because a name on the roster and absent from the payload is
  what a silently failed fetch looks like.
- **Capacity precedence is a decision, not a tweak** (ADR-070). A preferred
  full level names its source or the roster refuses to load.
- Keep `requirements-pipeline.txt` at numpy, pandas and requests. Test-only
  dependencies live in `requirements-test.txt`.

Verify: `npm run verify:pipeline`.
