"""The reservoir pipeline, one module per concern.

`refresh_reservoirs.py` is the orchestrator: it reads as a sequence -- fetch,
summarize, assemble, validate, write, report -- and the arithmetic each step
depends on lives here. It re-exports every public name in this package, so
`import refresh_reservoirs as R` still reaches all of it and no tool, test or
notebook had to learn a new import path.

    constants   paths, thresholds, schema and method versions, base rosters
    roster      the committed admissions, capacity evidence, station tables
    providers   one adapter per provider, and the retry policy they share
    seasonal    the estimator: window, annual votes, normals, rank, percentile
    numbers     rounding and ratios, decided once
    history     reading a series at a date, and the twelve months behind today
    freshness   carry-forward, the withdrawal threshold, the notice
    geography   county and drainage-area assignment

Put new logic in the module that owns the concern, not in the orchestrator.
See docs/architecture/pipeline.md and pipeline/AGENTS.md.
"""

from . import (  # noqa: F401
    constants, freshness, geography, history, numbers, providers, roster, seasonal,
)
