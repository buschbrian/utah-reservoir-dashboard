# ADR-015: Confirm a reservoir's dam by position before name

## Status

Accepted.

## Date

2026-08-10

## Context

The dashboard shows how full each reservoir is. To do that it needs two
numbers: the water stored now, and the water stored when the reservoir is
full. The two numbers come from two different agencies.

The storage services give the first number. The Bureau of Reclamation and the
Natural Resources Conservation Service both publish it. Neither publishes the
second number. The second number comes from the National Inventory of Dams,
which the U.S. Army Corps of Engineers maintains. See
[ADR-003](ADR-003-capacity-from-the-national-inventory-of-dams.md).

The dashboard must join the two datasets. Until now it joined them by name.
The join then applied one test: if the dam holds less water than the reservoir
has been seen to hold, the row is refused, because a dam cannot hold more
water than its own capacity.

Both parts of that method are unsafe. We measured how unsafe on 2026-08-10,
against 33 candidate reservoirs and 6,078 dams.

**A name is not an identifier.** The two agencies name the same structure
differently. The inventory calls the dam at Wolford Mountain Reservoir
"Ritschard". It calls the dam at Electric Lake "Pacificorp - Electric Lake".
Twelve of the 33 candidates found no dam by name.

**Two dams can share a name.** Four candidates got a different dam from a name
search than from a position search, and the name gave the wrong dam every
time. Three of the four were wrong by so much that the storage test caught
them. Lake Mead was matched to a dam that holds 132 acre-feet.

**The fourth was not caught, and is the reason for this record.** Willow Creek
Reservoir was matched by name to a dam 120 km away that holds 28,668
acre-feet. That number is believable. It passes the storage test. It belongs to
a different reservoir. The dashboard would have shown Willow Creek as 30% full
when it is 82% full, and no test in the project could have found the error.

**The storage test also refuses reservoirs that are correct.** Reservoirs are
operated a little above the conservation pool, which is the level an operator
means by "full". Eleven candidates hold more water than that level. Most are
close to it: Mcphee Reservoir by 0.4%, DMAD Reservoir by 1.1%, Huntington
Reservoir by 1.5%. Fontenelle Reservoir was in the same position, and a person
had to admit it by hand after checking the dam.

## Decision

Confirm the dam by position first and by name second, then test the storage
against the correct ceiling. The rules are in `admission.py` and are unit
tested in `tests/test_admission.py`.

**1. A dam within 2 km of the reservoir's published point is confirmed.**
A storage gauge stands at the dam or at the outlet. We measured 30 of the 33
candidates within 1.4 km of their dam. At that distance a second dam is not a
realistic possibility, so the name does not have to agree.

**2. A dam further away is confirmed only if the name also agrees, and only
up to 25 km.** Some published points describe the water surface, not the dam.
We measured the 29 reservoirs whose dam is already confirmed by its inventory
identifier: the distance from the point to the dam runs from 0.01 km to
20.87 km. Lake Powell's point is 20.87 km from Glen Canyon Dam. A single small
distance would refuse six matches that are known to be correct.

**3. Every other match is refused.** The dashboard shows fewer reservoirs
rather than wrong numbers.

**4. Test the observed storage against the maximum pool, not the conservation
pool.** The maximum pool includes the water a dam holds back in a flood, so it
is the most the structure can contain. A reservoir above its conservation pool
is being operated normally. A reservoir above its maximum pool is a wrong
match.

**5. Where the inventory gives no maximum pool, allow 2% above the figure it
does give.** Stagecoach Reservoir has held 36,474 acre-feet against a
conservation pool of 36,439 and no maximum pool. That is 35 acre-feet, or one
part in a thousand. A rule that refuses a reservoir over 35 acre-feet is not
protecting anybody.

**6. Keep dividing by the conservation pool.** ADR-003 is unchanged. This
record widens the test that confirms *which dam it is*. It does not change the
number the percentage divides by.

**7. Record the evidence for every decision**: the dam name, the inventory
identifier, the distance, and how the match was confirmed. A person must be
able to check any published reservoir without running the search again.

## Consequences

Of the 33 candidates, **31 are capacity-admissible**, against 10 under the old
method. This is not a publication decision: scope, reporting cadence and
stopped-series policy remain separate gates. The two capacity refusals are
refused for reasons a person should read:

- **Trout Lake Reservoir** has held 4,180 acre-feet against a maximum pool of
  3,200. That is 30% more than the dam can contain, which no operating
  allowance explains. Either the series measures water the dam does not hold,
  or it is still the wrong Trout Lake.
- **Great Salt Lake Rise** publishes no storage series at all. It measures
  water level, not stored volume, so it is not a candidate.

The 2 km and 25 km distances are measurements, not preferences. If either is
changed, the measurement that supports it must be redone.

The dam search must cover every state a dam can be in. Hoover Dam is in
Nevada, and a search that omitted Nevada refused Lake Mead correctly for the
wrong reason: the nearest dam was 88 km away. Whether Lake Mead is published
at all is a scope question, not a matching question, and this record does not
answer it.

This record does not admit any reservoir on its own. It decides how a
candidate is judged. Adding the reservoirs is a separate change, with the
before-and-after totals stated, because every addition moves the published
statewide numbers.

## Alternatives considered

**Keep name matching and add more aliases.** The project already keeps four
aliases, such as Lake Powell for Glen Canyon Dam. Every alias is a human
decision that a reviewer can check, which is good, but the list grows with
every reservoir added and it fails silently when it is incomplete. Willow
Creek shows the failure: nobody would have known to write an alias for a name
that already matched something.

**Match by the inventory identifier.** This is the strongest evidence, and the
project already uses it for the reservoirs it publishes. The storage services
do not publish that identifier, so it cannot start the join. It is the right
thing to *record* after a match is confirmed, and this record requires that.

**Accept the nearest dam, whatever the distance.** This publishes a number for
every reservoir, and some of those numbers are wrong. Lake Mead would have been
published with the capacity of a dam 88 km away.

**Divide by the maximum pool.** This removes every refusal, because no
reservoir exceeds its flood pool. It also makes every reservoir look emptier
than it is, and it answers a question nobody asks. ADR-003 rejected it for
those reasons and still does.
