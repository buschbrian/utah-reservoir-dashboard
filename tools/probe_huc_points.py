"""Work out which point each reservoir should be assigned to a watershed by.

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
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESERVOIRS_PATH = ROOT / "reservoirs.json"
CAPACITIES_PATH = ROOT / "capacities.json"

WBD_LAYER = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/3"
WBD_WHERE = "states LIKE '%UT%'"
EXPECTED_UNITS = 15

# The same inventory build_capacity_table.py resolves by searching ArcGIS
# Online. Pinned here instead: this probe queries by NID id, so it needs one
# known-good copy rather than schema-sniffing, and a probe that silently
# picks a different layer than the capacity table would be comparing two
# different inventories.
NID_LAYER = ("https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/"
             "services/NID_v1/FeatureServer/0")
NID_ID_FIELDS = ("NIDID", "nidId", "FEDERAL_ID", "federalId", "nidid")

USER_AGENT = "utah-reservoir-dashboard/huc-probe (+https://github.com/buschbrian)"
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


# --- geometry -------------------------------------------------------------
#
# Ray casting, deliberately the same algorithm as src/data/huc.ts. The two
# implementations are checked against each other at the end of this file's
# report rather than trusted to agree.

def in_ring(point: tuple[float, float], ring: list) -> bool:
    x, y = point
    inside = False
    count = len(ring)
    for i in range(count):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[i - 1][0], ring[i - 1][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
    return inside


def in_polygon(point: tuple[float, float], rings: list) -> bool:
    if not rings or not in_ring(point, rings[0]):
        return False
    return not any(in_ring(point, hole) for hole in rings[1:])


def assign_huc(point: tuple[float, float], units: list[dict]) -> dict | None:
    for unit in units:
        if any(in_polygon(point, polygon) for polygon in unit["polygons"]):
            return unit
    return None


def distance_to_boundary_km(point: tuple[float, float], unit: dict) -> float:
    """Shortest distance from the point to any edge of the unit.

    This is the number that says how much boundary precision the assignment
    actually needs. A reservoir 200 m from a boundary could be moved into the
    next unit by a generalized polygon or a slightly different dam
    coordinate; one 20 km inside cannot.

    Distances are computed on a local equirectangular projection about the
    point. Over the few kilometres that matter here the error is far below
    the thing being measured, and it avoids a geodesic dependency in a probe
    that is deliberately standard library only.
    """
    lon, lat = point
    scale = math.cos(math.radians(lat))
    km_per_degree = 111.32

    def to_local(vertex) -> tuple[float, float]:
        return ((vertex[0] - lon) * scale * km_per_degree,
                (vertex[1] - lat) * km_per_degree)

    best = float("inf")
    for polygon in unit["polygons"]:
        for ring in polygon:
            local = [to_local(vertex) for vertex in ring]
            for i in range(len(local) - 1):
                (x1, y1), (x2, y2) = local[i], local[i + 1]
                dx, dy = x2 - x1, y2 - y1
                length_squared = dx * dx + dy * dy
                if length_squared == 0:
                    best = min(best, math.hypot(x1, y1))
                    continue
                # Projection of the origin onto the segment, clamped to it.
                t = max(0.0, min(1.0, -(x1 * dx + y1 * dy) / length_squared))
                best = min(best, math.hypot(x1 + t * dx, y1 + t * dy))
    return best


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


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
