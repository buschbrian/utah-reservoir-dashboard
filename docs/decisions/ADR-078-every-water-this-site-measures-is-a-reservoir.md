# ADR-078: Every water this site measures is a reservoir

- Status: Accepted
- Date: 2026-08-22

## Context

The scoping that became this record asked a question the roster had never
answered: which of these waters are lakes, rather than calling everything a
reservoir? Of 375 published names, 105 end in "Reservoir", 99 contain "Lake",
and 173 say neither. A published percentage of capacity means something
different for a natural lake operated between limits than for a dammed
impoundment, so the word matters beyond tidiness.

The reviewer ruled the twenty-six damaged-name entries first, and the answer
did not generalize the way NHD suggested it would:

- **NHD's `FType` cannot carry the distinction.** It types twenty-five of the
  twenty-six as LakePond — Courtright Reservoir and Ice House Reservoir among
  them, both dammed impoundments with reviewed capacities.
- **GNIS can, but does not reach.** It names the same waters Reservoir where
  it answers at all, and answers inside the reviewer's kilometre for only six.
- **Filling from whichever source answered recorded source coverage, not the
  water**: two near-identical reservoirs came out typed differently, which is
  how a published label stops describing its subject.

Membership of the roster is the evidence that survives. Every published entry
holds behind a dam (ADR-003's dam inventory), has a reviewed full level, and
reports storage measured against it.

## Decision

**Every water on the roster is published as a reservoir.** The type is a
property of membership — dam, full level, reported storage — not a lookup
against a hydrographic classification. No per-record type field is published,
because a field that is the same on all 375 records is not information; the
decision lives here and in one glossary sentence a reader can find.

**A natural lake raised by a control structure is a reservoir under this
rule**, and may still be called a lake by the people who live beside it: the
*name* keeps its local form — Riffe Lake stays Riffe Lake — while the site's
word for what it measures stays reservoir. Bear Lake is the case the scoping
named, and it keeps both facts.

**No third state.** "Regulated lake" was considered and set aside: with the
type uniform by rule, a second word for some members would claim a distinction
the roster's own evidence does not carry, and would reopen as a method change
the moment any figure treated the two differently.

## Consequences

The methods page's glossary defines the word once, where the other terms live,
rather than labelling records with a constant. If a future roster ever admits
a water without a dam — a naturally terminal lake like Walker Lake is the
obvious candidate, and NWIS holds several — this record is what changes, and
the glossary sentence changes with it rather than growing per-record labels.
