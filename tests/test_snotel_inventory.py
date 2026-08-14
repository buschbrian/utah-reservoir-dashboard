"""Network-free checks for the reviewed snow-site inventory."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools.build_snotel_inventory import build_inventory, validate_inventory  # noqa: E402


def unit(huc6, name, left, right):
    return {
        "huc6": huc6,
        "name": name,
        "polygons": [[[[left, 0], [right, 0], [right, 1], [left, 1], [left, 0]]]],
    }


def station(number, lon, *, name=None, provider_huc="111111999999"):
    return {
        "stationTriplet": f"{number}:UT:SNTL",
        "name": name or f"Site {number}",
        "stateCode": "UT",
        "countyName": "Test",
        "latitude": 0.5,
        "longitude": lon,
        "elevation": 8000,
        "beginDate": "2000-10-01 00:00",
        "huc": provider_huc,
    }


def test_full_resolution_geometry_controls_inclusion_and_assignment():
    precise = [unit("111111", "One", 0, 1), unit("222222", "Two", 1, 2)]
    # The generalized divide is shifted east. Site 2 is falsely included;
    # Site 3 is filed under the wrong unit.
    generalized = [unit("111111", "One", 0, 1.2), unit("222222", "Two", 1.2, 2.2)]
    stations = [station("1", 0.5), station("2", 2.1), station("3", 1.1)]

    payload = build_inventory(
        stations, precise, generalized, scope_name="utah-connected")

    assert [site["station"] for site in payload["sites"]] == [
        "1:UT:SNTL", "3:UT:SNTL"]
    assert next(site for site in payload["sites"]
                if site["station"] == "3:UT:SNTL")["huc6"] == "222222"
    assert payload["assignment_review"] == [
        {"station": "2:UT:SNTL", "name": "Site 2",
         "full_resolution_huc6": None, "generalized_huc6": "222222"},
        {"station": "3:UT:SNTL", "name": "Site 3",
         "full_resolution_huc6": "222222", "generalized_huc6": "111111"},
    ]
    validate_inventory(payload)


def test_committed_inventory_is_internally_complete():
    payload = json.loads((ROOT / "snow_sites.json").read_text(encoding="utf-8"))
    validate_inventory(payload)
    assert set(payload["by_huc6"]) == {
        "140100", "140300", "140401", "140500", "140600", "140700", "140802",
        "150100", "160101", "160102", "160201", "160202", "160203", "160300",
    }
    assert payload["selection"]["watershed_geometry"] == "full_resolution"
    assert payload["normal_period"] == {"start_year": 1991, "end_year": 2020}
