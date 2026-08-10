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

RISE_RESULT_URL = "https://data.usbr.gov/rise/api/result"
AWDB_DATA_URL = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data"
START_DATE = "20150101"
OUTPUT_PATH = Path(__file__).parent / "reservoirs.json"
CAPACITY_PATH = Path(__file__).parent / "capacities.json"

# A reservoir whose newest observation is older than this many days is
# flagged is_stale and called out in the run log and in the dashboards.
# 2 days is deliberately tight: RISE normally publishes through yesterday,
# so anything past "yesterday, plus a day of slack" is a real signal.
STALE_AFTER_DAYS = 2
AWDB_MONTHLY_STALE_AFTER_DAYS = 45

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
RESERVOIRS = {
    "Deer Creek": (290, 40.43511, -111.50035),
    "Jordanelle": (468, 40.60689, -111.41655),
    "Strawberry": (779, 40.16882, -111.1311),
    "Rockport": (706, 40.77498, -111.39859),
    "Echo": (314, 40.9574, -111.4179),
    "East Canyon": (310, 40.91017, -111.59293),
    "Pineview": (652, 41.26543, -111.80998),
    "Willard Bay": (866, 41.37738, -112.08339),
    "Scofield": (727, 39.77656, -111.05074),
    "Starvation": (764, 40.19324, -110.44722),
    "Flaming Gorge": (337, 40.97789, -109.57304),
    "Lake Powell": (509, 37.05778, -111.30332),
    "Causey": (219, 41.29828, -111.58591),
    "Currant Creek": (278, 40.33841, -111.05821),
    "Huntington North": (432, 39.38458, -111.09082),
    "Hyrum": (439, 41.62117, -111.86099),
    "Joes Valley": (463, 39.2901, -111.27888),
    "Lost Creek": (544, 41.18887, -111.39628),
    "Meeks Cabin": (574, 41.01664, -110.58344),
    "Moon Lake": (587, 40.57445, -110.50665),
    "Newton": (623, 41.8998, -111.97562),
    "Red Fleet": (685, 40.57832, -109.42853),
    "Stateline": (769, 40.98291, -110.39038),
    "Steinaker": (774, 40.51456, -109.53275),
    "Trial Lake": (4516, 40.6799, -110.956839),
    "Upper Stillwater": (826, 40.56565, -110.70044),
    "Washington Lake": (4530, 40.6765, -110.964),
    "Lost Lake": (4523, 40.6741, -110.9413),
}

# Additional reservoirs in the Utah Division of Water Resources' statewide
# inventory that are not in the RISE set above. AWDB's RESC element is
# reservoir storage volume in acre-feet. Only Utah Lake and Smith and
# Morehouse currently publish a current daily series; the other stations are
# derived monthly values and are deliberately labeled/aged as monthly data.
# name -> (station triplet, lat, lon, capacity af, cadence)
AWDB_RESERVOIRS = {
    "Bear Lake": ("10055500:ID:BOR", 42.11667, -111.30000, 1302000.0, "monthly"),
    "Big Sand Wash": ("09UTBSWR:UT:BOR", 40.30006, -110.22139, 25700.0, "monthly"),
    "Cleveland": ("09UTCLEV:UT:BOR", 39.57758, -111.23896, 5400.0, "monthly"),
    "Grantsville": ("10UTGTVL:UT:BOR", 40.54185, -112.50567, 3300.0, "monthly"),
    "Gunlock": ("09UTGUNL:UT:BOR", 37.25136, -113.77556, 10400.0, "monthly"),
    "Gunnison": ("10216200:UT:BOR", 39.20635, -111.71103, 20300.0, "monthly"),
    "Jackson Flat": ("09UTJACK:UT:BOR", 37.00576, -112.51995, 4083.0, "monthly"),
    "Ken's Lake": ("09UTKENS:UT:BOR", 38.48126, -109.42845, 2300.0, "monthly"),
    "Lower Enterprise": ("10UTENTL:UT:BOR", 37.52601, -113.85091, 2600.0, "monthly"),
    "Miller Flat": ("09UTMILF:UT:BOR", 39.54028, -111.24222, 5200.0, "monthly"),
    "Millsite": ("09UTMILL:UT:BOR", 39.09558, -111.18794, 18061.0, "monthly"),
    "Minersville": ("10238500:UT:BOR", 38.21747, -112.83550, 23300.0, "monthly"),
    "Otter Creek": ("10188000:UT:BOR", 38.17082, -112.02436, 52500.0, "monthly"),
    "Panguitch": ("10UTPANG:UT:BOR", 37.72436, -112.62790, 22300.0, "monthly"),
    "Piute": ("10191000:UT:BOR", 38.32387, -112.19131, 71800.0, "monthly"),
    "Porcupine": ("10105200:UT:BOR", 41.51828, -111.74624, 11300.0, "monthly"),
    "Quail Creek": ("09UTQUAI:UT:BOR", 37.18022, -113.38098, 40000.0, "monthly"),
    "Sand Hollow": ("09UTSAND:UT:BOR", 37.11417, -113.37472, 50000.0, "monthly"),
    "Settlement Canyon": ("10UT03JJ:UT:BOR", 40.51086, -112.29504, 1000.0, "monthly"),
    "Smith and Morehouse": ("10128000:UT:BOR", 40.76202, -111.10338, 8100.0, "daily"),
    "Upper Enterprise": ("10UTENTU:UT:BOR", 37.51939, -113.86197, 10000.0, "monthly"),
    "Utah Lake": ("10166500:UT:BOR", 40.35867, -111.89339, 870900.0, "daily"),
    "Woodruff Creek": ("10UTWOOD:UT:BOR", 41.46666, -111.31838, 4000.0, "monthly"),
    "Woodruff Narrows": ("10020200:WY:BOR", 41.50273, -111.01602, 57300.0, "monthly"),
    "Yuba": ("10218500:UT:BOR", 39.37218, -112.03327, 236000.0, "monthly"),
}

ALL_RESERVOIR_NAMES = set(RESERVOIRS) | set(AWDB_RESERVOIRS)


RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 2  # doubles each retry: 2s, 4s
MAX_PAGES = 50  # ~100k daily rows; a stop so a bad meta block can't spin forever


LOCAL_TZ = "America/Denver"  # every reservoir here is on Mountain Time


def load_capacities() -> dict[str, dict]:
    """Reservoir capacities from capacities.json, or {} if it isn't there.

    Built separately by tools/build_capacity_table.py from the National
    Inventory of Dams, because RISE publishes no capacity at all. Kept as a
    committed, reviewable file rather than fetched at refresh time: it
    changes on the order of never, it comes from a different agency, and a
    denominator that silently changes under you is worse than a stale one.
    """
    if not CAPACITY_PATH.exists():
        return {}
    try:
        return json.loads(CAPACITY_PATH.read_text()).get("capacities", {})
    except (ValueError, AttributeError):
        print(f"WARNING: {CAPACITY_PATH.name} is unreadable; "
              "percent-of-capacity will be omitted")
        return {}


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


def seasonal_window(series: pd.Series, ref_date: pd.Timestamp, window_days: int = 7) -> pd.Series:
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


def seasonal_percentile(series: pd.Series, ref_date: pd.Timestamp, current: float,
                        window_days: int = 7) -> float:
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


def monthly_history(series: pd.Series, months: int = 12) -> list[dict]:
    """Last `months` calendar months: observed mean/min/max/end + a prior-years normal.

    `normal_af` is the median of that same calendar month's mean storage
    across every *earlier* year in the record, which is what makes the
    dashboard's 12-month chart readable as "above or below normal" rather
    than just "up or down".
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
        out.append({
            "month": period.strftime("%Y-%m"),
            "mean_af": _round(row["mean"]),
            "min_af": _round(row["min"]),
            "max_af": _round(row["max"]),
            "end_af": _round(row["last"]),
            "days": int(row["count"]) if not pd.isna(row["count"]) else 0,
            "normal_af": _round(normal),
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
              source_station_id: str | None = None) -> dict:
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
        "source_station_id": source_station_id or (str(item_id) if item_id is not None else None),
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

        # --- trend ---
        **changes,
        "peak_this_year_af": _round(peak_af),
        "peak_this_year_date": peak_date,
        "pct_of_peak_this_year": _pct(current, peak_af),
        "monthly": monthly_history(series),

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


def attach_watersheds(records: list[dict]) -> dict:
    """Add watershed membership to every record and summarize the result.

    Runs over carried-forward records too. A reservoir whose feed went quiet
    has not moved, and leaving it without a basin would drop it out of every
    watershed total on the day it most needs to be visible as late data.

    A missing or unreadable boundary file is not fatal. The fields are
    optional in the published schema and the dashboards work without them;
    losing the whole daily refresh over a watershed lookup would be a much
    worse failure than shipping a day without one.
    """
    try:
        units = huc.load_units()
    except (OSError, ValueError, KeyError) as exc:
        print(f"WARNING: no watershed boundaries ({type(exc).__name__}: {exc}); "
              "publishing without HUC fields")
        return {"unit_count": 0, "assigned": 0, "unassigned": len(records)}

    unassigned = []
    for record in records:
        lat, lon = record.get("lat"), record.get("lon")
        if lat is None or lon is None:
            unassigned.append(record.get("name"))
            continue
        record.update(huc.describe(lat, lon, units))
        if record["huc6"] is None:
            unassigned.append(record["name"])

    in_utah = sum(1 for r in records if r.get("in_utah"))
    print(f"\nWatersheds: {len(records) - len(unassigned)}/{len(records)} reservoirs "
          f"assigned across {len(units)} drainage areas; {in_utah} in Utah")
    if unassigned:
        # Not a failure. A reservoir outside every unit that touches Utah is
        # a real possibility as the inventory grows east, and the honest
        # response is to name it rather than to drop or guess it.
        print(f"  no drainage area matched: {', '.join(sorted(unassigned))}")
    return {
        "unit_count": len(units),
        "assigned": len(records) - len(unassigned),
        "unassigned": len(unassigned),
    }


def load_previous(path: Path) -> dict[str, dict]:
    """Index the last published output by reservoir name (tolerates both shapes)."""
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
    except ValueError:
        return {}
    records = payload if isinstance(payload, list) else payload.get("reservoirs", [])
    return {r["name"]: r for r in records if isinstance(r, dict) and "name" in r}


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


def emit_ci_signals(records: list[dict]) -> None:
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
        if problems:
            lines.append(f"**{len(problems)} stale or failed:**\n")
            lines.extend(_problem_table(problems))
        else:
            lines.append("All reservoirs fresh. :white_check_mark:")
        with open(summary_path, "a") as fh:
            fh.write("\n".join(lines) + "\n")

    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        _write_output(output_path, "stale_count", str(len(problems)))
        _write_output(output_path, "stale_names",
                      ", ".join(r["name"] for r in problems))
        _write_output(output_path, "stale_table",
                      "\n".join(_problem_table(problems)) if problems else "")


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
    print(f"NID capacities available for {len(capacities)}/{len(RESERVOIRS)} RISE reservoirs")

    rise_targets = RESERVOIRS if args.source in {"all", "rise"} else {}
    awdb_targets = AWDB_RESERVOIRS if args.source in {"all", "awdb"} else {}
    if args.only:
        wanted = set(args.only)
        rise_targets = {k: v for k, v in RESERVOIRS.items() if k in wanted}
        awdb_targets = {k: v for k, v in AWDB_RESERVOIRS.items() if k in wanted}
        missing = wanted - set(rise_targets) - set(awdb_targets)
        if missing:
            print(f"ERROR: unknown reservoir(s): {', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    records = []
    for name, (item_id, lat, lon) in rise_targets.items():
        try:
            df = fetch_rise_series(item_id, START_DATE, end)
        # Broad on purpose: the old handler only caught RequestException, so a
        # malformed payload (KeyError) or a schema change (TypeError) took the
        # entire 28-reservoir run down instead of costing one reservoir.
        except Exception as exc:  # noqa: BLE001
            reason = f"fetch failed after {RETRY_ATTEMPTS} attempts: {type(exc).__name__}: {exc}"
            print(f"WARNING: {name} (item {item_id}) -- {reason}")
            if name in previous:
                records.append(carry_forward(previous[name], today, reason))
            continue

        if df.empty:
            reason = "RISE returned no usable rows for the requested range"
            print(f"WARNING: {name} (item {item_id}) -- {reason}")
            if name in previous:
                records.append(carry_forward(previous[name], today, reason))
            continue

        records.append(summarize(name, item_id, lat, lon, df, today,
                                 capacities.get(name)))
        time.sleep(0.5)  # be polite to RISE's server

    for name, (station_triplet, lat, lon, capacity_af, cadence) in awdb_targets.items():
        try:
            df = fetch_awdb_series(station_triplet, cadence, START_DATE, end)
        except Exception as exc:  # noqa: BLE001
            reason = (f"AWDB fetch failed after {RETRY_ATTEMPTS} attempts: "
                      f"{type(exc).__name__}: {exc}")
            print(f"WARNING: {name} ({station_triplet}) -- {reason}")
            if name in previous:
                records.append(carry_forward(previous[name], today, reason))
            continue

        if df.empty:
            reason = f"AWDB returned no usable {cadence} RESC rows"
            print(f"WARNING: {name} ({station_triplet}) -- {reason}")
            if name in previous:
                records.append(carry_forward(previous[name], today, reason))
            continue

        stale_after = (AWDB_MONTHLY_STALE_AFTER_DAYS
                       if cadence == "monthly" else STALE_AFTER_DAYS)
        records.append(summarize(
            name, None, lat, lon, df, today,
            {"capacity_af": capacity_af,
             "capacity_basis": "awdb_reservoir_metadata"},
            source_key="awdb", source_label="USDA NRCS AWDB",
            source_url="https://wcc.sc.egov.usda.gov/awdbWebService/",
            data_frequency=cadence, stale_after_days=stale_after,
            change_tolerance_days=45 if cadence == "monthly" else 10,
            source_station_id=station_triplet,
        ))
        time.sleep(0.1)

    if args.only:
        print(json.dumps(records, indent=2))
        return 0 if records else 1

    # A source-specific refresh is useful for the slower, independently
    # scheduled feeds. Preserve the other source instead of turning a partial
    # refresh into a partial dashboard.
    selected_names = set(rise_targets) | set(awdb_targets)
    if args.source != "all":
        records.extend(record for name, record in previous.items()
                       if name not in selected_names)

    if not records:
        print("ERROR: no reservoir data at all -- refusing to overwrite reservoirs.json",
              file=sys.stderr)
        return 1

    attempted = [r for r in records if r.get("name") in selected_names]
    fresh = [r for r in attempted if r.get("fetch_ok")]
    if len(fresh) < len(selected_names) / 2:
        print(f"ERROR: only {len(fresh)}/{len(selected_names)} reservoirs refreshed successfully "
              "-- refusing to overwrite reservoirs.json", file=sys.stderr)
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

    watersheds = attach_watersheds(records)

    # Physical size is the primary browse order in every surface.
    records.sort(key=lambda r: (r.get("capacity_af") is None,
                                -(r.get("capacity_af") or 0), r.get("name", "")))

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "start_date": dt.datetime.strptime(START_DATE, "%Y%m%d").date().isoformat(),
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
        # Drainage areas are described in the envelope so a reader can tell
        # a run that assigned nothing (a missing boundary file) from one
        # where nothing needed assigning.
        "watersheds": {
            "source": "USGS Watershed Boundary Dataset, six-digit units",
            "boundaries": huc.BOUNDARY_PATH.name,
            "assignment_rule": "the dam or outlet point, not the middle of the water",
            **watersheds,
            "in_utah": sum(1 for r in records if r.get("in_utah")),
        },
        "reservoirs": records,
    }

    print(f"\nFreshness report ({today.date()}):")
    for r in sorted(records, key=lambda r: -(r.get("days_stale") or 0)):
        flag = "STALE" if r.get("is_stale") else "ok   "
        print(f"  {flag} {r['name']:<18} as_of={r['as_of']} "
              f"({r.get('days_stale')}d) n={r.get('n_obs')}")

    emit_ci_signals(records)

    if args.dry_run:
        print("\n--dry-run: not writing reservoirs.json")
        return 0

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {len(records)} reservoirs ({payload['stale_count']} stale) to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
