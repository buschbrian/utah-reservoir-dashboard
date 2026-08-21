---
name: science-method-change
description: Change a published estimator — seasonal normal, rank, percentile, drought sampling or area measurement. Strict procedure covering method version, rebuilds and regression evidence.
---

# Scientific method change

**Trigger:** any change to how a published number is computed, even one that
looks like a refactor. If the output could move by a rounding step, this is the
procedure.

## Read first

1. [`docs/architecture/hydrology-methods.md`](../../../docs/architecture/hydrology-methods.md) — all of it.
2. ADR-041 (the reader picks the period), ADR-046 (denominators), ADR-055
   (area), ADR-059 (measured land), ADR-056 (freshness).
3. The estimator itself: `pipeline/seasonal.py`, or
   `tools/compute_drought_coverage.py` for drought.

## Process

1. **State the property that is changing** in one sentence — what a published
   number will mean afterwards that it does not mean now.
2. **Write the failing test first**, against a synthetic series, at the seam
   the change is about: a leap year, the year-end wrap, a tie, a border basin,
   a monthly feed.
3. **Change the estimator.**
4. **Bump `METHOD_VERSION`.** It is not `schema_version`: a field can keep its
   name, type and units while the estimator under it changes. Three places
   refuse to mix versions — the normals builder, `load_normals`, and
   `merge_history` — and they are the point.
5. **Rebuild what the change invalidates.** A seasonal-estimator change means
   `tools/build_normal_baselines.py` for the whole roster (network job, about
   twelve seconds per reservoir, six at a time). A full run *drops* records
   built by the old estimator, names them, and leaves `--missing` to rebuild
   them; that is deliberate.
6. **Measure the movement.** Report how many published figures move and by how
   much, against the published precision — 0.1 of a point for drought shares.
   `tools/measure_drought_convergence.py` does this for the sampling step.
7. **Write an ADR.** A method change is architectural: what it was, what it is,
   what moved, what it costs. Follow the `adr` skill.
8. **Update** `docs/architecture/hydrology-methods.md` in the same change.

## Do not

- change the estimator and the payload shape together — one at a time, each
  with its own version;
- keep old-estimator records under a header claiming the new version;
- reach for `dayofyear`, a fitted normal curve, a standard deviation as an
  interpretive frame, or a projection instead of a finer sampling step;
- count a tie as below on one side of a comparison only.

## Done means

`npm run verify:pipeline` passes, `METHOD_VERSION` moved, every derived file
that depends on it was rebuilt or explicitly named as pending, the movement is
measured and reported, and an ADR records the decision.
