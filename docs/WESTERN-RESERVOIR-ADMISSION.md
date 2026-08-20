# Admitting the western reservoirs: what the run found

**Status (2026-08-20): historical admission measurement; delivered through
the later R1 and R2 reviews.** The capacity ceiling, cross-provider dedupe, and
station-keyed roster changes described here are implemented. Use the current
payload for published counts and
[`WESTERN-ROSTER-ADMISSION-REVIEW.md`](WESTERN-ROSTER-ADMISSION-REVIEW.md)
plus [`RISE-ADMISSION-REVIEW.md`](RISE-ADMISSION-REVIEW.md) for the final
review trail.

Measured 2026-08-19 against `west-huc6`, with
`tools/audit_awdb_stations.py` and `tools/audit_candidate_capacity.py`. Every
figure here came from a real run, and nothing has been admitted: this is the
review the admission rules exist to be reviewed by.

## The pool, and the rate

| | |
|---|---:|
| active AWDB storage stations, nationally | 347 |
| already tracked | 67 |
| outside the drawn drainage areas | 122 |
| **candidates** | **158** |
| admitted by the rules | **125 (79%)** |
| refused | 33 |

The scoping projected a 63% admission rate from this project's own Utah
history and the west came in at **79%**, so the pool is in better shape than
the projection assumed. The 125 carry **66.0 million acre-feet** of capacity,
of which 28.3 million is Lake Mead — which is already published, and is the
first of the three findings below.

By state: Oregon 38, Idaho 19, Colorado 16, Montana 11, Washington 10, Utah 9,
California 7, Wyoming 5, Nevada 5, Arizona 4, New Mexico 1.

RISE candidates are not in this count. The scoping measured 180 RISE
reservoirs inside `west-huc6` against 225 AWDB stations, with 99 reporting
through both, so the union is about 306 and this is the AWDB half of it.

## Finding 1: the capacity check compares against the wrong number

Twenty-two candidates were refused for "holding more water than the dam can
contain". That rule exists to catch a **wrong dam** (ADR-015), and it is
catching the right dams as well, because it compares the observed storage
against the *chosen denominator* -- normally the dam's normal storage --
rather than against the largest capacity the inventory holds for it.

Measured against the largest of `normal_storage`, `max_storage` and
`nid_storage`:

| | count | examples |
|---|---:|---|
| observed sits **inside** the dam's own largest figure | **9** | Cle Elum 0.62×, Gerber 0.73×, Thief Valley 0.78×, Beulah 0.90× |
| **within 10% over** it | **4** | American Falls 1.01×, Lake Tahoe 1.01×, Jackson Gulch 1.02×, Drews 1.06× |
| beyond that | 9 | Havasu 97×, Salt River System 29×, Mission Valley (8) 8.2×, Camas (4) 7.0×, Priest Lake 2.0× |

The nine in the first row are matched at 0.04 to 0.12 km with their names
agreeing. Beulah was refused for being seen **19 acre-feet** above a normal
storage of 59,212 while the same inventory record says the dam holds 66,000.
Cle Elum was refused at 62% full.

The second row is a real operating condition rather than a wrong dam: a
reservoir can be surcharged above normal pool, and normal storage is a design
figure, not a ceiling.

The third row is the rule working. The wrong-dam signal is *large* -- Lake
Havasu matched a 6,300 acre-foot dam called Gene Wash while its water is
behind Parker Dam, and "Mission Valley (8)" and "Camas (4)" are stations that
report a total across eight and four reservoirs, so no single dam can contain
them.

**Two borderline cases sit either side of any margin drawn here**: Drews at
1.06× would be admitted and Lake Mohave at 1.11× refused, and Mohave's match
is Davis Dam at 0.05 km, which is certainly the right dam.

## Finding 2: the candidate list overlaps the roster by provider

**Lake Mead is in the admitted list.** It is published already, through RISE
item 6124 (ADR-062); the candidate is AWDB station `09421000:AZ:BOR` at Hoover
Dam. `find_candidates` excludes stations already tracked *by station
identifier*, and Mead is not tracked by that identifier -- it is tracked by a
different provider's.

Admitting it again would add 28.3 million acre-feet to every total that
already contains it. The scoping measured this overlap and named it: 99 of the
306 western reservoirs report through both networks. The dedupe has to be by
**position**, not by station id.

The published Mead point is 41.9 km from Hoover Dam, and that is correct
rather than a discrepancy -- ADR-062 publishes the water and not the dam, so a
position dedupe has to compare against the reviewed dam point where there is
one.

## Finding 3: the roster is keyed by name, and the west has collisions

`RESERVOIRS`, `AWDB_RESERVOIRS`, `connected_reservoirs.json`,
`capacities.json` and `normals.json` are all keyed by reservoir name, and
`?reservoir=` names one in a published URL.

Four names are held by more than one reservoir once the west is admitted:

| name | | |
|---|---|---|
| Lost Creek | published, Utah (RISE 544, 22,510 af) | candidate, Oregon (William L. Jess Dam, 465,000 af) |
| Willow Creek | published, Colorado | candidate, Oregon |
| Clear Lake | candidate, Oregon | candidate, California |
| Lake Mead | published, Nevada | the same reservoir again (finding 2) |

The two Lost Creeks are **946 km apart**. Under a name key, one silently
becomes the other: the same capacity, the same climate normal, the same
`?reservoir=` link, and nothing fails.

This is ADR-058 arriving in a new place. That record established the rule for
counties -- "the key is the five-digit FIPS code and never the name" -- after
finding two Summit, two Carbon and two Garfield Counties on a roster of 35. A
reservoir needs the same treatment: the key is the provider identity, and the
label a reader sees has to carry the state.

## What this suggests doing, in order

1. **Refine the capacity check** against the largest inventory figure, with a
   stated surcharge margin, recorded as an ADR against ADR-015. The evidence
   is above; the margin is a judgement, and the Drews/Mohave pair is where it
   has to be made deliberately.
2. **Dedupe candidates against the roster by position**, so a reservoir
   published through one provider cannot be admitted again through another.
3. **Key the roster on provider identity and label with the state**, before
   admitting anything, because a collision admitted under a name key is a
   silent wrong number rather than a failure. Decided 2026-08-19; not yet
   built. The design below.
4. **Then admit**, refresh, and build the normals for what was added --
   which is now a four-minute job (`--missing`), not an hour.

## Findings 1 and 2 are done

- **ADR-065** measures a dam's ceiling against the largest figure its record
  holds, with a 10% surcharge allowance: 137 of 157 candidates admitted rather
  than 124, nothing that was admitted becoming refused, and the Utah scope
  unchanged.
- **The dedupe compares against the reviewed dam point as well as the
  published water**, so Lake Mead is recognised as already tracked. 157
  candidates, 68 tracked.

## The design for finding 3, not yet built

**The key already exists.** Every published record carries `source_key` and
`source_station_id` -- a RISE item id or an AWDB station triplet -- and ADR-003
already calls that the stable provider identity. Nothing new has to be
invented; the roster files simply stop being keyed by name:

| file | today | after |
|---|---|---|
| `RESERVOIRS`, `BASE_AWDB_RESERVOIRS` in `refresh_reservoirs.py` | name → tuple | station id → record carrying the name |
| `connected_reservoirs.json` | name → record | station id → record |
| `capacities.json` | name → capacity | station id → capacity |
| `normals.json` | `by_name` lookup | by station id |

**The label is the name, and the state settles a tie.** The payload already
carries `state` on every record, and `countyOptions` already does exactly this
for the counties ADR-058 found colliding -- "Summit County, CO" beside "Summit
County, UT". Two reservoirs sharing a name are labelled "Lost Creek, UT" and
"Lost Creek, OR"; a reservoir whose name is unique keeps it unadorned, because
most of them are and a state on every label is noise.

**`?reservoir=` keeps working.** It names a reservoir in a published URL and
the retired routes translate into it (ADR-031), so it goes on accepting a bare
name and resolves it when exactly one reservoir has it. Where more than one
does, it accepts the qualified label -- `?reservoir=Lost Creek, OR` -- which is
what the reader can see on screen. A bare name that no longer resolves to one
reservoir opens no selection rather than picking one, which is the same rule
every other parameter here follows.

**The client's selection is the work.** The store, the list, the table, the CSV
filename and the deep link all carry the name as identity today. They carry the
station id, with the label beside it for display.
