"""Build the reviewed snow monitoring site inventory.

The map boundary is generalized to about 500 metres. That is safe for the
reservoirs, but three snow sites sit within 65 metres of a divide. This tool
therefore downloads the same fourteen six-digit hydrologic units without a
generalization offset, assigns every active automated snow site by point, and
writes the small station inventory rather than committing the large geometry.

Run this deliberately when reviewing station membership; the daily data
refresh reads the committed result and does not silently add or remove sites.

    python tools/build_snotel_inventory.py
    python tools/build_snotel_inventory.py --dry-run
"""

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from huc import assign_huc, units_from_collection  # noqa: E402
from tools.audit_awdb_stations import AWDB_STATIONS, USER_AGENT  # noqa: E402
from tools.fetch_watershed_scope import (  # noqa: E402
    ArcGISRestClient,
    WBD_LAYER,
    normalize_collection,
)
from watershed_scopes import get_scope, load_scope_units  # noqa: E402

OUTPUT = ROOT / "snow_sites.json"
TIMEOUT = 120
NORMAL_PERIOD = {"start_year": 1991, "end_year": 2020}


def fetch_station_catalog(session=None) -> list[dict]:
    session = session or requests.Session()
    response = session.get(
        AWDB_STATIONS,
        params={
            "stationTriplets": "*:*:SNTL",
            "elements": "WTEQ",
            "activeOnly": "true",
        },
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    stations = response.json()
    if not isinstance(stations, list) or not stations:
        raise RuntimeError("station catalog returned no automated snow sites")
    return stations


def fetch_precise_units(scope_name: str, session=None) -> list[dict]:
    scope = get_scope(scope_name)
    collection = ArcGISRestClient(WBD_LAYER, session=session).query(
        scope,
        geometry_precision="6",
        max_allowable_offset=None,
    )
    normalized, _ = normalize_collection(collection, scope)
    return units_from_collection(normalized)


def _site(station: dict, unit: dict) -> dict:
    return {
        "station": str(station["stationTriplet"]),
        "name": str(station.get("name") or "").strip(),
        "state": station.get("stateCode"),
        "county": station.get("countyName"),
        "lat": station.get("latitude"),
        "lon": station.get("longitude"),
        "elevation_feet": station.get("elevation"),
        "begins": str(station.get("beginDate") or "")[:10] or None,
        "huc6": unit["huc6"],
        "huc6_name": unit["name"],
        "provider_huc6": str(station.get("huc") or "")[:6] or None,
    }


def build_inventory(stations: list[dict], precise_units: list[dict],
                    generalized_units: list[dict], *, scope_name: str) -> dict:
    """Build a deterministic inventory and record every precision-sensitive site."""
    sites = []
    assignment_review = []
    provider_disagreements = []

    for station in stations:
        triplet = str(station.get("stationTriplet") or "")
        if not triplet.endswith(":SNTL"):
            continue
        lat, lon = station.get("latitude"), station.get("longitude")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            continue
        point = (lon, lat)
        precise = assign_huc(point, precise_units)
        generalized = assign_huc(point, generalized_units)
        precise_huc6 = precise["huc6"] if precise else None
        generalized_huc6 = generalized["huc6"] if generalized else None

        if precise_huc6 != generalized_huc6 and (precise or generalized):
            assignment_review.append({
                "station": triplet,
                "name": str(station.get("name") or "").strip(),
                "full_resolution_huc6": precise_huc6,
                "generalized_huc6": generalized_huc6,
            })
        if not precise:
            continue

        site = _site(station, precise)
        if site["provider_huc6"] != site["huc6"]:
            provider_disagreements.append({
                "station": triplet,
                "name": site["name"],
                "full_resolution_huc6": site["huc6"],
                "provider_huc6": site["provider_huc6"],
            })
        sites.append(site)

    sites.sort(key=lambda site: (site["huc6"], site["name"], site["station"]))
    assignment_review.sort(key=lambda item: item["station"])
    provider_disagreements.sort(key=lambda item: item["station"])
    if len({site["station"] for site in sites}) != len(sites):
        raise ValueError("station catalog contains duplicate triplets")

    by_huc6 = {unit["huc6"]: 0 for unit in precise_units}
    for site in sites:
        by_huc6[site["huc6"]] += 1
    empty = [huc6 for huc6, count in by_huc6.items() if count == 0]
    if empty:
        raise ValueError(f"no snow sites found in drainage areas: {', '.join(empty)}")

    return {
        "schema_version": 1,
        "scope": scope_name,
        "normal_period": NORMAL_PERIOD,
        "selection": {
            "network": "SNTL",
            "element": "WTEQ",
            "active_only": True,
            "watershed_geometry": "full_resolution",
        },
        "sources": {
            "stations": AWDB_STATIONS,
            "watersheds": WBD_LAYER,
            "normal_period": (
                "https://www.nrcs.usda.gov/resources/data-and-reports/"
                "climatic-and-hydrologic-normals"
            ),
        },
        "site_count": len(sites),
        "by_huc6": by_huc6,
        "assignment_review": assignment_review,
        "provider_huc_disagreements": provider_disagreements,
        "sites": sites,
    }


def validate_inventory(payload: dict) -> None:
    sites = payload.get("sites")
    if not isinstance(sites, list) or not sites:
        raise ValueError("snow site inventory is empty")
    if payload.get("site_count") != len(sites):
        raise ValueError("site_count does not match the station list")
    stations = [site.get("station") for site in sites]
    if len(stations) != len(set(stations)):
        raise ValueError("snow site inventory has duplicate station triplets")
    counted = {huc6: 0 for huc6 in payload.get("by_huc6", {})}
    for site in sites:
        required = ("station", "name", "lat", "lon", "huc6", "huc6_name")
        if any(site.get(field) in (None, "") for field in required):
            raise ValueError(f"incomplete snow site: {site!r}")
        if site["huc6"] not in counted:
            raise ValueError(f"site uses unknown drainage area {site['huc6']}")
        counted[site["huc6"]] += 1
    if counted != payload["by_huc6"]:
        raise ValueError("by_huc6 does not match the station list")


def write_atomic(path: Path, payload: dict) -> bool:
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n"
    before = path.read_text(encoding="utf-8") if path.exists() else None
    if before == body:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(body)
        os.replace(temporary, path)
        os.chmod(path, 0o644)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", default="utah-connected",
                        choices=("utah-connected", "upper-colorado"))
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    session = requests.Session()
    stations = fetch_station_catalog(session)
    precise_units = fetch_precise_units(args.scope, session)
    generalized_units = load_scope_units(args.scope)
    payload = build_inventory(
        stations, precise_units, generalized_units, scope_name=args.scope)
    validate_inventory(payload)

    print(f"{payload['site_count']} active automated snow sites verified")
    for huc6, count in payload["by_huc6"].items():
        print(f"  {huc6}: {count}")
    for review in payload["assignment_review"]:
        print(
            f"  precision review: {review['name']} "
            f"{review['generalized_huc6']} -> {review['full_resolution_huc6']}"
        )
    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    changed = write_atomic(args.output, payload)
    print(f"{args.output} " + ("written." if changed else "unchanged."))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
