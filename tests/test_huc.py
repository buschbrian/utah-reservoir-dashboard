"""Tests for the committed watershed boundaries and the point assignment.

Network-free, like the rest of the suite: `huc6.geojson` and
`reservoirs.json` are both committed, so this asserts against exactly what
ships rather than against whatever the USGS service returns today.

What this guards is the thing that would otherwise fail silently. A wrong
watershed assignment does not throw, does not blank the map and does not
change a single storage number -- it just files a reservoir under the wrong
basin, and the only way to notice is to know the geography. These assertions
encode that knowledge.

Run with `pytest tests/` or directly with `python tests/test_huc.py`.
"""

import json
import math
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from probe_huc_points import (  # noqa: E402
    assign_huc, distance_to_boundary_km, in_polygon,
)

BOUNDARIES = ROOT / "huc6.geojson"
RESERVOIRS = ROOT / "reservoirs.json"

# Every hydrologic unit whose six-digit code touches Utah. Written down so a
# service change that quietly drops or adds one is a failed test rather than
# a differently-shaped map.
EXPECTED_UNITS = {
    "140100": "Colorado Headwaters",
    "140300": "Upper Colorado-Dolores",
    "140401": "Upper Green",
    "140500": "White-Yampa",
    "140600": "Lower Green",
    "140700": "Upper Colorado-Dirty Devil",
    "140802": "Lower San Juan",
    "150100": "Lower Colorado-Lake Mead",
    "160101": "Upper Bear",
    "160102": "Lower Bear",
    "160201": "Weber",
    "160202": "Jordan",
    "160203": "Great Salt Lake",
    "160300": "Escalante Desert-Sevier Lake",
    "170402": "Upper Snake",
}

# Assignments a reader can check against a map without running anything.
# Deliberately spread across the state and across both data providers.
KNOWN_ASSIGNMENTS = {
    "Lake Powell": "140700",          # Glen Canyon, Upper Colorado-Dirty Devil
    "Flaming Gorge": "140401",        # Upper Green, on the Wyoming line
    "Bear Lake": "160102",            # Lower Bear, mostly in Idaho
    "Utah Lake": "160202",            # Jordan
    "Deer Creek": "160202",           # Jordan
    "Willard Bay": "160201",          # Weber
    "Quail Creek": "150100",          # Lower Colorado, the St George corner
    "Piute": "160300",                # Sevier
    "Strawberry": "140600",           # Lower Green, not Jordan: it drains east
    "Meeks Cabin": "140401",          # in Wyoming, and still ours
}

# The margin the boundary generalization was chosen against. If a future
# reservoir lands inside this, the 500 m generalization in
# scripts/fetch-huc6.mjs is no longer comfortably finer than the closest
# call, and that decision needs re-measuring.
MIN_BOUNDARY_MARGIN_KM = 2.0


@pytest.fixture(scope="module")
def units() -> list[dict]:
    payload = json.loads(BOUNDARIES.read_text())
    parsed = []
    for feature in payload["features"]:
        geometry = feature["geometry"]
        coordinates = geometry["coordinates"]
        parsed.append({
            "huc6": feature["properties"]["huc6"],
            "name": feature["properties"]["name"],
            "polygons": coordinates if geometry["type"] == "MultiPolygon" else [coordinates],
        })
    return parsed


@pytest.fixture(scope="module")
def reservoirs() -> list[dict]:
    return json.loads(RESERVOIRS.read_text())["reservoirs"]


def test_boundary_file_holds_exactly_the_units_that_touch_utah(units):
    assert {unit["huc6"]: unit["name"] for unit in units} == EXPECTED_UNITS


def test_every_unit_lists_utah_among_its_states():
    payload = json.loads(BOUNDARIES.read_text())
    for feature in payload["features"]:
        assert "UT" in feature["properties"]["states"], feature["properties"]["name"]


def test_every_published_reservoir_lands_in_exactly_one_unit(units, reservoirs):
    """Exactly one, not at least one. Hydrologic units tile without
    overlapping, so a point in two of them means the boundaries are wrong."""
    for reservoir in reservoirs:
        point = (reservoir["lon"], reservoir["lat"])
        matches = [unit["huc6"] for unit in units
                   if any(in_polygon(point, polygon) for polygon in unit["polygons"])]
        assert len(matches) == 1, f"{reservoir['name']} matched {matches}"


@pytest.mark.parametrize("name,huc6", sorted(KNOWN_ASSIGNMENTS.items()))
def test_known_reservoirs_land_in_the_right_basin(units, reservoirs, name, huc6):
    reservoir = next(r for r in reservoirs if r["name"] == name)
    assigned = assign_huc((reservoir["lon"], reservoir["lat"]), units)
    assert assigned is not None, f"{name} fell outside every unit"
    assert assigned["huc6"] == huc6, f"{name} -> {assigned['huc6']} {assigned['name']}"


def test_no_reservoir_sits_close_enough_to_a_boundary_to_be_generalized_across(
        units, reservoirs):
    closest = min(
        (distance_to_boundary_km((r["lon"], r["lat"]),
                                 assign_huc((r["lon"], r["lat"]), units)), r["name"])
        for r in reservoirs)
    assert closest[0] > MIN_BOUNDARY_MARGIN_KM, (
        f"{closest[1]} is {closest[0]:.2f} km from a unit boundary; the 500 m "
        "generalization in scripts/fetch-huc6.mjs needs re-measuring")


def test_ray_casting_agrees_with_the_typescript_port():
    """The same fixtures as src/data/huc.test.ts, so the two implementations
    of the same algorithm cannot drift apart unnoticed."""
    donut = [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]],
    ]
    assert in_polygon((0.5, 0.5), donut) is True
    assert in_polygon((2, 2), donut) is False
    assert in_polygon((9, 9), donut) is False


def test_boundary_distance_is_zero_on_the_edge_and_grows_inward():
    square = {"polygons": [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]]}
    on_edge = distance_to_boundary_km((0.5, 0.0), square)
    inside = distance_to_boundary_km((0.5, 0.5), square)
    assert on_edge == pytest.approx(0.0, abs=1e-6)
    # Half a degree of latitude from the nearest edge, in kilometres.
    assert inside == pytest.approx(0.5 * 111.32, rel=0.01)
    assert not math.isnan(inside)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
