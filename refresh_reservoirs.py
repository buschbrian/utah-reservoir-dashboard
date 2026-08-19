"""Refresh reservoirs.json for the Utah Reservoir Drought Dashboard.

Pulls daily storage (af) from Reclamation RISE and daily/monthly storage
from USDA NRCS AWDB for the wider Utah reservoir inventory, then computes a
set of drought metrics per reservoir:

- pct_of_record_max: current storage vs. the highest storage seen in the
  pulled date range (proxy for % of physical capacity, not the real thing).
- seasonal_percentile: where today's storage ranks against *prior years'*
  values within a 7-day day-of-year window. Prior years only, so "lowest
  this week has ever been" can actually read as 0.
- seasonal_normal_af / pct_of_seasonal_normal: today's storage against the
  median storage for this same week in prior years -- the "is this normal
  for August?" read that pct_of_record_max can't give you.
- 7/30/365-day changes, this year's peak, and a 12-month monthly history
  (with a per-calendar-month normal from prior years) for the trend chart
  and table in the dashboard popups.

Every reservoir also carries explicit freshness fields (as_of, days_stale,
is_stale, fetch_ok). Reclamation's feed can go quiet for an individual
reservoir for days at a time while every other one keeps updating, and the
old version of this script published those frozen values indistinguishably
from fresh ones. Now staleness is data, and the dashboards render it.

No local CSV cache -- this always re-pulls the full date range fresh, since
it runs in an ephemeral GitHub Actions environment. RISE's own disclaimer:
data is provisional and recent values are subject to revision.
"""

import argparse
import datetime as dt
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

import huc
import watershed_scopes

RISE_RESULT_URL = "https://data.usbr.gov/rise/api/result"
AWDB_DATA_URL = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data"
START_DATE = "20150101"
SEASONAL_WINDOW_DAYS = 7
OUTPUT_PATH = Path(__file__).parent / "reservoirs.json"
CAPACITY_PATH = Path(__file__).parent / "capacities.json"
CONNECTED_RESERVOIRS_PATH = Path(__file__).parent / "connected_reservoirs.json"
NORMALS_PATH = Path(__file__).parent / "normals.json"
COUNTIES_PATH = Path(__file__).parent / "counties.json"
EXPORT_PATH = Path(__file__).parent / "reference.json"

# A reservoir whose newest observation is older than this many days is
# flagged is_stale and called out in the run log and in the dashboards.
# 2 days is deliberately tight: RISE normally publishes through yesterday,
# so anything past "yesterday, plus a day of slack" is a real signal.
STALE_AFTER_DAYS = 2
AWDB_MONTHLY_STALE_AFTER_DAYS = 45

# A reservoir whose newest observation is older than this many days is
# withdrawn from the payload entirely rather than published as stale.
#
# Being late and being from another season are different faults, and the
# second one is not fixed by a label. `carry_forward` keeps publishing the
# last known value because a point vanishing from the map with no explanation
# is worse than a point that says it is a few days behind -- that is right,
# and it stays right, for a gap measured in days.
#
# It stops being right somewhere before two months. A May reading standing in
# an August column is not a late measurement of August, it is an accurate
# measurement of spring, and the difference between those is most of the melt.
# Storage here is strongly seasonal: it is the same reason the seasonal
# normal compares a date against the same date in prior years instead of
# against an annual mean. Worse, `statewideRollup` sums `current_storage_af`
# across the scope with no freshness filter, so a carried-forward spring
# figure is not merely displayed out of season, it is added into a regional
# total presented as now.
#
# 60 days rather than a strict calendar two months because the threshold has
# to clear a month-end feed that has missed one publication: such a feed can
# legitimately reach about 45 days (AWDB_MONTHLY_STALE_AFTER_DAYS) before
# anything is wrong, and 60 leaves it room without letting a whole season
# through. ADR-056.
WITHDRAW_AFTER_DAYS = 60

# Which baseline the site opens on.
#
# "climate" is the 1991-2020 standard, and it is the default because the
# alternative was never a choice anybody made: the recent baseline exists only
# because START_DATE is 2015, and 2015 onward is the driest stretch in the
# modern record here. A reservoir measured against it is measured against the
# drought, so a bad year reads as ordinary. The snowpack half of the site has
# always used 1991-2020, so this also makes one dashboard use one definition
# of normal. Change this one constant to open on the recent baseline instead;
# both are published either way and the reader can switch.
DEFAULT_BASELINE = "climate"

# A baseline built from fewer than this many calendar years is published with
# its year count, but is not offered as the default for that reservoir. Ten
# years is where a median stops being a description of one decade's weather.
MIN_BASELINE_YEARS = 10

# Version of the reference export's shape, not of the numbers in it. It is
# here so a reader that finds a payload it does not understand can say so
# instead of quietly rendering half of it.
#
# 3 since ADR-066: `capacity_catalog.capacities` is keyed by the station id
# every reservoir record already publishes as `source_station_id`, and was
# keyed by the reservoir's name. That is a break, and it is versioned rather
# than slipped in -- a name cannot key a roster that holds two Lost Creeks,
# and a consumer indexing by name should be told rather than left to find a
# key it knows has quietly become a different reservoir's.
EXPORT_SCHEMA_VERSION = 3
RESERVOIR_SCHEMA_VERSION = 1

# name -> (RISE catalog-item id for "Daily Instantaneous Lake/Reservoir
# Storage (af)", lat, lon). The first 12 item IDs and the seasonal/record-max
# methodology come directly from Brian's original notebook
# (~/Developer/mtnwest-geo/reservoir_levels.ipynb); the other 16 were
# rediscovered via the same RISE location -> catalogRecord -> catalogItem
# walk documented there, filtered to stateId=UT, types=Reservoir, and
# parameterName == "Lake/Reservoir Storage" -- since that mapping was never
# committed anywhere despite the 28-reservoir statewide expansion using it.
#
# IMPROVEMENT: this mapping is hand-maintained and has no verification step.
# If Reclamation retires a catalog item (which is one of the plausible
# explanations for a reservoir going permanently stale), this dict keeps
# happily requesting a dead id and gets an empty series back forever. Worth
# adding a weekly job that re-walks location -> catalogRecord -> catalogItem
# for stateId=UT and diffs the discovered ids against this dict.
#
# RISE catalog item id -> (name, latitude, longitude). Keyed by the id and not
# by the name, because a name is not an identity: the west holds a Lost Creek
# in Utah and another in Oregon, 946 km apart, and a name-keyed roster cannot
# hold both -- the second silently becomes the first, with its capacity, its
# climate normal and its link (ADR-066). The id is what the payload already
# publishes as `source_station_id`, and ADR-003 already calls it the stable
# provider identity.
RESERVOIRS = {
    "290": ("Deer Creek", 40.43511, -111.50035),
    "468": ("Jordanelle", 40.60689, -111.41655),
    "779": ("Strawberry", 40.16882, -111.1311),
    "706": ("Rockport", 40.77498, -111.39859),
    "314": ("Echo", 40.9574, -111.4179),
    "310": ("East Canyon", 40.91017, -111.59293),
    "652": ("Pineview", 41.26543, -111.80998),
    "866": ("Willard Bay", 41.37738, -112.08339),
    "727": ("Scofield", 39.77656, -111.05074),
    "764": ("Starvation", 40.19324, -110.44722),
    "337": ("Flaming Gorge", 40.97789, -109.57304),
    "509": ("Lake Powell", 37.05778, -111.30332),
    # RISE item 6124, reached by walking location 3514 -> catalog record 4370
    # (Lower Colorado Hydrologic Database) -> its four water-operations items.
    # The `locationId` query filter is ignored by the API and returns an
    # unfiltered page, which is how four Utah reservoirs first came back
    # wearing Lake Mead's name; the walk is the way in (ADR-062).
    #
    # The point is "Lake Mead At Temple Bar", RISE location 3534 -- on the
    # water, like every other published point here. The obvious choice was
    # Hoover Dam, which is what RISE publishes for the *storage* location, and
    # it is the one point on this lake that cannot be used: the dam is the
    # basin outlet, so it sits exactly on the 150100 divide (ADR-062).
    "6124": ("Lake Mead", 36.0467, -114.2733),
    "219": ("Causey", 41.29828, -111.58591),
    "278": ("Currant Creek", 40.33841, -111.05821),
    "432": ("Huntington North", 39.38458, -111.09082),
    "439": ("Hyrum", 41.62117, -111.86099),
    "463": ("Joes Valley", 39.2901, -111.27888),
    "544": ("Lost Creek", 41.18887, -111.39628),
    "574": ("Meeks Cabin", 41.01664, -110.58344),
    "587": ("Moon Lake", 40.57445, -110.50665),
    "623": ("Newton", 41.8998, -111.97562),
    "685": ("Red Fleet", 40.57832, -109.42853),
    "769": ("Stateline", 40.98291, -110.39038),
    "774": ("Steinaker", 40.51456, -109.53275),
    "4516": ("Trial Lake", 40.6799, -110.956839),
    "826": ("Upper Stillwater", 40.56565, -110.70044),
    "4530": ("Washington Lake", 40.6765, -110.964),
    "4523": ("Lost Lake", 40.6741, -110.9413),
    # Wyoming, on the Green above Flaming Gorge. Admitted under the
    # intersect-Utah rule (ADR-009): its dam sits in 140401 Upper Green,
    # one of the fifteen drainage areas that touch the state. It is the
    # only one of Reclamation's five Upper Colorado candidates that
    # qualifies -- the other four drain through basins that never enter
    # Utah. See tools/audit_connected_reservoirs.py.
    "347": ("Fontenelle", 42.05781, -110.09665),
}

# Additional reservoirs in the Utah Division of Water Resources' statewide
# inventory that are not in the RISE set above. AWDB's RESC element is
# reservoir storage volume in acre-feet. Only Utah Lake and Smith and
# Morehouse currently publish a current daily series; the other stations are
# derived monthly values and are deliberately labeled/aged as monthly data.
# Station triplet -> (name, lat, lon, capacity af, cadence). Keyed by the
# triplet for the reason the RISE roster is keyed by its item id: a name is a
# label, not an identity (ADR-066).
BASE_AWDB_RESERVOIRS = {
    "10055500:ID:BOR": ("Bear Lake", 42.11667, -111.30000, 1302000.0, "monthly"),
    "09UTBSWR:UT:BOR": ("Big Sand Wash", 40.30006, -110.22139, 25700.0, "monthly"),
    "09UTCLEV:UT:BOR": ("Cleveland", 39.57758, -111.23896, 5400.0, "monthly"),
    "10UTGTVL:UT:BOR": ("Grantsville", 40.54185, -112.50567, 3300.0, "monthly"),
    "09UTGUNL:UT:BOR": ("Gunlock", 37.25136, -113.77556, 10400.0, "monthly"),
    "10216200:UT:BOR": ("Gunnison", 39.20635, -111.71103, 20300.0, "monthly"),
    "09UTJACK:UT:BOR": ("Jackson Flat", 37.00576, -112.51995, 4083.0, "monthly"),
    "09UTKENS:UT:BOR": ("Ken's Lake", 38.48126, -109.42845, 2300.0, "monthly"),
    "10UTENTL:UT:BOR": ("Lower Enterprise", 37.52601, -113.85091, 2600.0, "monthly"),
    "09UTMILF:UT:BOR": ("Miller Flat", 39.54028, -111.24222, 5200.0, "monthly"),
    "09UTMILL:UT:BOR": ("Millsite", 39.09558, -111.18794, 18061.0, "monthly"),
    "10238500:UT:BOR": ("Minersville", 38.21747, -112.83550, 23300.0, "monthly"),
    "10188000:UT:BOR": ("Otter Creek", 38.17082, -112.02436, 52500.0, "monthly"),
    "10UTPANG:UT:BOR": ("Panguitch", 37.72436, -112.62790, 22300.0, "monthly"),
    "10191000:UT:BOR": ("Piute", 38.32387, -112.19131, 71800.0, "monthly"),
    "10105200:UT:BOR": ("Porcupine", 41.51828, -111.74624, 11300.0, "monthly"),
    "09UTQUAI:UT:BOR": ("Quail Creek", 37.18022, -113.38098, 40000.0, "monthly"),
    "09UTSAND:UT:BOR": ("Sand Hollow", 37.11417, -113.37472, 50000.0, "monthly"),
    "10UT03JJ:UT:BOR": ("Settlement Canyon", 40.51086, -112.29504, 1000.0, "monthly"),
    "10128000:UT:BOR": ("Smith and Morehouse", 40.76202, -111.10338, 8100.0, "daily"),
    "10UTENTU:UT:BOR": ("Upper Enterprise", 37.51939, -113.86197, 10000.0, "monthly"),
    "10166500:UT:BOR": ("Utah Lake", 40.35867, -111.89339, 870900.0, "daily"),
    "10UTWOOD:UT:BOR": ("Woodruff Creek", 41.46666, -111.31838, 4000.0, "monthly"),
    "10020200:WY:BOR": ("Woodruff Narrows", 41.50273, -111.01602, 57300.0, "monthly"),
    "10218500:UT:BOR": ("Yuba", 39.37218, -112.03327, 236000.0, "monthly"),
}


def load_connected_reservoirs(path: Path = CONNECTED_RESERVOIRS_PATH) -> dict[str, dict]:
    """Load the reviewed out-of-state stations that fill empty drainage areas.

    Candidate discovery remains live and read-only. Publication is a separate,
    reviewable decision, so the selected station, update frequency and capacity
    evidence are committed together instead of being copied into Python tuples.
    """
    document = json.loads(path.read_text(encoding="utf-8"))
    rows = document.get("reservoirs")
    if not isinstance(rows, dict) or not rows:
        raise ValueError(f"{path.name} must contain a non-empty reservoirs object")

    required_capacity = {
        "capacity_af", "capacity_basis", "nid_id", "nid_dam_name",
        "dam_lon", "dam_lat", "match_distance_km", "match_confirmed_by",
    }
    for station, row in rows.items():
        if not isinstance(station, str) or not station or not isinstance(row, dict):
            raise ValueError(f"invalid reservoir entry in {path.name}")
        name = row.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError(f"{station}: a reservoir needs a name to be called by")
        # Keyed by the station and carrying the name, since ADR-066. The key
        # has to agree with the field, or the roster is indexed by one station
        # and fetched from another.
        if row.get("station_triplet") != station:
            raise ValueError(
                f"{station}: keyed by one station and configured for "
                f"{row.get('station_triplet')!r}")
        if station.count(":") != 2:
            raise ValueError(f"{name}: invalid station triplet")
        if row.get("cadence") not in {"daily", "monthly"}:
            raise ValueError(f"{name}: cadence must be daily or monthly")
        if not isinstance(row.get("lat"), (int, float)) or not isinstance(
                row.get("lon"), (int, float)):
            raise ValueError(f"{name}: coordinates are required")
        capacity = row.get("capacity")
        if not isinstance(capacity, dict) or not required_capacity <= capacity.keys():
            raise ValueError(f"{name}: incomplete capacity evidence")
        if not isinstance(capacity.get("capacity_af"), (int, float)) \
                or capacity["capacity_af"] <= 0:
            raise ValueError(f"{name}: capacity must be positive")
    return rows


CONNECTED_RESERVOIRS = load_connected_reservoirs()
AWDB_RESERVOIRS = {
    **BASE_AWDB_RESERVOIRS,
    **{
        station: (
            row["name"], row["lat"], row["lon"],
            row["capacity"]["capacity_af"], row["cadence"],
        )
        for station, row in CONNECTED_RESERVOIRS.items()
    },
}

#: Every station this project fetches, by the identity it fetches it with.
#:
#: `ALL_RESERVOIR_NAMES` was this set of names until ADR-066. The names are
#: still what a reader sees and what `--only` accepts; they are simply no
#: longer what the roster is keyed by, because two reservoirs may share one.
ALL_RESERVOIR_IDS = set(RESERVOIRS) | set(AWDB_RESERVOIRS)

#: What each station is called, by that same identity. One place builds it, so
#: a label and its station cannot come apart.
RESERVOIR_NAMES = {
    **{station: entry[0] for station, entry in RESERVOIRS.items()},
    **{station: entry[0] for station, entry in AWDB_RESERVOIRS.items()},
}

ALL_RESERVOIR_NAMES = set(RESERVOIR_NAMES.values())


RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 2  # doubles each retry: 2s, 4s
MAX_PAGES = 50  # ~100k daily rows; a stop so a bad meta block can't spin forever


#: The zone "today" is decided in.
#:
#: Not because every reservoir is on Mountain Time -- at western scope they
#: run from Pacific to Central -- but because at the hour this pipeline
#: actually runs, the choice cannot change a single figure. The refresh cron
#: is 12:00 UTC, which is 04:00 Pacific through 06:00 Central: every western
#: zone is on the same calendar date, hours from the nearest boundary, so
#: `local_today()` returns the same day whichever of them is named.
#:
#: That is a property of the schedule rather than of the code, so
#: tests/test_refresh.py asserts it instead of this comment being trusted. A
#: manual run near local midnight is the case it does not cover, and the
#: figure it would move is `days_stale` by one day.
LOCAL_TZ = "America/Denver"


def load_capacities() -> dict[str, dict]:
    """Committed National Inventory of Dams capacity records by station id.

    By station and not by name since ADR-066: a capacity is a denominator, and
    handing one reservoir's denominator to another because they share a name
    is a wrong percentage that nothing fails on.

    The original Reclamation table is built by tools/build_capacity_table.py.
    Reviewed connected-site evidence lives beside its station configuration
    in connected_reservoirs.json. Both are committed rather than fetched at
    refresh time because a denominator must not change silently.
    """
    capacities = {}
    try:
        if CAPACITY_PATH.exists():
            capacities = json.loads(CAPACITY_PATH.read_text()).get("capacities", {})
    except (ValueError, AttributeError):
        print(f"WARNING: {CAPACITY_PATH.name} is unreadable; "
              "its percent-full values will be omitted")
    return {
        **capacities,
        **{station: row["capacity"] for station, row in CONNECTED_RESERVOIRS.items()},
    }


def local_today() -> pd.Timestamp:
    """Today's date in Mountain Time, as a tz-naive midnight timestamp.

    This used to be UTC. Between 18:00 and 24:00 MT, UTC is already tomorrow,
    so an evening run reported every reservoir a day staler than a morning
    run of the same data -- and a reservoir sitting exactly on the threshold
    would flip in and out of `is_stale` purely by clock time. The reservoirs,
    the gages and the readers are all on Mountain Time; the dates RISE
    publishes are local dates, so comparing them against a local today is the
    apples-to-apples version.

    Handles DST automatically via the zoneinfo database, so it does not drift
    the way the workflow's fixed-UTC cron does.
    """
    return pd.Timestamp.now(LOCAL_TZ).normalize().tz_localize(None)


def _get_json(params: dict) -> dict:
    """GET a page from RISE, retrying on transient failures.

    RISE occasionally returns a non-JSON (often empty) body on an
    otherwise-2xx response, which crashed the whole run on 2026-08-03.
    The request itself (connect/read timeouts) must be inside the try too --
    on 2026-08-08 a bare read timeout raised from requests.get() before it
    ever reached the try block, so the retry never engaged.
    """
    for attempt in range(RETRY_ATTEMPTS):
        try:
            resp = requests.get(RISE_RESULT_URL, params=params, timeout=60)
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.RequestException, ValueError):
            if attempt == RETRY_ATTEMPTS - 1:
                raise
            time.sleep(RETRY_BACKOFF_SECONDS * 2**attempt)
    raise AssertionError("unreachable")  # keeps type checkers honest


def fetch_rise_series(item_id: int, start: str, end: str) -> pd.DataFrame:
    """Pull one RISE catalog item's daily results, paginating as needed.

    Returns a date-sorted frame with columns [date, storage_af], already
    cleaned: null/non-numeric results dropped, duplicate dates collapsed to
    the last reading, future-dated rows removed.
    """
    rows = []
    page = 1
    while page <= MAX_PAGES:
        params = {
            "itemsPerPage": 2000,
            "order[dateTime]": "ASC",
            "itemId": item_id,
            "dateTime[after]": start,
            "dateTime[strictly_before]": end,
            "page": page,
        }
        payload = _get_json(params)
        data = payload.get("data") or []
        rows.extend(data)

        meta = payload.get("meta") or {}
        per_page = meta.get("itemsPerPage") or 0
        total = meta.get("totalItems")
        # Stop on an empty page even if meta says there should be more --
        # otherwise a bad/missing meta block pages forever.
        if not data or not per_page or total is None:
            break
        if page * per_page >= total:
            break
        page += 1

    if not rows:
        return pd.DataFrame({"date": pd.Series(dtype="datetime64[ns]"),
                             "storage_af": pd.Series(dtype="float64")})

    df = pd.DataFrame([r["attributes"] for r in rows])
    df["date"] = pd.to_datetime(df["dateTime"], format="mixed", utc=True).dt.tz_localize(None).dt.normalize()
    # RISE returns null `result` for days the gage didn't report. Those used
    # to flow straight through: a trailing null became the "latest" reading
    # and poisoned every downstream metric with NaN.
    df["storage_af"] = pd.to_numeric(df["result"], errors="coerce")
    df = df.dropna(subset=["storage_af"])

    df = df[df["date"] <= local_today()]
    df = df.sort_values("date").drop_duplicates(subset="date", keep="last")
    return df[["date", "storage_af"]].reset_index(drop=True)


def _get_awdb_json(params: dict):
    """GET AWDB JSON with the same transient-failure policy as RISE."""
    for attempt in range(RETRY_ATTEMPTS):
        try:
            resp = requests.get(AWDB_DATA_URL, params=params, timeout=60)
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.RequestException, ValueError):
            if attempt == RETRY_ATTEMPTS - 1:
                raise
            time.sleep(RETRY_BACKOFF_SECONDS * 2**attempt)
    raise AssertionError("unreachable")


def fetch_awdb_series(station_triplet: str, cadence: str,
                      start: str, end: str) -> pd.DataFrame:
    """Pull an AWDB RESC storage series and normalize it to [date, storage_af].

    Daily values carry an ISO date. Monthly values carry only year/month;
    with periodRef=END they represent the end of that month, so we assign the
    calendar month-end date. The original cadence remains on the published
    reservoir record and drives its freshness threshold.
    """
    payload = _get_awdb_json({
        "stationTriplets": station_triplet,
        "elements": "RESC",
        "duration": cadence.upper(),
        "beginDate": dt.datetime.strptime(start, "%Y%m%d").date().isoformat(),
        "endDate": dt.datetime.strptime(end, "%Y%m%d").date().isoformat(),
        "periodRef": "END",
    })
    stations = payload if isinstance(payload, list) else [payload]
    values = []
    for station in stations:
        for block in (station.get("data") or []):
            values.extend(block.get("values") or [])

    rows = []
    for value in values:
        if cadence == "monthly":
            year, month = value.get("year"), value.get("month")
            date = (pd.Timestamp(year=int(year), month=int(month), day=1) +
                    pd.offsets.MonthEnd(0)) if year and month else pd.NaT
        else:
            date = pd.to_datetime(value.get("date"), errors="coerce")
        rows.append({"date": date, "storage_af": value.get("value")})

    if not rows:
        return pd.DataFrame({"date": pd.Series(dtype="datetime64[ns]"),
                             "storage_af": pd.Series(dtype="float64")})
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.normalize()
    df["storage_af"] = pd.to_numeric(df["storage_af"], errors="coerce")
    df = df.dropna(subset=["date", "storage_af"])
    df = df[df["date"] <= local_today()]
    return (df.sort_values("date").drop_duplicates(subset="date", keep="last")
              [["date", "storage_af"]].reset_index(drop=True))


def seasonal_window(series: pd.Series, ref_date: pd.Timestamp,
                    window_days: int = SEASONAL_WINDOW_DAYS) -> pd.Series:
    """Every observation within +/- window_days of ref_date's day-of-year, any year.

    IMPROVEMENT: the wrap-around uses a fixed 365, so in leap years the
    window is off by a day around the New Year boundary. Immaterial for a
    +/-7-day window on a drought dashboard, but it is wrong.
    """
    doy = series.index.dayofyear
    ref_doy = ref_date.dayofyear
    # Wrap around the year end using each observation's own year length, not a
    # flat 365. With the constant, a leap year shifts every day after Feb 29
    # by one, so a window near the New Year silently picked up the wrong days.
    year_length = np.where(series.index.is_leap_year, 366, 365)
    raw = np.abs(doy - ref_doy)
    diff = np.minimum(raw, year_length - raw)
    return series[diff <= window_days]


def prior_years(series: pd.Series, ref_date: pd.Timestamp) -> pd.Series:
    """Everything from calendar years strictly before ref_date's year."""
    return series[series.index.year < ref_date.year]


def normal_period(run_date: pd.Timestamp) -> dict[str, int]:
    """Calendar years that can contribute to a prior-year comparison."""
    return {
        "start_year": dt.datetime.strptime(START_DATE, "%Y%m%d").year,
        "end_year": int(run_date.year) - 1,
    }


def load_normals() -> dict:
    """The committed 1991-2020 climate normals, or an empty table.

    Missing is not fatal. A run without normals.json publishes the recent
    baseline alone and every reservoir says the climate baseline is
    unavailable, which is a smaller failure than not publishing at all. It is
    reported loudly, because the file not being there is a mistake rather than
    a state anyone wants.
    """
    if not NORMALS_PATH.exists():
        print(f"WARNING: {NORMALS_PATH.name} is missing -- publishing the recent "
              "baseline only. Build it with tools/build_normal_baselines.py")
        return {}
    try:
        payload = json.loads(NORMALS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"WARNING: {NORMALS_PATH.name} could not be read ({error}) -- "
              "publishing the recent baseline only")
        return {}
    return {
        "period": payload.get("period", {}),
        "window_days": payload.get("window_days"),
        "built": payload.get("built"),
        # By station id, not by name (ADR-066). A climate normal is a
        # denominator like a capacity, and two reservoirs sharing a name must
        # not share one: the west holds two Lost Creeks whose records differ
        # by a factor of twenty.
        "by_station": {str(r["source_station_id"]): r
                       for r in payload.get("reservoirs", [])
                       if r.get("source_station_id")},
    }


def climate_baseline(normals: dict, station_id: str | None, ref_date: pd.Timestamp,
                     current: float) -> dict | None:
    """One reservoir's 1991-2020 normal for today, read out of the committed table.

    The lookup is `ref_date.dayofyear` against a table built with the same
    expression, so the daily and climate baselines describe the same window of
    the year. `dayofyear` shifts by one after February in a leap year, and
    that shift is present on both sides of the comparison rather than on one.

    Returns None when this reservoir has no usable climate normal -- a dam
    younger than the period, or a station the provider would not answer for.
    The site says so instead of falling back to the other baseline behind the
    reader's back, because a comparison silently swapping its own denominator
    is the failure this whole change exists to fix.
    """
    record = (normals.get("by_station") or {}).get(str(station_id))
    if not record or not record.get("available"):
        return None
    table = record.get("day_of_year") or {}
    medians = table.get("median_af") or []
    counts = table.get("years") or []
    day = int(ref_date.dayofyear)
    if day >= len(medians) or medians[day] is None:
        return None
    normal = float(medians[day])
    years = int(counts[day]) if day < len(counts) else 0
    return {
        "normal_af": _round(normal),
        "pct_of_normal": _pct(current, normal),
        "sample_years": years,
        "covers_full_period": bool(record.get("covers_full_period")),
        "first_obs": record.get("first_obs"),
    }


def seasonal_percentile(series: pd.Series, ref_date: pd.Timestamp, current: float,
                        window_days: int = SEASONAL_WINDOW_DAYS) -> float:
    """Where `current` ranks against *prior years'* values in the day-of-year window.

    The comparison population is prior years only. It used to include the
    current year's own observations -- including `current` itself -- which
    made the statistic structurally incapable of returning a true 0 (a
    reservoir at its worst level ever still scored above zero because it was
    being compared against itself) and dragged every value toward the middle
    in a short record. "Lowest this week has ever been" should read as 0.

    Returns NaN when there are no prior years to compare against, which the
    output layer turns into null rather than a fake number.
    """
    population = seasonal_window(prior_years(series, ref_date), ref_date, window_days)
    if population.empty:
        return float("nan")
    return float(np.mean(population.to_numpy() <= current) * 100)


def value_asof(series: pd.Series, when: pd.Timestamp, tolerance_days: int = 10) -> float | None:
    """Most recent observation at or before `when`, or None if the gap is too wide."""
    sub = series[series.index <= when]
    if sub.empty:
        return None
    if (when - sub.index[-1]).days > tolerance_days:
        return None
    return float(sub.iloc[-1])


def monthly_history(series: pd.Series, months: int = 12,
                    climate_months: list | None = None) -> list[dict]:
    """Last `months` calendar months: observed mean/min/max/end + two normals.

    `normal_af` is the median of that same calendar month's mean storage
    across every *earlier* year in the record, which is what makes the
    dashboard's 12-month chart readable as "above or below normal" rather
    than just "up or down".

    `climate_normal_af` is the same statistic over 1991-2020, read from the
    committed table. Both are published for every month so the chart can
    switch between them without refetching, and so the difference between them
    is visible rather than being a claim the reader has to take on trust.
    """
    if series.empty:
        return []

    by_month = series.resample("MS").agg(["mean", "min", "max", "last", "count"])
    monthly_means = by_month["mean"]

    out = []
    for period, row in by_month.tail(months).iterrows():
        same_month = monthly_means[monthly_means.index.month == period.month]
        prior_years = same_month[same_month.index.year < period.year].dropna()
        normal = float(prior_years.median()) if not prior_years.empty else None
        climate = (climate_months[period.month]
                   if climate_months and period.month < len(climate_months)
                   else None)
        out.append({
            "month": period.strftime("%Y-%m"),
            "mean_af": _round(row["mean"]),
            "min_af": _round(row["min"]),
            "max_af": _round(row["max"]),
            "end_af": _round(row["last"]),
            "days": int(row["count"]) if not pd.isna(row["count"]) else 0,
            "normal_af": _round(normal),
            "climate_normal_af": _round(climate),
        })
    return out


def _round(value, places: int = 2):
    """Round for JSON output, mapping NaN/None to null (JSON has no NaN)."""
    if value is None:
        return None
    value = float(value)
    if math.isnan(value) or math.isinf(value):
        return None
    return round(value, places)


def _pct(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or not denominator:
        return None
    return _round(numerator / denominator * 100, 1)


def summarize(name: str, item_id: int | None, lat: float, lon: float,
              df: pd.DataFrame, today: pd.Timestamp,
              capacity: dict | None = None, *, source_key: str = "rise",
              source_label: str = "Bureau of Reclamation RISE",
              source_url: str = "https://data.usbr.gov/rise-api",
              data_frequency: str = "daily", stale_after_days: int = STALE_AFTER_DAYS,
              change_tolerance_days: int = 10,
              source_station_id: str | None = None,
              normals: dict | None = None) -> dict:
    """Turn one storage series into the record the dashboards consume."""
    series = df.set_index("date")["storage_af"].sort_index()
    last_date = series.index[-1]
    current = float(series.iloc[-1])
    record_max = float(series.max())
    record_min = float(series.min())

    days_stale = int((today - last_date).days)

    # The seasonal normal is a climatology, so it is built from prior years
    # only -- same correction as seasonal_percentile. Including this year's
    # own values pulled the "normal" toward whatever is happening right now,
    # which is precisely backwards in a drought: the worse the year, the
    # lower the bar it was being measured against.
    population = seasonal_window(prior_years(series, last_date), last_date)
    seasonal_normal = float(population.median()) if not population.empty else None
    seasonal_years = int(population.index.year.nunique()) if not population.empty else 0

    # The two baselines, side by side and each carrying its own coverage.
    #
    # They are published together rather than one being chosen here, because
    # which one is right depends on the question. "Is this a normal year for
    # this reservoir?" wants the climate normal. "How does this compare with
    # the rest of the drought?" wants the recent one. The site lets the reader
    # ask either, and neither can be mistaken for the other because both name
    # their period and their sample size.
    station = source_station_id or (str(item_id) if item_id is not None else None)
    climate = climate_baseline(normals or {}, station, last_date, current)
    climate_record = ((normals or {}).get("by_station") or {}).get(str(station)) or {}
    climate_month_medians = ((climate_record.get("month") or {}).get("median_af")
                             if climate_record.get("available") else None)
    baselines = {
        "recent": {
            "normal_af": _round(seasonal_normal),
            "pct_of_normal": _pct(current, seasonal_normal),
            "sample_years": seasonal_years,
            # The recent baseline is every prior year we hold, so it always
            # covers its own period by construction. The field exists so both
            # baselines have the same shape and the client needs one code path.
            "covers_full_period": True,
            "first_obs": series.index[0].date().isoformat(),
        } if seasonal_normal is not None else None,
        "climate": climate,
    }
    # A reservoir younger than the climate period, or one with too few years in
    # it, falls back to the recent baseline rather than opening on a median
    # over three winters.
    usable_climate = (climate is not None
                      and climate["sample_years"] >= MIN_BASELINE_YEARS)
    baselines["default"] = (DEFAULT_BASELINE if DEFAULT_BASELINE != "climate"
                            or usable_climate else "recent")

    this_year = series[series.index.year == last_date.year]
    peak_af = float(this_year.max()) if not this_year.empty else None
    peak_date = this_year.idxmax().date().isoformat() if not this_year.empty else None

    changes = {}
    for label, days in (("7d", 7), ("30d", 30), ("365d", 365)):
        # A monthly series cannot support a seven-day claim. For 30-day and
        # annual comparisons, month-end observations are close enough when
        # a leap day or calendar-month length shifts the target slightly.
        past = (None if data_frequency == "monthly" and days == 7 else
                value_asof(series, last_date - pd.Timedelta(days=days),
                           tolerance_days=change_tolerance_days))
        changes[f"change_{label}_af"] = _round(None if past is None else current - past)
        changes[f"change_{label}_pct"] = None if not past else _round((current - past) / past * 100, 1)

    capacity = capacity or {}
    capacity_af = capacity.get("capacity_af")

    return {
        "name": name,
        "rise_item_id": item_id,
        "source_key": source_key,
        "source_label": source_label,
        "source_url": source_url,
        "source_station_id": station,
        "data_frequency": data_frequency,
        "stale_after_days": stale_after_days,
        "lat": lat,
        "lon": lon,

        # --- freshness ---
        "as_of": last_date.date().isoformat(),
        "days_stale": days_stale,
        "is_stale": days_stale > stale_after_days,
        "fetch_ok": True,

        # --- headline metrics (kept for continuity with the original notebook) ---
        "current_storage_af": _round(current),
        "record_max_af": _round(record_max),
        "record_min_af": _round(record_min),
        "pct_of_record_max": _pct(current, record_max),

        # --- percent full, against real capacity rather than a proxy ---
        # record_max is the highest storage ever *observed*, so it drifts as
        # the record grows and a new high retroactively shrinks every earlier
        # percentage. Capacity is a fixed physical property; where we have it,
        # it is the honest denominator.
        "capacity_af": capacity_af,
        "capacity_basis": capacity.get("capacity_basis"),
        "pct_of_capacity": _pct(current, capacity_af),
        "seasonal_percentile": _round(seasonal_percentile(series, last_date, current), 1),

        # --- "is this normal for the season?" ---
        "seasonal_normal_af": _round(seasonal_normal),
        "pct_of_seasonal_normal": _pct(current, seasonal_normal),
        # How many prior years the normal and the percentile are built from.
        # A percentile drawn from three years means something very different
        # from one drawn from eleven, and the dashboard should be able to say
        # so rather than presenting both as equally solid.
        "seasonal_sample_years": seasonal_years,

        # --- the same question, asked against a choice of period ---
        # `seasonal_normal_af` above is the recent baseline and stays exactly
        # what it was, so nothing that already reads this payload changes
        # meaning. `baselines` is the addition.
        "baselines": baselines,

        # --- trend ---
        **changes,
        "peak_this_year_af": _round(peak_af),
        "peak_this_year_date": peak_date,
        "pct_of_peak_this_year": _pct(current, peak_af),
        "monthly": monthly_history(series, climate_months=climate_month_medians),

        # --- provenance ---
        "first_obs": series.index[0].date().isoformat(),
        "n_obs": int(series.size),
        "years_of_record": _round((last_date - series.index[0]).days / 365.25, 1),

        # Watershed membership is attached in main() rather than here: it is
        # pure geometry against a committed boundary file, it applies equally
        # to records carried forward from a failed fetch, and loading the
        # boundaries once for the whole run beats loading them 53 times.
    }


def carry_forward(previous: dict, today: pd.Timestamp, reason: str) -> dict:
    """Reuse yesterday's record for a reservoir we couldn't refresh today.

    Dropping the reservoir entirely (the old behavior) silently removed the
    point from the map with no explanation, which is strictly worse than
    showing the last known value clearly labeled as stale.
    """
    record = dict(previous)
    as_of = pd.Timestamp(record.get("as_of"))
    record["days_stale"] = int((today - as_of).days) if not pd.isna(as_of) else None
    record["is_stale"] = True
    record["fetch_ok"] = False
    record["fetch_error"] = reason
    return record


def partition_by_age(records: list[dict]) -> tuple[list[dict], list[dict]]:
    """Split the run's records into what is published and what is withdrawn.

    A record older than WITHDRAW_AFTER_DAYS is not published. It is not
    deleted either: it comes back on its own the morning its source resumes,
    because the roster it is fetched from is committed and this decision is
    made fresh on every run from the age of the data alone.

    A record with no `as_of` at all -- a reservoir that has never fetched
    successfully -- is published rather than withdrawn. That is a different
    fault with a different remedy, it is already visible through `fetch_ok`,
    and withdrawing on a missing field would hide a configuration error
    behind the mechanism built for a quiet feed.
    """
    published, withdrawn = [], []
    for record in records:
        days = record.get("days_stale")
        if days is not None and days > WITHDRAW_AFTER_DAYS:
            withdrawn.append(record)
        else:
            published.append(record)
    withdrawn.sort(key=lambda r: -(r.get("days_stale") or 0))
    return published, withdrawn


def withdrawal_notice(record: dict) -> dict:
    """What the payload says about a reservoir it is not publishing.

    Deliberately not a reservoir record: no storage, no percent full, no
    baseline. Publishing the figure in a quieter shape would be publishing
    the figure. This is the name, when it was last real, and how long ago
    that was -- enough for a reader to know the roster changed and why, and
    not enough for anything to chart it.
    """
    return {
        "name": record.get("name"),
        "as_of": record.get("as_of"),
        "days_stale": record.get("days_stale"),
        "source_label": record.get("source_label"),
        "reason": "no reading inside the publication window",
    }


def dam_points() -> dict[str, tuple[float, float]]:
    """Dam coordinates by station id, from capacities.json.

    Written by tools/add_dam_points.py, queried from the National Inventory
    of Dams by the NID id the capacity already came from. These are the
    points the watershed assignment should use: a drainage area is where
    the stored water leaves, and for a reservoir that spans a divide the
    middle of the lake is not that place.
    """
    points = {}
    for station, entry in load_capacities().items():
        lon, lat = entry.get("dam_lon"), entry.get("dam_lat")
        if lon is not None and lat is not None:
            points[station] = (lon, lat)
    return points



def attach_counties(records: list[dict]) -> dict:
    """Add the committed county assignment to every record.

    Counties answer "where is this, administratively", which is how readers
    ask for a reservoir when they do not think in drainage areas. The axis is
    a filter and a search term, never a grouping: 68 reservoirs fall in 34
    counties and 19 of those hold one, so a county total is a reservoir total
    with a county's name on it.

    Committed rather than resolved each morning, like the capacities and for
    the same reason -- and read here rather than recomputed, so a reservoir
    cannot move county on a morning when nothing about it changed.

    Runs over carried-forward records too. A reservoir whose feed went quiet
    has not moved counties, and dropping it out of its county filter on the
    day it goes late is exactly when a reader looking for it would fail to
    find it.

    A missing or unreadable file is not fatal, matching `attach_watersheds`:
    losing the whole daily refresh over a county lookup would be much worse
    than shipping a day without one.
    """
    try:
        document = json.loads(COUNTIES_PATH.read_text(encoding="utf-8"))
        counties = document["counties"]
    except (OSError, ValueError, KeyError) as exc:
        print(f"WARNING: no county assignments ({type(exc).__name__}: {exc}); "
              "publishing without county fields")
        return {"assigned": 0, "unassigned": len(records), "county_count": 0}

    unassigned = []
    for record in records:
        # By station id since ADR-066: a county is a fact about one reservoir,
        # and two sharing a name are in two counties.
        found = counties.get(str(record.get("source_station_id")))
        if not found:
            unassigned.append(record["name"])
            continue
        record["county_fips"] = found["county_fips"]
        record["county_name"] = found["county_name"]
        record["state"] = found["state"]
        # Where the water is, as opposed to where the point is. Reviewed
        # against NHD for the waterbodies that cross a line; the point's own
        # state for every other, which is a default rather than a finding
        # (ADR-060). `connected_states` is attached with the drainage area,
        # because that is what knows it.
        record["waterbody_states"] = huc.waterbody_states(
            record["name"], found["state"])

    distinct = {r["county_fips"] for r in records if r.get("county_fips")}
    states = {r["state"] for r in records if r.get("state")}
    print(f"\nCounties: {len(records) - len(unassigned)}/{len(records)} reservoirs "
          f"assigned across {len(distinct)} counties in {len(states)} states")
    if unassigned:
        # Named rather than guessed, like an unmatched drainage area. A new
        # reservoir arrives on the roster before the assignment is rebuilt,
        # and the honest answer is that its county is not known yet.
        print("  no county assignment: " + ", ".join(sorted(unassigned)) +
              " -- run tools/build_county_assignments.py")
    return {
        "assigned": len(records) - len(unassigned),
        "unassigned": len(unassigned),
        "county_count": len(distinct),
        "state_count": len(states),
    }


def attach_watersheds(records: list[dict]) -> dict:
    """Add watershed membership to every record and summarize the result.

    Runs over carried-forward records too. A reservoir whose feed went quiet
    has not moved, and leaving it without a basin would drop it out of every
    watershed total on the day it most needs to be visible as late data.

    A missing or unreadable boundary file is not fatal. Point and waterbody
    location remain available without it; only HUC assignment is omitted.
    Losing the whole daily refresh over a watershed lookup would be a much
    worse failure than shipping a day without HUC context.
    """
    for record in records:
        lat, lon = record.get("lat"), record.get("lon")
        if lat is not None and lon is not None:
            record.update(huc.location_fields(record["name"], lat, lon))

    try:
        units = huc.load_units()
    except (OSError, ValueError, KeyError) as exc:
        print(f"WARNING: no watershed boundaries ({type(exc).__name__}: {exc}); "
              "publishing without HUC fields")
        return {"unit_count": 0, "assigned": 0, "unassigned": len(records)}

    dams = dam_points()
    unassigned = []
    for record in records:
        lat, lon = record.get("lat"), record.get("lon")
        if lat is None or lon is None:
            unassigned.append(record.get("name"))
            continue
        # The dam point where we have one, the published lake point where
        # we do not, and the record says which it used. Measured across
        # the 53 reservoirs in the original measurement, switching to dam
        # points moved no assignment -- so this is a provenance improvement,
        # not a correction, and a reader can tell the two apart.
        dam = dams.get(str(record.get("source_station_id")))
        record.update(huc.describe(
            lat, lon, units, name=record["name"],
            assignment_point=dam,
            source="nid_dam_point" if dam else "published_point"))
        if record["huc6"] is None:
            unassigned.append(record["name"])

    intersects_utah = sum(1 for r in records if r.get("intersects_utah"))
    by_dam = sum(1 for r in records
                 if r.get("huc_assignment_source") == "nid_dam_point")
    print(f"\nWatersheds: {len(records) - len(unassigned)}/{len(records)} reservoirs "
          f"assigned across {len(units)} drainage areas; "
          f"{intersects_utah} waterbodies intersect Utah; "
          f"{by_dam} assigned by their dam")
    if unassigned:
        # Not a failure. A reservoir outside every unit that touches Utah is
        # a real possibility as the inventory grows east, and the honest
        # response is to name it rather than to drop or guess it.
        print(f"  no drainage area matched: {', '.join(sorted(unassigned))}")
    return {
        "unit_count": len(units),
        "assigned": len(records) - len(unassigned),
        "unassigned": len(unassigned),
        "assigned_by_dam": by_dam,
    }


def load_capacity_catalog() -> dict:
    """capacities.json whole, provenance included.

    `load_capacities()` returns only the per-reservoir table, because the
    daily refresh needs nothing but the denominators. The export carries the
    file's header too -- which National Inventory of Dams layer the numbers
    came from, when it was retrieved, and which of the several storage
    figures the denominator is. A capacity without that is a number the
    reader has no way to check.

    Unreadable is fatal here, unlike in `load_capacities()`. Skipping the
    capacities costs the daily refresh one derived field; skipping them in a
    file whose whole purpose is to carry them ships something that looks
    complete and is not.
    """
    catalog = json.loads(CAPACITY_PATH.read_text(encoding="utf-8"))
    catalog["capacities"] = load_capacities()
    # Said out loud in the file rather than left for a reader to infer from a
    # key that looks like a name for 30 of them and a triplet for the rest
    # (ADR-066).
    catalog["keyed_by"] = "source_station_id"
    catalog["connected_reservoirs"] = CONNECTED_RESERVOIRS_PATH.name
    catalog["dam_points"]["count"] = sum(
        1 for entry in catalog["capacities"].values()
        if entry.get("dam_lon") is not None and entry.get("dam_lat") is not None)
    return catalog


def _feature_collection(path: Path) -> dict:
    """Read a committed boundary file, refusing an empty or wrong-shaped one."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("type") != "FeatureCollection" or not payload.get("features"):
        raise ValueError(f"{path.name} is not a populated FeatureCollection")
    return payload


def build_watershed_sections() -> dict:
    """Every named scope's units, validated, plus which one is published.

    Names and codes, not polygons. The geometry used to travel here -- 982 KB
    of it, which was 98% of this file -- and every map page fetched the whole
    thing and then walked it coordinate by coordinate on the main thread to
    type-check it. The maps take their outlines from the hosted Watershed
    Boundary Dataset now, quantized to whatever the reader is looking at, so
    what this file still owes them is the roster: which areas are in scope,
    what each is called, and which states it touches.

    The committed GeoJSON does not go away. `source_file` still names it, the
    pipeline still assigns every reservoir with it, and it stays reviewable in
    the repository -- it simply stops being published, exactly as normals.json
    already is. That is what keeps the outlines from disagreeing with the
    assignments: the codes published here are read out of that same file.

    All of them, not just the drawn one: the scopes exist to be compared
    (docs/UPPER-COLORADO-PIPELINE.md), and a research scope that ships only
    as a file on disk cannot be compared against anything. `default_scope`
    is what keeps that from changing the dashboard -- the extra scopes are
    available, and one of them is the accepted geography.

    Two of them are named. `default_scope` is what the maps draw, 75 basins
    since 2026-08-18; `roster_scope` is the geography the reservoir roster was
    admitted from, still the fourteen areas that touch Utah, and it is what
    the storage map opens on (ADR-063). They were the same name for as long
    as coverage and roster moved together.

    A *published* scope that is missing, short, duplicated or out of region
    raises rather than exporting quietly. This is reference data assembled
    from committed files, not a network fetch that might come back thin;
    there is no partial answer here that is better than a loud failure.

    A registered scope that is not published is skipped, and that is not the
    same thing as tolerating a missing file. A geography gets registered,
    fetched, measured and reviewed before anything draws it -- the western
    scopes are in that state now -- and until it is marked for publication
    there is nothing for this export to be missing.
    """
    offered = watershed_scopes.DRAWN_SCOPES
    if watershed_scopes.DEFAULT_SCOPE not in offered.values():
        raise ValueError(
            f"the drawn scope {watershed_scopes.DEFAULT_SCOPE!r} is not one of the "
            f"levels on offer: {sorted(offered)}")
    for level, name in offered.items():
        scope = watershed_scopes.get_scope(name)
        if scope.level != level:
            raise ValueError(
                f"{name!r} is registered at level {scope.level} and offered at {level}")
        if not scope.published:
            raise ValueError(
                f"{name!r} is offered as a drawn level and is not published, so its "
                "roster would be missing from this file")

    scopes = {}
    for name, scope in sorted(watershed_scopes.SCOPES.items()):
        if not scope.published:
            continue
        boundaries = _feature_collection(watershed_scopes.ROOT / scope.output)
        field = watershed_scopes.huc_field(scope.level)
        codes = watershed_scopes.validate_huc_codes(
            [feature["properties"][field] for feature in boundaries["features"]],
            scope.level, scope.region)
        if scope.expected_count is not None and len(codes) != scope.expected_count:
            raise ValueError(f"expected {scope.expected_count} units for {name}, "
                             f"received {len(codes)}")
        scopes[name] = {
            "name": scope.name,
            "description": scope.description,
            "source_file": scope.output,
            "level": scope.level,
            "unit_count": len(codes),
            field: codes,
            "units": [
                {
                    field: feature["properties"][field],
                    "name": feature["properties"].get("name", ""),
                    "states": feature["properties"].get("states", ""),
                }
                for feature in boundaries["features"]
            ],
        }

    return {
        "default_scope": watershed_scopes.DEFAULT_SCOPE,
        # Which areas are drawn and which areas hold reservoirs stopped being
        # one question when the coverage moved west (ADR-063). A client that
        # wants the geography the roster covers -- the storage map's opening
        # extent is the one that does -- reads this rather than assuming the
        # drawn scope, and `src/viz/extent.ts` is held against the file it
        # names so the box cannot drift from the reservoirs.
        "roster_scope": watershed_scopes.ROSTER_SCOPE,
        # The levels a reader may choose between and the scope drawn at each
        # (ADR-064), as strings because JSON object keys are strings. Every
        # one of them is a scope published above, and `default_scope` is one
        # of them -- both asserted, because a level offered with no roster
        # behind it is a control that empties the map.
        "drawn_scopes": {str(level): name
                         for level, name in sorted(watershed_scopes.DRAWN_SCOPES.items())},
        "scopes": scopes,
    }


def build_export_sections() -> dict:
    """The reference half of the dashboard's data, in one payload.

    Capacity and geography are the parts that change on the order of never,
    and they are the parts every surface needs before it can draw anything:
    a percentage needs its denominator, and a map needs its outlines. Today
    they are four separate committed files that each page fetches by name, so
    every new surface re-learns which files exist and what shape each one is
    in, and a reader has no single thing to check for whether the reference
    data is the version it expects -- which is what `schema_version` is for.

    Deliberately separate from reservoirs.json, which is the other half: that
    file is rewritten every morning and its commit is the deploy (ADR-002).
    Folding never-changing geometry into a daily payload would put a megabyte
    of unchanged polygons in every day's diff and make the storage numbers
    harder to review, which is the one thing that diff is for.
    """
    return {
        "schema_version": EXPORT_SCHEMA_VERSION,
        "capacity_catalog": load_capacity_catalog(),
        "geography": {
            "state": _feature_collection(huc.UTAH_BOUNDARY_PATH),
            "watersheds": build_watershed_sections(),
        },
    }


def load_previous(path: Path) -> dict[str, dict]:
    """Index the last published output by station id (tolerates both shapes).

    By station since ADR-066. This is what `carry_forward` reads when a feed
    goes quiet, so a name index would republish one reservoir's last reading
    under another reservoir's name on the morning a same-named station failed.
    """
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
    except ValueError:
        return {}
    records = payload if isinstance(payload, list) else payload.get("reservoirs", [])
    return {str(r["source_station_id"]): r for r in records
            if isinstance(r, dict) and r.get("source_station_id")}


def _problem_table(problems: list[dict]) -> list[str]:
    rows = ["| Reservoir | As of | Days stale | Note |", "| --- | --- | ---: | --- |"]
    for r in problems:
        note = r.get("fetch_error", "no newer data published by the source")
        rows.append(f"| {r['name']} | {r['as_of']} | {r.get('days_stale')} | {note} |")
    return rows


def _write_output(path: str, key: str, value: str) -> None:
    """Append a GitHub Actions step output, using heredoc form for multi-line."""
    with open(path, "a") as fh:
        if "\n" in value:
            fh.write(f"{key}<<__RESERVOIR_EOF__\n{value}\n__RESERVOIR_EOF__\n")
        else:
            fh.write(f"{key}={value}\n")


def emit_ci_signals(records: list[dict],
                    withdrawn: list[dict] | None = None) -> None:
    """Surface stale/failed reservoirs to the log, the job summary and the workflow.

    Three audiences, three formats:
      - ``::warning::`` annotations, so the run page shows them inline;
      - a job-summary table, so the run page shows them without expanding logs;
      - step outputs, so the workflow can act on them without re-parsing JSON.

    The step outputs are what let the workflow open and close the tracking
    issue by itself. Without them the pipeline can only *describe* a problem
    on a page nobody is watching, which is precisely how the 2026-07-29 freeze
    on Deer Creek / Red Fleet / Steinaker went unnoticed for eleven days --
    the information was all there, sitting in a green run.
    """
    problems = sorted(
        (r for r in records if r.get("is_stale") or not r.get("fetch_ok")),
        key=lambda r: -(r.get("days_stale") or 0),
    )
    for r in problems:
        detail = r.get("fetch_error", "no newer data published by the source")
        print(f"::warning title=Stale reservoir::{r['name']} last updated "
              f"{r['as_of']} ({r.get('days_stale')} days ago) -- {detail}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        lines = [f"### Reservoir refresh: {len(records)} reservoirs\n"]
        if withdrawn:
            lines.append(
                f"**{len(withdrawn)} withdrawn** -- older than "
                f"{WITHDRAW_AFTER_DAYS} days, so not published at all:\n")
            lines.extend(_problem_table(withdrawn))
            lines.append("")
        if problems:
            lines.append(f"**{len(problems)} stale or failed:**\n")
            lines.extend(_problem_table(problems))
        elif not withdrawn:
            lines.append("All reservoirs fresh. :white_check_mark:")
        with open(summary_path, "a") as fh:
            fh.write("\n".join(lines) + "\n")

    for r in withdrawn or ():
        print(f"::error title=Withdrawn reservoir::{r['name']} last updated "
              f"{r['as_of']} ({r.get('days_stale')} days ago) -- past the "
              f"{WITHDRAW_AFTER_DAYS}-day publication window, so it is not in "
              "this morning's payload")

    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        _write_output(output_path, "stale_count", str(len(problems)))
        _write_output(output_path, "stale_names",
                      ", ".join(r["name"] for r in problems))
        _write_output(output_path, "stale_table",
                      "\n".join(_problem_table(problems)) if problems else "")
        _write_output(output_path, "withdrawn_count", str(len(withdrawn or ())))
        _write_output(output_path, "withdrawn_names",
                      ", ".join(r["name"] for r in withdrawn or ()))
        _write_output(output_path, "withdrawn_table",
                      "\n".join(_problem_table(withdrawn)) if withdrawn else "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="*", metavar="NAME",
                        help="debugging aid: fetch only these reservoirs and print the "
                             "resulting records to stdout. Never writes reservoirs.json, "
                             "since a partial run would drop every other reservoir.")
    parser.add_argument("--dry-run", action="store_true",
                        help="compute everything but don't write reservoirs.json")
    parser.add_argument("--source", choices=("all", "rise", "awdb"), default="all",
                        help="refresh one source and merge the other source's previously "
                             "published records (default: all)")
    args = parser.parse_args()

    today = local_today()
    end = (today + pd.Timedelta(days=1)).strftime("%Y%m%d")
    previous = load_previous(OUTPUT_PATH)
    capacities = load_capacities()
    normals = load_normals()
    if normals:
        available = sum(1 for r in normals["by_station"].values() if r.get("available"))
        period = normals["period"]
        print(f"Climate normals available: {available} of {len(normals['by_station'])} "
              f"reservoirs, {period.get('start_year')} through {period.get('end_year')} "
              f"(built {normals.get('built')})")
    print(f"NID capacity records available: {len(capacities)} "
          f"({len(RESERVOIRS)} Reclamation, {len(CONNECTED_RESERVOIRS)} connected)")

    rise_targets = RESERVOIRS if args.source in {"all", "rise"} else {}
    awdb_targets = AWDB_RESERVOIRS if args.source in {"all", "awdb"} else {}
    if args.only:
        # Named, because a person types a name and not a station triplet. The
        # roster is keyed by station since ADR-066, so a name is resolved to
        # the stations that carry it -- plural on purpose: asking for "Lost
        # Creek" where two exist probes both rather than silently picking one.
        wanted = set(args.only)
        chosen = {station for station, name in RESERVOIR_NAMES.items()
                  if name in wanted} | (wanted & set(RESERVOIR_NAMES))
        rise_targets = {k: v for k, v in RESERVOIRS.items() if k in chosen}
        awdb_targets = {k: v for k, v in AWDB_RESERVOIRS.items() if k in chosen}
        found = {RESERVOIR_NAMES.get(station, station)
                 for station in set(rise_targets) | set(awdb_targets)}
        missing = wanted - found - set(rise_targets) - set(awdb_targets)
        if missing:
            print(f"ERROR: unknown reservoir(s): {', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    records = []
    for station_id, (name, lat, lon) in rise_targets.items():
        # The key is the identity and the value carries the label (ADR-066).
        item_id = int(station_id)
        try:
            df = fetch_rise_series(item_id, START_DATE, end)
        # Broad on purpose: the old handler only caught RequestException, so a
        # malformed payload (KeyError) or a schema change (TypeError) took the
        # entire 28-reservoir run down instead of costing one reservoir.
        except Exception as exc:  # noqa: BLE001
            reason = f"fetch failed after {RETRY_ATTEMPTS} attempts: {type(exc).__name__}: {exc}"
            print(f"WARNING: {name} (item {item_id}) -- {reason}")
            if station_id in previous:
                records.append(carry_forward(previous[station_id], today, reason))
            continue

        if df.empty:
            reason = "RISE returned no usable rows for the requested range"
            print(f"WARNING: {name} (item {item_id}) -- {reason}")
            if station_id in previous:
                records.append(carry_forward(previous[station_id], today, reason))
            continue

        records.append(summarize(name, item_id, lat, lon, df, today,
                                 capacities.get(station_id), normals=normals))
        time.sleep(0.5)  # be polite to RISE's server

    for station_triplet, (name, lat, lon, capacity_af, cadence) in awdb_targets.items():
        try:
            df = fetch_awdb_series(station_triplet, cadence, START_DATE, end)
        except Exception as exc:  # noqa: BLE001
            reason = (f"AWDB fetch failed after {RETRY_ATTEMPTS} attempts: "
                      f"{type(exc).__name__}: {exc}")
            print(f"WARNING: {name} ({station_triplet}) -- {reason}")
            if station_triplet in previous:
                records.append(carry_forward(previous[station_triplet], today, reason))
            continue

        if df.empty:
            reason = f"AWDB returned no usable {cadence} RESC rows"
            print(f"WARNING: {name} ({station_triplet}) -- {reason}")
            if station_triplet in previous:
                records.append(carry_forward(previous[station_triplet], today, reason))
            continue

        stale_after = (AWDB_MONTHLY_STALE_AFTER_DAYS
                       if cadence == "monthly" else STALE_AFTER_DAYS)
        capacity = (CONNECTED_RESERVOIRS.get(station_triplet) or {}).get("capacity") or {
            "capacity_af": capacity_af,
            "capacity_basis": "awdb_reservoir_metadata",
        }
        records.append(summarize(
            name, None, lat, lon, df, today,
            capacity,
            source_key="awdb", source_label="USDA NRCS AWDB",
            source_url="https://wcc.sc.egov.usda.gov/awdbWebService/",
            data_frequency=cadence, stale_after_days=stale_after,
            change_tolerance_days=45 if cadence == "monthly" else 10,
            source_station_id=station_triplet,
            normals=normals,
        ))
        time.sleep(0.1)

    if args.only:
        print(json.dumps(records, indent=2))
        return 0 if records else 1

    # A source-specific refresh is useful for the slower, independently
    # scheduled feeds. Preserve the other source instead of turning a partial
    # refresh into a partial dashboard.
    selected_stations = set(rise_targets) | set(awdb_targets)
    if args.source != "all":
        records.extend(record for station, record in previous.items()
                       if station not in selected_stations)

    if not records:
        print("ERROR: no reservoir data at all -- refusing to overwrite reservoirs.json",
              file=sys.stderr)
        return 1

    # By station id, which is what `rise_targets` and `awdb_targets` are keyed
    # by since ADR-066. Matching on the name here counted nothing at all and
    # refused every run -- the guard doing its job against itself.
    attempted = [r for r in records
                 if str(r.get("source_station_id")) in selected_stations]
    fresh = [r for r in attempted if r.get("fetch_ok")]
    if len(fresh) < len(selected_stations) / 2:
        print(f"ERROR: only {len(fresh)}/{len(selected_stations)} reservoirs refreshed "
              "successfully -- refusing to overwrite reservoirs.json", file=sys.stderr)
        return 1

    # Older committed RISE records predate mixed-source provenance. A
    # source-specific AWDB refresh merges them unchanged numerically, but the
    # newly written envelope should still be self-describing without relying
    # on browser-side defaults.
    for record in records:
        if not record.get("source_key"):
            record["source_key"] = "rise"
            record["source_label"] = "Bureau of Reclamation RISE"
            record["source_url"] = "https://data.usbr.gov/rise-api"
            record["source_station_id"] = str(record.get("rise_item_id"))
            record["data_frequency"] = "daily"
            record["stale_after_days"] = STALE_AFTER_DAYS

    records, withdrawn = partition_by_age(records)

    watersheds = attach_watersheds(records)
    counties = attach_counties(records)

    # Physical size is the primary browse order in every surface.
    records.sort(key=lambda r: (r.get("capacity_af") is None,
                                -(r.get("capacity_af") or 0), r.get("name", "")))

    payload = {
        "schema_version": RESERVOIR_SCHEMA_VERSION,
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "start_date": dt.datetime.strptime(START_DATE, "%Y%m%d").date().isoformat(),
        "normal_period": normal_period(today),
        "normal_window_days": SEASONAL_WINDOW_DAYS,
        # The periods a reader can measure against, and which one the site
        # opens on. The recent period's end year moves with the calendar; the
        # climate period is fixed, which is the point of it.
        "baselines": [
            {
                "id": "recent",
                "label": "Recent years",
                "period_label": (f"{normal_period(today)['start_year']} through "
                                 f"{normal_period(today)['end_year']}"),
                **normal_period(today),
                "note": ("Every earlier year this site holds. It begins in 2015 "
                         "because that is when this site starts collecting, and "
                         "those years have been unusually dry, so a reservoir "
                         "can look ordinary against them and still be low."),
            },
            {
                "id": "climate",
                "label": "Standard climate period",
                "period_label": (
                    f"{(normals.get('period') or {}).get('start_year', 1991)} through "
                    f"{(normals.get('period') or {}).get('end_year', 2020)}"),
                "start_year": (normals.get("period") or {}).get("start_year", 1991),
                "end_year": (normals.get("period") or {}).get("end_year", 2020),
                "note": ("The thirty year period the World Meteorological "
                         "Organization defines as standard, and the same period "
                         "the mountain snow measurements use. Not every reservoir "
                         "existed for all of it, and each one reports how many "
                         "years it has."),
            },
        ],
        "default_baseline": DEFAULT_BASELINE,
        "climate_normals": {
            "built": normals.get("built"),
            "file": NORMALS_PATH.name,
            "available_count": sum(
                1 for r in records if (r.get("baselines") or {}).get("climate")),
            "minimum_years": MIN_BASELINE_YEARS,
        },
        "stale_after_days": STALE_AFTER_DAYS,
        "stale_after_days_by_cadence": {"daily": STALE_AFTER_DAYS,
                                         "monthly": AWDB_MONTHLY_STALE_AFTER_DAYS},
        "source": "Bureau of Reclamation RISE API and USDA NRCS AWDB",
        "sources": [
            {"key": "rise", "label": "Bureau of Reclamation RISE",
             "url": "https://data.usbr.gov/rise-api", "cadence": "daily"},
            {"key": "awdb", "label": "USDA NRCS AWDB",
             "url": "https://wcc.sc.egov.usda.gov/awdbWebService/",
             "cadence": "daily or monthly by station"},
        ],
        "source_counts": {
            "rise": sum(1 for r in records if r.get("source_key", "rise") == "rise"),
            "awdb": sum(1 for r in records if r.get("source_key") == "awdb"),
        },
        "reservoir_count": len(records),
        "stale_count": sum(1 for r in records if r.get("is_stale")),
        "capacity_count": sum(1 for r in records if r.get("capacity_af")),
        # What this run declined to publish, and the line it was judged
        # against. A withdrawn reservoir leaves `reservoirs` entirely, so
        # without these fields the roster would just be quietly shorter and
        # a reader comparing two mornings could not tell a withdrawal from a
        # reservoir that had never been here (ADR-056).
        "withdraw_after_days": WITHDRAW_AFTER_DAYS,
        "withdrawn_count": len(withdrawn),
        "withdrawn": [withdrawal_notice(r) for r in withdrawn],
        # Drainage areas are described in the envelope so a reader can tell
        # a run that assigned nothing (a missing boundary file) from one
        # where nothing needed assigning.
        "watersheds": {
            "source": "USGS Watershed Boundary Dataset",
            # How big the drainage areas are, as the length of their code.
            # Stated rather than assumed: the codes are fixed-width, so a
            # reader who knows the level knows the size, and a payload that
            # ever carries another one says so instead of looking like a
            # six-digit payload with odd codes in it.
            "level": watershed_scopes.get_scope(
                watershed_scopes.DEFAULT_SCOPE).level,
            "boundaries": huc.BOUNDARY_PATH.name,
            "assignment_rule": "the dam or outlet point, not the middle of the water",
            **watersheds,
            "in_utah": sum(1 for r in records if r.get("in_utah")),
            "intersects_utah": sum(1 for r in records
                                    if r.get("intersects_utah")),
            # The coarser grouping, for a reader who wants subregions rather
            # than the fourteen areas. Derived from the codes in this payload,
            # so it can never name an area the payload does not contain.
            "subregions": huc.subregion_roster(r.get("huc6") for r in records),
        },
        # Counties are described in the envelope for the same reason, and
        # carry their assignment rule for the opposite one: it is deliberately
        # *not* the drainage rule above. A reader comparing the two lines is
        # meant to see that they differ (ADR-058).
        "counties": {
            "source": "Esri Living Atlas, USA Census Counties",
            "assignment_rule": "the published waterbody point, not the dam",
            **counties,
        },
        "reservoirs": records,
    }

    print(f"\nFreshness report ({today.date()}):")
    for r in sorted(records, key=lambda r: -(r.get("days_stale") or 0)):
        flag = "STALE" if r.get("is_stale") else "ok   "
        print(f"  {flag} {r['name']:<18} as_of={r['as_of']} "
              f"({r.get('days_stale')}d) n={r.get('n_obs')}")

    emit_ci_signals(records, withdrawn)

    if args.dry_run:
        print("\nPayload comparison metadata:")
        print(json.dumps({
            "normal_period": payload["normal_period"],
            "normal_window_days": payload["normal_window_days"],
        }, indent=2))
        print("\n--dry-run: not writing reservoirs.json")
        return 0

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {len(records)} reservoirs ({payload['stale_count']} stale) to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
