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

from tools.audit_cdec_stations import (  # noqa: E402
    AGGREGATE_NAME, already_tracked, parse_station_table, simple_name, usable,
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
