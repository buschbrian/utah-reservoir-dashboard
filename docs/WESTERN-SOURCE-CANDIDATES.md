# Western reservoir source candidates

Status: Research inventory, checked 2026-08-20

The production roster is now western and is still fed by two federal
providers, the Bureau of Reclamation and the Natural Resources Conservation
Service (`AUTHORITATIVE-SOURCE-INVENTORY.md`). This document preserves the
survey that asked the next question: **what else publishes current storage**
for a reservoir neither provider covers, and is any of it fit to build
against. Its Colorado-first recommendation was later reversed by measured
value in [`CDSS-CDEC-API-REVIEW.md`](CDSS-CDEC-API-REVIEW.md).

Every candidate is judged against two accepted decisions this project will
not trade away:

- **ADR-004** decided this project runs with no ArcGIS API key and refuses
  any credential challenge outright, because a 401 on a public dashboard
  produced "a username and password modal on a public dashboard" and a
  20-second hang rather than a clean failure. ADR-004's own text is scoped to
  the map SDK's basemaps, not to data-source keys, but the working rule this
  review holds every candidate to is the same one: a source that needs a
  credential to answer a read-only request is a conflict with an accepted
  decision, not a detail to work around, and must be flagged prominently
  rather than quietly used.
- **ADR-003** established the stable provider identity (a RISE catalog item
  id) as the thing capacity gets pinned to, and **ADR-066** generalized it:
  a reservoir is keyed by `source_station_id`, never by name, because the
  western pool holds two Lost Creeks 946 km apart, two Willow Creeks, and two
  Clear Lakes — and this review's own research below found a **third** Willow
  Creek Reservoir (Montana, state-owned) that ADR-066's authors had not seen.
  A source that identifies a reservoir only by a human-readable name is a
  poor fit before anything else about it is even measured.

## How this review was done

Three research passes covered the eleven states in parallel: California,
USACE and USGS; Colorado, Oregon, Idaho and Washington; and Arizona, Nevada,
Montana, New Mexico and Wyoming. Every endpoint, worked example, and figure
below was independently fetched and confirmed live on 2026-08-19 — none of
it is carried over from documentation alone unless the text says so
explicitly, and every claim that could not be confirmed is named in its own
section rather than smoothed over.

## Summary table

| Source | States | Key needed (ADR-004) | Identifier stability (ADR-003/066) | Capacity published | Update frequency | Verdict |
|---|---|---|---|---|---|---|
| Colorado DWR / CDSS | CO | No — verified keyless, ~20 live calls | `abbrev` and `wdid` — both stable, non-name | No, in the live storage feed (separate stale administrative series exists) | Sub-hourly, per-record timestamp, verified live | **Build first.** 128 reservoirs, ~110 not already in RISE/AWDB |
| California Data Exchange Center (CDEC) | CA | No — verified keyless | 3-letter station code + sensor number — stable | Yes, on a separate static page | Daily/hourly, timestamped, verified live | **Build first.** 154 reservoirs, confirmed overlap on two named dams |
| USGS NWIS / Water Services (parameter 00054) | CA, NM, CO, NV, OR, AZ, ID, WA, WY | No today; legacy service retires ~2027, successor rate-limits without a free key | USGS site number — the most stable id in this space | No — confirmed absent | Daily, timestamped, verified live | Build for the 9 states with coverage; **zero active sites in Utah and Montana today** |
| USACE CWMS Data API | Confirmed: MT (Missouri Basin), CA/CO/UT (Sacramento District); absent in the national API for OR/WA/ID (Columbia Basin) | No for reads, verified live | Office + structured timeseries name — stable, compound, not one field | Unconfirmed | Confirmed live but office-dependent (4-day lag seen at one station) | The one confirmed coverage gap worth closing, but fragmented by district — scope narrowly |
| Salt River Project (AZ) | AZ | No login to view | **Fails** — name only, no station id | Yes, on the HTML report only | Unconfirmed on a per-reading basis | Real data, no machine-readable form — do not build against as-is |
| Montana DNRC state-owned dams | MT | Unconfirmed | **Fails** — name only on public pages | Yes, in the static 22-dam table | Unconfirmed | Real but thin; no export found |
| New Mexico OSE/ISC (meas.ose.state.nm.us) | NM | No | **Fails** — mixed/inconsistent ids | No — does not carry reservoirs at all | N/A | Not a reservoir source |
| newmexicowaterdata.org | NM (mirrors other states too) | Apparently no | Inherited from source agency, unverified | Unconfirmed | Unconfirmed | Confirmed republisher of USGS/USBR/CO data — do not treat as new coverage |
| Wyoming WRDS | WY | Unconfirmed | **Fails** — name only | Unconfirmed | N/A — visualization only, no export found | Likely a mirror of USGS/USBR/NRCS, not an independent source |
| Oregon Water Resources Department | OR | N/A — no API to key | Station number / USBR code, seen in the UI only | Unconfirmed | N/A — stateful ASP.NET app, not a queryable endpoint | Confirmed no machine-readable endpoint; likely already RISE/AWDB territory |
| Idaho Department of Water Resources | ID | N/A | N/A | N/A | N/A | Confirmed no independent source — IDWR's own data-sources page points every reservoir row at USGS, USBR or USACE |
| Washington Department of Ecology | WA | N/A | N/A | N/A | N/A | Confirmed no independent source; Yakima system routed to Reclamation's older Hydromet system, not confirmed inside RISE |
| Arizona DWR (ADWR) | AZ | — | — | — | — | No reservoir-storage product found; groundwater only |
| Nevada Division of Water Resources | NV | — | — | — | — | No reservoir-storage source found; not exhaustively searched |

## Sources verified with a real, working endpoint

### Colorado Division of Water Resources (CDSS)

**Endpoint, verified live in this session, returning today's reading:**

```
https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrystation/?format=json&abbrev=GRARESCO
```

Returned, for Granby Reservoir — the Colorado River Storage Project's
largest Colorado reservoir:

```json
{"stationName":"GRANBY RESERVOIR","dataSourceAbbrev":"BOR","dataSource":"Bureau of Reclamation  (Station cooperator)",
 "stationType":"Storage Structure","structureType":"Reservoir","parameter":"STORAGE",
 "measValue":312018.00,"units":"AF","measDateTime":"2026-08-19T08:15:00-06:00",
 "abbrev":"GRARESCO","wdid":"5104055"}
```

The timestamp matched the time of the request — this is live telemetry, not
a cached export. Full documentation at `https://dwr.state.co.us/rest/get/help`.

- **Key:** none required. Roughly twenty live calls in this session all
  succeeded unauthenticated. An optional key raises the daily quota from
  1,000 calls / 600,000 rows (anonymous) to something higher — irrelevant at
  dashboard scale, and unlike a hard-gated source, nothing here produces a
  401 or a credential prompt.
- **Identifier:** two independent, stable, non-name keys are published on
  every record — `abbrev` (the telemetry station code, `GRARESCO`) and
  `wdid` (the Water District Identification number, the same key used across
  CDSS's structures and water-rights endpoints, `5104055` here). `wdid` is
  the more durable of the two, since it is a water-right structure
  identifier rather than a telemetry-station label.
- **Capacity:** not in this live feed. A separate historical series exists
  at `structures/divrec/divrecday`, tagged `divrectype: "StageVolume"`, which
  publishes an administrative accounting record — but for Terrace Reservoir,
  fetched as a check, that series' period of record **ended 2025-10-31**,
  roughly ten months stale as of this review. Only the
  `telemetrystations/telemetrystation` STORAGE feed is current; the
  StageVolume series must not be read as "now."
- **Units:** acre-feet, confirmed in the live payload (`"units":"AF"`).
- **Update frequency:** sub-hourly at the stations checked (readings between
  07:15 and 08:15 local time this morning across several stations), each
  carrying its own `measDateTime` and a separate `modified` field.
- **Freshness is per-station, not guaranteed by the endpoint.** Gross
  Reservoir (Denver Water, `GROSRECO`), fetched as a check, returned
  `measDateTime: "2021-09-20..."` — that station's telemetry feed has been
  stale for roughly five years, and the record still appears in a live
  query with no flag distinguishing it from a fresh one. Any ingestion needs
  a per-record freshness gate against `measDateTime`, the same discipline
  ADR-056 already applies to RISE and AWDB.
- **Terms of use:** a "Terms of Use" link exists in the CDSS site footer;
  its actual text was not retrieved in this session — flagged below as
  unverified.
- **Coverage:** the full telemetry roster (1,418 stations) was queried and
  filtered to `parameter == "STORAGE"` and `stationType == "Storage
  Structure"`, yielding **128 Colorado reservoirs** reporting current
  storage this way, across Water Divisions 1 through 7 — statewide.
- **Overlap, measured directly.** Every record self-declares its
  `dataSourceAbbrev`. Of the 128: 90 are `DWR` (state-owned), 12 are `BOR`
  (Bureau of Reclamation cooperator), 6 are `NWBOR` (Northern Water/BOR
  joint, Colorado-Big Thompson project), and the remainder split across
  `UAWCD`, `COSP`, `COE` and single-agency tags. **The 18 tagged `BOR` or
  `NWBOR`** — Granby, Blue Mesa, Green Mountain, Williams Fork, Ruedi,
  McPhee, Horsetooth, Carter, Twin Lakes, Turquoise Lake and Vallecito among
  them — are very likely the same gauges already reachable through RISE.
  **The other roughly 110** — Dillon (Denver Water, 184,880 AF), Cheesman
  (Denver Water), Gross (Denver Water), Chatfield (USACE), John Martin
  (USACE), Rueter-Hess (Parker Water & Sanitation), Steamboat Lake (Colorado
  Parks), Spinney Mountain, Homestake — are not Reclamation reservoirs and
  are this source's real value: a straightforward filter on
  `dataSourceAbbrev != "BOR" && dataSourceAbbrev != "NWBOR"` is most of the
  dedupe work before any reservoir needs a manual check.

### California Data Exchange Center (CDEC)

**Endpoint, verified live in this session:**

```
https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=SHA&SensorNums=15&dur_code=D&Start=2026-08-15&End=2026-08-19
```

Returned a JSON array for Shasta Reservoir (station `SHA`, sensor 15 =
`STORAGE`), for example:

```json
{"stationId":"SHA","durCode":"D","SENSOR_NUM":15,"sensorType":"STORAGE",
 "date":"2026-8-15 00:00","obsDate":"2026-8-16 00:00","value":2826286,
 "dataFlag":" ","units":"AF"}
```

Multi-station, comma-delimited queries (`Stations=ORO,FOL`) were also
confirmed working. The most recent day in a query window commonly reads
`-9999` — CDEC's own not-yet-posted sentinel, which must be translated
explicitly rather than passed through, the same way this project already
refuses to encode a missing reading as a null or a zero (ADR-052's rule for
the snow calendar states the same principle for a different payload).

- **Key:** none required for this endpoint. `https://cdec.water.ca.gov/robots.txt`
  returns `Disallow: /` for crawlers, but this governs automated crawling of
  the HTML site, not a direct query to the data servlet by station and
  sensor — no user-agent gating was observed on the servlet itself, and no
  formal rate-limit or terms-of-service text was located to say otherwise.
  This is worth a second look before any high-frequency polling, since the
  robots directive is at least evidence CDEC does not want to be crawled at
  volume, even if this specific endpoint answered every query made of it.
- **Identifier:** a documented, stable 3-letter station code (`SHA`, `FOL`,
  `ORO`) paired with a sensor number (15 = storage), confirmed at
  `https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=SHA` and
  `.../staSearch?sensor_chk=on&sensor=15` — a real station identifier, not a
  name.
- **Capacity:** published, but on a separate static page rather than in the
  sensor feed — `https://cdec.water.ca.gov/misc/resinfo.html` lists Shasta
  at **4,552,000 acre-feet**, matching its known gross-pool capacity. The
  page does not label the figure "normal" or "gross" explicitly, so which
  basis CDEC intends was not confirmed from the page text alone.
- **Units:** acre-feet, confirmed (`"units":"AF"`).
- **Update frequency:** daily (`dur_code=D`) confirmed live; hourly and
  monthly duration codes are documented on the query-tools page. Every
  record carries its own `date` and `obsDate`.
- **Coverage:** CDEC's own daily reservoir report states **154** "Active
  Daily Reservoir Reporting Stations in California"
  (`https://cdec.water.ca.gov/reportapp/javareports?name=DailyRes`) — all in
  California, no coverage outside the state.
- **Overlap, confirmed by name.** CDEC's own report labels Shasta and Folsom
  as U.S. Bureau of Reclamation facilities, and both have RISE catalog
  records: `data.usbr.gov/catalog/2226` (Shasta) and
  `data.usbr.gov/catalog/2304` (Folsom). Oroville (`ORO`) is a State Water
  Project facility — California DWR itself, not Reclamation — and is not
  expected to double up with RISE. Any CDEC ingestion needs the same kind
  of per-station overlap check CDSS's `dataSourceAbbrev` makes cheap; CDEC
  has no equivalent field, so the check has to be done by dam name and
  coordinate instead.

### USGS National Water Information System / Water Services

**Endpoint, verified live in this session:**

```
https://waterservices.usgs.gov/nwis/dv/?format=json&sites=10288500&parameterCd=00054
```

Returned daily-value data for **Walker Lake near Hawthorne, NV**, USGS site
`10288500`: `"variableName": "Reservoir storage, acre-ft"`, latest value
**1,164,000 ac-ft** dated 2026-08-18, qualifier `P` (provisional). Parameter
00054 is USGS's own code for "Reservoir storage, acre-feet," confirmed both
in the live response and at
`https://help.waterdata.usgs.gov/codes-and-parameters`.

- **Key:** the legacy `waterservices.usgs.gov` service required no key for
  any query in this session; its own documentation asks only for a "major
  filter" such as a site or state code, and describes informal request-rate
  guidance (roughly 5–10 requests/second steady, bursts to 40–50/second)
  rather than a hard limit. That same documentation states the legacy
  service **will be decommissioned in early 2027**, with migration pointed
  at `https://api.waterdata.usgs.gov`, whose own docs describe a 50
  requests-per-IP-per-hour ceiling without a free, self-service API key. This
  is a real, dated collision with ADR-004: keyless today, likely
  key-encouraged (though not hard-gated) after the 2027 migration.
- **Identifier:** the USGS site number — the most standardized,
  longest-lived station identifier in U.S. hydrologic data.
- **Capacity:** confirmed absent. The full expanded site-metadata record
  (`/nwis/site/?format=rdb&sites=10288500&siteOutput=expanded`) was fetched
  and its ~43 fields cover only location, administrative and physical
  metadata — no capacity or full-pool figure anywhere in it.
- **Units:** acre-feet, explicit in both the parameter name and the payload
  (`"unitCode":"ac-ft"`).
- **Update frequency:** the daily-values service (`/nwis/dv/`) is the
  practical product for this parameter — a check of the instantaneous-values
  service (`/nwis/iv/`) returned **zero** active parameter-00054 sites in
  every western state tested, so reservoir storage on NWIS is effectively a
  daily figure despite formally living on the "instantaneous" service too.
  Every reading carries a timestamp and a provisional/approved qualifier.
- **Terms of use:** "Data provided by this service is US Government work in
  the public domain," and every response embeds a provisional-data
  disclaimer directly in its `queryInfo.note` block.
- **Coverage, counted per state via live queries of active parameter-00054
  daily-value sites:**

  | State | Active 00054 sites |
  |---|---:|
  | California | 28 |
  | New Mexico | 24 |
  | Nevada | 14 |
  | Colorado | 13 |
  | Oregon | 9 |
  | Arizona | 8 |
  | Idaho | 7 |
  | Washington | 6 |
  | Wyoming | 4 |
  | **Utah** | **0** |
  | **Montana** | **0** |

  **Utah and Montana currently have zero actively reporting USGS
  reservoir-storage sites.** For a Utah-rooted dashboard this matters: NWIS
  adds essentially nothing to the existing roster today and would only pay
  off as the roster expands into the nine states with coverage. Site
  activation status changes over time and is worth rechecking periodically.
- **Overlap:** not cross-checked site by site against RISE, AWDB, CDEC or
  USACE in this session. Walker Lake, the worked example, is a naturally
  terminal lake rather than a dam-controlled project tied to Reclamation or
  USACE operations, which suggests some NWIS reservoir-storage sites are
  genuinely additive — but that is an inference from one example, not a
  verified finding, and needs a name/coordinate reconciliation pass before
  any site is treated as new.

### U.S. Army Corps of Engineers CWMS Data API

The roster has no source for USACE reservoirs at all today, and USACE
operates major western reservoirs across the Missouri and Columbia systems —
the single largest confirmed coverage gap in the current roster.

**Endpoint, verified live in this session, returning a real storage
reading — Fort Peck Dam & Reservoir, Montana:**

```
1. https://cwms-data.usace.army.mil/cwms-data/locations?names=FTPK&office=NWDM
   -> {"office-id":"NWDM","name":"FTPK","public-name":"Fort Peck Dam & Reservoir",...}

2. https://cwms-data.usace.army.mil/cwms-data/catalog/timeseries?office=NWDM&like=FTPK.*Stor.*
   -> "FTPK.Stor.Inst.~1Day.0.Best-MRBWM", latest extent 2026-08-15T05:00:00Z

3. https://cwms-data.usace.army.mil/cwms-data/timeseries?office=NWDM&name=FTPK.Stor.Inst.~1Day.0.Best-MRBWM&begin=2026-08-01T00:00:00Z&end=2026-08-16T00:00:00Z&unit=m3
   -> [[1785560400000, 1.577129877488259E10, 0], ...]
```

That last value is roughly **12.8 million acre-feet** after unit conversion,
plausible against Fort Peck's approximately 18.5 million acre-foot capacity.
None of these three calls carried any authentication header, and none
produced a 401 or 403.

- **Key:** not required for these reads. The project's own GitHub repository
  (`github.com/USACE/cwms-data-api`) states authentication gates write
  access only, consistent with what was observed.
- **Identifier:** locations are keyed by `office-id` + `name` (`NWDM` /
  `FTPK`), and timeseries by a structured, documented name — `Location.
  Parameter.ParameterType.Interval.Duration.Version`
  (`FTPK.Stor.Inst.~1Day.0.Best-MRBWM`). This is a genuinely stable,
  government-maintained identifier, though it is a compound string rather
  than a single opaque id, and a roster entry would need to store the full
  timeseries name alongside the office.
- **Capacity:** not confirmed published through this API; a `/levels`
  endpoint exists and may carry pool or flood-control levels, but was not
  checked against Fort Peck specifically in this session.
- **Units:** cubic meters (`m3`) by default for the Fort Peck series, not
  acre-feet — confirmed in the live payload. The API accepts a `unit=`
  query parameter; whether an acre-feet unit code is accepted was not
  tested.
- **Update frequency:** the most recent Fort Peck value at the time of the
  check was dated 2026-08-15, a roughly four-day lag behind the 2026-08-19
  check date. A separate Sacramento District series checked for comparison
  was only two to three days stale, so lag is office-dependent rather than a
  single global cadence. Every value carries its own timestamp.
- **Terms of use / rate limits:** not confirmed. The GitHub repository states
  the API code itself is public domain/MIT-licensed; no explicit published
  rate-limit figure was located.
- **Coverage, confirmed empirically and unevenly:**
  - `NWDM` (Missouri River Basin Water Management — MT, WY, CO, NE, KS, SD)
    returned Fort Peck (MT), Oahe (SD) and Fort Randall (SD) among 12,060
    total locations under that office — that count includes river gauges and
    sub-basin points, not 12,060 reservoirs.
  - `SPK` (Sacramento District — CA, CO, UT) has **260 storage-related
    timeseries**, current to within a few days, including both
    wholly-USACE reservoirs and jointly compiled "Section 7" reservoirs.
  - `NWP` (Portland District — the Willamette Valley and Columbia Basin
    projects, e.g. Detroit, Lookout Point, Dworshak) returned **zero**
    storage timeseries and zero matching project locations in the national
    API as of this check. That data instead appears to live on the
    Northwestern Division's own separate portal,
    `https://www.nwd.usace.army.mil/CRWM/Water-Control-Data/`, whose
    structure was found by search but not independently fetched, so whether
    it offers anything machine-readable beyond an HTML report is
    unconfirmed. **The Columbia Basin — the core of USACE's Oregon,
    Washington and Idaho presence — is not reachable through the national
    CWMS Data API today.**
  - Sacramento District separately runs a legacy HTML report site,
    `https://www.spk-wc.usace.army.mil/`, covering California, Colorado and
    Utah flood-control reservoirs including non-Corps "Section 7" dams
    through tabulated report pages — this reads as pre-CDA HTML reporting,
    not a documented JSON/CSV API, and was not confirmed machine-readable.
- **Overlap, confirmed.** At least one Sacramento District series is
  explicitly labeled USBR-combined data (a Beardsley Lake series carrying
  `Rev-USBR-Combined` in its name) — meaning USACE and Reclamation can
  publish figures for the same physical reservoir under different offices
  and ids. This needs the same name/coordinate cross-check as every other
  overlap risk in this review.

## Sources checked and found to have no independent machine-readable endpoint

**Oregon Water Resources Department.** The near-real-time hydro tool at
`https://apps.wrd.state.or.us/apps/sw/hydro_near_real_time/` is a stateful
ASP.NET WebForms application (confirmed via raw HTTP fetch: IIS 10.0,
ViewState-driven `.aspx` postbacks). A direct, parameterized GET to
`DisplayHydroGraph.aspx?station_nbr=...` returned an HTTP 302 to an error
page, confirming the tool requires interactive form navigation rather than
accepting a simple query string — it cannot be treated as a machine
endpoint without scraping a session. The tool's own station listing shows
some Oregon reservoir stations keyed directly by "Station ID (Number or
USBR code)," a signal that Oregon's reservoirs likely already surface
through Reclamation RISE, consistent with the 38 Oregon candidates the
admission review already found via AWDB. `oregonwaterdata.org` returned no
fetchable body content in this session (likely a JavaScript-rendered page
this tooling could not execute), so it remains unconfirmed rather than
ruled out.

**Idaho Department of Water Resources.** IDWR's own "Water Supply Data
Sources" page (`https://idwr.idaho.gov/water-data/water-supply/data-sources/`)
is itself an outbound-links page, and every reservoir-storage row on it
points to a federal system, not an IDWR one: Mackay Reservoir to USGS NWIS,
the Boise/Payette and Upper Snake systems to Reclamation's Hydromet system,
the Pacific Northwest/Columbia system to USACE, and the Bear River to the
interstate Bear River Commission. IDWR's ArcGIS Open Data Hub
(`https://data-idwr.hub.arcgis.com/`) was checked via its DCAT-US feed
(`.../api/feed/dcat-us/1.1.json`, 283 datasets, keyless) — its one
dam-related dataset, "Dams of Idaho," is confirmed to be a dam-safety
hazard/inventory map under Idaho Code 42-1709–1721, not a current-storage
feed. **Idaho contributes no independent source; IDWR's own documentation
defers every reservoir to USGS, Reclamation or USACE.**

**Washington Department of Ecology.** Ecology's "Statewide conditions" page
is a narrative summary, not a data service — it states current Yakima
system figures in prose ("61% of full capacity") and links out to
Reclamation's older Pacific Northwest **Hydromet** system, a separate,
older web system from `data.usbr.gov/rise`; whether those Hydromet stations
are already indexed inside RISE was not checked and should not be assumed.
Washington's major reservoirs — the five Yakima Project reservoirs and the
Columbia system's Grand Coulee/Banks Lake — are federally operated
(Reclamation or USACE), consistent with the thin independent state coverage
expected going in. Ecology's other public tools (Freshwater DataStream, the
EIM/Freshwater Information Network) are water-quality and streamflow
oriented, with no reservoir-storage fields found in what was surfaced.

**Nevada Division of Water Resources.** `water.nv.gov/index.php/data` lists
precipitation, streamflow, well-level and water-use data — no reservoir or
dam storage dataset is described. An ArcGIS Hub link
(`data-ndwr.hub.arcgis.com`) returned HTTP 404 and was not otherwise
verified. Nevada's major reservoirs (Mead, Mohave, Lahontan) are already
Reclamation dams, and Walker Lake — the one Nevada reservoir this review did
verify data for — came through USGS NWIS, not a Nevada state source.

**Wyoming Water Resources Data System (WRDS).** The surface-water and
"Water and Climate Explorer" pages at `wrds.uwyo.edu` are confirmed to be
map and "teacup diagram" visualizations only — no API, bulk download, JSON
or CSV export was found on any page checked. WRDS describes its own data as
drawn from 13 source agencies with USGS as the largest, making it a likely
**republisher** rather than an original collector even for a reservoir this
project does not otherwise track. Wyoming's State Engineer's Office site
surfaced only SNOTEL reporting (already AWDB territory) and water-rights
administration pages, nothing reservoir-specific.

**Arizona Department of Water Resources (ADWR).** Its data-dashboards page
(`azwater.gov/adwr-data-dashboards`) covers groundwater, drought and
assured/adequate water supply determinations — no surface reservoir storage
product was found.

## Sources with real data but no clean fit

**Salt River Project (Arizona).** SRP's daily water report at
`https://streamflow.watershedconnection.com/dwr` was fetched and confirmed
to show current elevation, storage in acre-feet, remaining capacity to
full, 24-hour change, rainfall and percent full for Roosevelt, Apache,
Canyon, Saguaro, Horseshoe and Bartlett — real, current numbers. No JSON,
CSV or documented API was found; a guessed `/api/dwr` path returned 404.
Reservoirs are identified only by name in the URL and on the page — a clean
ADR-066 failure. Two of these dams (Roosevelt and Bartlett) are federally
owned by Reclamation, but RISE's own catalog record for Roosevelt
(`data.usbr.gov/location/3713`) carries only a historical sedimentation
survey, not a current daily storage series, so **SRP is currently the only
place this data exists at all** — a real gap, just not one this project can
build against as published today.

**Montana DNRC state-owned dams.** A fetched page
(`dnrc.mt.gov/Water-Resources/State-Owned-Dams-and-Canals/`) lists 22
state-owned dams with capacity in acre-feet, but only about eight link to
any near-real-time monitoring page, with no unified table or export across
them. A separate map application, StAGE
(`gis.dnrc.mt.gov/apps/stage/gage-report`), could not be confirmed either
way to expose an underlying REST/JSON service. DNRC's own pages explicitly
point to Reclamation's data for the federal reservoirs it does not
duplicate, confirming no overlap there but also confirming DNRC's own
coverage stops short of the Missouri mainstem dams this review reached
through USACE instead. This research also surfaced a real instance of the
exact naming hazard ADR-066 was written to prevent: Montana's state-owned
**Willow Creek Reservoir** is a third Willow Creek, distinct from the
Colorado one already published and the Oregon candidate already flagged in
`WESTERN-RESERVOIR-ADMISSION.md`.

**New Mexico.** `meas.ose.state.nm.us`, the state's real-time water
measurement system, is public and keyless but does not carry reservoir
storage at all — it links out to USGS and Reclamation for that, and its own
station identifiers are an inconsistent mix of USGS numbers, local names
and water-rights codes. A separate project, `newmexicowaterdata.org`, does
expose a genuine machine-readable interface — a CKAN catalog API plus a
live OGC SensorThings API (`FROST-Server` endpoints) that appears keyless —
but its own dataset description states it carries "reservoir elevation and
storage data from USGS, Colorado Department of Water Resources, and U.S.
Bureau of Reclamation." That is a **confirmed republisher**, not an
independent New Mexico source, and using it risks double-counting
reservoirs this project already has through RISE or a future Colorado
source — the exact failure ADR-046 and this review's overlap rule both
exist to prevent.

## What I could not verify

- **Whether USACE CWMS publishes reservoir capacity anywhere**, and its
  formal terms of use or rate limits. A `/levels` endpoint that may carry
  pool figures was not queried against Fort Peck.
- **Whether an acre-feet unit code is accepted by the CWMS `unit=`
  parameter** — the worked Fort Peck example returned cubic meters, and
  conversion was done by hand for this document.
- **Whether the Northwestern Division's own Columbia Basin water-control
  portal (`nwd.usace.army.mil/CRWM/Water-Control-Data/`) is machine-readable
  in any form.** It was located by search but not fetched directly, so
  Oregon, Washington and Idaho's USACE reservoirs remain a confirmed
  coverage gap with an unconfirmed second path around it.
- **Whether the Sacramento District legacy report site
  (`spk-wc.usace.army.mil`) is anything more than tabulated HTML.**
- **CDSS's actual Terms of Use text.** A footer link exists; its content was
  not retrieved.
- **CDEC's formal terms of use or rate-limit policy beyond `robots.txt`.**
  The `Disallow: /` directive was found and is noted above, but no separate
  terms page confirming or narrowing what it means for direct API-style
  queries (as opposed to crawling the HTML site) was located.
- **Whether CDEC's published capacity figures are gross pool or a
  regulated/normal figure** — the one example checked (Shasta) was not
  labeled either way on the page it came from.
- **Per-site overlap between USGS NWIS reservoir-storage sites and
  RISE/AWDB/CDEC/USACE**, beyond the single Walker Lake example, which
  suggested but did not prove some NWIS coverage is genuinely additive.
- **Whether Reclamation's older Pacific Northwest Hydromet stations (behind
  Washington Ecology's Yakima-system link) are already indexed inside RISE**
  or would need separate ingestion — treated as an open question, not
  assumed either way.
- **`oregonwaterdata.org`'s actual contents** — it returned no fetchable
  body in this session, likely because it is a JavaScript-rendered
  application this tooling could not execute; this is a verification gap,
  not a finding of absence.

## Recommendation

**Build against Colorado CDSS and CDEC first.** Both returned a real,
current, correctly-unitted storage value in this session with no
credential of any kind, both key on a genuine stable identifier rather than
a name, and CDSS in particular ships a self-declared `dataSourceAbbrev`
field that makes the RISE-overlap check close to mechanical — filter out
`BOR` and `NWBOR` and roughly 110 of 128 Colorado reservoirs are left, none
of them already on the roster through Reclamation. Both sources share the
same missing piece this project has already solved once: neither publishes
capacity in its live feed (CDEC keeps it on a separate static page; CDSS's
capacity-shaped series is administratively stale), which the National
Inventory of Dams — already adopted under ADR-003 — can very likely fill
the same way it already fills that gap for RISE and AWDB reservoirs.

**USGS NWIS is a real third pick, but not for Utah today.** It is keyless,
carries the strongest identifier of any candidate here, and has confirmed
coverage in nine of the eleven states — but zero active reservoir-storage
sites were found in Utah or Montana, so it would add nothing to the current
roster and only pays off as western admission proceeds. Its 2027
decommission deadline is real and specific enough to put a date on: build
against the legacy endpoint now, and revisit before the migration rather
than after.

**Treat USACE as the priority gap, and a genuinely fragmented one.** It is
the only candidate here that plausibly answers the roster's single largest
hole — zero USACE reservoirs today, against a real western fleet of them —
and this review did produce one working example, Fort Peck, with a real
current-ish storage value. But coverage is confirmed uneven by design: solid
in the Missouri Basin and Sacramento District, and **absent from the
national API for the Columbia Basin**, which is exactly where Oregon,
Washington and Idaho's USACE reservoirs sit. Scope this as two separate
questions rather than one integration: what the national CDA can already
reach (Missouri Basin, Sacramento District), and whether the Northwestern
Division's own Columbia Basin portal is machine-readable at all, which
remains unverified.

**Do not build against SRP, Montana's state-owned dams, WRDS, or
newmexicowaterdata.org as published today.** Each fails ADR-066 on
identifier, or turns out on inspection to be a republisher of data this
project can already reach more directly, or both. SRP is the one exception
worth remembering rather than discarding: it is genuinely the only current
source for six real Arizona reservoirs, two of them federally owned with no
current data in RISE at all, and if SRP ever publishes a stable
per-reservoir identifier or a structured feed, it moves straight to the top
of this list.

## Still open, checked against the roster on 2026-08-21

The survey above was made before California and Colorado were promoted. With
those two built, the published roster holds 375 reservoirs, and six of the
eleven states remain thin: **Idaho 25, Washington 18, Wyoming 9, Nevada 6,
Arizona 4** — 62 reservoirs between them, fewer than Utah's 58 from the two
federal providers alone. Oregon's 45 are federal as well.

Nothing above has been acted on for those six. The two recommendations that
still stand — USGS NWIS `00054` for the nine states with coverage, and USACE
CWMS for the confirmed Columbia Basin gap — have not been measured against
the current roster, and Nevada's own entry above says its search was not
exhaustive.

The next pass, and the order to work it in, is scoped in
[`WATER-BODY-AND-NAVIGATION-SCOPING.md`](WATER-BODY-AND-NAVIGATION-SCOPING.md),
section 5. **This document remains the authority for what each source is**;
that one records only what is left to do about it and what has to be counted
before anyone can size it.
