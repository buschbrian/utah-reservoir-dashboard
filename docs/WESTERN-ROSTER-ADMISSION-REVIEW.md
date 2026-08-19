# The R1 review: reading the 137 one by one

Measured 2026-08-19, on branch `published-unit-boxes` at `2a87b2d` (a working
tree mid-S1, per [`OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md`](OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md);
none of that work is touched here). This is the measurement half of R1: open
question 3 from that plan, answered candidate by candidate rather than by
trusting the rules that already ran. It writes nothing to the published data.

Reproduce it with:

```
.venv/bin/python tools/audit_candidate_capacity.py --scope west-huc6 --json
.venv/bin/python tools/audit_awdb_stations.py --scope west-huc6 --json
```

Both were run once and cached; every figure below is read from those two
files, not re-fetched. Expect roughly two and a half minutes for the first
(it pulls fifteen years of AWDB storage for 158 stations plus the full USACE
dam inventory for eleven states) and under thirty seconds for the second.

## The headline: the pool is 137, but the raw run says 138, and the extra one is a bug

The audit returned **158 candidates, 138 admitted, 20 refused** — not the 137
admitted / 21 refused that [`WESTERN-RESERVOIR-ADMISSION.md`](WESTERN-RESERVOIR-ADMISSION.md)
and [ADR-065](decisions/ADR-065-the-ceiling-is-the-largest-figure-the-record-holds.md)
recorded. Per the rails on this review, a different count is itself a
finding, not a number to adopt quietly.

**One of the 138 is Lake Mead, admitted again.** It is already published,
through RISE item 6124 ([ADR-062](decisions/ADR-062-admit-lake-mead-and-generalize-the-dominant-reservoir-control.md)).
Finding 2 of the admission review specifically fixed this: the dedupe was
widened to compare a candidate against the *reviewed dam point* as well as
the published waterbody point, because Mead's two providers publish it 41.9
km apart — RISE at the water, AWDB at Hoover Dam — which is further than the
25 km name-and-position rule reaches. The admission document states the fix
worked: "157 candidates, 68 tracked."

It does not work today. Reading the code:

```python
# tools/audit_awdb_stations.py, find_candidates()
catalog = json.loads((ROOT / "capacities.json").read_text())
dam_points = {
    name: (entry["dam_lon"], entry["dam_lat"])
    for name, entry in catalog["capacities"].items()
    if entry.get("dam_lon") is not None and entry.get("dam_lat") is not None
}
```

`catalog["capacities"]` has been keyed by `source_station_id` since
[ADR-066](decisions/ADR-066-a-reservoir-is-keyed-by-its-station-not-its-name.md)
(commit `5bc9b4f`, "Key every roster file by the station, not the name").
The loop variable `name` is bound to that key — a station id like `"6124"` —
not to `entry["name"]`. Then `tracked_points()` looks the dam point up by
`reservoir["name"]`:

```python
def tracked_points(reservoir, dam_points):
    points = [(reservoir["lon"], reservoir["lat"])]
    dam = dam_points.get(reservoir["name"])   # looks up "Lake Mead"
    if dam:                                    # dam_points has no such key any more
        points.append(dam)
    return points
```

`dam_points.get("Lake Mead")` is `None` on every call, confirmed directly:

```
>>> "Lake Mead" in dam_points
False
>>> "6124" in dam_points
True
```

So the published-water-point check still runs (41.9 km, misses) and the
dam-point check silently never fires. `commit 183ca1c`, "Dedupe candidates
against the dam point as well as the water," predates `5bc9b4f` and was never
touched by it — `git show 5bc9b4f --stat` does not list
`tools/audit_awdb_stations.py` or `tools/audit_candidate_capacity.py` among
its 35 changed files, though it does list `capacities.json`,
`connected_reservoirs.json`, `counties.json` and
`tools/build_county_assignments.py`. The county tool was updated for the
rekey; this one was not.

**No test caught it**, and the reason is precise:
`tests/test_candidate_audit.py::test_a_reservoir_tracked_at_its_dam_is_not_offered_again_at_its_water`
still passes, because it calls `select_candidates(..., dam_points={"Big
Lake": (-109.6, 38.2)})` directly with a hand-built, name-keyed dictionary —
exercising `select_candidates`, which is correct, but never exercising the
line in `find_candidates` that builds `dam_points` from the real,
now-station-id-keyed `capacities.json`. The integration point between "the
committed file's key changed" and "the tool that reads it" has no test on
either side of the seam.

**This is not a publishing risk** — it does not affect `reservoirs.json`,
`capacities.json`, or anything committed. It is a risk to *this audit*: it
inflates the candidate count by exactly the reservoirs a name-plus-dam-point
match would have caught, and Lake Mead is the only committed reservoir with
enough of a gap between its two providers' points to expose it (checked
against all 30 reservoirs in `capacities.json` that carry a dam point; only
Lake Mead and Lost Creek collide by name, and Lost Creek's Oregon and Utah
instances are 946 km apart — correctly two different reservoirs, not a
dedupe failure).

**Recommendation:** fix `tools/audit_awdb_stations.py` to build `dam_points`
from `entry.get("name")` rather than the dict key, and give
`find_candidates()` an integration test that reads the real (or a
realistically-shaped) `capacities.json` — not just `select_candidates()` with
a hand-built fixture — before this tool is trusted for R2's dedupe against
everything R1 publishes. This review does not fix it, per the read-only
scope; it excludes the one candidate the bug produced and proceeds on the
corrected number.

**With Lake Mead excluded, the count is 137** — matching the plan exactly.
The rest of this document treats 137 as the admitted pool.

A second, smaller drift: the 20 raw refusals (not 21) split as 9 "holds more
than the dam," 5 "no dam close enough," 6 "no storage series" — the 9 match
ADR-065's named list of still-refused candidates by name exactly (both
aggregate stations, both river-system stations, Havasu, Priest Lake, Henrys
Lake, Trout Lake, Mohave). The other buckets are one candidate lighter than
implied; a storage series crossing a reporting threshold between the two runs
is the likely cause and is not investigated further here — it does not touch
the 137.

## The three groups

| Group | Count | What it means |
|---|---:|---|
| **Clean** | **112** | Unambiguous dam, capacity traceable to a named NID field, name and position agree or position alone is decisive. No further review needed before the publishing half. |
| **Needs a decision** | **25** | Admitted by the rules; something a reader would notice on inspection. Listed below with the field and figure that raised it. |
| **Should be refused** | **1** | Lake Mead — already published; readmitted only because of the tool bug above. |
| **Total admitted (raw)** | 138 | |
| **Genuinely new (137 − 0, after excluding the bug)** | **137** | The number that answers open question 3. |

None of the 25 "needs a decision" candidates look like a wrong dam on
inspection — the position and name evidence for each is within the rules'
own design tolerances. They are flagged because the *evidence a human would
want to see before trusting the number* is not as clean as the other 112,
not because the match looks wrong.

### Everything that is not clean

| Candidate | State | Why it needs a decision |
|---|---|---|
| Lake Mead | AZ (station) | **Should be refused.** Already published via RISE 6124; readmitted by the tool bug above (observed 11,610,000 acre-feet against a matched Hoover Dam ceiling of 28,255,000–30,237,000). |
| Howard Hansen | WA | Observed maximum is **2.89×** the normal-storage denominator (75,200 of 26,000 acre-feet). Normal/max/headline figures disagree 5.3× (26,000 / 136,700 / 136,700). Flood-control dam operated far above conservation pool. |
| Detroit | OR | Observed maximum is **2.75×** the denominator (426,115 of 155,000 acre-feet). Figures disagree 2.9× (155,000 / 455,000 / 455,000). |
| Green Peter | OR | Observed maximum is **2.55×** the denominator (408,133 of 160,000 acre-feet). Figures disagree 2.7× (160,000 / 430,000 / 430,000). |
| Willow Creek | OR | Observed maximum is **1.73×** the denominator (7,478 of 4,326 acre-feet). Figures disagree 3.3× (4,326 / 14,091 / 14,091). Name also collides with published **Willow Creek Reservoir, CO** — needs the ADR-066 qualified label. |
| Big Sandy | WY | Observed maximum is **1.31×** the denominator (51,963 of 39,700 acre-feet). |
| Lemon Reservoir | CO | Inventory's own figures disagree **12.1×** — normal 40,146, max 487,660, headline 48,658. `capacity_basis` correctly uses the 40,146 normal-storage figure (observed maximum 39,753 agrees closely), but the 487,660 max-storage figure is almost certainly a data-entry error in the source record — a small Colorado reservoir near Durango does not hold half a million acre-feet. Because ADR-065's ceiling test takes the *largest* of the three figures, a bad figure like this one inflates the admission ceiling rather than tightening it; here it did not change the outcome (39,753 is comfortably under even the correct ~44,000–53,500-acre-foot ceiling), but the pattern is worth a human's attention before it does. |
| DMAD | UT | Figures disagree 2.8× (normal 7,735, max/headline 21,887). |
| Rocky Ford | UT | Figures disagree 3.5× (normal 1,700, max/headline 5,996). Observed maximum is 1.09× the denominator. |
| Donner Lake | CA | Capacity denominator is `max_storage` (10,300 acre-feet) — the inventory publishes no normal-storage figure for this dam. Dam is 3.89 km from the published point, confirmed only by name-and-position, not by position alone. |
| Independence Lake | CA | Capacity denominator is `max_storage` (18,500 acre-feet); no normal-storage figure. |
| Bridgeport Reservoir | CA | Capacity denominator is `max_storage` (44,100 acre-feet); no normal-storage figure. |
| Cascade Reservoir | ID | Capacity denominator is `max_storage` (693,200 acre-feet); no normal-storage figure. |
| Deadwood Reservoir | ID | Capacity denominator is `max_storage` (153,992 acre-feet); no normal-storage figure. This is one of the thirteen ADR-065 named as gained by the rule change — admission is correct, the denominator concern is separate. |
| Lake Lowell | ID | Capacity denominator is `max_storage` (159,365 acre-feet); no normal-storage figure. |
| Mann Creek Reservoir | ID | Capacity denominator is `max_storage` (12,536 acre-feet); no normal-storage figure. |
| Warm Springs | OR | Capacity denominator is `max_storage` (169,714 acre-feet); no normal-storage figure. Also one of ADR-065's thirteen. |
| Thief Valley | OR | Capacity denominator is `max_storage` (13,307 acre-feet); no normal-storage figure. Also one of ADR-065's thirteen. |
| Cold Springs | OR | Capacity denominator is `max_storage` (38,000 acre-feet); no normal-storage figure. |
| Gerber | OR | Capacity denominator is `max_storage` (92,215 acre-feet); no normal-storage figure. Also one of ADR-065's thirteen. |
| Lake Tahoe | CA | Dam is 2.69 km from the published point, confirmed only by name-and-position (up to the 25 km limit), not by position alone. Also one of ADR-065's thirteen. |
| Fruitland Reservoir | CO | Matched dam is named "Onion Valley" — no resemblance to "Fruitland" — at 1.47 km, confirmed by position alone (within the rule's 2 km radius, so name agreement is not required by design; flagged for a human look because the names are unrelated, the way Wolford Mountain/Ritschard was in ADR-015). |
| Kolob Reservoir | UT | Matched dam is named "Kolob Creek" at 1.05 km, confirmed by position alone. Plausible name variant, not flagged as risky, but worth a glance. |
| Eden | WY | Matched structure is "Eden Dike 1," a secondary structure, not the principal dam — the exact situation [ADR-057](decisions/ADR-057-a-dam-identifier-names-a-project-not-a-structure.md) named as a live disagreement between the admission matcher (which finds any nearby structure) and the "principal structure" rule (which `tools/add_dam_points.py` applies only to the *committed* dam-point table). Capacity is unaffected — ADR-057 established that every row of a project carries the same storage figures — but the matched point may not be the project's principal one. |
| Clear Lake | OR and CA | Two candidates in this pool share this name, one per state. Both are real, distinct reservoirs — the ADR-066 label ("Clear Lake, OR" / "Clear Lake, CA") is what keeps them apart on screen and in `?reservoir=`. |
| Lost Creek | OR | Collides with published **Lost Creek, UT**. The two are 946 km apart (per the admission review) — a real second reservoir, needs the qualified label, not a dedupe failure. |

### The refused 20, for context

Not part of the 137 — the rules refused them and this review did not
re-litigate that. Listed because the 9 "holds more than the dam" refusals are
worth confirming against ADR-065's named list, and they match exactly:

| Reason | Count | Names |
|---|---:|---|
| Holds more water than the dam can contain | 9 | Lake Havasu (wrong dam, 97×), Salt River Reservoir System, Verde River Reservoir System, Mission Valley (8), Camas (4) — all aggregate/system stations reporting several reservoirs against one dam — plus Priest Lake (2.0×), Henrys Lake (1.6×), Trout Lake Reservoir (1.31×), Lake Mohave (1.11×, Davis Dam is certainly its dam — the named edge case in ADR-065). |
| No dam close enough to confirm | 5 | Topaz Lake, East Fork Rock Creek Reservoir, Lake Pend Oreille, Lake Coeur d'Alene, Mud Lake |
| No storage series | 6 | Great Salt Lake, Pyramid Lake, Walker Lake, Silver Lake, Teton Reservoir, Crane Creek Reservoir — natural lakes reporting water level, not stored volume, the same fault ADR-015 found in Great Salt Lake originally |

## The measured distribution

### By drainage area

`west-huc6` draws 75 areas; **61 hold no published reservoir today**
(75 − 14, matching ADR-063's figure exactly). The 137 land in 38 distinct
areas:

| | Count |
|---|---:|
| Areas gaining their first reservoir | **26** |
| Areas still empty after R1 | **35** (61 − 26) |
| Areas that already had a reservoir, gaining more | 12 |

The busiest areas:

| HUC-6 | Name | New reservoirs | Was empty? |
|---|---|---:|---|
| 170900 | Willamette | 14 | yes |
| 170501 | Middle Snake-Boise | 13 | yes |
| 140200 | Gunnison | 11 | yes |
| 170102 | Pend Oreille | 10 | yes |
| 170402 | Upper Snake | 10 | yes |
| 160501 | Truckee | 7 | yes |
| 170703 | Deschutes | 6 | yes |
| 180102 | Klamath | 6 | yes |
| 170300 | Yakima | 5 | yes |
| 170502 | Middle Snake-Powder | 5 | yes |

`audit_awdb_stations.py`'s own scope check (`huc6_from_station` vs the
geometric `huc6_from_point`) **agrees for all 158 candidates, with zero
disagreements** — worth stating plainly, since it is a cheap and direct
confirmation that the drainage assignment is not a source of doubt for any
of the 137.

### By state

Using the AWDB station's own `stateCode` — which is the equivalent of the
*point's* state, `state` in ADR-060's three-question framing, not the
reviewed `waterbody_states`. None of the 137 have had the NHD
waterbody-versus-dam review ADR-060 ran for Lake Powell, Bear Lake and Meeks
Cabin; until that review runs, `waterbody_states` for each would default to
this same column, and the default is not a finding.

| State | Candidates |
|---|---:|
| Oregon | 43 |
| Idaho | 21 |
| Colorado | 17 |
| Washington | 14 |
| Montana | 11 |
| Utah | 9 |
| California | 8 |
| Wyoming | 5 |
| Nevada | 5 |
| Arizona | 3 |
| New Mexico | 1 |
| **Total** | **137** |

**The dam-versus-waterbody check ADR-060 asked to be re-run was re-run**, as
a proxy: each admitted candidate's matched NID identifier carries a
two-letter state prefix (`CO01675`, `WA00298`), compared against the
candidate's own provider state. Across all 137, exactly **one** disagreed —
Lake Mead (AZ station, NV dam) — which is the tool-bug candidate already
excluded, and is in fact the *correct* answer restated: Mead's water and dam
genuinely sit in different states, which is why ADR-062 needed its own
waterbody-state review. **No other candidate in the 137 shows this pattern.**
This is a proxy, not the full NHD polygon review ADR-060 used for Mead,
Powell and Meeks Cabin — it catches a dam matched across a state line, not a
waterbody that crosses one with both points on the same side. A full
NHD-based review of the 137 is still open work for whoever builds
`waterbody_states` for this batch, not something this pass substitutes for.

### Dominant-reservoir check (ADR-062)

The plan's watch item: is there a third reservoir large enough to need its
own include/exclude control, the way Powell and Mead do. **None found.** The
largest candidate is Lake Koocanusa at 5,809,000 acre-feet — 14% of the new
pool's own combined 41,574,805 acre-feet, and about 5.7% of what the roster's
total capacity would be after R1 (currently-published 60,113,896 plus the
new 41,574,805 ≈ 101.7 million). Powell and Mead together are roughly 87% of
today's published total; Koocanusa is not in that class. Hungry Horse Lake
and Dworshak Reservoir (3,468,000 each) are next, similarly ordinary by
comparison.

## Open question 3, answered

**137 of the 158 audited candidates survive review as genuinely new
reservoirs** — the plan's number, reached independently rather than
re-adopted: 138 raw admissions minus the one reservoir a tool bug readmitted.
Of those 137, **112 need no further reading** and **25 carry a flag** a human
should read before publishing, none of which look like a wrong dam.

## Open question 4: does `BASE_AWDB_RESERVOIRS` stay in Python?

**No — recommend migrating it into the reviewed JSON file, but treat that as
its own small task rather than a blocker for R1.**

`BASE_AWDB_RESERVOIRS` holds **25** entries today (confirmed:
`len(refresh_reservoirs.BASE_AWDB_RESERVOIRS) == 25`), each a bare tuple —
`(name, lat, lon, capacity_af, cadence)` — with none of the evidence trail
`connected_reservoirs.json` requires of every row it holds
(`load_connected_reservoirs` enforces `nid_id`, `nid_dam_name`, `dam_lon`,
`dam_lat`, `match_distance_km`, `match_confirmed_by` on every entry).
`CONNECTED_RESERVOIRS` holds 15 today and would hold roughly 15 + 137 ≈ 152
after R1 and its rename (D6).

Two separate reasons point the same way:

1. **The ratio the admission document itself named** — "two rosters in two
   formats was survivable at 25 against 15" — becomes 25 against ~152, which
   is no longer two comparable halves; it is a large reviewed roster with a
   small unreviewed appendix bolted on in a different format that a
   maintainer has to remember exists.
2. **`BASE_AWDB_RESERVOIRS` is missing exactly the evidence trail this
   project has spent three ADRs building** (ADR-015's distance-and-name
   confirmation, ADR-065's ceiling figure, ADR-066's station key). Its 25
   entries were set by hand before that trail existed. That is not a
   capacity error — nothing here suggests any of the 25 numbers are wrong —
   but it is the same shape of risk ADR-058 and ADR-066 both found: data that
   looks equivalent to the reviewed rows but was not put through the same
   process, sitting where a reader cannot tell the difference.

**The cost of migrating is not zero**: unlike a pure format move, backfilling
`nid_id` / `dam_lon` / `dam_lat` / `match_distance_km` for the 25 existing
entries means running the same NID match `admission.py` already performs for
new candidates, against 25 dams nobody has matched by that process yet. That
is real work, independent of R1's 137, and it is a reasonable thing to scope
as its own follow-up rather than something this review can wave through.

## The denominator, measured (added 2026-08-19)

The review's flagged table named five reservoirs that read far above full.
Measuring the whole pool rather than the tail changes what the question is.

**61 of the 138 admissible candidates exceed 100% somewhere in the record**,
and the distribution is the finding:

| Above full | Candidates |
|---|---:|
| 1.00 to 1.05 times | 38 |
| 1.05 to 1.20 times | 15 |
| 1.20 to 1.50 times | 4 |
| above 1.50 times | 4 |

Thirty-eight are inside five points. Jackson Lake, Lake Tahoe, Palisades,
American Falls and Wickiup all sit at 1.00 to 1.01 -- reservoirs filling
slightly past a nominal figure, which is what reservoirs do. Publishing 101%
for them is the correct number, and a rule that refused everything above full
would have dropped 44% of the pool for ordinary operation. Decision D9 in the
scoping document settles it: the conservation pool stays the denominator and
the reading is published as measured.

### Two figures disagreeing is not the same as a source contradicting itself

The first cut of this review treated a conservation figure smaller than a
maximum figure as a discrepancy. It is not. **102 of the 138 have one**,
because that is what a flood pool is -- two correct numbers describing two
different pools of the same dam.

The signal is two fields of the *same* inventory record disagreeing, and on
that test the pool is almost clean:

| Reservoir | max storage against NID storage |
|---|---:|
| **Lemon Reservoir, CO** | **10.0 times** |
| Blackfoot Reservoir, ID | 1.6 |
| San Carlos Reservoir, AZ | 1.5 |
| 19 others | 1.1 to 1.4 |

The 1.1-to-1.6 cluster is two field definitions differing and is not a fault.
Lemon is a digit, and it is alone.

### The withheld list, and what to send

One reservoir, withheld under D10 -- admitted by the rules, held back because
its source record contradicts itself.

**Lemon Reservoir, Colorado.** Storage from Reclamation, station
`09009070:CO:BOR`. Capacity from the National Inventory of Dams, record
**CO01688, "Lemon Dam"**, matched by name and position at 0.115 km.

| Field | Value, acre-feet |
|---|---:|
| Normal storage | 40,146 |
| NID storage | 48,658 |
| **Maximum storage** | **487,660** |
| Highest storage observed since 2015 | 39,753 |

The maximum-storage field is almost exactly ten times the NID-storage field
of the same record. Eleven years of Reclamation readings peak at 39,753
acre-feet, within 1% of the normal-storage figure and 8% of the stated
maximum. A reservoir on the Florida River near Durango does not hold half a
million acre-feet.

**The report goes to USACE, not Reclamation.** All three capacity figures are
the National Inventory of Dams', which the Corps maintains; Reclamation's
readings are the evidence the figure is wrong, not the thing that is wrong.
This is the only entry the western pool produces.

## What R1's publishing half still costs

The plan names four artefacts per addition. What this review de-risks, and
what it does not:

| Artefact | De-risked by this review? |
|---|---|
| **Capacity evidence** | Mostly. All 137 rows already carry `capacity_af`, `capacity_basis`, `nid_id`, `nid_dam_name`, `dam_lon`, `dam_lat`, `match_distance_km`, `match_confirmed_by` in the cached JSON — nearly the exact shape `load_connected_reservoirs()` requires. 112 are ready to transcribe. 25 need a human decision first (above), and one field the schema requires — `cadence` (`daily`/`monthly`) — is not in this audit's output and still needs determining per candidate from which AWDB duration series actually answered. |
| **County assignment** | Not touched. `tools/build_county_assignments.py` was not run, per the read-only scope. All 137 still need it once ROSTER_SCOPE moves. |
| **Climate normal** | Not run, per the read-only scope. Projected: at the documented rate (12.2 seconds of wall clock per reservoir, 6 concurrent workers), `ceil(137 / 6) × 12.2 s = 23 × 12.2 s ≈ 281 s ≈ 4.7 minutes` — consistent with the plan's own ~4.5-minute figure once the 137-candidate basis is used rather than the full projected roster. One candidate, Elkhead Reservoir (station `09246300:CO:BOR`), already has a cached normal in `normals.json` from an earlier run — 24 of 30 years, usable (`minimum_years` is 10) but not `covers_full_period`. `--missing` will use it as-is rather than rebuilding it; worth knowing it is not a fresh 1991–2020 figure like the other 136 will be. |
| **The refresh** | Not run. `tests/test_refresh.py` will not accept a "pending" state — every roster name must publish or be withdrawn in the same change, which this review does not make. |

Also unresolved by this review: **121 of the 137 fall outside today's
`ROSTER_SCOPE`** (`utah-connected`, 14 areas); 16 fall inside it (mostly
Utah's own remaining unadmitted candidates, riding along in the `west-huc6`
scope, plus a handful in Colorado/Wyoming areas already inside the 14). That
121-versus-16 split is the direct evidence for the plan's claim that
admitting this pool is what moves `ROSTER_SCOPE` to `west-huc6` and reopens
`HUC6_BOUNDS` — confirmed, not assumed.

## What the plan does not account for

- **The audit tool's dedupe regression**, above — the headline finding. It
  does not change what should be published, but it means the tool cannot be
  trusted for R2's dedupe against R1's output until it is fixed and given
  integration coverage.
- **A new failure class in the western pool that the original 34
  Utah-connected candidates never exercised**: USACE flood-control dams in
  the Pacific Northwest (Howard Hanson, Detroit, Green Peter, and to a
  lesser extent Willow Creek and Big Sandy) are operated with a large gap
  between their conservation pool (`normal_storage`, the ADR-003 preferred
  denominator) and their flood pool. These are correctly matched — right dam,
  tight distance — but publishing `pct_of_record_max` and similar figures
  against `normal_storage` for these five will read as "over 100% full" on a
  fairly ordinary day, not a rare surcharge event the way Beulah or Drews
  are. This is a display-and-labeling question, not an admission-rules one,
  and it is not the same shape as anything in
  `docs/WESTERN-RESERVOIR-ADMISSION.md`.
- **ADR-065's "largest of three figures" ceiling rule is more exposed to a
  single bad source figure than the single-field rule it replaced** — Lemon
  Reservoir's 487,660-acre-foot `max_storage_af` (against a real capacity
  near 40,000) did not cause a wrong admission this time only because the
  observed maximum was comfortably under even the correct ceiling. A
  reservoir whose observed storage genuinely sits between the correct
  ceiling and a bad inflated one would be admitted on bad evidence with
  nothing in the current output to distinguish it from a real surcharge. A
  sanity check — flag any admission whose ceiling is more than, say, 3× the
  next-largest of the three figures — would catch this class without
  changing the admission outcome for anyone reviewed here.
- **ADR-057's structure-versus-project ambiguity has a live instance now**:
  Eden, WY matched to "Eden Dike 1" rather than a principal structure. ADR-057
  said this would surface once matching moved past the 14 HUC-6 areas and
  named exactly where the second copy of the question lives; this is that
  surfacing.

## Where the evidence lives

- `.venv/bin/python tools/audit_candidate_capacity.py --scope west-huc6
  --json` — cached at
  `/private/tmp/claude-502/-Users-brianbusch-Developer-utah-reservoir-dashboard/3da8f2b8-047c-446f-b056-e123f106e473/scratchpad/west-candidates.json`
  (158 records, full admission evidence per candidate).
- `.venv/bin/python tools/audit_awdb_stations.py --scope west-huc6 --json` —
  cached at the same directory as `west-stations.json` (158 records, station
  metadata: county, `begins`, `agrees`, `tracked_name_match`, `in_utah`,
  coordinates). Both are scratch files, not committed, and will not survive
  past this session.
