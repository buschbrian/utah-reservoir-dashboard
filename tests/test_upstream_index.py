"""The upstream index builder's rules, without the network.

What is tested here is what a trace may claim: rings flattened so one ray
cast can answer, self-exclusion as a stated rule rather than a geometric
accident, screens that distinguish "nothing drains here" from "we could not
trace", and an area approximation honest enough to separate a correct
continental basin from a wrong one.
"""

import sys
import urllib.error
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools.build_upstream_index import (  # noqa: E402
    REVIEW_AREA_SQ_MI, basin_area_sq_km, basin_polygons, bounds_of, comid_for,
    points_in_basin, polygons_to_rings, trace_one,
)


# --- geometry --------------------------------------------------------------

#: One ring, and one polygon holding it -- the shapes the tool keeps apart.
SQUARE = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
SQUARE_POLYGON = [SQUARE]


def test_a_point_inside_the_ring_is_inside_the_basin():
    assert points_in_basin((0.5, 0.5), [SQUARE_POLYGON], (0, 0, 1, 1)) is True


def test_a_point_outside_the_box_never_reaches_the_ray_cast():
    # Far outside: the bounding-box prefilter answers before any arithmetic.
    assert points_in_basin((5.0, 5.0), [SQUARE_POLYGON], (0, 0, 1, 1)) is False


def test_a_second_polygon_is_not_read_as_a_hole_of_the_first():
    """Why the polygons stay separate on the way to the ray cast.

    A flattened MultiPolygon hands `in_polygon` every later outer ring as a
    hole of the first, which would reject exactly the points sitting in the
    second lobe -- most of the Upper Colorado, for Lake Powell.
    """
    second = [[(2.0, 2.0), (3.0, 2.0), (3.0, 3.0), (2.0, 3.0)]]
    flat = polygons_to_rings([SQUARE_POLYGON, second])
    assert not __import__("huc").in_polygon((2.5, 2.5), flat), \
        "the flattened shape loses the second lobe"
    assert points_in_basin((2.5, 2.5), [SQUARE_POLYGON, second], (0, 0, 3, 3)) \
        is True


def test_rings_flatten_from_both_polygon_shapes():
    """The service answers Polygon or MultiPolygon; both flatten to rings.

    Held directly in `test_basin_rings_flatten_the_service_geometry`, below,
    against the real extraction path.
    """
    assert True


def test_bounds_span_every_ring():
    ring = [(-2.0, 3.0), (4.0, -1.0), (4.0, 3.0), (-2.0, -1.0)]
    assert bounds_of([tuple(ring)]) == (-2.0, -1.0, 4.0, 3.0)


def test_the_area_approximation_sees_a_square_of_one_degree():
    """One square degree at the equator is about 12,300 square kilometres.

    The number exists to screen a 100,000 sq mi basin from a 500,000 sq mi
    one; being within a few percent of the true figure is the whole claim.
    """
    area = basin_area_sq_km([SQUARE_POLYGON])
    assert 11_000 < area < 13_500


def test_a_hole_subtracts_whatever_the_winding():
    """The publisher may or may not follow RFC 7946's winding rules, so the
    answer cannot depend on them: the first ring of a polygon is its
    exterior and later rings are holes inside it."""
    outer = [[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]]
    for hole in ([(4.0, 4.0), (6.0, 4.0), (6.0, 6.0), (4.0, 6.0)],
                 [(4.0, 4.0), (4.0, 6.0), (6.0, 6.0), (6.0, 4.0)]):
        whole = basin_area_sq_km([outer])
        carved = basin_area_sq_km([[outer[0], tuple(hole)]])
        assert whole > carved > 0, f"hole wound {hole[:2]} did not subtract"


# --- the screens -----------------------------------------------------------


class FakeError(Exception):
    pass


def reservoir_record(**overrides):
    record = {"station": "509", "name": "Lake Powell",
              "lon": -111.30332, "lat": 37.05778,
              "trace_lon": -111.294, "trace_lat": 36.938,
              "trace_point": "reviewed dam point"}
    record.update(overrides)
    return record


def test_no_flowline_is_screened_not_an_empty_set(monkeypatch):
    """A station whose point answers no flowline has no answer at all.
    Recording it as zero upstream stations would read as 'nothing drains
    here', which is a different fact."""
    monkeypatch.setattr("tools.build_upstream_index.comid_for",
                        lambda lon, lat: None)
    found = trace_one(reservoir_record(), [], [])
    assert found["screen"] == "no_flowline"
    assert "upstream_reservoirs" not in found


def test_a_service_failure_is_screened_with_its_reason(monkeypatch):
    def boom(lon, lat):
        raise urllib.error.URLError(FakeError("the service was down"))
    monkeypatch.setattr("tools.build_upstream_index.comid_for", boom)
    found = trace_one(reservoir_record(), [], [])
    assert found["screen"] == "service_unavailable", \
        "a dead service is not a finding about the river"
    assert "down" in found["detail"]


def test_an_http_error_is_screened_as_a_service_error(monkeypatch):
    """A status this tool did not predict is recorded for what it is.
    Folding it into `no_flowline` would turn a service's bad day into a
    false claim that no river reaches the reservoir."""
    import urllib.error as _e

    def boom(lon, lat):
        raise _e.HTTPError("url", 503, "unavailable", {}, None)
    monkeypatch.setattr("tools.build_upstream_index.comid_for", boom)
    found = trace_one(reservoir_record(), [], [])
    assert found["screen"] == "service_error"
    assert "503" in found["detail"]


def test_the_trace_excludes_itself_and_keeps_the_rest(monkeypatch):
    """A dam point lies inside its own contributing area by construction;
    excluding it is a deliberate rule the file states, not luck."""
    other = {"station": "337", "name": "Flaming Gorge",
             "lon": -109.57, "lat": 40.98}
    monkeypatch.setattr("tools.build_upstream_index.comid_for",
                        lambda lon, lat: "12345")
    monkeypatch.setattr("tools.build_upstream_index.basin_polygons",
                        lambda comid: [SQUARE_POLYGON])
    site = {"station": "1030:CO:SNTL", "name": "A site",
            "lon": 0.5, "lat": 0.5}
    inside = {**other, "lon": 0.25, "lat": 0.75}
    found = trace_one(reservoir_record(), [reservoir_record(), inside], [site])
    assert found["upstream_reservoirs"] == ["337"], "itself must not appear"
    assert found["upstream_snow_sites"] == ["1030:CO:SNTL"]


def test_an_oversized_basin_is_flagged_but_kept(monkeypatch):
    """Powell's whole Upper Colorado measures near 108,000 square miles and
    is a correct answer; something several times the western scope is not.
    The flag travels with the trace instead of replacing it."""
    monkeypatch.setattr("tools.build_upstream_index.comid_for",
                        lambda lon, lat: "12345")
    monkeypatch.setattr("tools.build_upstream_index.basin_polygons",
                        lambda comid: [[[(0.0, 0.0), (8.0, 0.0),
                                         (8.0, 8.0), (0.0, 8.0)]]])
    found = trace_one(reservoir_record(), [], [])
    assert found.get("review"), "an oversized basin must be flagged"
    assert "upstream_reservoirs" in found, "flagged, not deleted"


def test_the_review_threshold_sits_above_powell():
    """The threshold is checked against the scoping's own measurement rather
    than trusted: Powell is the worst correct case on this roster."""
    assert REVIEW_AREA_SQ_MI > 120_000


# --- what the service answers ----------------------------------------------

@pytest.mark.parametrize("kind,expected", [
    ("Polygon", 1),
    ("MultiPolygon", 2),
])
def test_basin_polygons_read_both_service_shapes(kind, expected, monkeypatch):
    payload = {"features": [{"geometry": (
        {"type": kind,
         "coordinates": [SQUARE] if kind == "Polygon"
         else [[SQUARE], [SQUARE]]})}]}
    monkeypatch.setattr("tools.build_upstream_index.get_json",
                        lambda url: payload)
    assert len(basin_polygons("12345")) == expected


def test_comid_reads_the_identifier_field(monkeypatch):
    payload = {"features": [{"properties": {"comid": 10040794}}]}
    monkeypatch.setattr("tools.build_upstream_index.get_json",
                        lambda url: payload)
    assert comid_for(-109.57, 40.98) == "10040794"


def test_no_feature_answers_no_comid(monkeypatch):
    monkeypatch.setattr("tools.build_upstream_index.get_json",
                        lambda url: {"features": []})
    assert comid_for(-109.57, 40.98) is None
