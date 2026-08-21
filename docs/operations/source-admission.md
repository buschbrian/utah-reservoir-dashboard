# Admitting a reservoir source

The procedure for adding, replacing or reviewing a provider or a reservoir.
The agent-facing short form is
[`.claude/skills/reservoir-source/SKILL.md`](../../.claude/skills/reservoir-source/SKILL.md);
this is the detail behind it. The candidate evidence itself lives in
`docs/WESTERN-SOURCE-CANDIDATES.md`, `docs/CDSS-CDEC-API-REVIEW.md` and the
admission reviews indexed by [`docs/README.md`](../README.md).

## Three providers, and a provider is named by its agency

`SourceKey` is `rise | awdb | cdec` and every table keyed by it is exhaustive,
so a fourth provider is a compile error rather than an `undefined` reaching a
reader. Visible text names the agency and never the system: "Bureau of
Reclamation", "Natural Resources Conservation Service", "California Department
of Water Resources" (ADR-006).

## A reservoir is keyed by its station, not its name (ADR-066)

A name is a label, not an identity: the west holds a Lost Creek in Utah and
another in Oregon, 946 km apart. Every roster is keyed by the provider's own
identifier, which is what the payload publishes as `source_station_id`.

## The two questions a candidate must answer

**A dam match is not the whole question.** `admit` asks whether the inventory
holds the right dam and answers from the inventory alone. `discrepancies` asks
whether everything else known about the same reservoir agrees with it:

1. whether the provider's own full level and the inventory's differ;
2. whether the water has stood above the capacity it would be divided by;
3. whether it has ever stood a third of the way up it; and
4. whether one reading sits far above the rest of the series.

All four reuse the measured `SURCHARGE_ALLOWANCE` rather than a new number. Of
169 California candidates the inventory admitted 162 and the screens held 36 —
Keswick's conservation pool of 7,470 acre-feet against the service's 23,772, and
O'Neill Forebay matched to a dam 1.18 km away carrying San Luis Reservoir's
2,094,900, thirty-seven times its own. The spike screen reads the **third**
highest reading, because Lake Havasu carries two and a rule reading the second
would have called them agreement.

**Nothing is repaired.** Every correction available is a guess about which
source is wrong, so the screen reports and a person decides
([#25](https://github.com/buschbrian/western-water-dashboard/issues/25)).
`publishable` is the field a roster builder reads and it is deliberately
narrower than `admitted`, which still states that the dam match itself stands.

**Being listed is not reporting.** The candidate screen asks whether a station
has answered **within the year**. Bon Tempe is why — five usable readings ever,
the last in March 2023 — and admitting it would have put a name on the roster
that is withdrawn for a quiet feed the same morning, which is what a silently
failed fetch looks like.

## The denominator

**Where the operator publishes a full level, that is the denominator**
(ADR-070). ADR-003 prefers the conservation pool because that is what an
operator means by full, and the dam inventory was long the only place to read
one; where the provider that publishes the readings publishes a full level too,
that figure wins.

`preferred_capacity` is the rule and it is **opt-in** — a caller names the
`capacity_basis` its provider's figure carries, and the two federal audits name
none, so nothing outside California moved. A preferred figure **names its
source or the roster refuses to load**: `cdec_reservoir_report` and
`reclamation_project_record` both require `capacity_source_url` in
`validate_capacity_evidence`. The disagreement screen measures against the
figure *actually chosen*, so it reports an inventory contradicting a denominator
this project divides by and stays quiet once the rule has settled it.

Two keys, one reader-facing phrase: `basisShares` groups by label, because
"published by the reservoir operator 4, published by the reservoir operator 33"
is one fact printed twice.

**Do not introduce a new capacity precedence rule without a decision record.**

## A reviewed admission names the screen it was admitted against

Five California reservoirs are on the roster over a screen that held them, and
`admitted_cdec_reservoirs.json` carries `review.waived` and `review.why` for
each — the loader refuses a waiver with no reason, because a waiver with no
reason is a screen turned off. The same file's `withheld` block names every
candidate kept out and the finding behind it, so the next reader meets the work
rather than repeating it: Lake Havasu's reviewed 646,200 acre-feet is recorded
there beside the spike that keeps it unpublished.

## A roster addition needs a refresh in the same change

`tests/test_refresh.py` asserts every roster name is either published or
withdrawn, and there is no "pending" state on purpose: a name on the roster and
absent from the payload is what a silently failed fetch looks like.

- `refresh_reservoirs.py --only "Name"` prints and never writes, so it is a
  probe.
- `tools/build_normal_baselines.py` merges on every path — `--only` used to
  write its one reservoir as the whole file, and a full run used to drop the
  normal of every reservoir withdrawn that morning.

## Checklist

1. Identify the measurement semantics: what the value means, its units, and
   what date the provider stamps it with. Correct the calendar, never the
   reading.
2. Identify the full-level authority and whether the provider publishes one.
3. Read the closest existing adapter in `pipeline/providers.py`.
4. Discover candidates with the matching `tools/audit_*_stations.py`.
5. Run the admission and discrepancy screens; record every withheld candidate
   with its finding.
6. Add the roster entries **and** run the refresh in the same change.
7. Build the missing normals: `tools/build_normal_baselines.py --missing`.
8. Re-run the dam-versus-waterbody check; it is what found Lake Powell.
9. `npm run verify:pipeline`.
