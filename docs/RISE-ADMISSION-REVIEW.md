# R2: the RISE-only west, measured

> **Historical implementation journal.** It records a slice of work as it
> was, and is not a description of current architecture — that is
> [`docs/architecture/`](architecture/README.md). See
> [`docs/history/README.md`](history/README.md).

**Status (2026-08-20): delivered.** The reviewed RISE-only additions are in the
production federal western roster. Counts below describe the admission run,
not a daily payload guarantee.

Run 2026-08-19 against the live RISE catalogue and the USACE National
Inventory of Dams, on `main` at 198 published reservoirs.

## Delivered 2026-08-20

R2 admits the 25 reviewed daily items below through
`admitted_rise_reservoirs.json` and ADR-069. County assignments, closed-period
baselines, the daily payload and the public reference export were rebuilt in
the same change. Twenty-four additions have a usable 1991 through 2020
baseline; Scooteney has no observations in that closed period and reports no
comparison for it.

The audit is now committed as `tools/audit_rise_reservoirs.py` and remains
reproducible after admission by comparing against the pre-R2 roster. A rerun
on 2026-08-20 found 39 daily storage catalog items and 38 with usable
observations, one fewer catalog item than the run recorded below. The reviewed
stages did not move: 37 after the dam-point check, 28 passing the admission
rules and 25 new dam identities.

Three capacity conflicts were resolved before delivery. Billy Clapp Lake uses
21,200 acre-feet from the Bureau's Pinto Dam project record, Keswick Reservoir
uses 23,800 from the Bureau's California program record, and Lake Cachuma uses
205,000 from the Bradbury Dam project record. Each row retains the national
inventory values, dam identity and point beside the selected operator record.

Open question 2 is answered: the matched dam identifier is the identity check
of record. Open question 1 remains separate; the three already-published
monthly stations do not change provider or history in R2.

R1 admitted the AWDB west. This is the other federal source: the reservoirs
Reclamation publishes through RISE that AWDB does not carry, or carries less
often.

## The funnel

| | |
|---|---:|
| RISE locations, all types | 1,012 |
| of type Lake/Reservoir | 284 |
| with a usable point | 280 |
| inside `west-huc6` | **180** |
| already published, by position | 96 |
| candidates | 84 |
| **publishing a storage series** | **40** |
| with an observed maximum since 2015 | 38 |
| after the dam-point dedupe | 37 |
| admitted by the rules | 28 |
| **after the dam-identity dedupe** | **25** |

The 180 reproduces `WESTERN-EXPANSION-SCOPING.md`'s own count exactly, which
is a useful check on both.

## Three findings about deduplication, in order of how much they cost

**A location is not a reservoir.** Of the 84 candidates, **44 publish no
storage series at all** — they are diversion dams, powerplant forebays and
regulating structures that RISE files under Lake/Reservoir because that is
what the structure impounds. They have elevation, release and inflow, and
nothing this site could draw. The scoping's "RISE adds 81" counted locations;
the admissible pool is less than half that before any rule is applied.

**Position deduplication is not enough, and the gap is the same one that
killed the AWDB dedupe.** RISE publishes some reservoirs at the water and
some at the dam. Lake Mead's RISE location is Hoover Dam, 41.9 km from the
published Temple Bar point — far outside any position threshold. It was
caught here only because the reviewed dam-point table has an entry for it,
which is the check `d564015` repaired.

**Only 30 of the 198 published reservoirs have a reviewed dam point**, so
that check covers 15% of the roster. Three more duplicates survived it and
were caught by a stronger identity: **the matched NID dam**. Both R1 and R2
resolve every candidate to a dam in the national inventory, so two records
naming the same dam are the same reservoir whatever their points say.

| Caught by | Duplicates found |
|---|---:|
| position, 3 km | 96 |
| reviewed dam point | 1 — Lake Mead |
| **matched NID dam** | **3** — Blue Mesa, Navajo, McPhee |

The last row is the one to keep. Name and position are properties of a
*record*; the dam is a property of the *reservoir*. R3 should dedupe on the
dam first and treat position as the fallback, not the other way round.

## What is new: 25 reservoirs, all daily

Every one publishes daily. The largest are the major California reservoirs
this site has been missing entirely:

| Reservoir | Capacity, acre-feet |
|---|---:|
| Shasta Lake | 4,552,090 |
| New Melones Lake | 2,720,000 |
| Trinity Lake | 2,447,650 |
| Lake Berryessa | 1,602,278 |
| Banks Lake | 1,275,000 |
| Folsom Lake | 894,000 |
| Millerton Lake | 520,500 |
| Potholes Reservoir | 511,700 |

By the drainage areas' states: California 12, Washington 6, Oregon 5,
Colorado 4, Idaho 4, Utah 3, Montana 3, and two each in Arizona, New Mexico,
Wyoming and Nevada. California is the point — it has almost no federal snow
network (36 of 637 sites) and, until this, almost no published storage
either.

## The nine refusals

Four hold more water than the matched dam can contain, which is ADR-065's
ceiling doing its job:

- **Lake Mohave** (1,795,810 acre-feet seen) — refused in R1 on the same
  grounds. Davis Dam is certainly its dam; the ceiling is the named edge case
  in ADR-065 and it has now refused the same reservoir through two sources.
- **Lake Havasu** (610,440) — also refused in R1, wrong dam matched.
- **Henrys Lake** (93,471) — refused in R1.
- **Milner Lake** (45,360) — new.

Five have no dam close enough to confirm: **Utah Lake**, **Grand Lake**,
**Lake Natoma**, **Lake Waha**, **Clear Lake Reservoir West Lobe**. Utah Lake
and Grand Lake are natural lakes with regulating structures rather than
impoundments, which is the same shape as the Great Salt Lake refusal in
ADR-015.

That three of the four ceiling refusals are reservoirs R1 already refused,
through a different provider, is worth stating: the rule is reproducible
across sources rather than tuned to one.

## The update schedule, and what it is worth

The owner's rule for deduplication: where both sources carry the same water,
prefer the one that updates more often.

Measured across the 96 overlaps:

| Published record | Count |
|---|---:|
| AWDB, daily | 63 |
| RISE, daily | 30 |
| **AWDB, monthly** | **3** |

So **three** reservoirs are published monthly while RISE offers the same
water daily, and all three match within 140 metres:

| Published | Station | RISE location |
|---|---|---|
| Conconully Lake Salmon Lake Dam | `12446453:WA:BOR` | 7169, 0.14 km |
| Conconully Reservoir | `12446480:WA:BOR` | 7325, 0.01 km |
| Gerber | `11483400:OR:BOR` | 7306, 0.05 km |

Small, and worth doing: it is three reservoirs moving from one reading a
month to one a day, at the cost of changing which item id the refresh asks
for. The other 75 monthly records have no RISE equivalent — they are AWDB's
alone, and monthly is the best this site can publish for them.

## What this does not do

Nothing is published. R1's publishing half took the roster, the county
assignments, the climate normals and a refresh in one change; this is the
measurement that decides what belongs in that change. The 25 need the same
review R1's 137 got — a human reading the dam match, not just the rule's
verdict — and the four artefacts per addition.

## Open questions

1. **Do the three monthly reservoirs move to RISE?** It is a change to which
   source publishes an already-published reservoir, so the station id
   changes and the history is the new source's. Worth confirming the series
   agree before switching.
2. **Should the dam identity become the dedupe of record?** It is stronger
   than position, it is already computed, and R3 will face a third source
   with its own idea of where a reservoir is.
3. **Do the 44 storage-less locations deserve a note anywhere?** They are not
   refusals — they were never candidates — but the next person to count RISE
   will find 84 and wonder where half of them went.
