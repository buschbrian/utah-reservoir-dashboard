# ADR-057: A dam identifier names a project, not a structure

- Status: Accepted
- Date: 2026-08-18

## Context

The source inventory listed the dam inventory reference as a migration
candidate: capacity evidence and dam points came from a hosted copy of the
National Inventory of Dams on ArcGIS Online, and should come from the
owner-operated U.S. Army Corps service instead. It scoped the move as a
five-step parity exercise, on the assumption that two copies of one inventory
might disagree.

They do not. Both services publish 81 fields under the same names, and for
all 29 committed dam identifiers they return identical values — names, all
three storage figures, both coordinates. The migration changed no published
number, and rebuilding the dam points against the owner service reproduced
all 29 committed positions exactly.

What the parity plan did not think to ask was whether an identifier names one
thing.

### It does not

A `NIDID` identifies a *project*. Three of the committed ones return more than
one row:

| identifier | reservoir | structures |
|---|---|---:|
| `UT00184` | Lost Lake | Lost Lake Dam, Lost Lake Dike |
| `UT10123` | Hyrum | Hyrum Dam, Hyrum Dike |
| `UT10156` | Stateline | Stateline Dam, Stateline Dike A, Stateline Dike B |

Every row of a project carries the **same** storage figures, so
`capacities.json` was never exposed on the number it exists to record. The
coordinates are not the same. The structures sit up to **0.58 km** apart, and
that coordinate is the drainage-area assignment point — ADR-013's decision
that a reservoir belongs to the basin its water *leaves through*, not the one
holding the middle of the lake.

`tools/add_dam_points.py` collected rows into a dictionary keyed by
identifier, so it kept whichever arrived last. That is not a rule, and it is
not stable: the two inventory copies return Stateline's three rows in
different orders, so the same code against the same data wrote the dam from
one service and a dike from the other. The committed file happened to hold
the dam for all three.

This is precisely what rule 4 of the source inventory exists to prevent — "an
assignment that can change underneath you is not reproducible" — defeated
inside the tool that writes the committed file.

### What it currently costs: nothing

Every structure of each of the three projects falls in the same drainage area:

| project | structures | spread | distinct HUC-6 |
|---|---:|---:|---:|
| Lost Lake | 2 | 0.35 km | 1 (Jordan) |
| Hyrum | 2 | 0.58 km | 1 (Lower Bear) |
| Stateline | 3 | 0.57 km | 1 (Upper Green) |

So no published assignment moves, whichever row wins.

**That is a property of the level, not of the data.** A HUC-6 basin is large
enough that 600 metres almost never crosses one. The western expansion scoping
puts HUC-8 on the path — 571 subbasins where today there are 14 areas — and at
that size a 600-metre ambiguity between a dam and its dike is a coin toss
about which subbasin a reservoir is reported in. Fixing it while it is free is
cheaper than discovering it as a changed assignment later.

## Decision

**A project's point is its principal structure**: the row not named as a
secondary embankment — dike, dyke, saddle, auxiliary — with the name as the
tie-break after that.

A dike holds back the same pool as the dam beside it. The dam is where the
stored water leaves, which is the question ADR-013 already answered for
choosing dam points over lake points; this record only says which dam.

The rule **sorts rather than filters**, so a project whose rows are all named
as secondary structures still resolves to one of them rather than to nothing.
An inventory that names things unexpectedly should give a worse answer, not no
answer, when the alternative is a reservoir silently losing its point.

`tools/add_dam_points.py` prints every project where it had to choose, and
which structures it passed over. A choice nobody can see is the same problem
in a quieter form.

## Consequences

The rule reproduces all 29 committed dam points, so nothing published moves
and no re-review is needed.

Storage is unaffected in principle as well as in fact: the figures are the
project's, so they cannot vary by structure. Only the point does.

`admission.find_dam` still matches candidates by position and name across the
whole state scope, and therefore still sees dike rows as separate candidates.
It has not been changed here. Its distance rule makes a dike an acceptable
match for its own reservoir, which is not wrong — a dike is on the same pool —
but it means the *matcher* and this rule can disagree about which structure
represents a project. Nothing observed today depends on it. It is recorded so
the next person to widen the roster knows where the second copy of this
question lives.

The 40 km plausibility guard in `add_dam_points.py` is unchanged and still
does its own job: this record picks between structures of one project, and
that guard rejects a project that is not the right one at all.
