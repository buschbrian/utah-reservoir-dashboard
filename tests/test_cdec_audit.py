"""The judgements the CDEC audit makes before a reviewer sees anything.

The fetching is not tested here -- it is a live public service, and
`tests/test_refresh.py` holds the parsing contract for the data itself. What
is tested is the three screens this tool applies on a reviewer's behalf, each
of which was written because the first run got it wrong:

  - a station list that is not a reservoir roster,
  - a duplicate that position alone cannot see,
  - a station table whose shape changed underneath the parse.
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from admission import Decision, Match  # noqa: E402
from tools.audit_cdec_stations import (  # noqa: E402
    AGGREGATE_NAME, already_tracked, parse_station_table, quiet_cutoff,
    reading_day, review, simple_name, usable,
)


# --- the missing sentinel -------------------------------------------------

def test_the_missing_sentinel_is_not_a_reading():
    """`-9999` is a number, which is what makes it dangerous."""
    assert usable(-9999) is None
    assert usable(-1) is None
    assert usable(None) is None
    assert usable("1234") is None, "a string is not a reading either"


def test_an_empty_reservoir_is_a_reading():
    """Zero storage and no reading are different facts (ADR-056's distinction)."""
    assert usable(0) == 0.0
    assert usable(1234.5) == 1234.5


# --- a station list is not a reservoir roster -----------------------------

@pytest.mark.parametrize("name", [
    "Statewide Storage Estimate (154)",
    "Thermalito  Total",
    "San Luis Reservoir (Federal)",
    "San Luis Reservoir (State)",
    "Lake Spaulding S Yuba System",
])
def test_an_aggregate_is_not_admitted_as_a_reservoir(name):
    """These rows are sums, and the service gives them a reservoir's shape.

    The statewide row reports 33.9 million acre-feet -- a third of everything
    this site publishes -- and San Luis appears three times, whole and in two
    shares. Admitting any of them double counts.
    """
    assert AGGREGATE_NAME.search(name), f"{name!r} should be held back for review"


@pytest.mark.parametrize("name", [
    "San Luis Reservoir", "Shasta Dam", "Lake Almanor", "Folsom Lake",
    "Don Pedro Reservoir",
])
def test_a_reservoir_is_not_mistaken_for_an_aggregate(name):
    """The screen is a heuristic on names, so its false positives matter."""
    assert not AGGREGATE_NAME.search(name), f"{name!r} is a reservoir"


# --- a duplicate position alone cannot see --------------------------------

#: Lake Mead as this site publishes it (ADR-058: the waterbody) and as this
#: service publishes it (the dam). 41.8 km apart, and the same reservoir.
SITE_MEAD = (-114.2733, 36.0467)
HOOVER_DAM = (-114.7360, 36.0160)


def test_position_alone_would_admit_lake_mead_twice():
    """The measurement this whole screen exists because of.

    28 million acre-feet, already published, and a position test at any sane
    radius calls it new. ADR-011 and ADR-062 make Lake Mead a control
    precisely because a total that silently holds it is a different
    measurement from one that does not -- and a total that holds it *twice*
    is not a measurement at all.
    """
    station = {"name": "Lake Mead", "lon": HOOVER_DAM[0], "lat": HOOVER_DAM[1]}
    # Position against the published waterbody point: misses it.
    assert already_tracked(station, [SITE_MEAD], [], set()) is None
    # Against the reviewed dam point: catches it.
    assert already_tracked(station, [SITE_MEAD], [HOOVER_DAM], set()) \
        == "the reviewed dam point"
    # And so does the name, which is the third independent signal.
    assert already_tracked(station, [SITE_MEAD], [], {"mead"}) == "name"


def test_a_near_miss_on_position_is_caught_by_name():
    """Upper Klamath sits 2.1 km away -- just outside the radius."""
    station = {"name": "Upper Klamath", "lon": -121.8150, "lat": 42.2500}
    far = (-121.7900, 42.2500)
    assert already_tracked(station, [far], [], set()) is None
    assert already_tracked(station, [far], [], {"upper klamath"}) == "name"


def test_a_station_we_do_not_track_stays_a_candidate():
    """The screen must not swallow the reservoirs the tool exists to find."""
    station = {"name": "Some New Reservoir", "lon": -120.0, "lat": 38.0}
    assert already_tracked(station, [SITE_MEAD], [HOOVER_DAM], {"mead"}) is None


def test_names_reduce_to_what_two_providers_would_agree_on():
    """One provider writes "Lake Mead", another "Mead Reservoir"."""
    assert simple_name("Lake Mead") == simple_name("Mead Reservoir") == "mead"
    assert simple_name("Boca Reservoir") == simple_name("Boca") == "boca"
    # And it must not collapse two different reservoirs into one name.
    assert simple_name("Willow Creek Reservoir") != simple_name("Willow Lake")


# --- the roster is HTML, and HTML changes shape ---------------------------

HEADER = ("<tr><th>ID</th><th>Station Name</th><th>River Basin</th>"
          "<th>County</th><th>Longitude</th><th>Latitude</th>"
          "<th>ElevationFeet</th><th>Operator</th></tr>")


def row(station, name, lon, lat):
    return (f"<tr><td>{station}</td><td>{name}</td><td>BASIN</td><td>COUNTY</td>"
            f"<td>{lon}</td><td>{lat}</td><td>1,000</td><td>Operator</td></tr>")


def test_the_station_table_parses_to_stations():
    stations = parse_station_table(
        f"<table>{HEADER}{row('SHA', 'SHASTA', -122.417, 40.718)}</table>")
    assert stations == [{
        "station": "SHA", "name": "Shasta", "basin": "BASIN",
        "county": "COUNTY", "lon": -122.417, "lat": 40.718,
        "operator": "Operator",
    }]


def test_a_reshaped_table_raises_rather_than_returning_a_short_list():
    """A silently short roster reads exactly like a service retiring stations.

    The columns are positional, so one inserted upstream shifts every field --
    and a roster of reservoirs at the wrong coordinates is worse than no
    roster at all.
    """
    moved = HEADER.replace("<th>ID</th>", "<th>Agency</th><th>ID</th>")
    with pytest.raises(RuntimeError, match="changed shape"):
        parse_station_table(f"<table>{moved}</table>")


def test_a_page_with_no_table_raises():
    with pytest.raises(RuntimeError, match="no table"):
        parse_station_table("<html><body>service unavailable</body></html>")


def test_a_table_of_headers_and_nothing_else_raises():
    with pytest.raises(RuntimeError, match="no stations"):
        parse_station_table(f"<table>{HEADER}</table>")


def test_a_coordinate_outside_the_state_is_a_parse_fault_not_a_station():
    """Shifted columns can still parse as floats. The box catches that."""
    stations = parse_station_table(
        f"<table>{HEADER}"
        f"{row('SHA', 'SHASTA', -122.417, 40.718)}"
        f"{row('BAD', 'ELSEWHERE', 1000, 2000)}</table>")
    assert [s["station"] for s in stations] == ["SHA"]


# --- what a roster builder is allowed to read -----------------------------


def candidate(station, name, highest, observed=None):
    return {"station": station, "name": name, "lon": -121.0, "lat": 37.0,
            "state": "CA", "huc6": "180400", "huc6_name": "San Joaquin",
            "operator": "Department of Water Resources",
            "observed_max_af": observed if observed is not None else highest[0],
            "highest_readings": highest, "readings": len(highest)}


def test_a_candidate_nothing_disagrees_about_is_publishable():
    decision = Decision("Shasta Dam", True, "confirmed by name and position",
                        None, 4552090.0, "normal_storage")
    row = review(candidate("SHA", "Shasta Dam", [4476827, 4470000, 4460000]),
                 decision, 4552000.0)
    assert row["publishable"] is True
    assert row["discrepancies"] == []


def test_the_service_own_full_level_settles_a_disagreement_with_the_inventory():
    # Keswick: matched at 0.03 km, and two sources 69% apart on what full is.
    # The operator publishes one of them (ADR-070), so the pair is no longer
    # a reason to withhold the reservoir -- and the water standing at 22,928
    # acre-feet, above the inventory's pool and inside the service's, is the
    # measurement that says which figure the operator was describing.
    decision = Decision("Keswick Reservoir", True, "confirmed by name and position",
                        None, 7470.0, "normal_storage")
    row = review(candidate("KES", "Keswick Reservoir", [22928, 22000, 21000]),
                 decision, 23772.0)
    assert row["admitted"] is True
    assert row["publishable"] is True
    assert row["discrepancies"] == []


def test_the_inventory_still_holds_a_reservoir_the_service_says_nothing_about():
    # The rule reaches only as far as the service's own report. Where it
    # publishes no full level there is no second figure to prefer, and the
    # inventory's pool is both the denominator and the screen.
    decision = Decision("Jackson Meadows", True, "confirmed by position",
                        None, 53100.0, "normal_storage")
    row = review(candidate("JCK", "Jackson Meadows (Nevada Co Wd)",
                           [68700, 68000, 67000]), decision, None)
    assert row["publishable"] is False
    assert [found["screen"] for found in row["discrepancies"]] == [
        "seen above the capacity it would be divided by"]


def test_a_reservoir_above_even_its_own_operators_figure_is_still_held():
    # Buchanan: 172,105 acre-feet seen against the 150,000 its operator
    # calls full. The rule chooses a denominator; it does not explain water
    # standing 15% above the one the operator published.
    decision = Decision("Buchanan Dam", True, "confirmed by position",
                        None, 122576.0, "normal_storage")
    row = review(candidate("BUC", "Buchanan Dam", [172105, 170000, 168000]),
                 decision, 150000.0)
    assert row["publishable"] is False
    assert [found["screen"] for found in row["discrepancies"]] == [
        "seen above the capacity it would be divided by"]
    assert "150,000" in row["discrepancies"][0]["detail"], \
        "the figure named is the one being divided by"


def test_a_refusal_is_never_publishable():
    decision = Decision("San Luis Reservoir", False, "no dam close enough to confirm")
    row = review(candidate("SNL", "San Luis Reservoir", [2028217, 2018313, 2014762]),
                 decision, 2041000.0)
    assert row["publishable"] is False
    assert row["discrepancies"][0]["screen"] == "no confirmed dam"


def test_the_evidence_row_states_the_service_figure_beside_the_inventory_one():
    # The service's figure is the denominator now, and the inventory's is
    # kept beside it rather than overwritten: the decision was made from the
    # pair, and a reviewer reading one number cannot check it.
    match = Match({"name": "Loon Lake Auxiliary", "lon": -120.33, "lat": 38.98,
                   "normal_storage_af": 51000.0, "max_storage_af": 69309.0,
                   "nid_storage_af": 69309.0, "nid_id": "CA00820"},
                  0.977, "position")
    decision = Decision("Loon Lake", True, "confirmed by position",
                        match, 51000.0, "normal_storage")
    row = review(candidate("LON", "Loon Lake (Smud)", [67977, 67600, 67460]),
                 decision, 69306.0)
    assert row["capacity_af"] == 69306.0
    assert row["capacity_basis"] == "cdec_reservoir_report"
    assert row["inventory_capacity_af"] == 51000.0
    assert row["inventory_capacity_basis"] == "normal_storage"
    assert row["service_capacity_af"] == 69306.0
    assert row["normal_storage_af"] == 51000.0, \
        "the record the dam match was made against is untouched"


# --- a station that answers, but not this year ----------------------------

def test_a_reading_day_is_read_from_an_unpadded_stamp():
    """The servlet writes `2026-8-1 00:00`, so the strings do not sort."""
    assert reading_day("2026-8-1 00:00") == "2026-08-01"
    assert reading_day("2026-08-10 00:00") == "2026-08-10"
    assert reading_day("2023-3-1 00:00") < reading_day("2023-11-1 00:00"), \
        "March must not sort after November"


def test_a_stamp_with_no_day_in_it_is_not_a_day():
    assert reading_day(None) == ""
    assert reading_day("") == ""
    assert reading_day("not a date") == ""
    assert reading_day("2026-08 00:00") == ""


def test_the_quiet_cutoff_is_a_year_back():
    import time as _time
    assert quiet_cutoff(_time.struct_time(
        (2026, 8, 20, 0, 0, 0, 0, 0, 0))) == "2025-08-20"


def test_bon_tempe_is_the_station_the_cutoff_exists_for():
    """Five usable readings ever, the last in March 2023.

    Admitted on the whole record it would join the roster and be withdrawn
    for a quiet feed the same morning (ADR-056). Measured across the 159
    candidates of 2026-08-20, this screen moves exactly two: Bon Tempe, which
    was publishable, and Guadalupe, which was held for a spike anyway.
    """
    import time as _time
    cutoff = quiet_cutoff(_time.struct_time((2026, 8, 20, 0, 0, 0, 0, 0, 0)))
    assert reading_day("2023-3-1 00:00") < cutoff
    assert reading_day("2026-8-1 00:00") > cutoff
