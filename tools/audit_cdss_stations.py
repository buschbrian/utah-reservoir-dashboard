"""Which Colorado Division of Water Resources reservoirs could be published.

The same question `audit_awdb_stations.py`, `audit_candidate_capacity.py` and
`audit_cdec_stations.py` answer for the first three providers, asked of
Colorado's own telemetry service: which of its storage stations sit in a
drainage area this site draws, are not already tracked, and can be given a
full level.

    python tools/audit_cdss_stations.py
    python tools/audit_cdss_stations.py --json > cdss-candidates.json

It writes nothing to the published data. The admission rules live in
`admission.py` and are unit tested; this tool fetches and prints what they
decided, so a person reviews the evidence before anything is committed.

Four things about this service that shape the tool:

  - **Everything is JSON**, unlike California's HTML station list -- but the
    answer is always an envelope whose `ResultList` may be paged, and a
    station or window with no rows is an HTTP 404 with a text body rather
    than an empty list. Both are handled in `pipeline.providers`; this tool
    reads through that adapter's helpers rather than re-deciding them.

  - **A station list is not a reservoir roster.** `structureType` says what
    each station sits on, and 13 of the storage stations sit on recharge
    ponds -- not reservoirs, excluded and named. One station sits on a
    "Reservoir System", which reports several reservoirs against one row;
    held for review like the aggregate stations every other provider has.

  - **Being listed is not reporting** -- the same lesson as Bon Tempe, and
    measured here too: Gross Reservoir's last reading is from 2021 and three
    more stations are years quiet. A station must have answered inside the
    last year to be a candidate (ADR-056 would withdraw it the same morning
    otherwise).

  - **This service publishes no capacity at all.** Every denominator has to
    be matched against the National Inventory of Dams, which is why this
    audit costs two passes: one for the readings and one for the dams.
    ADR-070 never fires for this provider; ADR-003's inventory rule decides
    every percentage.

The observed maximum used by the admission screen is read over the full daily
record since 2015-01-01, because there is no monthly endpoint to thin it
with. That is about 400,000 rows for all candidates -- most of the service's
published 600,000-row daily quota -- so this tool prints how much of the
quota it has used as it goes, and a run on the same day as a full refresh of
this provider should not be attempted.
"""

import argparse
import datetime as _dt
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from admission import admit_all, denominator_for, discrepancies  # noqa: E402
from huc import assign_huc, load_units  # noqa: E402
from tools.audit_cdec_stations import already_tracked, simple_name  # noqa: E402
from tools.audit_candidate_capacity import (  # noqa: E402
    dam_states, fetch_dams, find_dam_layer,
)

#: This service's two endpoints. Written here rather than imported from
#: `pipeline.providers`, because importing any `pipeline` module loads the
#: committed rosters -- and this tool runs *before* there is one, which is
#: exactly when the CDEC tool wrote its own URLs too.
CDSS_STATIONS_URL = "https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrystation"
CDSS_SERIES_URL = ("https://dwr.state.co.us/Rest/GET/api/v2/"
                   "telemetrystations/telemetrytimeseriesday")

USER_AGENT = "western-water-dashboard/cdss-audit (+https://github.com/buschbrian)"
TIMEOUT = 180

#: Matches the storage roster's own start (`refresh_reservoirs.START_DATE`),
#: which is what an admitted station will be fetched from every morning.
START_DATE = "2015-01-01"

#: Structure types a storage station can sit on. "Recharge Area" is the
#: third found in the wild; anything new is reported rather than admitted,
#: because a type this tool has not met is a judgement it cannot make.
RESERVOIR_TYPES = {"Reservoir", "Reservoir System"}

#: How many stations to ask for in one series request. The endpoint takes a
#: comma-separated abbrev list; this keeps any one response reviewable and
#: any one failure small.
CHUNK = 25


def get(url: str, params: dict | None = None) -> tuple[bytes, object]:
    """One request, with this project named in the agent string."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.read(), response.headers
    except urllib.error.HTTPError as error:
        # This service answers "no rows" with a 404 and a text body -- the
        # same convention `pipeline.providers._get_cdss_json` honours. An
        # empty window is an answer here, not a failure; anything else still
        # raises.
        if error.code == 404 and b"zero records" in error.read():
            return b"[]", {}
        raise


def result_list(payload) -> list[dict]:
    """The rows out of the envelope, refusing a reshaped one."""
    if not isinstance(payload, dict) or not isinstance(
            payload.get("ResultList"), list):
        raise RuntimeError("the service answered without a ResultList")
    return payload["ResultList"]


def fetch_storage_stations() -> tuple[list[dict], int]:
    """Every station record carrying a latest STORAGE reading, and its rows.

    The station endpoint does not filter server-side by parameter -- tested:
    passing `parameter=STORAGE` changes nothing -- so the whole list is read
    (~1,400 records across three pages) and filtered here. Each *station*
    appears once per parameter, so the filter yields one row per storage
    station.
    """
    rows: list[dict] = []
    page = 1
    while True:
        body, _ = get(CDSS_STATIONS_URL, {
            "format": "json", "pageSize": 500, "pageIndex": page})
        found = result_list(json.loads(body))
        rows.extend(found)
        # Page until a short page arrives; a short page is the ground truth
        # about the end of the list, whatever the envelope claims.
        if len(found) < 500:
            break
        page += 1
        if page > 50:
            raise RuntimeError("the station list did not end after 50 pages")
    stations_by_abbrev: dict[str, dict] = {}
    for row in rows:
        if (row.get("parameter") or "") == "STORAGE":
            # One abbrev answered twice on the day measured -- the service
            # keeps two latest-reading rows for Pearl Lake. First wins.
            stations_by_abbrev.setdefault(row["abbrev"], row)
    stations = list(stations_by_abbrev.values())
    if not stations:
        raise RuntimeError("the station list parsed to no storage stations")
    return stations, len(rows)


def reading_day(stamp) -> str:
    """One reading's day as an ISO date, or "" if it has none.

    This service stamps ISO with an offset (`2026-08-21T15:00:00-06:00`) on
    the station row, and without one (`2026-07-01T00:00:00`) on the series
    rows. Only the date part is wanted here, and both shapes carry it first.
    """
    text = str(stamp or "")[:10]
    parts = text.split("-")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        return ""
    year, month, day = (int(part) for part in parts)
    try:
        _dt.date(year, month, day)
    except ValueError:
        return ""
    return f"{year:04d}-{month:02d}-{day:02d}"


def quiet_cutoff(today=None) -> str:
    """The day a station has to have reported since to be a candidate.

    A year, exactly as `audit_cdec_stations.quiet_cutoff` defines it: long
    enough that a seasonally quiet reservoir is never mistaken for a dead
    one, short enough that a station silent since 2023 does not join the
    roster and get withdrawn the same morning (ADR-056).
    """
    day = today or _dt.date.today()
    return f"{day.year - 1:04d}-{day.month:02d}-{day.day:02d}"


def classify(stations: list[dict], units=None,
             published: tuple[list, set] | None = None,
             dam_points: list | None = None) -> dict[str, list]:
    """Split the storage stations into candidates and everything else.

    The order of screens matters and each is reported: a structure that is
    not a reservoir, a station that did not answer within the year, one this
    site already publishes (by position, reviewed dam point, or name), and
    finally where the rest sit.

    `published` is `(waterbody points, reduced names)` from the payload and
    `dam_points` the reviewed dam coordinates; both default to reading the
    committed files, which is what the command-line run does. The seams exist
    so tests can drive every screen without touching repository data.
    """
    units = units or load_units()
    if published is None:
        payload = json.loads(
            (ROOT / "reservoirs.json").read_text(encoding="utf-8"))
        published = (
            [(r["lon"], r["lat"]) for r in payload["reservoirs"]],
            {simple_name(r["name"]) for r in payload["reservoirs"]},
        )
    points, names = published
    if dam_points is None:
        catalog = json.loads(
            (ROOT / "capacities.json").read_text(encoding="utf-8"))
        dam_points = [(entry["dam_lon"], entry["dam_lat"])
                      for entry in catalog["capacities"].values()
                      if entry.get("dam_lon") is not None
                      and entry.get("dam_lat") is not None]
    cutoff = quiet_cutoff()

    buckets: dict[str, list] = {
        "candidates": [], "not_reservoirs": [], "quiet": [],
        "already_tracked": [], "outside": [],
    }
    for station in stations:
        kind = station.get("structureType")
        if kind != "Reservoir":
            # Recharge ponds are excluded outright; a "Reservoir System" or
            # any unmet type is reported for review rather than admitted,
            # because a row reporting several reservoirs against one station
            # cannot be given one denominator.
            buckets["not_reservoirs"].append(station)
            continue
        last = reading_day(station.get("measDateTime"))
        if not last or last < cutoff:
            buckets["quiet"].append({**station, "last_reading": last})
            continue
        point = (station["longitude"], station["latitude"])
        how = already_tracked(
            {"name": station["stationName"], "lon": point[0], "lat": point[1]},
            points, dam_points, names)
        if how:
            buckets["already_tracked"].append({**station, "matched_by": how})
            continue
        unit = assign_huc(point, units)
        if not unit:
            buckets["outside"].append(station)
            continue
        buckets["candidates"].append({
            "abbrev": station["abbrev"],
            "name": station["stationName"],
            "wdid": station.get("wdid"),
            "gnis_id": station.get("gnisId"),
            "county": station.get("county"),
            "lon": station["longitude"],
            "lat": station["latitude"],
            "last_reading": last,
            "state": "CO",
            # Every state this station's drainage area reaches, which is the
            # set its dam could be in -- the lesson Lake Havasu taught the
            # CDEC audit.
            "dam_states": [code for code in (unit.get("states") or "").split(",")
                           if code],
            "huc6": unit["huc6"],
            "huc6_name": unit["name"],
            "por_start": reading_day(station.get("stationPorStart")),
        })
    buckets["candidates"].sort(key=lambda c: (c["huc6"], c["name"]))
    return buckets


def storage_history(abbrevs: list[str], report=None) -> dict[str, dict]:
    """Full daily storage since `START_DATE`, by abbrev.

    Batched, and paged through the envelope when one batch answers with more
    than a page. There is no monthly endpoint to thin the series with, so
    this pass is the audit's real cost: roughly 3,000 rows per station, and
    the whole candidate pool is a large share of the service's published
    daily row quota. `report` is called after each chunk with the rows still
    available, so the caller can print consumption as it goes.
    """
    end = _dt.date.today().isoformat()
    history: dict[str, dict] = {}
    for start in range(0, len(abbrevs), CHUNK):
        chunk = abbrevs[start:start + CHUNK]
        collected: list[dict] = []
        page = 1
        while True:
            body, headers = get(CDSS_SERIES_URL, {
                "abbrev": ",".join(chunk), "parameter": "STORAGE",
                "startDate": START_DATE, "endDate": end,
                "pageSize": 50000, "pageIndex": page, "format": "json",
            })
            payload = json.loads(body)
            collected.extend(result_list(payload))
            remaining = headers.get("X-Rate-Row-Remaining")
            if report and remaining is not None:
                report(int(remaining))
            page_count = payload.get("PageCount") if isinstance(payload, dict) else 1
            if not isinstance(page_count, int) or page >= page_count:
                break
            page += 1
            time.sleep(1)
        for row in collected:
            value = row.get("measValue")
            if not isinstance(value, (int, float)) or value < 0:
                continue
            entry = history.setdefault(row["abbrev"], {"values": [], "last": ""})
            entry["values"].append(float(value))
            day = reading_day(row.get("measDate"))
            if day and day > entry["last"]:
                entry["last"] = day
        time.sleep(1)
    return history


def review(candidate: dict, decision) -> dict:
    """One candidate's evidence row: the dam match, and what disagrees with it.

    The same shape the other audits publish (`publishable` narrower than
    `admitted`), with one difference and one absence. The difference: this
    provider publishes no full level, so `preferred_capacity` never fires and
    the inventory figure is always the denominator -- there is no
    `service_capacity_af` beside it. The absence follows: the disagreement
    screen that compares the two sources stays quiet for every candidate
    here, because there is nothing to compare against.

    The denominator is chosen with `denominator_for`, not with the plain
    preference `admit()` records -- ADR-072's condition, that a denominator be
    a figure the water has not been seen above, is applied here because this
    audit is where Colorado's denominators get chosen. Alsbury is why: its
    record offers 181 (conservation) and 429 (maximum) and has stood at 226,
    so dividing by 181 would publish "125% full" as an ordinary state while
    the same record already holds the figure that contains the water.
    """
    evidence = dict(decision.evidence(),
                    abbrev=candidate["abbrev"],
                    wdid=candidate.get("wdid"),
                    gnis_id=candidate.get("gnis_id"),
                    state=candidate["state"],
                    huc6=candidate["huc6"],
                    huc6_name=candidate["huc6_name"],
                    lat=candidate["lat"], lon=candidate["lon"],
                    county=candidate.get("county"),
                    por_start=candidate.get("por_start"),
                    last_reading=candidate.get("last_reading"),
                    observed_max_af=candidate["observed_max_af"],
                    readings=candidate["readings"])
    observed = candidate.get("observed_max_af")
    if decision.match is not None:
        capacity, basis = denominator_for(decision.match.dam, observed)
    else:
        capacity, basis = decision.capacity_af, decision.capacity_basis
    # The screens measure against the figure actually chosen, so they are
    # handed the decision with ADR-072's answer in it rather than the audit's
    # first-preference copy.
    chosen = type(decision)(decision.name, decision.admitted, decision.reason,
                            decision.match, capacity, basis)
    evidence["capacity_af"] = capacity
    evidence["capacity_basis"] = basis
    evidence["discrepancies"] = [
        {"screen": screen, "detail": detail}
        for screen, detail in discrepancies(
            chosen, highest_readings=candidate.get("highest_readings"))]
    evidence["publishable"] = evidence["admitted"] and not evidence["discrepancies"]
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true",
                        help="print the decisions and their evidence as JSON")
    args = parser.parse_args()

    print("=== Colorado Division of Water Resources, telemetry storage",
          file=sys.stderr)
    stations, scanned = fetch_storage_stations()
    print(f"  {scanned} station records scanned, {len(stations)} carry STORAGE",
          file=sys.stderr)

    buckets = classify(stations)
    print(f"  not reservoirs (recharge ponds and systems): "
          f"{len(buckets['not_reservoirs'])}", file=sys.stderr)
    for station in buckets["not_reservoirs"]:
        print(f"    {station['structureType']:<20} {station['abbrev']:<10}"
              f" {station['stationName']}", file=sys.stderr)
    print(f"  quiet for over a year: {len(buckets['quiet'])}", file=sys.stderr)
    for station in buckets["quiet"]:
        print(f"    {station['abbrev']:<10} {station['stationName']}"
              f"  (last reading {station['last_reading']})", file=sys.stderr)
    print(f"  already tracked: {len(buckets['already_tracked'])}", file=sys.stderr)
    for station in buckets["already_tracked"]:
        print(f"    {station['abbrev']:<10} {station['stationName']}"
              f"  (matched by {station['matched_by']})", file=sys.stderr)
    print(f"  outside the drawn areas: {len(buckets['outside'])}", file=sys.stderr)
    candidates = buckets["candidates"]
    print(f"  candidates: {len(candidates)}\n", file=sys.stderr)
    if not candidates:
        print("No candidates.", file=sys.stderr)
        return 0

    def report(remaining: int) -> None:
        if remaining < 100_000:
            print(f"  WARNING: only {remaining} quota rows remain today",
                  file=sys.stderr)

    print(f"  fetching daily history since {START_DATE} ...", file=sys.stderr)
    history = storage_history([c["abbrev"] for c in candidates], report=report)

    screened = []
    for candidate in candidates:
        found = history.get(candidate["abbrev"])
        if not found or not found["values"]:
            # Answered within the year at its station row, yet no daily rows
            # since 2015: a station that began reporting days ago. Reported,
            # not admitted -- a reservoir with a two-week record carries no
            # observed maximum to screen a capacity match with.
            print(f"    no history   {candidate['abbrev']:<10}"
                  f"{candidate['name']}", file=sys.stderr)
            continue
        seen = found["values"]
        candidate["observed_max_af"] = max(seen)
        candidate["highest_readings"] = sorted(seen, reverse=True)[:3]
        candidate["readings"] = len(seen)
        screened.append(candidate)
    if not screened:
        print("No candidates carry a usable history.", file=sys.stderr)
        return 0

    reachable = sorted({code for candidate in screened
                        for code in candidate["dam_states"]} | {"CO"})
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

    decisions = admit_all(screened, dams)
    rows = [review(candidate, decision)
            for candidate, decision in zip(screened, decisions)]

    if args.json:
        print(json.dumps({
            "scanned_records": scanned,
            "storage_stations": len(stations),
            "buckets": {key: len(value) for key, value in buckets.items()},
            "review": rows,
        }, indent=1))
        return 0

    header = (f"{'candidate':<32} {'abbrev':<10} {'area':<26} {'capacity':>11} "
              f"{'observed':>11} {'km':>6}  decision")
    print(header)
    print("-" * len(header))
    for row in rows:
        distance = (f"{row['match_distance_km']:.2f}"
                    if row.get("match_distance_km") is not None else "-")
        capacity = (f"{row['capacity_af']:,.0f}" if row.get("capacity_af") else "-")
        observed = f"{row['observed_max_af']:,.0f}"
        mark = ("admit " if row["publishable"]
                else "HOLD  " if row["admitted"] else "REFUSE")
        print(f"{row['name'][:31]:<32} {row['abbrev']:<10} "
              f"{row['huc6_name'][:25]:<26} {capacity:>11} {observed:>11} "
              f"{distance:>6}  {mark} "
              f"{'; '.join(d['screen'] for d in row['discrepancies']) or row['reason']}")

    admitted = sum(1 for row in rows if row["admitted"])
    publishable = sum(1 for row in rows if row["publishable"])
    print(f"\n{admitted} of {len(rows)} candidates are capacity-admissible "
          "against the dam inventory.")
    print(f"{publishable} of those {admitted} carry no disagreement and could "
          f"be published; {admitted - publishable} are held for review.")
    held = {}
    for row in rows:
        for found in row["discrepancies"]:
            held.setdefault(found["screen"], []).append(row["abbrev"])
    for screen, abbrevs in sorted(held.items(), key=lambda pair: -len(pair[1])):
        print(f"  {len(abbrevs):>3}  {screen}: {', '.join(sorted(abbrevs))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
