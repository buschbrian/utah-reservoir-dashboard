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


def test_a_reservoir_tracked_at_its_dam_is_not_offered_again_at_its_water():
    """The Lake Mead case, and the reason a position dedupe needs both points.

    RISE publishes Mead as the water at Temple Bar and AWDB as the gauge at
    Hoover Dam, 41.9 km apart -- further than any name-and-position rule will
    reach (ADR-062). Comparing against the reviewed dam point as well is what
    keeps a reservoir already on the roster from being admitted a second time,
    which would have added 28.3 million acre-feet to every total that already
    contained it.
    """
    payload = {"reservoirs": [{"name": "Big Lake", "source_station_id": "rise-1",
                               "lon": -109.1, "lat": 38.9}]}
    # The station sits at the dam, well outside the 25 km the name rule uses.
    far_dam = station("awdb-1", "140600123456", -109.6, 38.2, "Big Lake")

    without = select_candidates([far_dam], payload, UNITS)
    assert [c["station"] for c in without[0]] == ["awdb-1"]

    with_dam = select_candidates([far_dam], payload, UNITS,
                                 {"Big Lake": (-109.6, 38.2)})
    assert with_dam[0] == []
    assert with_dam[1] == 1


def test_a_dam_point_does_not_excuse_a_different_reservoir():
    """The dam point widens where a *name match* may be, and nothing else. Two
    reservoirs with different names near one dam stay two reservoirs."""
    payload = {"reservoirs": [{"name": "Big Lake", "source_station_id": "rise-1",
                               "lon": -109.1, "lat": 38.9}]}
    other = station("awdb-2", "140600123456", -109.6, 38.2, "Little Lake")

    candidates, already, _ = select_candidates(
        [other], payload, UNITS, {"Big Lake": (-109.6, 38.2)})

    assert [c["station"] for c in candidates] == ["awdb-2"]
    assert already == 0
