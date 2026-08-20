# Colorado CDSS and California CDEC: what the APIs actually answer

Status: Measured 2026-08-20. Every figure below came from a live request made
in this session; nothing is carried over from documentation or from the
earlier survey in `docs/WESTERN-SOURCE-CANDIDATES.md`.

`docs/WESTERN-SOURCE-CANDIDATES.md` established that both sources exist, are
keyless, and carry stable identifiers. This review asks the next question:
**what would it cost to build against them, and what would the site gain.**

## The headline: the recommended order is the wrong way round

The source inventory recommended building Colorado first and California
second. Measured against the roster as it stands today, that ordering is
backwards by the project's own rule — additional providers are prioritised by
marginal coverage, not by availability.

| | reservoirs added | full level added | median size |
|---|---|---|---|
| **California (CDEC)** | 149 (+75%) | **35.9 million acre-feet (+34%)** | 63,700 af |
| **Colorado (CDSS)** | 119 (+60%) | **2.6 million acre-feet (+2%)** | 2,436 af |

The site holds 198 reservoirs and 105.8 million acre-feet of full level today.
Colorado's telemetry network is mostly small: 72 of its 105 matchable
reservoirs are under 10,000 acre-feet, and its largest ten are 71% of
everything it would add. California's are reservoirs in the sense this site
already means the word.

**California is worth about seventeen times what Colorado is**, per reservoir
admitted. Colorado is still worth doing — it is 119 real reservoirs and it
makes the Colorado headwaters legible — but it should not be first, and it
should be understood as a coverage-of-places gain rather than a
coverage-of-water one.

---

## Colorado: Division of Water Resources (CDSS)

`https://dwr.state.co.us/Rest/GET/api/v2/`

### What it answers

- **Keyless.** Every request in this session succeeded unauthenticated, and no
  request produced a credential challenge. Compatible with ADR-004.
- **Rate limited, and it says so.** The response carries
  `x-rate-request-limit: 1000`, `x-rate-row-limit: 600000`,
  `x-rate-request-remaining`, `x-rate-row-remaining` and
  `x-rate-reset-date`, resetting at midnight Mountain. This is the first
  source this project has met that publishes its own quota, and it is the
  number the build has to be sized against — see the cost note below.
- **Two stable non-name identifiers on every record**, `abbrev` (telemetry
  station) and `wdid` (water-right structure), plus `gnisId` for the waterbody
  itself. ADR-066 is satisfied three times over.
- **Acre-feet, stated per record** (`units: AF` on the station endpoint,
  `measUnit: ACFT` on the time series — the same unit spelled two ways across
  two endpoints, which an integration has to know).
- **Batching works.** `abbrev` accepts a comma-separated list.

### The roster

146 stations report `parameter == STORAGE`. Filtering to reservoirs:

| structureType | count |
|---|---|
| Reservoir | 132 |
| Reservoir System | 1 |
| Recharge Area | 13 — **not reservoirs, exclude** |

**133 reservoirs**, of which **119 are not on this site** (matched by position
against every published point, 2 km threshold). The 14 overlaps all resolve to
within half a kilometre and all arrive here through the Natural Resources
Conservation Service today, which is what makes the position match credible.

### Freshness: the trap

129 of 133 read on the day of the request. Four did not, and they are returned
by a live query with nothing to distinguish them:

| reservoir | station | last reading | age |
|---|---|---|---|
| Gross Reservoir | GROSRECO | 2021-09-20 | 1,794 days |
| Brush Hollow Reservoir | BVRWP2CO | 2022-07-25 | 1,486 days |
| Steamboat Lake | STELAKCO | 2022-10-18 | 1,401 days |
| Santa Maria Reservoir | SAMRESCO | 2026-05-13 | 98 days |

Every record carries `measDateTime`, so this is gateable — and it *must* be
gated, per record, the way ADR-056 already gates the two federal providers. A
station five years dead looks exactly like a station read this morning until
you read the timestamp.

### History: the constraint

`telemetrystations/telemetrytimeseriesday` serves daily storage back to the
station's own period of record, with `measCount` (readings behind each day) and
a quality flag. A 1991 fetch for Granby returned 359 daily rows.

But **only 25 of 133 stations have a period of record starting 1991 or
earlier.** The distribution is heavily recent — about 70 stations were
installed in 2012 or later, twelve of them in 2025. So most of Colorado would
join with no standard-period comparison at all, and would publish only the
recent baseline (ADR-041 already handles this honestly; it is a coverage cost,
not a correctness one).

Note `porStart`/`porEnd` on the *structures* endpoint is a different and older
record — Granby's ends 2025-10-31. That is the administrative accounting
series the earlier review found stale. Only the telemetry series is current.

### Capacity: not published

Neither `telemetrystation` nor `structures` carries a capacity. Tested against
the National Inventory of Dams, which is where this project's capacities
already come from (ADR-003): of the 119 new reservoirs, **105 (88%) sit within
2 km of an NID dam carrying a usable full level.** 92 are within 500 m. Eight
have no dam within 5 km.

ADR-015 applies to every one of them — confirm by position before name — and
the 13 that match between 500 m and 2 km need review individually rather than
by rule.

### What a build would cost

A daily refresh is trivial: one batched request, 133 rows.

A **climate-normal build is not**. Thirty years of daily storage is about
10,500 rows per station, so 133 stations is roughly **1.4 million rows against
a 600,000-row anonymous daily limit** — three days of quota, or one request
for a key. `tools/build_normal_baselines.py` would need to respect
`x-rate-row-remaining` and resume, which `--missing` already makes possible.

---

## California: Data Exchange Center (CDEC)

`https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet`

### What it answers

- **Keyless**, and it returns real JSON rather than HTML for the data.
- **Stable three-letter station id** (`SHA`, `ORO`), plus sensor number — 15 is
  reservoir storage. ADR-066 satisfied.
- **Acre-feet, stated per row** (`units: AF`).
- **Daily history to 1991 and earlier.** A 1991 fetch for Shasta returned 365
  rows, 361 usable. A standard-period normal is achievable here in a way it is
  not for most of Colorado.
- **No rate-limit headers**, and no published quota found.

### The two traps

**1. `-9999` is the missing-data sentinel, and it is a number.** Over a
seven-day window across all 238 stations, 1,435 rows came back:

- 898 usable
- **537 (37%) were `-9999`**
- 0 null

At 37% this is not an edge case, it is the dominant shape of the data. A
pipeline that treats the value field as a number sums a negative ten thousand
into a regional total. This is Rule 1 of the review — never collapse missing
into a value — arriving as a live hazard rather than a principle.

**2. The station list is HTML; only the data is JSON.** 238 stations carry
sensor 15, and the only way found to enumerate them is scraping
`dynamicapp/staSearch`. The roster would have to be committed and reviewed
like `snow_sites.json` rather than discovered at run time, which is what this
project does anyway (ADR-002) — but it means roster maintenance is manual.

### The roster

238 stations carry the storage sensor. **156 returned a usable value in the
last week**; the other 82 are listed but dormant. Of the reporting stations,
**149 are not on this site.**

Several of the 238 are forebays, afterbays and regulating ponds — "Bethany
Forebay" is on the list. An admission review like
`docs/WESTERN-RESERVOIR-ADMISSION.md` is needed before any of them is
published; the sensor list is not a reservoir roster.

### Capacity: partly published

CDEC's daily reservoir report (`reportapp/javareports?name=RES`) publishes
capacity in acre-feet keyed by station id — but **only for 48 reservoirs**,
combined capacity 28.8 million acre-feet. The other 190 sensor-15 stations
have storage and no denominator from CDEC. Probing for a fuller report
(`RESSUM`, `RES_ALL`, `RESDAILY`) returned the same default page each time;
`RES` appears to be the only one.

The report also publishes an "Average Storage(AF)" column whose period is not
stated anywhere on the page. It must not be used as a normal without
establishing what years it covers (Rule 4: name the time basis).

Against NID, of the 184 new stations without a CDEC capacity, **160 match a
dam within 2 km carrying a usable full level**. Combining both sources: **205
of 229 new stations (89%) could carry a denominator**, and 24 could not.

---

## What both sources share

- Neither publishes a hydrologic unit this project can use directly. CDSS
  carries a `huc10` field holding an eight-digit value; CDEC carries a river
  basin name. Both publish latitude and longitude, which is all `huc.py` needs
  — and the assignment point rule (ADR-058: the waterbody, not the dam) has to
  be applied to them the same way it was to the existing roster.
- Both would arrive without a reviewed capacity, and both lean on the same
  National Inventory of Dams the project already uses. That is a strength —
  one denominator source, one basis vocabulary — and a risk, because a
  position match is evidence and not proof.
- Neither's terms of use were retrieved in this session. Both are public
  agency services and neither challenged an anonymous request, but the terms
  remain unread and are the one thing here that has not been checked.

## Suggested order

1. **California, reporting stations only, admission-reviewed.** 34% more
   stored water, a workable capacity path, and full historical depth. The
   `-9999` sentinel and the HTML roster are the work.
2. **Colorado.** 119 reservoirs for 2% more water — worth having for what it
   shows about the headwaters, not for what it adds to a total. Its
   climate-normal build needs quota planning that California's does not.
3. Re-run `tools/check_reference_freshness.py` after either lands; both would
   add a committed roster with its own review interval.

Whichever is built first, `reservoirs.json`'s `coverage` block already tells
readers the gap exists, and it is that block's counts that should move.
