"""Network-free checks for the candidate audit's geographic scope."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools.audit_awdb_stations import select_candidates  # noqa: E402


UNITS = [{
    "huc6": "140600",
    "name": "Upper Colorado-Dolores",
    "polygons": [[[[-110.0, 38.0], [-109.0, 38.0], [-109.0, 39.0],
                    [-110.0, 39.0], [-110.0, 38.0]]]],
}]


def station(triplet, huc, lon, lat, name="Candidate"):
    return {"stationTriplet": triplet, "huc": huc, "longitude": lon,
            "latitude": lat, "name": name, "stateCode": "CO"}


def test_coordinates_include_a_site_even_when_provider_huc_disagrees():
    candidates, already, outside = select_candidates(
        [station("1:CO:BOR", "999999999999", -109.5, 38.5)],
        {"reservoirs": []}, UNITS)
    assert len(candidates) == 1
    assert candidates[0]["huc6_from_point"] == "140600"
    assert candidates[0]["agrees"] is False
    assert already == 0 and outside == 0


def test_provider_huc_cannot_include_a_point_outside_the_polygons():
    candidates, already, outside = select_candidates(
        [station("2:CO:BOR", "140600123456", -105.0, 38.5)],
        {"reservoirs": []}, UNITS)
    assert candidates == []
    assert already == 0 and outside == 1


def test_identifier_then_name_and_position_exclude_tracked_sites():
    payload = {"reservoirs": [{"name": "Shared Name", "source_station_id": "old",
                                "lon": -109.6, "lat": 38.5}]}
    candidates, already, outside = select_candidates(
        [station("old", "140600123456", -109.5, 38.5, "Renamed"),
         station("new", "140600123456", -109.6, 38.5, "Shared Name"),
         station("far", "140600123456", -109.95, 38.5, "Shared Name")],
        payload, UNITS)
    assert [candidate["station"] for candidate in candidates] == ["far"]
    assert candidates[0]["tracked_name_match"] is True
    assert already == 2 and outside == 0
