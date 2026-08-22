"""Probe: which reservoirs would move county if counties followed the dam.

The drainage assignment is made at the dam, because a drainage area is where
the stored water leaves. The county assignment is deliberately made at the
published waterbody point (ADR-058): Glen Canyon Dam is in Coconino County,
Arizona, and the lake a Utah reader asks about is in San Juan County, Utah.
`OPEN-BACKLOG-SCOPING.md` left open how many reservoirs would move if
counties followed the drainage rule instead. This probe measures it.

It reads the reviewed dam points from `capacities.json` -- the same points the
upstream trace starts from -- assigns each against the same full-resolution
Census-counties service `build_county_assignments.py` used for the committed
file (so the diff measures the two points, not two sources), and diffs the
answer against `counties.json`.

A probe prints and writes nothing. The committed assignments do not change
here whatever the diff says; reopening ADR-058 is a decision, not a side
effect of a measurement.

    python tools/probe_county_dam_point.py

Only stations with a reviewed dam point can be asked; that subset is reported
as what it is.
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

COUNTY_LAYER = ("https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/"
                "services/USA_Census_Counties/FeatureServer/0")
FIELDS = "FIPS,NAME,STATE_ABBR"
USER_AGENT = ("western-water-dashboard/county-dam-probe "
              "(+https://github.com/buschbrian)")
TIMEOUT = 60
POLITENESS_SECONDS = 0.1


def county_at(lon: float, lat: float) -> list[dict]:
    """Every county whose full-resolution polygon contains the point."""
    request = urllib.request.Request(
        f"{COUNTY_LAYER}/query",
        data=urllib.parse.urlencode({
            "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint",
            "inSR": "4326", "spatialRel": "esriSpatialRelIntersects",
            "outFields": FIELDS, "returnGeometry": "false", "f": "json",
        }).encode(),
        headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"    !! {exc}", file=sys.stderr)
        return []
    if isinstance(payload, dict) and payload.get("error"):
        print(f"    !! service error: {payload['error'].get('message')}",
              file=sys.stderr)
        return []
    return [f["attributes"] for f in (payload or {}).get("features") or []]


def main() -> int:
    capacities = json.loads(
        (ROOT / "capacities.json").read_text(encoding="utf-8"))["capacities"]
    counties = json.loads(
        (ROOT / "counties.json").read_text(encoding="utf-8"))["counties"]

    dams = {station: entry for station, entry in capacities.items()
            if entry.get("dam_lon") is not None
            and entry.get("dam_lat") is not None}
    print(f"{len(capacities)} reviewed capacity records, "
          f"{len(dams)} with a dam point", file=sys.stderr)

    moved: list[tuple[str, dict, dict]] = []
    unresolved: list[str] = []
    for station, entry in sorted(dams.items(), key=lambda kv: kv[1]["name"]):
        name = entry["name"]
        found = county_at(entry["dam_lon"], entry["dam_lat"])
        if not found:
            unresolved.append(f"{name}: no county contains the dam point")
            continue
        if len(found) > 1:
            names = ", ".join(a["NAME"] for a in found)
            unresolved.append(f"{name}: dam point on a boundary ({names})")
            continue
        dam = {"county_fips": found[0]["FIPS"],
               "county_name": found[0]["NAME"],
               "state": found[0]["STATE_ABBR"]}
        water = counties.get(station)
        if water is None:
            unresolved.append(f"{name}: no committed waterbody-point county")
            continue
        if dam["county_fips"] == water["county_fips"]:
            print(f"  {name:<34} same ({dam['county_name']}, {dam['state']})",
                  file=sys.stderr)
        else:
            moved.append((name, water, dam))
            print(f"  {name:<34} MOVES  {water['county_name']}, "
                  f"{water['state']} -> {dam['county_name']}, {dam['state']}"
                  f"  [{station}]", file=sys.stderr)
        time.sleep(POLITENESS_SECONDS)

    print(f"\n{len(dams)} dam points asked; "
          f"{len(moved)} would move county, "
          f"{len(dams) - len(moved) - len(unresolved)} would not.")
    for problem in unresolved:
        print(f"    !! {problem}")
    if moved:
        print("\nWould move under the drainage rule:")
        for name, water, dam in moved:
            print(f"  {name:<34} {water['county_name']}, {water['state']} -> "
                  f"{dam['county_name']}, {dam['state']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
