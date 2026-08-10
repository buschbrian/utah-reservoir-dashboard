"""Network-free checks for SNOTEL audit scope."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools.audit_snotel import select_snotel  # noqa: E402

UNITS = [{"huc6": "140600", "name": "Upper Colorado-Dolores",
          "polygons": [[[[-110.0, 38.0], [-109.0, 38.0], [-109.0, 39.0],
                          [-110.0, 39.0], [-110.0, 38.0]]]]}]


def test_selects_snotel_by_coordinate_and_keeps_huc_disagreement():
    sites = select_snotel([{"stationTriplet": "1:CO:SNTL", "name": "Snow",
                            "longitude": -109.5, "latitude": 38.5,
                            "huc": "999999999999", "stateCode": "CO"}], UNITS)
    assert len(sites) == 1
    assert sites[0]["huc6"] == "140600"
    assert sites[0]["agrees"] is False


def test_excludes_non_snotel_and_points_outside_scope():
    stations = [
        {"stationTriplet": "1:CO:SNOW", "longitude": -109.5, "latitude": 38.5},
        {"stationTriplet": "2:CO:SNTL", "longitude": -105.0, "latitude": 38.5},
    ]
    assert select_snotel(stations, UNITS) == []
