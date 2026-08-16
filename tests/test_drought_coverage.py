"""The drought coverage engine against shapes with known answers, and the
committed weekly output against its own arithmetic.

The synthetic fixtures use squares near the equator so the cosine weighting
is almost uniform and the expected percentages are exact up to sampling
resolution. The committed-file tests stay data-independent: they assert
structure and self-consistency, never this week's drought, so a Thursday
release cannot turn the suite red.
"""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from compute_drought_coverage import (  # noqa: E402
    LEVELS,
    build_payload,
    segments_of,
    unit_coverage,
)


def square(west, south, east, north):
    return [[west, south], [east, south], [east, north], [west, north], [west, south]]


def polygon(*rings):
    return {"type": "Polygon", "coordinates": list(rings)}


def drought_fixture(features):
    return {
        "map_date": "2026-08-11",
        "release_date": "2026-08-13",
        "source": "https://example.com/usdm",
        "attribution": "U.S. Drought Monitor",
        "features": [
            {"properties": {"DM": level}, "geometry": geometry}
            for level, geometry in features
        ],
    }


def boundaries_fixture(geometry):
    return {"features": [
        {"properties": {"huc6": "140100", "name": "Test Unit"}, "geometry": geometry}
    ]}


def coverage(drought_features, unit_geometry, step=0.005):
    payload = build_payload(
        drought_fixture(drought_features), boundaries_fixture(unit_geometry), step)
    return payload["units"][0]


class TestEngine:
    def test_half_covered_square(self):
        unit = polygon(square(0, 0, 1, 1))
        west_half = polygon(square(0, 0, 0.5, 1))
        result = coverage([(2, west_half)], unit)
        assert result["percent_of_area"]["d2"] == pytest.approx(50.0, abs=0.5)
        assert result["percent_of_area"]["none"] == pytest.approx(50.0, abs=0.5)
        assert result["percent_of_area"]["d0"] == 0.0

    def test_uncovered_and_fully_covered(self):
        unit = polygon(square(0, 0, 1, 1))
        elsewhere = polygon(square(5, 5, 6, 6))
        result = coverage([(0, elsewhere)], unit)
        assert result["percent_of_area"]["none"] == 100.0

        result = coverage([(4, polygon(square(-1, -1, 2, 2)))], unit)
        assert result["percent_of_area"]["d4"] == 100.0
        assert result["percent_of_area_at_least"]["d4"] == 100.0

    def test_hole_in_drought_polygon_is_not_covered(self):
        unit = polygon(square(0, 0, 1, 1))
        # Drought everywhere except a quarter-area hole in the middle.
        holed = polygon(square(0, 0, 1, 1), square(0.25, 0.25, 0.75, 0.75))
        result = coverage([(1, holed)], unit)
        assert result["percent_of_area"]["d1"] == pytest.approx(75.0, abs=0.5)
        assert result["percent_of_area"]["none"] == pytest.approx(25.0, abs=0.5)

    def test_exclusive_classes_and_cumulative_sums(self):
        unit = polygon(square(0, 0, 1, 1))
        # The layers are exclusive by contract: D2 is a ring of the west
        # half, D3 the island inside it -- the shape the real payload has.
        d2 = polygon(square(0, 0, 0.5, 1), square(0.1, 0.1, 0.4, 0.4))
        d3 = polygon(square(0.1, 0.1, 0.4, 0.4))
        result = coverage([(2, d2), (3, d3)], unit)
        assert result["percent_of_area"]["d3"] == pytest.approx(9.0, abs=0.5)
        assert result["percent_of_area"]["d2"] == pytest.approx(41.0, abs=0.5)
        at_least = result["percent_of_area_at_least"]
        assert at_least["d3"] == pytest.approx(9.0, abs=0.5)
        assert at_least["d2"] == pytest.approx(50.0, abs=0.5)
        assert at_least["d0"] == pytest.approx(50.0, abs=0.5)

    def test_multipolygon_unit(self):
        two_parts = {
            "type": "MultiPolygon",
            "coordinates": [
                [square(0, 0, 1, 1)],
                [square(2, 0, 3, 1)],
            ],
        }
        covered_part = polygon(square(2, 0, 3, 1))
        result = coverage([(0, covered_part)], two_parts)
        assert result["percent_of_area"]["d0"] == pytest.approx(50.0, abs=0.5)

    def test_missing_class_reads_zero(self):
        unit = polygon(square(0, 0, 1, 1))
        result = coverage([(0, polygon(square(0, 0, 1, 1)))], unit)
        for level in ("d1", "d2", "d3", "d4"):
            assert result["percent_of_area"][level] == 0.0

    def test_duplicate_class_is_refused(self):
        unit = polygon(square(0, 0, 1, 1))
        shape = polygon(square(0, 0, 1, 1))
        with pytest.raises(ValueError, match="duplicate drought intensity"):
            build_payload(
                drought_fixture([(1, shape), (1, shape)]),
                boundaries_fixture(unit), 0.01)

    def test_latitude_weighting_matters_in_the_north(self):
        # A unit spanning 40-48 degrees north, drought on its north half.
        # Unweighted sampling would call this 50%; the true share is smaller
        # because northern cells are narrower.
        unit = polygon(square(0, 40, 1, 48))
        north = polygon(square(0, 44, 1, 48))
        raw = unit_coverage(
            segments_of(unit), {0: segments_of(north)}, 0.01)
        assert raw["d0"] < 49.7
        # (sin 48 - sin 44) / (sin 48 - sin 40) = 48.3%.
        assert raw["d0"] == pytest.approx(48.3, abs=0.5)


class TestCommittedOutput:
    @pytest.fixture(scope="class")
    def payload(self):
        path = ROOT / "data" / "drought" / "usdm-huc6.json"
        assert path.exists(), "run tools/compute_drought_coverage.py"
        return json.loads(path.read_text(encoding="utf-8"))

    @pytest.fixture(scope="class")
    def source(self):
        return json.loads(
            (ROOT / "data" / "drought" / "usdm-current.geojson")
            .read_text(encoding="utf-8"))

    def test_every_published_drainage_area_is_covered(self, payload):
        boundaries = json.loads((ROOT / "huc6.geojson").read_text(encoding="utf-8"))
        expected = sorted(f["properties"]["huc6"] for f in boundaries["features"])
        assert [unit["huc6"] for unit in payload["units"]] == expected
        assert payload["unit_count"] == len(expected)

    def test_dates_match_the_polygon_file(self, payload, source):
        assert payload["map_date"] == source["map_date"]
        assert payload["release_date"] == source["release_date"]

    def test_percentages_are_complete_and_sum_to_the_whole(self, payload):
        for unit in payload["units"]:
            shares = unit["percent_of_area"]
            assert set(shares) == {"none", *LEVELS}
            for value in shares.values():
                assert 0.0 <= value <= 100.0
            # Six rounded figures may miss 100 by half a rounding step each.
            assert sum(shares.values()) == pytest.approx(100.0, abs=0.3)

    def test_cumulative_figures_agree_with_the_exclusive_ones(self, payload):
        for unit in payload["units"]:
            shares = unit["percent_of_area"]
            at_least = unit["percent_of_area_at_least"]
            assert list(at_least) == list(LEVELS)
            running = 0.0
            for level in reversed(LEVELS):
                running += shares[level]
                assert at_least[level] == pytest.approx(running, abs=0.3)
            previous = 100.1
            for level in LEVELS:
                assert at_least[level] <= previous
                previous = at_least[level]
