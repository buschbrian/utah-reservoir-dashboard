"""Find reservoir stations inside our drainage areas that we do not track.

ADR-009 fixes the geography: a site belongs here when it sits in one of the
fourteen six-digit hydrologic units that touch Utah. That rule is mechanical,
so the list of missing sites should be mechanical too, rather than hand-picked
from somebody's operating region.

The AWDB REST API this pipeline already calls carries reservoir storage for
the whole west on the same station triplets, with no key. This tool takes
every active storage station, keeps the ones whose drainage area is one of
ours, drops the ones already tracked, and reports what is left.

Two things worth knowing about that API:

  - `stateCds` is ignored. `?stateCds=CO`, `?stateCds=WY` and `?stateCds=UT`
    all return the identical national set. Filter in the client and assert the
    counts; this is the third service in this project to answer 200 and ignore
    a filter it does not support.
  - Station metadata carries a 12-digit `huc` and coordinates, but **no
    capacity**. That is the admission bottleneck: without a denominator a
    reservoir cannot join the percent-full totals, so each candidate still
    needs a National Inventory of Dams match it can survive.

    python tools/audit_awdb_stations.py
    python tools/audit_awdb_stations.py --json
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from huc import assign_huc, in_utah, load_units  # noqa: E402

# The same normalization build_capacity_table.py uses to match our names
# against a second agency's. Without it "Causey" and "Causey Reservoir" read
# as two different reservoirs, and the pass reports sites we already track.
NOISE = re.compile(r"\b(reservoir|lake|dam|and|no|number)\b", re.I)


def normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", NOISE.sub(" ", name or "").lower())


AWDB_STATIONS = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations"
USER_AGENT = "utah-reservoir-dashboard/awdb-audit (+https://github.com/buschbrian)"
TIMEOUT = 120


def get_json(url: str, params: dict):
    request = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(params)}", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"    !! {exc}", file=sys.stderr)
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    units = load_units()
    ours = {unit["huc6"]: unit["name"] for unit in units}

    payload = json.loads((ROOT / "reservoirs.json").read_text())
    tracked_ids = {str(r.get("source_station_id") or "") for r in payload["reservoirs"]}
    tracked_names = {normalize(r["name"]) for r in payload["reservoirs"]}

    stations = get_json(AWDB_STATIONS, {
        "stateCds": "UT", "elements": "RESC", "activeOnly": "true"})
    if not stations:
        print("ERROR: no stations returned", file=sys.stderr)
        return 1
    print(f"{len(stations)} active storage stations returned "
          "(the state filter is ignored; this is the national set)\n")

    candidates, outside, already = [], 0, 0
    for station in stations:
        triplet = str(station.get("stationTriplet") or "")
        name = str(station.get("name") or "").strip()
        huc12 = str(station.get("huc") or "")
        huc6 = huc12[:6]
        if huc6 not in ours:
            outside += 1
            continue
        if triplet in tracked_ids or normalize(name) in tracked_names:
            already += 1
            continue

        lat, lon = station.get("latitude"), station.get("longitude")
        point = (lon, lat) if lon is not None and lat is not None else None
        # The station's own HUC and our polygons should agree. Where they do
        # not, the coordinate is the one to trust for a map and the mismatch
        # is worth seeing rather than silently preferring one.
        geometric = assign_huc(point, units) if point else None
        candidates.append({
            "name": name,
            "station": triplet,
            "state": station.get("stateCode"),
            "county": station.get("countyName"),
            "huc6_from_station": huc6,
            "huc6_name": ours[huc6],
            "huc6_from_point": geometric["huc6"] if geometric else None,
            "agrees": bool(geometric and geometric["huc6"] == huc6),
            "in_utah": in_utah(point) if point else None,
            "lat": lat, "lon": lon,
            "begins": station.get("beginDate"),
        })

    candidates.sort(key=lambda c: (c["huc6_from_station"], c["name"]))
    if args.json:
        print(json.dumps({"candidates": candidates}, indent=1))
        return 0

    print(f"{already} already tracked, {outside} outside our drainage areas, "
          f"{len(candidates)} candidates.\n")
    print(f"{'reservoir':<34} {'station':<20} {'st':<3} {'area':<28} agree")
    for c in candidates:
        print(f"{c['name'][:33]:<34} {c['station']:<20} {c['state']:<3} "
              f"{c['huc6_name'][:27]:<28} {'yes' if c['agrees'] else 'NO'}")

    by_state = {}
    for c in candidates:
        by_state[c["state"]] = by_state.get(c["state"], 0) + 1
    print("\nBy state: " + ", ".join(f"{k} {v}" for k, v in sorted(by_state.items())))

    by_area = {}
    for c in candidates:
        by_area.setdefault(c["huc6_name"], []).append(c["name"])
    print("\nBy drainage area:")
    for unit in units:
        found = by_area.get(unit["name"], [])
        tracked_here = sum(1 for r in payload["reservoirs"] if r.get("huc6") == unit["huc6"])
        print(f"  {unit['huc6']}  {unit['name']:<30} tracked {tracked_here:>2}, "
              f"candidates {len(found):>2}")

    print("\nNone of these can be added on this evidence alone: AWDB publishes "
          "no capacity, and without a denominator a reservoir cannot join the "
          "percent-full totals. Each still needs a National Inventory of Dams "
          "match that survives the observed-storage check.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
