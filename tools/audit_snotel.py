"""Audit active SNOTEL snow-water-equivalent sites in our drainage areas.

The published Phase 1.6 plan records live measurements. This tool makes the
station count and geographic assignment reproducible. Coordinates are scoped
with full-resolution federal HUC6 polygons because several sites are closer
to a drainage divide than the map boundary's generalization tolerance.
Provider HUC metadata is retained only as disagreement evidence.

    python tools/audit_snotel.py
    python tools/audit_snotel.py --scope upper-colorado
    python tools/audit_snotel.py --json
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from huc import assign_huc  # noqa: E402
from tools.audit_awdb_stations import AWDB_STATIONS, get_json  # noqa: E402
from tools.build_snotel_inventory import fetch_precise_units  # noqa: E402


def select_snotel(stations, units):
    """Return active SNTL stations whose coordinates fall in our polygons."""
    selected = []
    for station in stations:
        triplet = str(station.get("stationTriplet") or "")
        if not triplet.endswith(":SNTL"):
            continue
        lat, lon = station.get("latitude"), station.get("longitude")
        point = (lon, lat) if lon is not None and lat is not None else None
        unit = assign_huc(point, units) if point else None
        if not unit:
            continue
        provider_huc6 = str(station.get("huc") or "")[:6]
        selected.append({
            "name": str(station.get("name") or "").strip(),
            "station": triplet,
            "state": station.get("stateCode"),
            "lat": lat,
            "lon": lon,
            "huc6": unit["huc6"],
            "huc6_name": unit["name"],
            "huc6_from_station": provider_huc6,
            "agrees": provider_huc6 == unit["huc6"],
        })
    return sorted(selected, key=lambda site: (site["huc6"], site["name"]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--scope", choices=("utah-connected", "upper-colorado"),
                        default="utah-connected")
    args = parser.parse_args()

    units = fetch_precise_units(args.scope)
    stations = get_json(AWDB_STATIONS, {
        "stationTriplets": "*:*:SNTL",
        "elements": "WTEQ",
        "activeOnly": "true",
    })
    if not stations:
        print("ERROR: no SNOTEL stations returned", file=sys.stderr)
        return 1
    selected = select_snotel(stations, units)
    by_huc = {unit["huc6"]: 0 for unit in units}
    for site in selected:
        by_huc[site["huc6"]] += 1
    disagreements = sum(not site["agrees"] for site in selected)

    result = {
        "scope": args.scope,
        "query": {"stationTriplets": "*:*:SNTL", "elements": "WTEQ",
                  "activeOnly": True},
        "national_station_count": len(stations),
        "selected_station_count": len(selected),
        "metadata_huc_disagreements": disagreements,
        "by_huc6": by_huc,
        "stations": selected,
    }
    if args.json:
        print(json.dumps(result, indent=1))
        return 0

    print(f"{len(stations)} active SNOTEL sites with WTEQ returned nationally")
    print(f"{len(selected)} fall inside the full-resolution drainage-area polygons")
    print(f"{disagreements} provider-HUC disagreements retained for review\n")
    for unit in units:
        print(f"  {unit['huc6']}  {unit['name']:<32} {by_huc[unit['huc6']]:>3}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
