"""The judgements the Colorado audit makes before a reviewer sees anything.

The fetching is not tested here -- it is a live public service. What is
tested are the screens this tool applies on a reviewer's behalf and the
service facts they rest on:

  - a storage station list that includes recharge ponds and systems,
  - a station that answers but not this year (Gross Reservoir is the reason),
  - the reading-day parse this service's two stamp shapes both feed,
  - what a roster builder may read out of a decision made with no
    service-published capacity to prefer.
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from admission import Decision, Match  # noqa: E402
import tools.audit_cdss_stations as cdss_audit  # noqa: E402
from tools.audit_cdss_stations import (  # noqa: E402
    quiet_cutoff, reading_day, review,
)

#: An empty published roster: no waterbody points, no reviewed dam points, so
#: every screen after the structure and freshness ones lets the station pass.
NOTHING_PUBLISHED = ([], set())


# --- the two reading-stamp shapes -----------------------------------------

def test_a_station_stamp_reads_as_its_own_day():
    """The station row carries an offset: `2026-08-21T15:00:00-06:00`."""
    assert reading_day("2026-08-21T15:00:00-06:00") == "2026-08-21"


def test_a_series_stamp_reads_as_its_own_day():
    """The series rows carry none: `2026-07-01T00:00:00`."""
    assert reading_day("2026-07-01T00:00:00") == "2026-07-01"


def test_a_stamp_with_no_day_in_it_is_not_a_day():
    assert reading_day(None) == ""
    assert reading_day("") == ""
    assert reading_day("not a date") == ""
    assert reading_day("2026-13-01T00:00:00") == "", "an impossible date too"


def test_the_quiet_cutoff_is_a_year_back():
    import datetime as _dt
    assert quiet_cutoff(_dt.date(2026, 8, 20)) == "2025-08-20"


# --- a station list is not a reservoir roster ------------------------------

STATION = {"abbrev": "GRARESCO", "stationName": "GRANBY RESERVOIR",
           "structureType": "Reservoir", "parameter": "STORAGE",
           "wdid": "0505622", "county": "GRAND",
           "longitude": -105.85, "latitude": 40.15,
           "measDateTime": "2026-08-21T06:00:00-06:00",
           "stationPorStart": "1985-10-01T00:00:00-06:00"}


@pytest.fixture()
def classify_isolated(monkeypatch):
    """classify() with no repository files behind it."""
    monkeypatch.setattr(cdss_audit, "load_units", lambda: [])
    return lambda stations: cdss_audit.classify(
        stations, published=NOTHING_PUBLISHED, dam_points=[])


def test_recharge_ponds_are_not_reservoirs(classify_isolated):
    """13 storage stations sit on recharge facilities; none may be admitted."""
    pond = {**STATION, "abbrev": "ARFHEAD2", "structureType": "Recharge Area"}
    found = classify_isolated([pond])
    assert found["candidates"] == []
    assert [s["abbrev"] for s in found["not_reservoirs"]] == ["ARFHEAD2"]


def test_a_system_station_is_reported_rather_than_admitted(classify_isolated):
    """One station reports several reservoirs against one row; it has no one
    dam to hold its water, so it cannot be given one denominator."""
    system = {**STATION, "abbrev": "SYSDWRES", "structureType": "Reservoir System"}
    found = classify_isolated([system])
    assert found["candidates"] == []
    assert [s["abbrev"] for s in found["not_reservoirs"]] == ["SYSDWRES"]


def test_a_quiet_station_is_not_a_candidate(classify_isolated):
    """Gross Reservoir answered last in 2021 -- listed against the sensor and
    five years dead. Admitted, ADR-056 would withdraw it the same morning."""
    dead = {**STATION, "abbrev": "GROSRECO", "stationName": "GROSS RESERVOIR",
            "measDateTime": "2021-09-20T06:00:00-06:00"}
    found = classify_isolated([dead])
    assert found["candidates"] == []
    assert [s["abbrev"] for s in found["quiet"]] == ["GROSRECO"]
    assert found["quiet"][0]["last_reading"] == "2021-09-20"


def test_an_unmeasurable_last_reading_is_treated_as_quiet(classify_isolated):
    """A station whose latest-reading stamp does not parse has no evidence it
    spoke within the year, which is the same state as being quiet."""
    blank = {**STATION, "measDateTime": None}
    found = classify_isolated([blank])
    assert found["candidates"] == []


def test_a_candidate_carries_its_drainage_area_and_identity(
        monkeypatch):
    """Everything a reviewer needs to trace the admission: the abbrev keying
    the roster (ADR-066), the point, the area, and the period of record."""
    monkeypatch.setattr(cdss_audit, "load_units", lambda: [])
    unit = {"huc6": "140200", "name": "Gunnison", "states": "CO"}
    monkeypatch.setattr(cdss_audit, "assign_huc", lambda *a: unit)
    found = cdss_audit.classify([{**STATION}], published=NOTHING_PUBLISHED,
                          dam_points=[])
    assert len(found["candidates"]) == 1
    row = found["candidates"][0]
    assert row["abbrev"] == "GRARESCO"
    assert row["state"] == "CO"
    assert row["dam_states"] == ["CO"]
    assert row["huc6"] == "140200"
    assert row["por_start"] == "1985-10-01"


def test_a_station_outside_every_drawn_area_waits(monkeypatch):
    monkeypatch.setattr(cdss_audit, "load_units", lambda: [])
    monkeypatch.setattr(cdss_audit, "assign_huc", lambda *a: None)
    found = cdss_audit.classify([{**STATION}], published=NOTHING_PUBLISHED,
                          dam_points=[])
    assert found["candidates"] == []
    assert [s["abbrev"] for s in found["outside"]] == ["GRARESCO"]


def test_a_station_already_published_by_name_is_not_a_candidate(monkeypatch):
    """The third dedupe signal. Position catches what sits where; the name
    catches what moved -- and both exist because Lake Mead is 41.9 km apart
    in its two providers' records."""
    monkeypatch.setattr(cdss_audit, "load_units", lambda: [])
    found = cdss_audit.classify(
        [{**STATION}],
        published=([(0.0, 0.0)], {cdss_audit.simple_name(STATION["stationName"])}),
        dam_points=[])
    assert found["candidates"] == []
    assert [s["abbrev"] for s in found["already_tracked"]] == ["GRARESCO"]


# --- what a roster builder is allowed to read ------------------------------


def candidate():
    return {"abbrev": "DILRESCO", "wdid": "0504825", "gnis_id": "0016530",
            "name": "DILLON RESERVOIR", "state": "CO", "huc6": "140100",
            "huc6_name": "Colorado Headwaters", "lat": 39.63, "lon": -106.05,
            "county": "SUMMIT", "por_start": "1985-04-01",
            "last_reading": "2026-08-21", "readings": 4100,
            "observed_max_af": 248_000.0,
            "highest_readings": [248_000.0, 247_500.0, 247_000.0]}


def test_a_candidate_nothing_disagrees_about_is_publishable():
    match = Match({"name": "Dillon Dam", "lon": -106.06, "lat": 39.62,
                   "normal_storage_af": 254_164.0, "max_storage_af": 269_000.0,
                   "nid_storage_af": 257_900.0, "nid_id": "CO00229"},
                  0.84, "position")
    decision = Decision("DILLON RESERVOIR", True, "confirmed by position",
                        match, 254_164.0, "normal_storage")
    row = review(candidate(), decision)
    assert row["publishable"] is True
    assert row["discrepancies"] == []
    assert row["capacity_af"] == 254_164.0
    assert row["capacity_basis"] == "normal_storage"
    assert "service_capacity_af" not in row, \
        "this provider publishes no full level of its own"


def test_this_provider_cannot_prefer_its_own_figure():
    """ADR-070 never fires here: there is nothing to prefer, so the inventory
    rule (ADR-003) decides every percentage Colorado publishes."""
    decision = Decision("X", True, "confirmed by position", None,
                        40_146.0, "normal_storage")
    row = review({**candidate(), "abbrev": "LEMRESCO"}, decision)
    assert row["capacity_basis"] == "normal_storage"


def test_a_refusal_is_never_publishable():
    decision = Decision("SOME RESERVOIR", False, "no dam close enough to confirm")
    row = review(candidate(), decision)
    assert row["publishable"] is False
    assert row["discrepancies"][0]["screen"] == "no confirmed dam"


def test_a_spike_is_held_for_review():
    """A wrong once-in-the-record reading is held, exactly as CDEC's are:
    the third-highest reading is what the screen trusts."""
    decision = Decision("SPIKE RESERVOIR", True, "confirmed by position",
                        None, 50_000.0, "normal_storage")
    spiked = candidate()
    spiked["highest_readings"] = [500_000.0, 49_000.0, 48_000.0]
    spiked["observed_max_af"] = 500_000.0
    row = review(spiked, decision)
    assert row["admitted"] is True
    assert row["publishable"] is False
    assert [found["screen"] for found in row["discrepancies"]] == [
        "unstable maximum", "seen above the capacity it would be divided by"]


def test_the_denominator_is_a_figure_the_water_has_not_been_seen_above():
    """ADR-072 applied where Colorado's denominators are chosen.

    Alsbury's record offers 181 (conservation) and 429 (maximum) and has
    stood at 226 acre-feet. The plain preference would divide by 181 and
    publish "125% full" as an ordinary state; the record's own larger figure
    contains the water, and that is the one a percentage divides by.
    """
    match = Match({"name": "Alsbury", "lon": -107.4839, "lat": 39.3333,
                   "normal_storage_af": 181.0, "max_storage_af": 429.0,
                   "nid_storage_af": 429.0, "nid_id": "CO02808"},
                  0.085, "name and position")
    decision = Decision("ALSBURY RESERVOIR", True,
                        "confirmed by name and position", match,
                        181.0, "normal_storage")
    alsbury = candidate()
    alsbury["abbrev"] = "ALSRESCO"
    alsbury["observed_max_af"] = 226.1
    alsbury["highest_readings"] = [226.1, 225.0, 224.0]
    row = review(alsbury, decision)
    assert row["capacity_af"] == 429.0
    assert row["capacity_basis"] == "max_storage"
    assert row["publishable"] is True, \
        "the screen measures against the figure actually chosen"
    assert row["discrepancies"] == []


def test_the_evidence_row_keeps_the_dam_record_beside_the_decision():
    match = Match({"name": "Some Dam", "lon": -106.0, "lat": 39.6,
                   "normal_storage_af": 12_000.0, "max_storage_af": 14_000.0,
                   "nid_storage_af": 13_000.0, "nid_id": "CO00000"},
                  0.31, "position")
    decision = Decision("SOME RESERVOIR", True, "confirmed by position",
                        match, 12_000.0, "normal_storage")
    row = review(candidate(), decision)
    assert row["nid_id"] == "CO00000"
    assert row["normal_storage_af"] == 12_000.0
    assert row["match_distance_km"] == 0.31
