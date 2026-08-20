"""Work out which point each reservoir should be assigned to a watershed by.

Superseded rather than required: its answer is recorded in ADR-005 and the
dam points it argued for are committed (tools/add_dam_points.py). Kept for
re-running the measurement when a new provider point looks suspect.

Phase 1.5 says a reservoir belongs to the six-digit hydrologic unit that
contains its *dam or outlet* point, not the centre of its water polygon,
because a large reservoir can span a boundary and the assignment is meant to
answer "where does the stored water leave?".

We do not currently have dam points. `reservoirs.json` carries one lat/lon
per reservoir, hand-copied from a RISE catalog record or an AWDB station, and
nobody has checked what those coordinates actually describe. This tool checks
it, and answers the question the plan cannot answer from a desk:

  1. How far is each published point from the dam the capacity came from?
     `capacities.json` records a `nid_id` for 28 reservoirs, so the National
     Inventory of Dams can be queried directly by id -- no name matching, and
     therefore none of the risk that made build_capacity_table.py careful.
  2. Does the difference change the HUC6 assignment for any reservoir? If it
     changes none of them, the rule still stands but nothing is at stake
     today, and the refresh job can ship the published points now and add dam
     points as a later correctness improvement rather than a blocker.

Standard library only, on purpose: this is a probe, it runs rarely, and it
should not need the pandas/numpy stack the refresh job needs.

    python tools/probe_huc_points.py            # full report
    python tools/probe_huc_points.py --json     # machine-readable
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from huc import (  # noqa: E402
    assign_huc, distance_to_boundary_km, haversine_km,
)

RESERVOIRS_PATH = ROOT / "reservoirs.json"
CAPACITIES_PATH = ROOT / "capacities.json"

WBD_LAYER = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/3"
WBD_WHERE = "states LIKE '%UT%'"
EXPECTED_UNITS = 14

# The same inventory build_capacity_table.py reads, and now the same pinned
# service: both point at the agency that maintains it. That was the reason
# this constant was written out by hand in the first place -- a probe reading
# a different copy of the inventory than the capacity table would be
# comparing two things and reporting it as one.
NID_LAYER = ("https://geospatial.sec.usace.army.mil/dls/rest/services/NID/"
             "National_Inventory_of_Dams_Public_Service/FeatureServer/0")
NID_ID_FIELDS = ("NIDID", "nidId", "FEDERAL_ID", "federalId", "nidid")

USER_AGENT = "western-water-dashboard/huc-probe (+https://github.com/buschbrian)"
TIMEOUT = 90


def get_json(url: str, params: dict) -> dict | None:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(f"{url}?{query}", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"    !! {exc}", file=sys.stderr)
        return None
    # An ArcGIS service reports its own failures with HTTP 200 and an
    # `error` body, so a status check alone would call this a success.
    if isinstance(payload, dict) and payload.get("error"):
        print(f"    !! service error: {payload['error'].get('message')}", file=sys.stderr)
        return None
    return payload


# --- sources --------------------------------------------------------------

def fetch_units() -> list[dict]:
    payload = get_json(f"{WBD_LAYER}/query", {
        "where": WBD_WHERE, "outFields": "huc6,name,states",
        "returnGeometry": "true", "outSR": "4326",
        "geometryPrecision": "5", "f": "geojson",
    })
    features = [f for f in (payload or {}).get("features", [])
                if f.get("geometry") and f.get("properties", {}).get("huc6")]
    units = []
    for feature in features:
        geometry = feature["geometry"]
        coordinates = geometry["coordinates"]
        polygons = coordinates if geometry["type"] == "MultiPolygon" else [coordinates]
        units.append({
            "huc6": feature["properties"]["huc6"],
            "name": feature["properties"]["name"],
            "states": feature["properties"].get("states", ""),
            "polygons": polygons,
        })
    return sorted(units, key=lambda unit: unit["huc6"])


def fetch_dam_points(nid_ids: list[str]) -> dict[str, tuple[float, float]]:
    """Dam coordinates keyed by NID id, queried by id rather than by name."""
    info = get_json(NID_LAYER, {"f": "json"}) or {}
    available = {field["name"] for field in info.get("fields") or []}
    id_field = next((name for name in NID_ID_FIELDS if name in available), None)
    if id_field is None:
        print(f"    !! no NID id field on {NID_LAYER}; saw {sorted(available)[:12]}",
              file=sys.stderr)
        return {}

    points: dict[str, tuple[float, float]] = {}
    # Chunked so the `where` clause cannot outgrow the service's URL limit.
    for start in range(0, len(nid_ids), 40):
        chunk = nid_ids[start:start + 40]
        quoted = ",".join(f"'{value}'" for value in chunk)
        payload = get_json(f"{NID_LAYER}/query", {
            "where": f"{id_field} IN ({quoted})", "outFields": id_field,
            "returnGeometry": "true", "outSR": "4326", "f": "json",
        })
        for feature in (payload or {}).get("features", []):
            geometry = feature.get("geometry") or {}
            key = (feature.get("attributes") or {}).get(id_field)
            if key and geometry.get("x") is not None:
                points[key] = (geometry["x"], geometry["y"])
    return points


# --- report ---------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true",
                        help="print the findings as JSON and nothing else")
    args = parser.parse_args()

    reservoirs = json.loads(RESERVOIRS_PATH.read_text())["reservoirs"]
    capacities = json.loads(CAPACITIES_PATH.read_text())["capacities"]

    units = fetch_units()
    if len(units) != EXPECTED_UNITS:
        print(f"ERROR: expected {EXPECTED_UNITS} units touching Utah, got {len(units)}",
              file=sys.stderr)
        return 1

    nid_ids = sorted({entry["nid_id"] for entry in capacities.values()
                      if entry.get("nid_id")})
    dam_points = fetch_dam_points(nid_ids)

    rows = []
    for reservoir in reservoirs:
        name = reservoir["name"]
        published = (reservoir["lon"], reservoir["lat"])
        nid_id = (capacities.get(name) or {}).get("nid_id")
        dam = dam_points.get(nid_id) if nid_id else None

        published_unit = assign_huc(published, units)
        dam_unit = assign_huc(dam, units) if dam else None
        rows.append({
            "name": name,
            "source_key": reservoir["source_key"],
            "published_point": published,
            "published_huc6": published_unit["huc6"] if published_unit else None,
            "published_huc6_name": published_unit["name"] if published_unit else None,
            "nid_id": nid_id,
            "dam_point": dam,
            "dam_huc6": dam_unit["huc6"] if dam_unit else None,
            "km_from_dam": round(haversine_km(published, dam), 3) if dam else None,
            "km_to_boundary": (round(distance_to_boundary_km(published, published_unit), 3)
                               if published_unit else None),
            "disagrees": bool(dam_unit and published_unit
                              and dam_unit["huc6"] != published_unit["huc6"]),
        })

    if args.json:
        print(json.dumps({"units": [{k: unit[k] for k in ("huc6", "name", "states")}
                                    for unit in units],
                          "reservoirs": rows}, indent=1))
        return 0

    print(f"{len(units)} hydrologic units touching Utah, "
          f"{len(dam_points)}/{len(nid_ids)} dam points resolved from the inventory.\n")

    unassigned = [row for row in rows if row["published_huc6"] is None]
    disagree = [row for row in rows if row["disagrees"]]
    measured = [row for row in rows if row["km_from_dam"] is not None]

    print(f"{'reservoir':<22} {'src':<5} {'HUC6':<8} {'km from dam':>11} "
          f"{'km to edge':>10}  unit")
    for row in sorted(rows, key=lambda r: (r["published_huc6"] or "zzz", r["name"])):
        distance = f"{row['km_from_dam']:.2f}" if row["km_from_dam"] is not None else "-"
        edge = f"{row['km_to_boundary']:.2f}" if row["km_to_boundary"] is not None else "-"
        flag = "  <-- DIFFERENT UNIT" if row["disagrees"] else ""
        print(f"{row['name']:<22} {row['source_key']:<5} "
              f"{row['published_huc6'] or 'NONE':<8} {distance:>11} {edge:>10}  "
              f"{row['published_huc6_name'] or ''}{flag}")

    print()
    edges = sorted((row["km_to_boundary"], row["name"]) for row in rows
                   if row["km_to_boundary"] is not None)
    if edges:
        print(f"Distance to the nearest unit boundary: median {edges[len(edges) // 2][0]:.2f} km, "
              f"closest {edges[0][0]:.2f} km ({edges[0][1]}).")
        tight = [f"{name} {km:.2f} km" for km, name in edges if km < 2]
        print("  Within 2 km of a boundary: " + (", ".join(tight) if tight else "none"))
    if measured:
        distances = sorted(row["km_from_dam"] for row in measured)
        worst = max(measured, key=lambda row: row["km_from_dam"])
        print(f"Distance from the dam, over {len(measured)} reservoirs with a NID id: "
              f"median {distances[len(distances) // 2]:.2f} km, "
              f"worst {worst['km_from_dam']:.2f} km ({worst['name']}).")
    print(f"Unassigned by the published point: {len(unassigned)}"
          + (f" -- {', '.join(row['name'] for row in unassigned)}" if unassigned else ""))
    print(f"Reservoirs whose unit changes if the dam point is used: {len(disagree)}"
          + (f" -- {', '.join(row['name'] for row in disagree)}" if disagree else ""))

    by_unit: dict[str, list[str]] = {}
    for row in rows:
        by_unit.setdefault(row["published_huc6"] or "unassigned", []).append(row["name"])
    print("\nReservoirs per unit:")
    for unit in units:
        members = by_unit.get(unit["huc6"], [])
        print(f"  {unit['huc6']}  {unit['name']:<32} {len(members):>2}  "
              f"{', '.join(members)}")
    if "unassigned" in by_unit:
        print(f"  ------  {'unassigned':<32} {len(by_unit['unassigned']):>2}  "
              f"{', '.join(by_unit['unassigned'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
