# ADR-065: The ceiling is the largest figure the record holds, plus a surcharge

- Status: Accepted
- Date: 2026-08-19

## Context

ADR-015 established how a candidate reservoir is joined to a dam in the
National Inventory of Dams, and the second of its two rules is the one that
catches a wrong join: **reject the match if the reservoir holds more water
than the dam can contain**, because that means the wrong dam was matched.

The implementation asked that question of the dam's *maximum pool* where the
inventory published one, treating it as a real ceiling needing no allowance,
and of the other figures with a 2% allowance where it did not. That was
measured against the 34 Utah-connected candidates and held there.

Run against the 158 western candidates, it refused 22 -- and thirteen of those
are right-dam matches, at 0.04 to 0.15 km with their names agreeing. The full
measurement is in `docs/WESTERN-RESERVOIR-ADMISSION.md`.

Two separate causes, and neither is a wrong dam.

**The inventory's own figures disagree about which is largest.** A maximum
pool is not always the biggest number in the record it sits in. Deadwood Dam
publishes a maximum pool of 153,992 and a headline figure of 191,600; the
reservoir has held 157,590, which is inside its own record's larger number and
outside the one being read as the ceiling. Cle Elum was refused while **62%
full** the same way -- 437,382 seen, a 437,000 maximum pool, and a 710,000
headline. Eight reservoirs were refused on that alone.

**Reservoirs are surcharged above every published pool.** American Falls has
held 1% over, Lake Tahoe 1%, Jackson Gulch 2%, Drews 6%. Beulah was refused
for being seen **19 acre-feet** above a 59,212 conservation pool while the
same record says the dam holds 66,000.

Meanwhile the cases the rule exists for are not close calls at all. Lake
Havasu matched a 6,300 acre-foot dam called Gene Wash while its water sits
behind Parker Dam: **97 times over**. The Salt River Reservoir System station
reports a total across six reservoirs and matched one of their dams: 29 times.
"Mission Valley (8)" and "Camas (4)" say in their own names that they report
several reservoirs each: 8.2 and 7.0 times.

## Decision

**The ceiling is the largest of the three published figures** -- maximum pool,
headline figure, conservation pool -- and not whichever field is present.
`largest_published_pool` in `admission.py` is that number. A dam with no
figures at all publishes no ceiling, and that is not evidence either way.

**A reservoir may hold 10% more than that ceiling before the match is refused.**
`SURCHARGE_ALLOWANCE` replaces the 2% `CONSERVATION_ALLOWANCE`, and it is
absorbing a different thing: not the gap between a conservation pool and a
maximum pool, which is now inside the ceiling, but real operation above every
pool the inventory names.

**The lenient screen becomes the strict test's complement.** `could_hold`
chose between candidate structures with a weaker question than the one used to
accept a match, which is the wrong way round: a screen stricter than the
acceptance test can discard a dam that would have been accepted, and that is
how Trial Lake was once matched to Washington Lake Dam. One question, one set
of figures, asked in two places.

## What it admits, measured

| | before | after |
|---|---:|---:|
| western candidates admitted | 124 of 158 | **137 of 158** |
| refused as holding more than the dam | 22 | **9** |

Nothing that was admitted became refused. The thirteen gained are American
Falls, Beulah, Bumping Lake, Cle Elum, Deadwood, Drews, Gerber, Jackson Gulch,
Keechelus, Lake Tahoe, Rimrock, Thief Valley and Warm Springs.

The nine still refused are the two aggregate stations, the two river-system
stations, Lake Havasu's wrong dam, Priest Lake at 2.0×, Henrys Lake at 1.6×,
Trout Lake at 1.31× and Lake Mohave at 1.11×.

The Utah-connected scope is unchanged: 16 of 19, with Trout Lake still refused.

## The edge is a judgement, and these are the two cases at it

**Drews at 1.06× is admitted and Lake Mohave at 1.11× is refused**, and Mohave's
match is Davis Dam at 0.05 km, which is certainly its dam. The station reports
what looks like gross pool against an inventory figure for normal pool.

That is the cost of a single threshold, stated rather than hidden. Mohave can
be admitted later the way Lake Mead was -- by review, into the committed
capacity table, with its evidence written down (ADR-062) -- which is the path
this project already has for a reservoir the automatic rules will not take.

## Alternatives Considered

### Keep the maximum pool as an unallowanced ceiling and widen only the others

- Pros: no change to the field the inventory documents as the maximum.
- Rejected by the data: eight of the thirteen were refused *because* a maximum
  pool was present and smaller than the same record's headline figure. The
  field is not reliably the largest, so reading it as the ceiling is reading
  the wrong number confidently.

### A 20% allowance

- Pros: admits Lake Mohave, whose dam is not in doubt.
- Rejected: it also admits the Verde River Reservoir System at 1.15×, which is
  a station reporting several reservoirs against one dam's capacity -- exactly
  the arithmetic this rule exists to refuse. A threshold that admits a known
  wrong answer to catch a known right one is worse than one that names both.

### Compare against the reservoir's own observed maximum instead

- Pros: no inventory figure to be wrong about.
- Rejected: the observed maximum is what is being checked. The point of the
  join is to obtain a denominator the provider does not publish, and checking
  a number against itself confirms nothing.
