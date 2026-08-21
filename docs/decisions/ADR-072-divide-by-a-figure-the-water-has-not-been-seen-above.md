# ADR-072: Divide by a figure the water has not been seen above

- Status: Accepted
- Date: 2026-08-21

## Context

ADR-003 chose the conservation pool as the figure a percentage divides by,
because that is what an operator means by "full", and it is right about almost
every reservoir this project publishes. Strawberry's pool is 1,105,910
acre-feet against 1,106,560 ever observed. Rockport's is 62,120 against 62,372.
For 229 of the 365 published reservoirs the conservation pool is the
denominator and it describes the water.

For thirteen it does not, and the payload said so out loud. **Detroit was
published at 223.7% full.**

| reservoir | pool divided by | maximum pool | observed since 2015 | published |
|---|---:|---:|---:|---:|
| Detroit | 155,000 | 455,000 | 426,115 | **223.7%** |
| Howard Hansen | 26,000 | 136,700 | 75,200 | **145.0%** |
| Green Peter | 160,000 | 430,000 | 408,133 | **122.4%** |
| Dexter | 22,200 | 29,900 | 26,981 | **115.9%** |
| Boca Reservoir | 32,870 | 40,870 | 40,850 | 100.3% |
| Willow Creek | 4,326 | 14,091 | 7,478 | 84.4% |
| … | 7 more | | | 0.9% to 49.1% |

**The pool is not wrong about the pool.** Detroit, Green Peter, Dexter and
Howard Hansen are Corps flood-control projects. Their Conservation Service
series report gross storage — the water actually behind the dam, flood space
included — while the inventory's conservation pool describes the summer pool
underneath it. Two true figures about two different volumes, divided by each
other.

**The record already published the right figure.** Every one of the thirteen
carries a maximum pool in its own admitted entry, and in every case that
figure contains the water: Detroit's 455,000 against 426,115 observed. Nothing
had to be fetched, guessed at, or asked of a second source. The denominator
was chosen from the record by a rule that never looked at what the reservoir
had done.

**And the tool that builds the table already knew.** `build_capacity_table.py`
has carried a check since it was written — *a capacity below what we have
already seen in it means the match is wrong* — and Detroit fails it by 175%.
The check calls `keep_or_report`, which appends a line to a report and keeps
the committed entry. It had been reporting this for as long as the reservoir
had been published.

**A related screen was never asked.** `discrepancies` in `admission.py` holds
a candidate out of the roster when the water has stood above the denominator,
and `tools/audit_rise_reservoirs.py` and `tools/audit_cdec_stations.py` both
run it. `tools/audit_awdb_stations.py` does not import it. Every one of the
thirteen is a Conservation Service station.

## Decision

**The denominator must be a figure the water has not been seen above.**

`denominator_for` in `admission.py` offers the inventory's three figures in
ADR-003's existing order of preference — conservation pool, then maximum pool,
then the headline figure — and takes the first one the observed record fits
inside. The preference is unchanged. What is added is a condition on the first
choice, answered from the same record the choice is made in.

**The allowance is `SURCHARGE_ALLOWANCE`, which already exists.** ADR-065
measured 10% for real operation above a published pool. A reservoir a percent
or two over its conservation pool keeps that pool and goes on publishing just
above 100, because that is what a surcharge is and the figure is true. Only a
reservoir the pool cannot describe at all moves.

**Where no published figure contains the record, nothing is chosen.** That is
not a denominator to pick between; it is a wrong dam or a surcharge above
every pool the inventory names, and `holds_more_than_the_dam` and
`discrepancies` are what answer it. After this rule, no reservoir in the
inventory-derived roster is in that position.

**This chooses among the inventory's figures only.** Where the provider that
publishes the readings also publishes a full level, ADR-070 already prefers it
and this rule is never reached. The 33 California and 25 Conservation Service
stations that arrive with an operator's own figure are untouched.

**`METHOD_VERSION` does not move, and that is not an oversight.** It names the
seasonal-normal estimator, and the three places that refuse to mix versions —
the normals builder, `load_normals` and `merge_history` — all guard normals.
A normal is a median of readings in acre-feet and does not divide by capacity,
so no committed normal is invalidated by this and a rebuild would be a long
network job that changed nothing. `pct_of_seasonal_normal` is unmoved for
every one of the thirteen. What changes is `pct_of_capacity`, `capacity_af`
and `capacity_basis`, and the payload states its own basis per reservoir.

## What moves, measured

Thirteen reservoirs of 365. Twelve move from the conservation pool to the
maximum pool; Thief Valley moves from a maximum pool it had also been seen
above to the headline figure that contains it.

| | before | after |
|---|---:|---:|
| published above 110% full | 4 | **0** |
| published above 100% full | 10 | 6 |
| highest published percentage | 223.7% | **104.0%** |
| `normal_storage` denominators | 229 | 216 |
| `max_storage` denominators | 74 | 86 |

Verified end to end through the pipeline rather than by arithmetic on the
committed payload: `refresh_reservoirs.py --only Detroit "Green Peter"
--source awdb --dry-run` publishes 76.2% and 45.5% against 223.7% and 122.4%.

The six still above 100 are surcharge inside the allowance — Thompson Falls at
104.0%, Black Canyon at 103.2% — and they keep their conservation pools
deliberately.

## Consequences

**Two charts stop being unreadable.** The storage histogram divides the range
the data covers into ten bands, so Detroit at 223.7% stretched it to 0–224 and
squeezed 355 reservoirs into the left half with four near-empty bands to the
right of them. The band edges follow the data now.

**A percentage above 100 still means something.** It means a reservoir is
surcharged above the pool its operator calls full, which happens, rather than
that the wrong volume is in the denominator.

**The roster entries carry their own reason.** `admitted_reservoirs.json` is
reviewed evidence, and each of the thirteen gained a `denominator_note` naming
the figure it left, the water observed, and the figure that contains it.

**`tools/audit_awdb_stations.py` still does not run `discrepancies`.** This
record does not fix that. The rule above removes the thirteen cases the screen
would have caught here, but the audit is still asking fewer questions of the
Conservation Service candidates than the other two providers' audits ask of
theirs, and a future candidate could arrive with an unstable maximum or a
never-filled series and pass. That is its own change.

## Related

- Narrows [ADR-003](ADR-003-capacity-from-the-national-inventory-of-dams.md)'s
  implementation, not its reasoning: the conservation pool is still what an
  operator means by full, and still the first preference.
- Uses [ADR-065](ADR-065-the-ceiling-is-the-largest-figure-the-record-holds.md)'s
  `SURCHARGE_ALLOWANCE` and its finding that a reservoir may really sit above
  a published pool. ADR-065 chose a ceiling for deciding whether a dam match
  is right; this chooses a denominator, and they are different questions asked
  of the same three figures.
- Sits beside [ADR-070](ADR-070-the-operators-own-full-level-is-the-denominator.md):
  that record prefers the operator's own full level over the inventory
  entirely, and where it applies this rule is never reached.
