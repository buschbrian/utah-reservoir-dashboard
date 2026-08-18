"""Decide which candidate reservoirs could be published, and show the evidence.

`audit_awdb_stations.py` answers "which storage stations sit in our drainage
areas and are not tracked?". It stops there, because a reservoir also needs a
capacity, and the storage service publishes none. This tool takes that list,
finds each candidate's dam in the National Inventory of Dams, and applies the
admission rules in `admission.py`.

The rules live in that module and are unit tested. This tool only fetches, and
prints what the rules decided. It writes nothing to the published data.

    python tools/audit_candidate_capacity.py
    python tools/audit_candidate_capacity.py --json > candidates.json

Two things worth knowing about the services:

  - The dam inventory is the USACE public NID service. Its schema is resolved
    at runtime so a documented field rename fails visibly.
  - The states searched matter. A dam outside them cannot be matched, and the
    rules then refuse the reservoir rather than take a distant dam with the
    right-looking name. Lake Mead is the live example: Hoover Dam is in
    Nevada.
"""

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from admission import admit_all, positive  # noqa: E402
from tools.audit_awdb_stations import find_candidates  # noqa: E402
from watershed_scopes import (  # noqa: E402
    DEFAULT_SCOPE, SCOPES, load_scope_units,
)

AWDB_DATA = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data"
NID_LAYER = ("https://geospatial.sec.usace.army.mil/dls/rest/services/NID/"
             "National_Inventory_of_Dams_Public_Service/FeatureServer/0")
USER_AGENT = "utah-reservoir-dashboard/candidate-audit (+https://github.com/buschbrian)"
TIMEOUT = 180
START_DATE = "2015-01-01"

# Every state a dam in one of our drainage areas can be in. Nevada is here for
# Hoover Dam; whether Lake Mead is published at all is a separate question.
#: Postal codes to the names the inventory files dams under.
#:
#: The states to fetch are the states the candidates are in, not a list
#: written down here. The list that used to be here was the seven interior
#: states, which was right for a Utah-connected scope and silently wrong for
#: a western one: every Oregon, Washington and California candidate was
#: refused as "no dam close enough to confirm" when the truth was that its
#: dam had never been fetched. A refusal that means "not looked for" reads
#: exactly like a refusal that means "looked for and not found".
STATE_NAMES = {
    "AZ": "Arizona", "CA": "California", "CO": "Colorado", "ID": "Idaho",
    "KS": "Kansas", "MT": "Montana", "ND": "North Dakota", "NE": "Nebraska",
    "NM": "New Mexico", "NV": "Nevada", "OK": "Oklahoma", "OR": "Oregon",
    "SD": "South Dakota", "TX": "Texas", "UT": "Utah", "WA": "Washington",
    "WY": "Wyoming",
}

FIELD_OPTIONS = {
    "name": ("damname", "name", "officialname", "damnameofficial", "dam"),
    "normal_storage_af": ("normalstorage", "normalstor", "conservationstorage", "normal"),
    "max_storage_af": ("maxstorage", "maximumstorage", "maxstor"),
    "nid_storage_af": ("nidstorage", "nidstor"),
    "state": ("state", "statename", "stateabbr", "stateabbreviation"),
    "nid_id": ("nidid", "federalid", "nididnumber"),
}

NOISE = re.compile(r"\b(reservoir|lake|dam|and|no|number)\b", re.I)


def normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", NOISE.sub(" ", name or "").lower())


def get_json(url: str, params: dict):
    request = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(params, doseq=True)}",
        headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - an audit reports and continues
        print(f"    !! {exc}", file=sys.stderr)
        return None


#: Stations per AWDB request.
#:
#: The triplets travel in the query string, so the request length grows with
#: the roster. Asking for all 278 western candidates at once returns HTTP 400
#: -- the same shape of failure as the 414 that the HUC-8 boundary fetch hit
#: with 1,247 object ids. `refresh_snowpack.py` batches at 75 against the same
#: service, so this does too rather than inventing a second number.
BATCH_SIZE = 75


def observed_maxima(candidates: list[dict]) -> dict:
    """The most water each candidate has been seen to hold since 2015."""
    stations = [c["station"] for c in candidates]
    seen: dict[str, float] = {}
    for duration in ("DAILY", "MONTHLY"):
        answered = 0
        for start in range(0, len(stations), BATCH_SIZE):
            batch = stations[start:start + BATCH_SIZE]
            params = {"stationTriplets": ",".join(batch), "elements": "RESC",
                      "duration": duration, "beginDate": START_DATE,
                      "endDate": "2100-01-01"}
            payload = None
            for _attempt in range(3):
                payload = get_json(AWDB_DATA, params)
                if payload is not None:
                    break
            if payload is None:
                raise RuntimeError(
                    f"AWDB {duration} query failed for stations "
                    f"{start}-{start + len(batch)}; partial data refused")
            answered += len(payload)
            for entry in payload:
                for series in entry.get("data", []):
                    values = [v["value"] for v in series.get("values", [])
                              if v.get("value") is not None]
                    if values:
                        triplet = entry["stationTriplet"]
                        seen[triplet] = max(seen.get(triplet, 0), max(values))
        # Asking for n stations and receiving fewer is a fact worth printing:
        # a silent shortfall reads as "these reservoirs have no data".
        print(f"  {duration}: {answered} of {len(candidates)} stations answered",
              file=sys.stderr)
    return seen


def dam_field_map(info: dict) -> dict:
    actual = {f["name"].lower().replace("_", ""): f["name"]
              for f in (info.get("fields") or [])}
    resolved = {}
    for key, options in FIELD_OPTIONS.items():
        for option in options:
            if option in actual:
                resolved[key] = actual[option]
                break
    return resolved


def dam_states(candidates: list[dict]) -> list[str]:
    """The states the candidates are actually in.

    An unknown postal code is reported rather than dropped: a candidate whose
    state cannot be mapped would otherwise be refused for the invisible
    reason above.
    """
    codes = sorted({(candidate.get("state") or "").upper() for candidate in candidates})
    unknown = [code for code in codes if code and code not in STATE_NAMES]
    if unknown:
        print(f"  no inventory state name for {', '.join(unknown)}; their dams "
              "will not be fetched", file=sys.stderr)
    return sorted({STATE_NAMES[code] for code in codes if code in STATE_NAMES})


def find_dam_layer(states: list[str]):
    fields = dam_field_map(get_json(NID_LAYER, {"f": "json"}) or {})
    if not (fields.get("name") and fields.get("state")):
        return None, None, None, None
    where = f"{fields['state']} IN ({','.join(repr(s) for s in states)})"
    count = get_json(f"{NID_LAYER}/query",
                     {"f": "json", "where": where, "returnCountOnly": "true"})
    if (count or {}).get("count", 0) <= 500:
        return None, None, None, None
    print(f"dam layer: official USACE NID, {count['count']} dams", file=sys.stderr)
    return NID_LAYER, fields, where, count["count"]


def fetch_dams(layer_url: str, fields: dict, where: str) -> list[dict]:
    dams, offset = [], 0
    while True:
        params = {"f": "json", "where": where, "outFields": "*",
                  "returnGeometry": "true", "outSR": 4326,
                  "resultOffset": offset, "resultRecordCount": 1000}
        page = None
        for _attempt in range(3):
            page = get_json(f"{layer_url}/query", params)
            if page is not None:
                break
        if page is None:
            raise RuntimeError(f"NID query failed at result offset {offset}; partial data refused")
        features = (page or {}).get("features") or []
        for feature in features:
            attributes = feature.get("attributes", {})
            geometry = feature.get("geometry") or {}
            if geometry.get("x") is None:
                continue
            dams.append({
                # The inventory pads its name field with spaces.
                "name": str(attributes.get(fields["name"]) or "").strip(),
                "lon": geometry["x"], "lat": geometry["y"],
                "normal_storage_af": positive(attributes.get(fields.get("normal_storage_af"))),
                "max_storage_af": positive(attributes.get(fields.get("max_storage_af"))),
                "nid_storage_af": positive(attributes.get(fields.get("nid_storage_af"))),
                "nid_id": attributes.get(fields.get("nid_id")),
                "state": attributes.get(fields["state"]),
            })
        if len(features) < 1000:
            break
        offset += 1000
    return dams


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="print the evidence as JSON")
    # Every registered scope, not a list written down twice.
    # `watershed_scopes.py` is the one place that decides which geographies
    # exist; a tool with its own copy of that list stops offering the newest
    # one the moment somebody adds it.
    parser.add_argument("--scope", choices=tuple(sorted(SCOPES)),
                        default=DEFAULT_SCOPE)
    args = parser.parse_args()

    # The same list audit_awdb_stations.py prints, so the two tools cannot
    # disagree about what a candidate is.
    candidates, info = find_candidates(load_scope_units(args.scope))
    if not candidates:
        print("no candidates", file=sys.stderr)
        return 1
    print(f"{info['stations']} storage stations, {info['tracked']} already tracked, "
          f"{info['outside']} outside our drainage areas, {len(candidates)} candidates",
          file=sys.stderr)
    try:
        seen = observed_maxima(candidates)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    for candidate in candidates:
        candidate["observed_max_af"] = seen.get(candidate["station"])

    states = dam_states(candidates)
    print(f"  fetching dams for {len(states)} state(s): {', '.join(states)}",
          file=sys.stderr)
    layer_url, fields, where, expected_dams = find_dam_layer(states)
    if not layer_url:
        print("ERROR: no dam inventory found with a usable schema", file=sys.stderr)
        return 1
    try:
        dams = fetch_dams(layer_url, fields, where)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    if expected_dams is not None and len(dams) != expected_dams:
        print(f"ERROR: NID returned {len(dams)} of {expected_dams} dams; "
              "partial data refused", file=sys.stderr)
        return 1
    print(f"{len(dams)} dams with coordinates\n", file=sys.stderr)

    decisions = admit_all(candidates, dams)
    if args.json:
        print(json.dumps([dict(decision.evidence(),
                               station=candidate["station"], state=candidate["state"],
                               huc6=candidate["huc6_from_station"],
                               observed_max_af=candidate.get("observed_max_af"))
                          for candidate, decision in zip(candidates, decisions)], indent=1))
        return 0

    header = (f"{'candidate':<32} {'st':<3} {'area':<28} {'capacity':>11} "
              f"{'observed':>11} {'km':>6}  decision")
    print(header)
    print("-" * len(header))
    admitted = 0
    for candidate, decision in zip(candidates, decisions):
        admitted += decision.admitted
        distance = f"{decision.match.distance_km:.2f}" if decision.match else "-"
        capacity = f"{decision.capacity_af:,.0f}" if decision.capacity_af else "-"
        observed = (f"{candidate['observed_max_af']:,.0f}"
                    if candidate.get("observed_max_af") else "-")
        mark = "admit " if decision.admitted else "REFUSE"
        print(f"{candidate['name'][:31]:<32} {candidate['state']:<3} "
              f"{candidate['huc6_name'][:27]:<28} {capacity:>11} {observed:>11} "
              f"{distance:>6}  {mark} {decision.reason}")

    print(f"\n{admitted} of {len(candidates)} candidates are capacity-admissible.")
    print("Every admission carries its dam name, inventory identifier and match "
          "distance; run with --json to see them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
