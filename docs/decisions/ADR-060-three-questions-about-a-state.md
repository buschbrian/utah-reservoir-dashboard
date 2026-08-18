# ADR-060: Three questions about a state

- Status: Accepted
- Date: 2026-08-18

## Context

ADR-011 gave the dashboard two Utah facts, and they were right to be two:
`in_utah` is the provider point, `intersects_utah` is the waterbody and
carries a reviewed list of the two bodies that cross the line from outside.
Together they let the site ask "reservoirs in Utah" and "reservoirs in
drainage areas connected to Utah" without either quietly becoming the other.

The western expansion needs the same distinction for eleven states, and a pair
of booleans per state is twenty-two fields that all mean two things.

Generalising it turned up that the pair was really three questions.

## Decision

Three fields replace the per-state pair.

**`state`** — the one state containing the published point. A point is in
exactly one state, so this is a string. `in_utah` is its Utah special case and
stays for compatibility.

This is not a new lookup. The county assignment (ADR-058) already resolves
this reservoir's own point against a state-and-county service, so the state
came with it. It was published as `county_state`, which stored one fact under
a name suggesting it belonged to the county rather than to the reservoir;
measured against `in_utah` across all 68 published reservoirs, the two agree
everywhere. Renamed rather than duplicated.

**`waterbody_states`** — every state the water touches. The reviewed answer
where a waterbody crosses a line, and the point's own state otherwise. The
default is stated as a default: nobody has reviewed most of these reservoirs,
and returning the point's state is the honest answer rather than a finding.

**`connected_states`** — every state the drainage area reaches. Free: the
committed boundary file already carries each unit's `states`, and
`assign_huc` already returns the whole unit.

They differ in ways a reader cares about:

| reservoir | `state` | `waterbody_states` | `connected_states` |
|---|---|---|---|
| Lake Powell | UT | AZ, UT | AZ, UT |
| Bear Lake | ID | ID, UT | ID, UT |
| Meeks Cabin | WY | UT, WY | CO, UT, WY |
| Hyrum | UT | UT | ID, UT |

Hyrum is the clearest: wholly inside Utah, fed from Idaho. A reader asking
what Idaho's snow feeds wants the third column; one asking what is in Idaho
wants the first.

## What generalising the question exposed

**Lake Powell was missing from the reviewed table.** The Utah-only table
existed to add *Utah* to waterbodies whose point was somewhere else, so a
reservoir already pointed at Utah never needed an entry — and Powell's water
crosses into Arizona all the same.

The evidence is this project's own, and needed no external lookup: Powell's
reviewed dam point is in Coconino County, Arizona (ADR-057) and its published
waterbody point in San Juan County, Utah (ADR-058). Measured across every
reservoir holding both points, **Powell is the only one where they fall in
different states**, so that check both found the gap and bounded it.

The table now records which kind of evidence each entry rests on — an NHD
permanent identifier for the two reviewed against NHDPlus HR, and the two
committed points for Powell.

## Consequences

`intersects_utah` reads the generalised table and is unchanged in value, which
`tests/test_huc.py` asserts directly. Nothing published moves except by
gaining fields.

**The reviewed list is not complete and does not claim to be.** It holds three
waterbodies. The dam-versus-waterbody check is evidence this project already
has for every reservoir with a dam point, and it found one; a reservoir
straddling a line with both its points on the same side would still need NHD
review. The default is visible in the data rather than hidden: a reservoir
whose `waterbody_states` is exactly its `state` has not been reviewed, it has
been defaulted.

At western coverage this matters more, and the same check should be re-run
whenever the roster grows — it is cheap and it is already written.

**A state filter has three possible meanings and the site must pick per
control.** "Reservoirs in Idaho" is `state`; "reservoirs whose water is in
Idaho" is `waterbody_states`; "reservoirs Idaho's snow feeds" is
`connected_states`. ADR-011's warning applies unchanged — a geographic filter
that quietly means one of these while reading as another is the failure this
record exists to prevent.
