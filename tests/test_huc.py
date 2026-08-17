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
sys.path.insert(0, str(ROOT))
from huc import (  # noqa: E402
    UTAH_POLYGONS, UTAH_RING, assign_huc, describe, distance_to_boundary_km, in_polygon,
    in_utah, load_units,
)

BOUNDARIES = ROOT / "huc6.geojson"
RESERVOIRS = ROOT / "reservoirs.json"
SHARED_VIZ = ROOT / "shared" / "reservoir-viz.js"
UTAH_BOUNDARY = ROOT / "utah-boundary.geojson"

# Every hydrologic unit in scope: touching Utah, and in the Colorado River or
# Great Basin systems. Upper Snake (170402) touches the state and is excluded
# on purpose -- it drains to the Columbia. See ADR-010. Written down so a
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
    "Dillon Reservoir": "140100",     # Colorado Headwaters
    "Elkhead Reservoir": "140500",    # White-Yampa
    "Narraguinnep Reservoir": "140802",  # Lower San Juan
}

# The margin the boundary generalization was chosen against. If a future
# reservoir lands inside this, the 500 m generalization in
# the retired 500 m generalization is no longer comfortably finer than the closest
# call, and that decision needs re-measuring.
MIN_BOUNDARY_MARGIN_KM = 2.0


@pytest.fixture(scope="module")
def units() -> list[dict]:
    return load_units()


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


def test_every_published_unit_has_at_least_one_tracked_reservoir(reservoirs):
    represented = {reservoir["huc6"] for reservoir in reservoirs}
    assert represented == set(EXPECTED_UNITS)


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
        "the committed boundary generalization needs re-measuring")


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


def test_the_state_classification_uses_the_authoritative_map_boundary():
    payload = json.loads(UTAH_BOUNDARY.read_text(encoding="utf-8"))
    geometry = payload["features"][0]["geometry"]
    expected = (geometry["coordinates"] if geometry["type"] == "MultiPolygon"
                else [geometry["coordinates"]])
    assert UTAH_POLYGONS == expected
    assert UTAH_RING == expected[0][0]
    assert len(UTAH_RING) > 100
    signed_area = sum(
        x0 * y1 - x1 * y0
        for (x0, y0), (x1, y1) in zip(UTAH_RING, UTAH_RING[1:])
    ) / 2
    assert signed_area > 0, "GeoJSON outer ring must use counterclockwise winding"
    assert "UtahStateBoundary" in payload["source"]


@pytest.mark.parametrize("name,lon,lat,expected", [
    ("Salt Lake City", -111.89, 40.76, True),
    ("St George", -113.58, 37.10, True),
    ("Bear Lake, on the Idaho side", -111.30, 42.12, False),
    ("Meeks Cabin, in Wyoming", -110.58, 41.02, False),
    ("inside the northeast notch, which is Wyoming", -110.50, 41.50, False),
    ("just south of the notch, which is Utah", -110.50, 40.90, True),
    ("Glen Canyon Dam, in Arizona", -111.48, 36.94, False),
])
def test_the_state_outline_includes_the_northeast_notch(name, lon, lat, expected):
    assert in_utah((lon, lat)) is expected, name


def test_in_utah_describes_the_reservoir_and_not_its_outlet(units):
    """Lake Powell is the case this distinction exists for: Glen Canyon Dam
    is in Arizona, the reservoir reaches well into Utah, and it is the
    largest thing on the dashboard. Assigning the drainage area by the dam
    must not drop it out of the Utah view."""
    powell = next(r for r in json.loads(RESERVOIRS.read_text())["reservoirs"]
                  if r["name"] == "Lake Powell")
    glen_canyon_dam = (-111.483, 36.937)
    fields = describe(powell["lat"], powell["lon"], units,
                      name="Lake Powell",
                      assignment_point=glen_canyon_dam, source="nid_dam_point")
    assert fields["in_utah"] is True
    assert fields["huc_assignment_point"] == [-111.483, 36.937]
    assert fields["huc_assignment_source"] == "nid_dam_point"
    # And the dam point still lands in the same drainage area as the lake.
    assert fields["huc6"] == describe(
        powell["lat"], powell["lon"], units, name="Lake Powell")["huc6"]


@pytest.mark.parametrize("name,lat,lon,expected", [
    ("Bear Lake", 42.11667, -111.30000, True),
    ("Meeks Cabin", 41.01664, -110.58344, True),
    ("Woodruff Narrows", 41.50273, -111.01602, False),
    ("Fontenelle", 42.05781, -110.09665, False),
])
def test_cross_border_waterbody_review_is_separate_from_point_location(
        units, name, lat, lon, expected):
    fields = describe(lat, lon, units, name=name)
    assert fields["in_utah"] is False
    assert fields["intersects_utah"] is expected


def test_an_unassigned_point_reports_no_source(units):
    """A point outside every unit gets no basin and no provenance for one.
    Naming the source anyway would claim an assignment that did not happen."""
    fields = describe(35.0, -95.0, units, name="Nowhere")  # Oklahoma
    assert fields["huc6"] is None
    assert fields["huc6_name"] is None
    assert fields["huc_assignment_source"] is None
    assert fields["in_utah"] is False
    assert fields["intersects_utah"] is False


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
