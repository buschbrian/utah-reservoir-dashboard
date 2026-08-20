"""Network-free guards for the R2 Bureau of Reclamation audit."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools.audit_rise_reservoirs import (  # noqa: E402
    existing_dam_ids,
    existing_dam_points,
    existing_roster_points,
    relationship_ids,
    remove_dam_point_duplicates,
    select_locations,
    storage_items,
)
import refresh_reservoirs as refresh  # noqa: E402


UNITS = [{
    "huc6": "140600",
    "name": "Upper Colorado-Dolores",
    "polygons": [[[[-110.0, 38.0], [-109.0, 38.0], [-109.0, 39.0],
                    [-110.0, 39.0], [-110.0, 38.0]]]],
}]


def location(identifier="1", name="Candidate", lon=-109.5, lat=38.5,
             kind="Lake/Reservoir", records=("10",), states=("CO",)):
    return {
        "id": f"/rise/api/location/{identifier}",
        "attributes": {
            "_id": int(identifier),
            "locationName": name,
            "locationTypeName": kind,
            "locationCoordinates": {"type": "Point", "coordinates": [lon, lat]},
        },
        "relationships": {
            "catalogRecords": {"data": [
                {"id": f"/rise/api/catalog-record/{record}"} for record in records]},
            "states": {"data": [
                {"id": f"/rise/api/state/{state}"} for state in states]},
        },
    }


def item(identifier="100", record="10", parameter="Lake/Reservoir Storage",
         unit="af", timestep="daily"):
    return {
        "id": f"/rise/api/catalog-item/{identifier}",
        "attributes": {
            "_id": int(identifier),
            "parameterName": parameter,
            "parameterUnit": unit,
            "parameterTimestep": timestep,
        },
        "relationships": {"catalogRecord": {
            "data": {"id": f"/rise/api/catalog-record/{record}"}}},
    }


def test_relationship_ids_read_one_or_many_targets():
    resource = location(records=("10", "11"), states=("UT",))
    assert relationship_ids(resource, "catalogRecords") == ["10", "11"]
    assert relationship_ids(resource, "states") == ["UT"]
    assert relationship_ids(resource, "missing") == []


def test_the_committed_geometry_decides_scope_and_position_decides_duplicates():
    locations = [
        location("1", "New", -109.5, 38.5),
        location("2", "Already there", -109.5005, 38.5),
        location("3", "Outside", -105.0, 38.5),
        location("4", "Not storage", -109.6, 38.5, kind="Canal"),
    ]
    selected, counts = select_locations(
        locations, UNITS, [("old", "Published", -109.5004, 38.5)])

    assert selected == []
    assert counts == {
        "locations": 4,
        "reservoir_locations": 3,
        "located": 3,
        "in_scope": 2,
        "tracked": 2,
    }


def test_a_same_name_far_away_is_still_a_candidate():
    selected, counts = select_locations(
        [location(name="Shared")], UNITS,
        [("old", "Shared", -109.95, 38.5)])

    assert [row["location_id"] for row in selected] == ["1"]
    assert selected[0]["state"] == "CO"
    assert selected[0]["area_states"] == []
    assert selected[0]["huc6"] == "140600"
    assert counts["tracked"] == 0


def test_only_daily_acre_foot_storage_items_survive_the_local_join():
    items = [
        item("100", "10"),
        item("101", "11"),
        item("102", "10", parameter="Lake/Reservoir Elevation", unit="ft"),
        item("103", "10", timestep="monthly"),
        item("104", "10", unit="m3"),
    ]

    selected = storage_items(items, {"10"})

    assert [row["item_id"] for row in selected] == ["100"]
    assert selected[0]["catalog_record_ids"] == ["10"]


def test_a_storage_location_at_a_reviewed_dam_is_already_represented():
    candidate = {"item_id": "new", "name": "Big Lake",
                 "lon": -109.5, "lat": 38.5}
    kept, duplicates = remove_dam_point_duplicates(
        [candidate], [("old", "Big Lake", -109.5005, 38.5)])

    assert kept == []
    assert duplicates[0]["item_id"] == "new"
    assert duplicates[0]["dam_point_duplicates"][0]["source_station_id"] == "old"


def test_the_committed_r2_results_do_not_erase_their_own_audit_evidence():
    admitted = set(refresh.ADMITTED_RISE_RESERVOIRS)
    point_stations = {station for station, *_ in existing_roster_points()}
    dam_point_stations = {station for station, *_ in existing_dam_points()}
    dam_identity_stations = {
        station
        for matches in existing_dam_ids().values()
        for station, _name in matches
    }

    assert admitted.isdisjoint(point_stations)
    assert admitted.isdisjoint(dam_point_stations)
    assert admitted.isdisjoint(dam_identity_stations)
