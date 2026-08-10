# ADR-003: Take reservoir capacity from the National Inventory of Dams

## Status

Accepted

## Date

2026-08-09

## Context

The dashboard's headline number is how full a reservoir is. That needs a
denominator, and the storage source does not supply one.

This was established rather than assumed. `tools/probe_rise.py` walks
Reclamation's RISE catalog for Lake Powell (item 509 → record 2362 → location
393) and finds: no capacity attribute on the location, no capacity among the 17
catalog items on the record, `hasProfile` false so there is no
elevation–area–capacity table, and empty free-text fields. **RISE publishes no
capacity at all.**

Without one, the dashboard divided by the highest storage ever *observed* since
2015. That number drifts: a reservoir that sets a new high retroactively
shrinks every earlier percentage in its own history.

## Decision

Build `capacities.json` from the USACE National Inventory of Dams with
`tools/build_capacity_table.py`, and **commit it** rather than fetching it at
refresh time.

Prefer `normal_storage` — the conservation pool — as the denominator, falling
back to `max_storage` where NID has no normal figure. The AWDB additions use
AWDB's own traceable reservoir-capacity metadata.

## Alternatives Considered

### Keep dividing by the observed record maximum

- Pros: no second source, no name matching, no new failure mode.
- Cons: the denominator moves, and it moves in the direction that flatters the
  present.
- Rejected as the headline, **kept alongside it.** It is still published as
  `pct_of_record_max`, because it is what the dashboard used to show and
  because it is the only denominator available for reservoirs NID does not
  cover.

### Use NID's headline `nid_storage` figure

- Rejected on measurement. `nid_storage` is the maximum pool *including flood
  surcharge*. Taking it for Lake Powell gives 29,875,000 acre-feet against a
  real full pool nearer 25,000,000 — which quietly understates how empty the
  reservoir is, in the exact place the dashboard is most read.

### Utah Division of Water Resources' published capacities

- Pros: the more local authority for a Utah dashboard.
- Cons: no machine-readable version found. `tools/find_utah_capacities.py`
  records where we looked and what each candidate field actually contained.
- Deferred, not rejected. Revisit if a machine-readable source appears.

### Fetch NID at refresh time instead of committing

- Rejected for the same reason as ADR-005: a denominator that changes silently
  underneath you is worse than one that is a year old. Capacity changes on the
  order of never.

## Consequences

- `normal_storage` turns out to be strikingly close to observation: Strawberry
  1,105,910 acre-feet against 1,106,560 observed since 2015; Rockport 62,120
  against 62,372.
- **Matching reservoirs to dams is the risk**, so every row is checked against
  the storage actually observed since 2015 and rejected if the capacity comes
  in below it — a capacity smaller than water we have already watched sit in
  the reservoir means the wrong dam got attached. Four reservoirs needed help:
  Strawberry and Rockport are impounded by Soldier Creek and Wanship dams, and
  Glen Canyon (Lake Powell) and Meeks Cabin are outside Utah, so a `state='UT'`
  filter dropped them.
- Every entry records its NID id and dam name, so any figure can be traced.
- 28 of 53 reservoirs have a NID capacity; the rest fall back to observed
  record maximum, and the popup always says which denominator it used.
- The committed NID ids later paid for themselves again: ADR-005's dam-point
  comparison could query the inventory *by id*, with no name matching and none
  of its risk.
