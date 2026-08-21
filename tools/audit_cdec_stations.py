"""Which California Data Exchange Center reservoirs could be published.

The same question `audit_awdb_stations.py` and `audit_candidate_capacity.py`
answer for the two federal providers, asked of California's own service:
which of its storage stations sit in a drainage area this site draws, are not
already tracked, and can be given a full level.

    python tools/audit_cdec_stations.py
    python tools/audit_cdec_stations.py --json > cdec-candidates.json

It writes nothing to the published data. The admission rules live in
`admission.py` and are unit tested; this tool fetches and prints what they
decided, so a person reviews the evidence before anything is committed.

Three things about this service that the two federal ones did not require:

  - **`-9999` is the missing-data sentinel, and it is a number.** Measured on
    2026-08-20 over a week across all 238 storage stations, 537 of 1,435
    values were `-9999` and none were null. At 37% this is the dominant shape
    of the data rather than an edge case, and a reader of the value field who
    treats it as a number subtracts ten thousand acre-feet from a total. Every
    read here goes through `usable`, and nothing else may touch `value`.

  - **The roster is HTML; only the data is JSON.** There is no station-list
    endpoint that answers in a machine format, so the table is parsed out of
    the search page. The parse is strict and fails loudly rather than
    returning a short list, because a silently short roster reads exactly like
    a service that has retired some stations.

  - **Being listed is not reporting.** 82 of the 238 stations carrying the
    storage sensor returned nothing usable over that week. They are excluded
    here rather than admitted and then carried forward as stale, which is a
    different thing from ADR-056's carry-forward: that is for a feed that has
    gone quiet, not for one that never spoke.

The observed maximum used by the admission screen is read at monthly
resolution. Thirty times fewer rows than daily, and the screen only asks how
much water has ever been seen -- a monthly maximum answers that.
"""

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from admission import (  # noqa: E402
    admit_all, discrepancies, distance_km, preferred_capacity,
)
from huc import assign_huc, load_units  # noqa: E402
from tools.audit_candidate_capacity import (  # noqa: E402
    dam_states, fetch_dams, find_dam_layer,
)

#: The station search, which is the only enumeration this service offers.
#: `sensor=15` is reservoir storage.
CDEC_STATIONS = "https://cdec.water.ca.gov/dynamicapp/staSearch"
CDEC_DATA = "https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet"
#: The daily reservoir report, the one place capacity is published.
CDEC_REPORT = "https://cdec.water.ca.gov/reportapp/javareports?name=RES"
#: What that figure is called in `capacity_basis`, and the name a reader of
#: the published payload meets. It sits beside `reclamation_project_record`
#: and `awdb_reservoir_metadata`, which are the same thing for the two
#: federal providers: the operator's own record, preferred over the dam
#: inventory's pool (ADR-070). Naming the report rather than the service is
#: deliberate -- this figure comes from one page of it, and a reader
#: following the basis should land where the number is.
CDEC_CAPACITY_BASIS = "cdec_reservoir_report"

USER_AGENT = "western-water-dashboard/cdec-audit (+https://github.com/buschbrian)"
TIMEOUT = 180
#: Matches the storage roster's own start (`refresh_reservoirs.START_DATE`).
START_DATE = "2015-01-01"

#: The value this service writes where it has no reading. It is a number, not
#: a null, and it is the single most dangerous fact about this source.
MISSING_VALUE = -9999

#: How close a station has to sit to a point this site already publishes
#: before it is treated as one we already track.
#:
#: Position alone is not enough, and Lake Mead is why. ADR-058 puts this
#: site's published point on the *waterbody*; this service puts its point on
#: the *dam*. For Lake Mead those are 41.8 km apart, so a position test at any
#: sane radius reports the largest reservoir in the west as a new one and the
#: roster carries 28 million acre-feet twice -- the exact double count ADR-011
#: and ADR-062 exist to prevent. Upper Klamath is the quieter version of the
#: same thing at 2.1 km, just outside this radius.
#:
#: So `already_tracked` tests three things: this radius against the published
#: waterbody point, the same radius against the *reviewed dam point* in
#: `capacities.json`, and the reservoir's name. Any one is enough.
ALREADY_TRACKED_KM = 2.0

#: Names that describe something other than one reservoir.
#:
#: This service's storage sensor is not a reservoir roster. The list holds
#: rows that are sums: "Statewide Storage Estimate (15 reservoirs)" reports
#: 33.9 million acre-feet, and "Thermalito Total" adds a forebay to an
#: afterbay this site would publish separately. It also carries San Luis
#: Reservoir three times -- whole, federal share and state share -- and the
#: whole one is the one with a published capacity, so a rule that trusted the
#: service's own figure would admit the double count in preference to the
#: parts.
#:
#: Matched on the name because there is nothing else to match on: the service
#: gives an aggregate the same shape of record as a reservoir. A heuristic, so
#: it reports rather than silently drops, and every hit is listed for review.
AGGREGATE_NAME = re.compile(
    r"\b(total|statewide|estimate|combined|system)\b|\((federal|state)\)",
    re.IGNORECASE)

#: How many stations to ask for in one request. The servlet takes a
#: comma-separated list; this keeps any one response reviewable and any one
#: failure small.
CHUNK = 40


def get(url: str, params: dict | None = None) -> bytes:
    """One request, with this project named in the agent string."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


def usable(value) -> float | None:
    """A reading, or None where the service means "nothing".

    `-9999` is the sentinel and it is a number, so this is the only place the
    `value` field may be read. Returning None rather than zero is the whole
    point: no reading and an empty reservoir are different facts, and the
    first must never be summed.
    """
    if not isinstance(value, (int, float)):
        return None
    if value == MISSING_VALUE or value < 0:
        return None
    return float(value)


#: The columns the search page publishes, in order. Asserted rather than
#: assumed: a column inserted upstream would otherwise shift every field
#: quietly, and a roster of reservoirs at the wrong coordinates is worse than
#: no roster.
STATION_COLUMNS = ["ID", "Station Name", "River Basin", "County",
                   "Longitude", "Latitude", "ElevationFeet", "Operator"]


def parse_station_table(html: str) -> list[dict]:
    """The storage stations, out of the only page that lists them.

    Strict on the header row. If the service reshapes its table this raises
    rather than returning a plausible short list, because a short roster looks
    exactly like a service that has retired stations.
    """
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)
    if not rows:
        raise RuntimeError("the station search returned no table at all")

    def cells(row: str) -> list[str]:
        return [re.sub(r"<[^>]+>", "", cell).strip()
                for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]

    header = cells(rows[0])
    if header[:len(STATION_COLUMNS)] != STATION_COLUMNS:
        raise RuntimeError(
            "the station search table has changed shape; expected "
            f"{STATION_COLUMNS} and found {header[:len(STATION_COLUMNS)]}")

    stations = []
    for row in rows[1:]:
        found = cells(row)
        if len(found) < len(STATION_COLUMNS):
            continue
        try:
            lon, lat = float(found[4]), float(found[5])
        except ValueError:
            continue
        if not (-125 < lon < -113 and 32 < lat < 43):
            # Outside California's own box. Not a judgement about scope --
            # that is the drainage areas' job below -- but a coordinate this
            # far out is a parse fault rather than a station.
            continue
        stations.append({
            "station": found[0],
            "name": found[1].title(),
            "basin": found[2],
            "county": found[3],
            "lon": lon,
            "lat": lat,
            "operator": found[7],
        })
    if not stations:
        raise RuntimeError("the station search table parsed to no stations")
    return stations


def fetch_stations() -> list[dict]:
    """Every station carrying the reservoir-storage sensor."""
    html = get(CDEC_STATIONS, {
        "sta": "", "sensor_chk": "on", "sensor": "15",
        "collect": "NONE SPECIFIED", "dur": "", "active": "",
        "loc_chk": "on", "lon1": "", "lon2": "", "lat1": "", "lat2": "",
        "elev1": "-5", "elev2": "99000", "nearby": "",
        "basin": "NONE SPECIFIED", "hydro": "NONE SPECIFIED",
        "county": "NONE SPECIFIED", "agency_num": "160", "display": "sta",
    }).decode("utf-8", errors="replace")
    return parse_station_table(html)


def storage_history(stations: list[dict]) -> dict[str, dict]:
    """Every usable monthly storage reading since `START_DATE`, by station.

    Monthly rather than daily: the admission screen asks how much water has
    ever been seen, and a monthly series answers that in a thirtieth of the
    rows.

    Each station answers with its readings *and* the date of the last one.
    "Being listed is not reporting" is this source's own lesson and it was
    measured over a week; asking the whole record whether a station has ever
    spoken asks a different question, and Bon Tempe is the reservoir that
    separates the two -- five usable readings ever, the last in March 2023.
    Admitted on the record alone it would join the roster and be withdrawn
    for a quiet feed the same morning (ADR-056), which is a roster addition
    that publishes nothing and reads exactly like a failed fetch.
    """
    end = time.strftime("%Y-%m-%d")
    readings: dict[str, list[float]] = {}
    ids = [station["station"] for station in stations]
    for start in range(0, len(ids), CHUNK):
        chunk = ids[start:start + CHUNK]
        body = get(CDEC_DATA, {
            "Stations": ",".join(chunk), "SensorNums": "15",
            "dur_code": "M", "Start": START_DATE, "End": end})
        # The same guard `fetch_cdec_series` holds in the daily pipeline: the
        # servlet answers an error with an object, and iterating that yields
        # its keys, so `row.get` raises and takes the whole audit down --
        # every chunk already fetched, and a second of sleep paid for each.
        # A chunk that will not parse is reported and the run goes on; the
        # stations in it simply have no readings to screen on.
        try:
            rows = json.loads(body)
        except ValueError:
            rows = None
        if not isinstance(rows, list):
            print(f"  CDEC did not answer with readings for {len(chunk)} "
                  f"stations starting {chunk[0]}; skipped", file=sys.stderr)
            time.sleep(1)
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            value = usable(row.get("value"))
            if value is None:
                continue
            found = readings.setdefault(row["stationId"],
                                        {"values": [], "last": ""})
            found["values"].append(value)
            # Dates arrive unpadded (`2026-8-1 00:00`), so this is a
            # comparison of the parsed day and not of the string.
            day = reading_day(row.get("date"))
            if day and day > found["last"]:
                found["last"] = day
        # A public service this project does not pay for.
        time.sleep(1)
    return readings


def reading_day(stamp) -> str:
    """One reading's own day as an ISO date, or "" if it has none.

    The servlet writes `2026-8-10 00:00` -- unpadded, so the strings do not
    sort. `fetch_cdec_series` in the refresh has the same fact written down
    beside it; this is the audit's copy of it, kept here rather than imported
    because the refresh is pandas and this tool is deliberately not.
    """
    text = (stamp or "").split(" ")[0]
    parts = text.split("-")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        return ""
    year, month, day = (int(part) for part in parts)
    return f"{year:04d}-{month:02d}-{day:02d}"


def published_capacities() -> dict[str, float]:
    """The full levels this service publishes, keyed by station.

    Only the daily reservoir report carries them, and only for a fraction of
    the stations -- 48 of 238 when this was written. The rest have to be
    matched to the dam inventory like every other candidate.
    """
    html = get(CDEC_REPORT).decode("utf-8", errors="replace")
    capacities: dict[str, float] = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        found = [re.sub(r"<[^>]+>", "", cell).strip()
                 for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
        if len(found) < 3 or not re.fullmatch(r"[A-Z0-9]{3}", found[1] or ""):
            continue
        digits = found[2].replace(",", "")
        if digits.isdigit() and int(digits) > 0:
            capacities[found[1]] = float(digits)
    return capacities


def simple_name(name: str) -> str:
    """A name reduced to what two providers would plausibly agree on."""
    lowered = re.sub(r"[^a-z0-9 ]+", " ", (name or "").lower())
    words = [word for word in lowered.split()
             if word not in {"lake", "reservoir", "lk", "res", "the", "near"}]
    return " ".join(words)


def already_tracked(station: dict, points, dam_points, names) -> str | None:
    """Why this station is one this site already publishes, or None.

    Three tests, any of which is enough. See `ALREADY_TRACKED_KM` for why one
    would not be: this site's point is on the waterbody and this service's is
    on the dam, and for Lake Mead those are 41.8 km apart.
    """
    point = (station["lon"], station["lat"])
    if points and min(distance_km(point, other) for other in points) < ALREADY_TRACKED_KM:
        return "position"
    if dam_points and min(distance_km(point, other)
                          for other in dam_points) < ALREADY_TRACKED_KM:
        return "the reviewed dam point"
    reduced = simple_name(station["name"])
    if reduced and reduced in names:
        return "name"
    return None


def quiet_cutoff(today=None) -> str:
    """The day a station has to have reported since to be a candidate.

    A year, which is long enough that a monthly reservoir reported once a
    season is never mistaken for a quiet one, and short enough that a station
    silent since 2023 does not join the roster. ADR-056 withdraws at 60 days,
    and this is deliberately not that number: withdrawal is about a
    reservoir this site publishes going quiet, and this is about never
    admitting one that already has.
    """
    day = today or time.gmtime()
    return f"{day.tm_year - 1:04d}-{day.tm_mon:02d}-{day.tm_mday:02d}"


def find_candidates(units=None) -> tuple[list[dict], dict]:
    """Reporting storage stations in our drainage areas that we do not track.

    Returns `(candidates, info)`, where info carries the counts the caller
    reports. Printing is left to the caller so `--json` stays machine-readable.
    """
    units = units or load_units()
    payload = json.loads((ROOT / "reservoirs.json").read_text(encoding="utf-8"))
    points = [(r["lon"], r["lat"]) for r in payload["reservoirs"]]
    names = {simple_name(r["name"]) for r in payload["reservoirs"]}
    #: The reviewed dam coordinates, read from the committed table the same
    #: way `audit_awdb_stations` reads them.
    catalog = json.loads((ROOT / "capacities.json").read_text(encoding="utf-8"))
    dam_points = [(entry["dam_lon"], entry["dam_lat"])
                  for entry in catalog["capacities"].values()
                  if entry.get("dam_lon") is not None
                  and entry.get("dam_lat") is not None]

    stations = fetch_stations()
    readings = storage_history(stations)
    quiet_before = quiet_cutoff()

    candidates, dormant, quiet, already, aggregates, outside = [], [], [], [], [], []
    for station in stations:
        found = readings.get(station["station"])
        if not found or not found["values"]:
            # Listed against the sensor and never answering with a reading.
            dormant.append(station)
            continue
        if found["last"] < quiet_before:
            # Answering, but not this year. See `storage_history`.
            quiet.append({**station, "last_reading": found["last"]})
            continue
        seen = found["values"]
        if AGGREGATE_NAME.search(station["name"]):
            aggregates.append(station)
            continue
        how = already_tracked(station, points, dam_points, names)
        if how:
            already.append({**station, "matched_by": how})
            continue
        point = (station["lon"], station["lat"])
        unit = assign_huc(point, units)
        if not unit:
            outside.append(station)
            continue
        candidates.append({
            **station,
            "state": "CA",
            # Every state this station's drainage area reaches, which is the
            # set its dam could be in. Lake Havasu and Lake Mohave are why:
            # this service reports both, their dams stand in Arizona and
            # Nevada, and a run that fetched California dams alone refused
            # them for "no dam close enough to confirm" -- a refusal that
            # means "never looked for" and reads exactly like one that means
            # "looked for and not found".
            "dam_states": [code for code in (unit.get("states") or "").split(",")
                           if code],
            # `huc6` is the unit's key whatever level the scope is drawn at
            # (ADR-050): the code arrives under the name the level gives it,
            # and this reads it rather than re-deriving one.
            "huc6": unit["huc6"],
            "huc6_name": unit["name"],
            "observed_max_af": max(seen),
            # The top of the series rather than its maximum alone. A wrong dam
            # is wrong in every reading and a bad reading is wrong once, and
            # the second is only visible from the readings either side of it:
            # see `admission.SPIKE_RATIO`. Three, because that is what the
            # screen reads and a whole series in the evidence file would be
            # a hundred and thirty numbers per station saying nothing.
            "highest_readings": sorted(seen, reverse=True)[:3],
            "readings": len(seen),
        })

    candidates.sort(key=lambda c: (c["huc6"], c["name"]))
    return candidates, {
        "stations": len(stations),
        "dormant": len(dormant),
        "quiet_for_over_a_year": len(quiet),
        "looks_like_an_aggregate": len(aggregates),
        "already_tracked": len(already),
        "outside_the_drawn_areas": len(outside),
        "_already": already,
        "_aggregates": aggregates,
        "_quiet": quiet,
    }


def review(candidate: dict, decision, service_capacity_af: float | None) -> dict:
    """One candidate's evidence row: the dam match, and what disagrees with it.

    `publishable` is the only field a roster builder should read, and it is
    deliberately narrower than `admitted`. A dam match answers one question;
    the service's own full level and the shape of the series answer others,
    and where any of them disagree the candidate is held for a person rather
    than published over. See `admission.discrepancies`.

    `capacity_af` and `capacity_basis` are the figure a percentage would be
    divided by and where it came from, which since ADR-070 is the service's
    own published full level wherever it has one. The inventory's answer to
    the same question is kept beside it as `inventory_capacity_af` rather
    than overwritten: a reviewer comparing two sources needs both, and the
    three inventory storage fields below it are the record the dam match was
    made against, not the denominator.
    """
    evidence = dict(decision.evidence(),
                    station=candidate["station"],
                    state=candidate["state"],
                    huc6=candidate["huc6"],
                    huc6_name=candidate["huc6_name"],
                    lat=candidate["lat"], lon=candidate["lon"],
                    operator=candidate["operator"],
                    observed_max_af=candidate["observed_max_af"],
                    readings=candidate["readings"])
    # The service's own figure, where it has one, and the inventory's beside
    # it. Which of them is the denominator is settled by rule now (ADR-070)
    # rather than left to the roster builder, but both are still reported:
    # the decision was made from the pair and a reviewer reads the pair.
    evidence["service_capacity_af"] = service_capacity_af
    evidence["inventory_capacity_af"] = decision.capacity_af
    evidence["inventory_capacity_basis"] = decision.capacity_basis
    capacity, basis = preferred_capacity(
        decision, service_capacity_af, CDEC_CAPACITY_BASIS)
    # Only where a dam was confirmed. A denominator written into a row that
    # has no dam behind it reads as a reservoir this project could measure,
    # and the four that need a reviewed capacity by hand are exactly those
    # rows -- `service_capacity_af` already carries the figure for them.
    if "capacity_af" in evidence:
        evidence["capacity_af"] = capacity
        evidence["capacity_basis"] = basis
    evidence["discrepancies"] = [
        {"screen": screen, "detail": detail}
        for screen, detail in discrepancies(
            decision,
            highest_readings=candidate.get("highest_readings"),
            service_capacity_af=service_capacity_af,
            provider_basis=CDEC_CAPACITY_BASIS)]
    evidence["publishable"] = evidence["admitted"] and not evidence["discrepancies"]
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true",
                        help="print the decisions and their evidence as JSON")
    args = parser.parse_args()

    print("=== California Data Exchange Center, reservoir storage",
          file=sys.stderr)
    candidates, info = find_candidates()
    for label, count in info.items():
        if label.startswith("_"):
            continue
        print(f"  {label.replace('_', ' ')}: {count}", file=sys.stderr)
    # Named, not counted. Both lists are judgements this tool made on a
    # reviewer's behalf, and a count is not something a reviewer can check.
    for station in info["_aggregates"]:
        print(f"    aggregate?  {station['station']:<4} {station['name']}",
              file=sys.stderr)
    for station in info["_quiet"]:
        print(f"    quiet       {station['station']:<4} {station['name']}"
              f"  (last reading {station['last_reading']})", file=sys.stderr)
    for station in info["_already"]:
        print(f"    tracked     {station['station']:<4} {station['name']}"
              f"  (by {station['matched_by']})", file=sys.stderr)
    print(f"  candidates: {len(candidates)}\n", file=sys.stderr)
    if not candidates:
        print("No candidates.", file=sys.stderr)
        return 0

    published = published_capacities()
    print(f"  this service publishes a full level for {len(published)} stations",
          file=sys.stderr)

    # Every state any candidate's drainage area reaches, not just the state
    # the service belongs to. State names, not postal codes: `dam_states`
    # maps them and reports any it cannot.
    reachable = sorted({code for candidate in candidates
                        for code in candidate["dam_states"]} | {"CA"})
    states = dam_states([{"state": code} for code in reachable])
    print(f"  dams to fetch for: {', '.join(states)}", file=sys.stderr)
    layer_url, fields, where, expected = find_dam_layer(states)
    if not layer_url:
        print("ERROR: no dam inventory found with a usable schema", file=sys.stderr)
        return 1
    dams = fetch_dams(layer_url, fields, where)
    if expected is not None and len(dams) != expected:
        print(f"ERROR: the inventory returned {len(dams)} of {expected} dams; "
              "partial data refused", file=sys.stderr)
        return 1
    print(f"  {len(dams)} dams with coordinates\n", file=sys.stderr)

    decisions = admit_all(candidates, dams)
    rows = [review(candidate, decision, published.get(candidate["station"]))
            for candidate, decision in zip(candidates, decisions)]

    if args.json:
        print(json.dumps(rows, indent=1))
        return 0

    header = (f"{'candidate':<30} {'sta':<4} {'area':<26} {'inventory':>11} "
              f"{'service':>10} {'observed':>11} {'km':>6}  decision")
    print(header)
    print("-" * len(header))
    for row in rows:
        distance = (f"{row['match_distance_km']:.2f}"
                    if row.get("match_distance_km") is not None else "-")
        inventory = (f"{row['capacity_af']:,.0f}"
                     if row.get("capacity_af") else "-")
        service = (f"{row['service_capacity_af']:,.0f}"
                   if row.get("service_capacity_af") else "-")
        observed = f"{row['observed_max_af']:,.0f}"
        mark = ("admit " if row["publishable"]
                else "HOLD  " if row["admitted"] else "REFUSE")
        print(f"{row['name'][:29]:<30} {row['station']:<4} "
              f"{row['huc6_name'][:25]:<26} {inventory:>11} {service:>10} "
              f"{observed:>11} {distance:>6}  {mark} "
              f"{'; '.join(d['screen'] for d in row['discrepancies']) or row['reason']}")

    admitted = sum(1 for row in rows if row["admitted"])
    publishable = sum(1 for row in rows if row["publishable"])
    with_service = sum(1 for row in rows
                       if not row["admitted"] and row.get("service_capacity_af"))
    print(f"\n{admitted} of {len(rows)} candidates are capacity-admissible "
          "against the dam inventory.")
    print(f"{publishable} of those {admitted} carry no disagreement and could "
          f"be published; {admitted - publishable} are held for review.")
    held = {}
    for row in rows:
        for found in row["discrepancies"]:
            held.setdefault(found["screen"], []).append(row["station"])
    for screen, stations in sorted(held.items(), key=lambda pair: -len(pair[1])):
        print(f"  {len(stations):>3}  {screen}: {', '.join(sorted(stations))}")
    if with_service:
        print(f"{with_service} more carry a full level from the service itself "
              "and no confirmed dam; each needs review by hand.")
    print("Every admission carries its dam name, inventory identifier and match "
          "distance; run with --json to see them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
