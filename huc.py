"""Watershed membership for each reservoir.

Three facts get attached to every published record: which six-digit hydrologic
unit its water drains through, whether its provider point is in Utah, and
whether its waterbody intersects Utah. They are separate on purpose. A
drainage area does not stop at a state line -- Lake
Powell's water comes down the Green from Wyoming and the Colorado from
Colorado -- so "reservoirs in Utah" and "reservoirs in drainage areas that
touch Utah" are two different questions and the dashboard has to be able to
ask each one without the other quietly changing.

Standard library only, and deliberately kept out of refresh_reservoirs.py:
this is geometry with no series, no network and no pandas in it, so it can be
tested on its own and reused by tools/probe_huc_points.py without dragging
the whole data stack along.

Boundaries come from `huc6.geojson`, written by scripts/fetch-huc6.mjs from
the USGS Watershed Boundary Dataset and committed. Committed rather than
fetched at refresh time for the same reason as capacities.json: an
assignment that can change underneath you is not reproducible, and a
reservoir that silently moves basin between two runs is the kind of error
nobody would catch by looking.
"""

import json
import math
from pathlib import Path

BOUNDARY_PATH = Path(__file__).resolve().parent / "huc6.geojson"
UTAH_BOUNDARY_PATH = Path(__file__).resolve().parent / "utah-boundary.geojson"

# Provider points outside Utah do not settle whether the stored water crosses
# the state line. These two waterbodies were reviewed against the official
# USGS NHDPlus HR NHDWaterbody layer. The permanent identifiers make the
# evidence reproducible without adding a remote geometry dependency to the
# daily refresh. See ADR-013.
# Source: https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/9
CROSS_BORDER_UTAH_WATERBODIES = {
    "Bear Lake": "120026431",
    "Meeks Cabin": "120025290",
}

def _load_utah_polygons(path: Path = UTAH_BOUNDARY_PATH):
    """Read the committed UGRC polygon in the same normalized shape as WBD."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    geometry = payload["features"][0]["geometry"]
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError(f"Unsupported Utah boundary geometry: {geometry['type']}")


UTAH_POLYGONS = _load_utah_polygons()
# Compatibility for callers that need the principal outline. Classification
# uses every polygon and its holes below.
UTAH_RING = UTAH_POLYGONS[0][0]

Point = tuple[float, float]


def in_ring(point: Point, ring) -> bool:
    """Ray casting, counting a crossing on the half-open edge [y0, y1).

    The same algorithm as `inRing` in src/data/huc.ts, kept in step by a
    shared set of fixtures in the two test suites. A point exactly on the
    boundary is not specified either way and is not worth defining: dam
    points do not land on watershed boundaries, and pretending otherwise
    would invent a rule nothing tests.
    """
    x, y = point
    inside = False
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[i - 1][0], ring[i - 1][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
    return inside


def in_polygon(point: Point, rings) -> bool:
    """Inside the outer ring and inside none of its holes."""
    if not rings or not in_ring(point, rings[0]):
        return False
    return not any(in_ring(point, hole) for hole in rings[1:])


def in_utah(point: Point) -> bool:
    return any(in_polygon(point, polygon) for polygon in UTAH_POLYGONS)


def waterbody_intersects_utah(name: str, point: Point) -> bool:
    """Whether the reservoir surface intersects Utah.

    A point inside Utah proves intersection. A point outside the state needs
    a reviewed polygon; the current exceptions are versioned above.
    """
    return in_utah(point) or name in CROSS_BORDER_UTAH_WATERBODIES


def location_fields(name: str, lat: float, lon: float) -> dict:
    """Stable location facts that do not depend on watershed boundaries."""
    site = (lon, lat)
    return {
        "in_utah": in_utah(site),
        "intersects_utah": waterbody_intersects_utah(name, site),
    }


def units_from_collection(payload: dict) -> list[dict]:
    """Normalize a GeoJSON feature collection to the assignment shape.

    Most callers use :func:`load_units` with a committed file. Research tools
    also need to classify divide-adjacent points against an un-generalized
    federal response without writing that much larger geometry to the
    repository first.
    """
    units = []
    for feature in payload["features"]:
        geometry = feature["geometry"]
        coordinates = geometry["coordinates"]
        units.append({
            "huc6": feature["properties"]["huc6"],
            "name": feature["properties"]["name"],
            "states": feature["properties"].get("states", ""),
            "polygons": coordinates if geometry["type"] == "MultiPolygon" else [coordinates],
        })
    return sorted(units, key=lambda unit: unit["huc6"])


def load_units(path: Path | None = None) -> list[dict]:
    """The committed hydrologic units, normalized to one polygon list each."""
    payload = json.loads((path or BOUNDARY_PATH).read_text())
    return units_from_collection(payload)


def assign_huc(point: Point, units) -> dict | None:
    """The unit containing this point, or None.

    First hit wins. Hydrologic units tile the country without overlapping, so
    a point inside two of them means the boundary data is wrong; picking the
    first is no worse than any other arbitrary choice, and
    tests/test_huc.py asserts the situation does not arise.
    """
    for unit in units:
        if any(in_polygon(point, polygon) for polygon in unit["polygons"]):
            return unit
    return None


def distance_to_boundary_km(point: Point, unit: dict) -> float:
    """Shortest distance from the point to any edge of the unit.

    This is the number that says how much boundary precision the assignment
    needs. A reservoir 200 m from a boundary could be moved into the next
    unit by a generalized polygon or a slightly different dam coordinate; one
    20 km inside cannot. Measured across the 53 reservoirs published at the
    time of the boundary study, the closest is 2.72 km, which is what
    justifies the 500 m generalization in
    scripts/fetch-huc6.mjs.

    Computed on a local equirectangular projection about the point. Over the
    few kilometres that matter the error is far below the thing being
    measured, and it avoids a geodesic dependency in a module that is
    deliberately standard library only.
    """
    lon, lat = point
    scale = math.cos(math.radians(lat))
    km_per_degree = 111.32

    best = float("inf")
    for polygon in unit["polygons"]:
        for ring in polygon:
            local = [((vertex[0] - lon) * scale * km_per_degree,
                      (vertex[1] - lat) * km_per_degree) for vertex in ring]
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


def haversine_km(a: Point, b: Point) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def describe(lat: float, lon: float, units, *, name: str,
             assignment_point: Point | None = None,
             source: str = "published_point") -> dict:
    """The watershed fields for one reservoir record.

    Two points, and they must not be collapsed into one:

    - The **reservoir's** point decides `in_utah`. That preserves the provider
      point-location fact.
    - The reservoir point plus reviewed waterbody polygons decide
      `intersects_utah`. That owns the default Utah scope.
    - The **assignment** point decides the drainage area. That asks where the
      stored water leaves, which is the dam or outlet.

    They were the same in the original assignment study and will not stay
    that way. Glen Canyon Dam is in Arizona while Lake Powell reaches well
    into Utah, so the moment the dam points land, computing `in_utah` from the
    assignment point would drop the single largest reservoir on this
    dashboard out of its own default view.

    `source` records what kind of point produced the assignment, because the
    answer is going to improve. The published coordinates are lake points, a
    median of 1.08 km from the dam. Across the 53 reservoirs published when
    that study was run, using the dam point instead moved none of them, so the
    upgrade was a correctness improvement rather than a correction -- but a
    reader should still be able to tell which one produced a given row.
    """
    site = (lon, lat)
    point = tuple(assignment_point) if assignment_point else site
    unit = assign_huc(point, units)
    return {
        **location_fields(name, lat, lon),
        "huc6": unit["huc6"] if unit else None,
        "huc6_name": unit["name"] if unit else None,
        "huc_assignment_point": [round(point[0], 5), round(point[1], 5)],
        "huc_assignment_source": source if unit else None,
    }
