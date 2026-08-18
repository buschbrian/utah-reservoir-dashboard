"""Network-free checks for the reviewed snow-site inventory."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools.build_snotel_inventory import (  # noqa: E402
    build_inventory,
    refuse_newly_unmonitored,
    validate_inventory,
)


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


def test_a_drainage_area_with_no_sites_is_published_not_refused():
    """Twenty-four of the 75 western basins hold no automated snow site.

    Every one explains itself -- Sonoran and Mojave desert, Pacific coastal
    lowland, Central Valley floor, and three basins that are in Mexico. This
    used to raise, which was right while every area in scope had sites and
    wrong the moment the scope reached ground that has none.
    """
    precise = [unit("111111", "One", 0, 1), unit("222222", "Desert", 1, 2)]
    payload = build_inventory(
        [station("1", 0.5)], precise, precise, scope_name="west-huc6")

    assert payload["by_huc6"] == {"111111": 1, "222222": 0}
    assert payload["unmonitored_areas"] == ["222222"]
    assert payload["unmonitored_area_count"] == 1
    validate_inventory(payload)


def test_an_area_that_had_sites_cannot_quietly_become_unmonitored():
    """A partial failure must not publish as a finding.

    One corrupted unit geometry empties exactly one area while every other
    keeps its sites, so the all-empty guard stays quiet. The transition from
    monitored to unmonitored is what that failure looks like, and it is
    refused against the committed inventory rather than published.
    """
    import pytest

    precise = [unit("111111", "One", 0, 1), unit("222222", "Two", 1, 2)]
    committed = build_inventory(
        [station("1", 0.5), station("2", 1.5)], precise, precise,
        scope_name="west-huc6")
    broken = build_inventory([station("1", 0.5)], precise, precise,
                             scope_name="west-huc6")

    with pytest.raises(ValueError, match="222222"):
        refuse_newly_unmonitored(broken, committed)
    # A desert that has never had a site is a fact, not a transition.
    refuse_newly_unmonitored(broken, broken)
    # A different scope's inventory holds nothing to compare against.
    refuse_newly_unmonitored(
        {**broken, "scope": "utah-connected"}, committed)
    refuse_newly_unmonitored(broken, None)


def test_an_assignment_that_matches_nothing_still_fails():
    """The failure the old guard was really protecting against.

    A changed code field or a geometry mismatch assigns every station to
    nothing, and that must stop the build rather than publish an inventory of
    no sites and call every area unmonitored.
    """
    import pytest

    precise = [unit("111111", "One", 0, 1)]
    with pytest.raises(ValueError, match="do not agree"):
        build_inventory([station("1", 5.0)], precise, precise,
                        scope_name="west-huc6")
