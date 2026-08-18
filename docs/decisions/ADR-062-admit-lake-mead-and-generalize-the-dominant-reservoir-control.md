# ADR-062: Admit Lake Mead, and generalize the dominant-reservoir control

- Status: Accepted
- Date: 2026-08-18

## Context

Lake Mead sits in `150100 Lower Colorado-Lake Mead`, one of the fourteen
drainage areas this dashboard has published since ADR-009. It was in scope
geographically from the beginning and was never admitted, so the area named
after it carried none of it.

At **28,255,000 acre-feet** it is larger than Lake Powell, and it would be
substantially the whole of that area's storage. That is the same problem
ADR-011 solved for Powell — a combined figure with it and one without are both
true and are not the same measurement — arriving a second time.

## Admitting it

**The provider identity is RISE catalog item 6124**, and finding it is the
part worth recording.

`?locationId=3514` is **ignored** by the RISE API. It does not error; it
returns an unfiltered page of catalog items. Sampling the storage items it
returned gave 19,112 af, 254,611 af, 22,471 af and 1,030 af — none of them a
plausible figure for Lake Mead, and all four in fact Utah reservoirs already
on this roster: Lost Lake, Trial Lake, Platoro, Millerton. A filter that is
quietly ignored is worse than one that fails, because the answer looks like an
answer.

The way in is the walk the roster's own comment already described: **location →
catalog record → catalog item.** Location 3514 has five catalog records; 4370
is "Water Operations Monitoring Data from the Lower Colorado Hydrologic
Database" and holds four items, of which 6124 is daily storage in acre-feet.
It reports 6,961,850 af for 2026-08-17 and carries 4,247 observations back to
2015 — about 24.6% of capacity, which is the right order for Mead today.

**The capacity is NID `NV10122`, Hoover Dam, Nevada**: 28,255,000 af normal
storage against 30,237,000 max, at coordinates identical to the RISE location.
Read from the owner-operated inventory adopted in ADR-057. Querying NID by
name is its own trap — 43 rows match "Hoover", including a stock pond in Texas
holding 42 acre-feet — so the match is confirmed by position as well as name.

**The published point is the dam.** For every other reservoir here the
published point is the water and the dam is a second, reviewed point; RISE
publishes Hoover Dam for this location, so for Mead they are the same point.
It resolves to Clark County, Nevada, and to drainage area 150100.

**Its waterbody spans two states, and only NHD says so.** RISE publishes five
monitoring points on Lake Mead — Hoover Dam, Temple Bar, Sandy Point, Las
Vegas Wash, Echo Bay — and **all five are in Clark County, Nevada**. The
provider's own evidence would have defaulted `waterbody_states` to Nevada
alone and been a third wrong. Measured against the NHD polygon (permanent
identifier `122648503`, 541.3 km²), the surface is **66.7% Nevada and 33.2%
Arizona**, so it joins Bear Lake and Meeks Cabin in ADR-060's reviewed table
with the same class of evidence.

`intersects_utah` is false, so Mead appears only under the connected
geography. That is correct: it is connected to Utah by drainage and its water
never enters the state.

## The control

`isLakePowell` becomes one of a small table of **dominant reservoirs**, keyed
on the RISE item id with the name as a fallback for a payload predating the
id. `StatewideRollupOptions` gains `lakeMead` beside `lakePowell`.

Two named fields rather than one abstraction over a set. There are two of
these, the URL contract already publishes `powell` and is translated by the
retired routes, and a reader toggling a control labelled "Include Lake Powell"
must not silently be toggling Mead as well. A third would be the moment to
generalize the shape rather than the mechanism.

**Absent means excluded.** Every existing caller was written before Mead was
on the roster; a default of "include" would have them silently start adding
28 million acre-feet to totals nobody changed.

## Consequences

The roster is 70. `counties.json` was rebuilt over it — 36 counties now, with
Mead in Clark County, Nevada.

**A roster addition requires a refresh in the same change.** `--only` prints
and never writes, so it is a probe rather than a write path, and
`tests/test_refresh.py` asserts that every roster name is either published or
withdrawn. There is deliberately no "pending" state: a name on the roster and
absent from the payload is exactly what a silently failed fetch looks like.

The area this reservoir is named after will change substantially the first
time anyone includes it, which is the point of the control rather than a
side effect of it.
