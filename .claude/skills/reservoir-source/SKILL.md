---
name: reservoir-source
description: Add, replace, review or debug a reservoir data provider or roster entry. Covers admission screens, capacity authority, freshness and the refresh that must ship with it.
---

# Reservoir source

**Trigger:** adding a provider or a reservoir, investigating a quiet feed, or
reviewing a held candidate.

## Read first

1. [`docs/operations/source-admission.md`](../../../docs/operations/source-admission.md) — the procedure and its evidence.
2. [`pipeline/AGENTS.md`](../../../pipeline/AGENTS.md) — module ownership.
3. ADR-070, then ADR-003 (denominator), ADR-066 (identity), ADR-056 (freshness),
   ADR-069 (deduplication). Index:
   [`docs/decisions/README.md`](../../../docs/decisions/README.md).

## Files that normally matter

`pipeline/providers.py`, `pipeline/roster.py`, `admission.py`,
`admitted_*.json`, `tools/audit_*_stations.py`,
`tools/audit_candidate_capacity.py`, `tests/test_admission.py`,
`tests/test_refresh.py`.

## Process

1. **Identify the measurement semantics** — what the value means, its units,
   and what date the provider stamps it with. The calendar is corrected, never
   the reading.
2. **Identify the full-level authority.** Where the operator publishes one, it
   is the denominator (ADR-070), and it must name its source URL or the roster
   refuses to load.
3. **Read the closest existing adapter** in `pipeline/providers.py` before
   writing a new one. `SourceKey` is exhaustive: a fourth provider is a compile
   error until every table names it.
4. **Discover candidates** with the matching audit tool.
5. **Run the admission and discrepancy screens.** A dam match is not the whole
   question — four further screens compare the provider's full level, the
   record maximum, the low-water floor and a spike against the third-highest
   reading.
6. **Never repair a source disagreement by guessing.** The screen reports and a
   person decides. Record every withheld candidate with its finding, and every
   waiver with its reason.
7. **Ship the refresh in the same change.** A roster name absent from the
   payload is what a silently failed fetch looks like; there is no pending
   state.
8. **Build the missing normals**: `tools/build_normal_baselines.py --missing`.
9. Re-run the dam-versus-waterbody county check; it is what found Lake Powell.

## Do not

- change frontend behaviour, symbology or visible vocabulary incidentally;
- change a scientific estimator (that is `science-method-change`);
- hand-edit `reservoirs.json` or any generated payload;
- introduce a new capacity precedence rule without a decision record;
- lower a freshness threshold to keep a quiet feed on the map.

## Done means

`npm run verify:pipeline` passes, the roster and the payload agree, every held
candidate names its finding, and any new precedence or threshold has an ADR.
