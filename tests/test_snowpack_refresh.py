"""Network-free checks for the independent snow-data refresh."""

import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from refresh_snowpack import (  # noqa: E402
    build_payload,
    build_rollups,
    fetch_all,
    normalize_site,
    water_year_start,
)


def site(station="1:UT:SNTL", huc6="160202", name="Test Site"):
    return {
        "station": station,
        "name": name,
        "state": "UT",
        "county": "Test",
        "lat": 40.0,
        "lon": -111.0,
        "elevation_feet": 8000,
        "begins": "2000-10-01",
        "huc6": huc6,
        "huc6_name": f"Area {huc6}",
        "provider_huc6": huc6,
    }


def record(station="1:UT:SNTL", values=None):
    return {
        "stationTriplet": station,
        "data": [{
            "stationElement": {
                "elementCode": "WTEQ",
                "durationName": "DAILY",
                "storedUnitCode": "in",
            },
            "timingCentralTendencies": {
                "medianPeak": {"month": 4, "day": 1, "value": 12.0},
            },
            "values": values or [
                {"date": "2026-03-01", "value": 6.0, "median": 8.0,
                 "qcFlag": "V", "qaFlag": "P"},
            ],
        }],
    }


def test_short_batch_is_retried_by_station_and_must_be_complete():
    calls = []

    def request(_session, station_ids, _begin, _end):
        calls.append(station_ids)
        if len(station_ids) > 1:
            return [record(station_ids[0])]
        return [record(station_ids[0])]

    rows = fetch_all(None, ["1:UT:SNTL", "2:UT:SNTL"],
                     date(2025, 10, 1), date(2026, 3, 1), request=request)
    assert [row["stationTriplet"] for row in rows] == ["1:UT:SNTL", "2:UT:SNTL"]
    assert calls == [["1:UT:SNTL", "2:UT:SNTL"], ["2:UT:SNTL"]]


def test_missing_station_after_individual_retry_is_an_error():
    """Half the network silent is a broken service, not weather."""
    def request(_session, station_ids, _begin, _end):
        return [record(station_ids[0])] if len(station_ids) > 1 else []

    with pytest.raises(RuntimeError, match="omitted 1 of 2"):
        fetch_all(None, ["1:UT:SNTL", "2:UT:SNTL"],
                  date(2025, 10, 1), date(2026, 3, 1), request=request)


def test_a_few_quiet_stations_do_not_throw_away_the_others():
    """The day is published without them, and they are named.

    These are solar-powered radios in the mountains in winter. Requiring all
    of them to answer means publishing nothing on the days that matter most,
    which is a worse answer than publishing the ones that did.
    """
    stations = [f"{number}:UT:SNTL" for number in range(100)]
    quiet = stations[7]

    def request(_session, station_ids, _begin, _end):
        return [record(station) for station in station_ids if station != quiet]

    received = fetch_all(None, stations, date(2025, 10, 1), date(2026, 3, 1),
                         request=request)
    assert len(received) == len(stations) - 1
    assert quiet not in {row["stationTriplet"] for row in received}


def test_too_many_quiet_stations_is_still_an_error():
    """Past the tolerance the service is wrong, not the weather."""
    stations = [f"{number}:UT:SNTL" for number in range(100)]
    quiet = set(stations[:5])

    def request(_session, station_ids, _begin, _end):
        return [record(station) for station in station_ids if station not in quiet]

    with pytest.raises(RuntimeError, match="omitted 5 of 100"):
        fetch_all(None, stations, date(2025, 10, 1), date(2026, 3, 1),
                  request=request)


def test_zero_median_is_not_divided_and_late_data_is_retained():
    normalized = normalize_site(site(), record(values=[
        {"date": "2026-03-01", "value": 6.0, "median": 8.0},
        {"date": "2026-03-02", "value": 0.0, "median": 0.0},
    ]), date(2026, 3, 6))
    assert normalized["series"][0]["percent_of_normal_median"] == 75.0
    assert normalized["series"][1]["percent_of_normal_median"] is None
    assert normalized["latest_date"] == "2026-03-02"
    assert normalized["late"] is True


def test_rollup_averages_site_percentages_and_enforces_minimum_count():
    sites = []
    for number, percent in enumerate((50.0, 100.0, 150.0), start=1):
        row = site(f"{number}:UT:SNTL")
        row["series"] = [{"date": "2026-03-01",
                          "percent_of_normal_median": percent}]
        sites.append(row)
    rollup = build_rollups(sites, {"160202": "Jordan"})[0]
    assert rollup["series"] == [{
        "date": "2026-03-01",
        "reporting_site_count": 3,
        "mean_percent_of_normal_median": 100.0,
    }]
    rollup = build_rollups(sites[:1], {"160202": "Jordan"})[0]
    assert rollup["series"][0]["mean_percent_of_normal_median"] is None


def test_payload_covers_inventory_and_uses_the_mountain_water_year():
    inventory = {
        "site_count": 1,
        "normal_period": {"start_year": 1991, "end_year": 2020},
        "sites": [site()],
    }
    payload = build_payload(
        inventory,
        [record()],
        date(2026, 3, 1),
        datetime(2026, 3, 1, 12, tzinfo=timezone.utc),
    )
    assert water_year_start(date(2026, 3, 1)) == date(2025, 10, 1)
    assert payload["water_year"] == 2026
    assert payload["site_count"] == 1
    assert payload["generated_at"] == "2026-03-01T12:00:00Z"
    assert payload["site_series_fields"] == [
        "series_days", "series_values", "series_normals"]
    # The dates are written once for the whole file and each site names the
    # ones it published, as positions in that list. Rebuilding this site's
    # single row has to give back exactly the row it used to publish.
    assert payload["series_dates"] == ["2026-03-01"]
    site_out = payload["sites"][0]
    assert site_out["series_days"] == [0]
    assert site_out["series_values"] == [6.0]
    assert site_out["series_normals"] == [8.0]
    assert "series" not in site_out
    rebuilt = [
        [payload["series_dates"][day], value, normal]
        for day, value, normal in zip(
            site_out["series_days"], site_out["series_values"],
            site_out["series_normals"])
    ]
    assert rebuilt == [["2026-03-01", 6.0, 8.0]]
