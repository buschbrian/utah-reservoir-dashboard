# ADR-070: Where the operator publishes a full level, that is the denominator

- Status: Accepted
- Date: 2026-08-20

## Context

ADR-003 chose the dam inventory's conservation pool as the figure a percentage
divides by, and gave the reason: the conservation pool is what an operator
means by "full". At the time that reasoning had one implementation, because
the inventory was the only place this project could read a full level at all.
The two federal providers publish readings; they did not publish a
denominator.

California's Data Exchange Center does, for a fraction of its stations, in its
daily reservoir report. That put two answers to one question in the same
evidence row, and the first audit of the 169 candidates held **16** of them for
disagreeing by more than the surcharge allowance -- with the direction almost
always the same, the inventory's pool lower than the figure the operator
publishes:

| station | reservoir | inventory | the operator | |
|---|---|---:|---:|---:|
| `KES` | Keswick | 7,470 | 23,772 | −69% |
| `TRM` | Terminus | 113,431 | 185,600 | −39% |
| `COY` | Lake Mendocino | 74,500 | 122,400 | −39% |
| `WRS` | Lake Sonoma | 245,000 | 381,000 | −36% |
| `PNF` | Pine Flat | 772,300 | 1,000,000 | −23% |
| … | 11 more | | | −11% to −31% |

**The water settles which figure is which.** Twelve of the sixteen have been
observed *above* the inventory's pool and inside the operator's -- Pine Flat at
991,966 acre-feet against 772,300 and 1,000,000, Terminus at 185,801 against
113,431 and 185,600. A denominator a reservoir routinely exceeds is not the
level its operator calls full.

**And the project had already decided this once, for a different provider.**
`capacity_basis` in the published payload reads `reclamation_project_record`
for reservoirs where Reclamation's own record replaced the inventory's figure,
and `awdb_reservoir_metadata` for the 25 stations that arrive with a full level
beside their readings. Keswick is the reservoir that makes it plain: it is
published today at **23,800 acre-feet from Reclamation's project record**,
while the inventory calls its pool 7,470 -- the same reservoir, the same
disagreement, already settled the other way for the provider that happens to
report it.

## Decision

**Where the provider that publishes the readings also publishes a full level,
that figure is the denominator.** The inventory answers where it does not.
`preferred_capacity` in `admission.py` is that rule, and it is deliberately
opt-in: a caller names the `capacity_basis` its provider's figure is published
under, and a caller that names none is unchanged. The two federal audits pass
none.

**The disagreement screen keeps only the case it still describes.**
`discrepancies` measures the drift against the figure actually chosen, so it
reports the inventory contradicting a denominator this project is dividing by,
and stays quiet when the rule has already preferred the operator's own. A
screen that fired anyway would hold every reservoir the rule exists to admit.

**A preferred figure names its source.** `cdec_reservoir_report` joins
`reclamation_project_record` under the same guard in
`validate_capacity_evidence`: a denominator chosen over the inventory carries
`capacity_source`, `capacity_source_url` and `capacity_source_checked`, or the
roster refuses to load. "The operator says so" belongs in the file, not in a
commit message.

**Two keys, one label.** `reclamation_project_record` and
`cdec_reservoir_report` say the same thing to a reader -- the full level
published by the reservoir operator -- so `basisShares` groups by the label
rather than the key. Keyed by basis, the storage-charts sentence read
"…published by the reservoir operator 4, …published by the reservoir operator
33", which is one fact printed twice.

## What it admits, measured

Against the California candidates on 2026-08-20:

| | before | after |
|---|---:|---:|
| candidates | 159 | 159 |
| publishable | 126 | **138** |
| held | 33 | **21** |
| newly held by the change | | **0** |
| full level published | 18.6 M af | **21.6 M af** |

The service publishes a full level for **25 of the 159**, so the rule reaches
25 reservoirs and no others. Twelve are freed. Ten already passed and shift
denominator, nine of them by under 4% -- Pyramid is the largest move at −5.6%.
Three stay held on other evidence: Buchanan and Success are above even their
operator's figure, and San Luis has no matched dam.

Nothing that passed before fails after. That is the property worth stating: a
rule that freed twelve reservoirs at the cost of holding one would be a trade,
and this is not one.

## What it does not decide

**It is not a rule about which agency is right.** It is a rule about which
question each source answers. The inventory describes a dam; the operator
describes what it runs the reservoir to. Where only the inventory speaks, its
figure is unchanged and 229 published reservoirs still divide by
`normal_storage`.

**It does not repair a series.** Buchanan Dam has been seen holding 172,105
acre-feet against the 150,000 its own operator publishes, and this rule has
nothing to say about that. It stays held (issue
[#25](https://github.com/buschbrian/western-water-dashboard/issues/25)).

## Alternatives Considered

### Keep the inventory's conservation pool everywhere

- Pros: ADR-003 untouched; one source for every denominator on the site.
- Rejected: it is already untrue in the published payload -- 28 reservoirs
  divide by an operator's own record today -- so the choice was not between
  one source and two, but between applying the existing rule to a third
  provider or leaving twelve reservoirs held for a disagreement this project
  has settled twice before.

### Prefer the operator's figure only where the water exceeded the inventory's

- Pros: narrower, and every case is backed by a reading.
- Rejected: it makes the denominator depend on how wet the last ten years
  were. Two reservoirs with the same disagreement would be measured against
  different sources because one of them happened to fill. The rule should be
  about which source answers the question, and the readings are the evidence
  that it does -- not the trigger.

### Publish both figures and let the reader choose

- Pros: the honest shape of a genuine disagreement, and ADR-041 already does
  exactly this for comparison periods.
- Rejected here: a period is a question a reader has an opinion about -- "as
  against the last decade, or the standard thirty years" is a real choice. Which
  of two agencies measured a concrete pool is not; it is a question with one
  right answer that this project has to determine, and offering it as a
  preference would be asking the reader to do the review.
