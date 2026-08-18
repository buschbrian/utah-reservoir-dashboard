"""Add each dam's coordinates to capacities.json.

Watershed assignment is supposed to use the point where the stored water
*leaves* a reservoir -- the dam or outlet -- because a large reservoir can
span a drainage divide and only one of those answers is meaningful. The
published `lat`/`lon` on each record is not that point: it is a lake point
copied from a RISE catalog record or an AWDB station, a median of 1.08 km
from the dam and, for Lake Powell, 20.87 km away.

`capacities.json` already records the NID id of the dam each capacity came
from, so the coordinates can be fetched **by id** -- no name matching, and
therefore none of the risk that made build_capacity_table.py careful about
attaching the wrong dam.

Committed rather than fetched at refresh time, for the same reason as the
capacities themselves and the watershed boundaries: an assignment that can
change underneath you is not reproducible.

    python tools/add_dam_points.py --dry-run   # report, write nothing
    python tools/add_dam_points.py             # update capacities.json

Superseded, and kept only for repair. `tools/build_capacity_table.py` writes
`dam_lon` and `dam_lat` itself now: it fetches the geometry to match on
position, so the coordinates are already in hand and a second pass over the
same rows can only disagree with the first. Running this after that tool
rewrites the same fields from a second query, which is the arrangement that
lets two files describe one dam differently.
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
from huc import assign_huc, haversine_km, load_units  # noqa: E402

CAPACITIES_PATH = ROOT / "capacities.json"
RESERVOIRS_PATH = ROOT / "reservoirs.json"

NID_LAYER = ("https://geospatial.sec.usace.army.mil/dls/rest/services/NID/"
             "National_Inventory_of_Dams_Public_Service/FeatureServer/0")
NID_ID_FIELD = "NIDID"
NID_NAME_FIELD = "NAME"

# A dam identifier names a *project*, not a structure, and three of the ones
# committed here return more than one row: Lost Lake and Hyrum have a dike
# beside the dam, Stateline has two. Every row of a project carries the same
# storage figures, so capacity was never at risk -- but they sit up to 600
# metres apart, and the point written here is the drainage assignment point.
#
# This used to keep whichever row the service happened to return last, which
# is not a decision anybody made and not the same answer twice: the two
# inventory copies return the same three Stateline rows in different orders,
# so a rebuild against one wrote the dam and against the other a dike.
# Measured 2026-08-18: no published assignment changes either way, because
# all the structures of a project fall in one drainage area at HUC-6. That is
# a property of this level rather than of the data, and the western expansion
# scoping puts HUC-8 on the path, where 600 metres straddles divides.
#
# The rule is the main structure: a dike is a secondary embankment holding
# the same pool, so the dam is where the stored water leaves. It reproduces
# every point currently committed.
SECONDARY_STRUCTURE = re.compile(r"\b(dike|dyke|saddle|auxiliary)\b", re.IGNORECASE)
USER_AGENT = "utah-water-dashboard/dam-points (+https://github.com/buschbrian)"
TIMEOUT = 90

# A dam further than this from the reservoir's published point is far more
# likely to be the wrong dam than a very long reservoir. Lake Powell is the
# real maximum at 20.9 km, so this leaves room without leaving the door open.
MAX_PLAUSIBLE_KM = 40.0


def get_json(url: str, params: dict) -> dict | None:
    request = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(params)}", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"    !! {exc}", file=sys.stderr)
        return None
    if isinstance(payload, dict) and payload.get("error"):
        print(f"    !! service error: {payload['error'].get('message')}", file=sys.stderr)
        return None
    return payload


def principal_structure(rows: list[dict]) -> dict:
    """The row a project's point should come from, chosen the same way twice.

    Sorted rather than filtered, so a project whose rows are *all* named as
    dikes still resolves to one of them rather than to nothing. The name is
    the tie-break after that, because two rows equally entitled to be the
    answer still have to produce one answer.
    """
    return sorted(
        rows, key=lambda row: (bool(SECONDARY_STRUCTURE.search(row["name"] or "")),
                               row["name"] or ""))[0]


def fetch_dam_points(nid_ids: list[str]) -> dict[str, tuple[float, float]]:
    rows: dict[str, list[dict]] = {}
    for start in range(0, len(nid_ids), 40):
        chunk = nid_ids[start:start + 40]
        quoted = ",".join(f"'{value}'" for value in chunk)
        payload = get_json(f"{NID_LAYER}/query", {
            "where": f"{NID_ID_FIELD} IN ({quoted})",
            "outFields": f"{NID_ID_FIELD},{NID_NAME_FIELD}",
            "returnGeometry": "true", "outSR": "4326", "f": "json",
        })
        for feature in (payload or {}).get("features", []):
            geometry = feature.get("geometry") or {}
            attributes = feature.get("attributes") or {}
            key = attributes.get(NID_ID_FIELD)
            if key and geometry.get("x") is not None:
                rows.setdefault(key, []).append({
                    "name": attributes.get(NID_NAME_FIELD),
                    "point": (round(geometry["x"], 5), round(geometry["y"], 5)),
                })

    points: dict[str, tuple[float, float]] = {}
    for key, found in rows.items():
        chosen = principal_structure(found)
        if len(found) > 1:
            others = ", ".join(sorted(r["name"] or "?" for r in found
                                      if r is not chosen))
            print(f"    {key}: {len(found)} structures, using "
                  f"{chosen['name']!r} (also {others})")
        points[key] = chosen["point"]
    return points


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    document = json.loads(CAPACITIES_PATH.read_text())
    capacities = document["capacities"]
    published = {r["name"]: (r["lon"], r["lat"])
                 for r in json.loads(RESERVOIRS_PATH.read_text())["reservoirs"]}
    units = load_units()

    nid_ids = sorted({entry["nid_id"] for entry in capacities.values()
                      if entry.get("nid_id")})
    points = fetch_dam_points(nid_ids)
    print(f"{len(points)}/{len(nid_ids)} dam points resolved from the inventory\n")

    rejected, moved, updated = [], [], 0
    print(f"{'reservoir':<20} {'km from lake point':>18}  drainage area")
    for name, entry in sorted(capacities.items()):
        point = points.get(entry.get("nid_id"))
        if point is None:
            rejected.append(f"{name}: no geometry for {entry.get('nid_id')}")
            continue
        lake = published.get(name)
        distance = haversine_km(lake, point) if lake else None

        # The same guard build_capacity_table.py applies to the capacity
        # itself: a figure that cannot be right is reported, never written.
        if distance is not None and distance > MAX_PLAUSIBLE_KM:
            rejected.append(
                f"{name}: dam {entry['nid_id']} is {distance:.1f} km from the "
                "reservoir, which is more likely the wrong dam than a long lake")
            continue

        before = assign_huc(lake, units) if lake else None
        after = assign_huc(point, units)
        if after is None:
            rejected.append(f"{name}: the dam point falls outside every drainage area")
            continue
        if before and before["huc6"] != after["huc6"]:
            moved.append(f"{name}: {before['huc6']} {before['name']} -> "
                         f"{after['huc6']} {after['name']}")

        entry["dam_lon"], entry["dam_lat"] = point
        updated += 1
        print(f"{name:<20} {(f'{distance:.2f}' if distance is not None else '-'):>18}"
              f"  {after['name']}")

    print(f"\n{updated} dams recorded.")
    print("Assignments that change: " +
          (", ".join(moved) if moved else "none -- the dam points confirm every "
           "assignment the lake points already produced"))
    if rejected:
        print("\nNot recorded:")
        for line in rejected:
            print(f"  {line}")

    if args.dry_run:
        print("\nDry run: nothing written.")
        return 0
    document["dam_points"] = {
        "source": NID_LAYER,
        "note": ("Dam coordinates, queried by NID id. Used as the watershed "
                 "assignment point: the drainage area is where the stored "
                 "water leaves, not where the middle of the lake is."),
        "count": updated,
    }
    CAPACITIES_PATH.write_text(json.dumps(document, indent=2) + "\n")
    print(f"\nWrote {CAPACITIES_PATH.name}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
