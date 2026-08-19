# ADR-066: A reservoir is keyed by its station, not by its name

- Status: Accepted
- Date: 2026-08-19

## Context

Every roster file this project keeps was keyed by the reservoir's name:
`RESERVOIRS` and `BASE_AWDB_RESERVOIRS` in `refresh_reservoirs.py`,
`connected_reservoirs.json`, `capacities.json`, `counties.json`, the
`by_name` index into `normals.json`, and the index of the previous payload
that `carry_forward` reads. `reference.json` published its capacity catalog
keyed by name as well, and `data.html` documented it that way.

That held while the roster was 69 Utah-connected reservoirs, because no two of
them share a name.

The western candidate pool breaks it. Admitting the 137 reservoirs the rules
accept would put **two Lost Creeks** on the roster — one in Utah holding
22,510 acre-feet, one in Oregon behind William L. Jess Dam holding 465,000,
**946 km apart** — along with two Willow Creeks and two Clear Lakes.

Under a name key, one silently becomes the other. Not loudly: a Python dict
takes the last value written, `capacities.get(name)` hands back whichever
capacity was loaded last, the climate normal follows, the county follows, and
`carry_forward` republishes one reservoir's last reading under the other's
name the morning a feed goes quiet. The map draws a circle, the totals add up,
and every number about one of them is wrong.

This is ADR-058 arriving in a second place. That record established the rule
for counties — "the key is the five-digit FIPS code and never the name" —
after finding two Summit, two Carbon and two Garfield Counties on a roster of
35. The same argument applies to the thing being counted.

## Decision

**A reservoir is keyed by `source_station_id`**: its RISE catalog item id or
its AWDB station triplet. Nothing was invented for this — every published
record already carries that field, and ADR-003 already calls it the stable
provider identity. The roster files simply stop being keyed by the label.

| | keyed by |
|---|---|
| `RESERVOIRS` | RISE item id, value `(name, lat, lon)` |
| `BASE_AWDB_RESERVOIRS`, `AWDB_RESERVOIRS` | station triplet, value `(name, lat, lon, capacity, cadence)` |
| `connected_reservoirs.json` | station triplet, `name` inside |
| `capacities.json`, `counties.json` | station id, `name` inside |
| `normals.json` index | station id (`by_station`) |
| the previous payload | station id |

**The name stays what a reader sees, and what `--only` takes.** A person types
a name; `refresh_reservoirs.py --only "Lost Creek"` resolves it to *every*
station carrying it rather than silently picking one, which is the honest
answer to an ambiguous request.

**`reference.json` moves to schema 3.** `capacity_catalog.capacities` is keyed
by station id and each entry carries its `name`. That is a break for anyone
indexing the catalog by name, and it is versioned rather than slipped in: the
client already refuses a shape it does not know, and a consumer is better told
than handed a key that has quietly become a different reservoir's.

**Where a name must be unique, that is now asserted rather than assumed.**
`RESERVOIR_NAMES` maps station to label in one place, and the roster tests
hold the count of labels against the count of stations.

## Consequences

- **The refresh reproduces the payload exactly.** Same 69 stations, and every
  identity and derived field — name, capacity, county, drainage area, state,
  assignment source — byte-identical. The rekey moved plumbing and no number,
  which is the only acceptable outcome for a change this wide.
- **One guard caught itself.** The run's completeness check counted records
  whose *name* appeared in the set of selected targets, and that set became
  station ids: it matched nothing and refused every run. It is a good failure
  — loud, immediate, and refusing to publish — and it is exactly what the
  check exists to do.
- **The client still identifies a reservoir by name.** The selection store,
  the list, the table, the CSV filename and `?reservoir=` all carry the label.
  Two same-named reservoirs would therefore both be published with correct
  numbers and be hard to tell apart on screen, and a deep link would pick one
  of the two. That is the remaining half of this record and it is not built
  yet; until it is, the colliding candidates stay out of the roster.

## Alternatives Considered

### Qualify the colliding names instead

Admit the western ones as "Lost Creek (Oregon)" and keep the name as the key.

- Pros: no structural change, no API break, and the labels a reader sees are
  the ones they would have wanted anyway.
- Rejected: it leaves the trap set. The next collision is silent again, and
  the name is doing a job — identity — that it demonstrably cannot do. It also
  makes the key unstable in a subtler way: admitting an Oregon Lost Creek
  would change the Utah one's key from "Lost Creek", so a consumer breaks
  either way and this way there is no version to say so.

### Skip the colliding candidates

- Pros: smallest change; the other 134 could be admitted today.
- Rejected: three real reservoirs, one of them 465,000 acre-feet, left out
  because of a data-structure choice this project can fix. And the fix is
  needed eventually regardless — the west has more names than the roster does.

### A synthetic id of this project's own

- Pros: independent of any provider's identifier scheme.
- Rejected: it would need minting, committing and keeping stable by hand,
  which is a second identity to get wrong. The provider's id is already stable,
  already published, and already what ADR-003 nominated.
