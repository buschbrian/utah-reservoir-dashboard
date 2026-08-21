"""One adapter per provider, and the retry policy they share.

Three providers answer with storage readings -- Reclamation, the Natural
Resources Conservation Service, and the California Department of Water
Resources -- and each has its own URL, its own paging, its own idea of a
missing value and its own date convention. Everything specific to a provider
belongs here, so that the rest of the pipeline sees one shape: a frame of
`date` and `storage_af`, cleaned, sorted and deduplicated.

A fourth provider starts in this module. `SourceKey` on the TypeScript side is
exhaustive, so it will not compile until every table names it.
"""

import datetime as dt
import time

import pandas as pd
import requests

from .constants import AWDB_DATA_URL, RISE_RESULT_URL, local_today


RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 2  # doubles each retry: 2s, 4s
MAX_PAGES = 50  # ~100k daily rows; a stop so a bad meta block can't spin forever

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


#: California's own service. The station id and sensor number are the identity
#: (ADR-066); sensor 15 is reservoir storage, published in acre-feet.
CDEC_DATA_URL = "https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet"
CDEC_STORAGE_SENSOR = 15

#: The value this service writes where it has no reading.
#:
#: It is a number rather than a null, which makes it the most dangerous fact
#: about this source: a reader of `value` that treats it as a measurement
#: subtracts ten thousand acre-feet from whatever total it lands in. Measured
#: on 2026-08-20 across a week and all 238 storage stations, 537 of 1,435
#: values were this and none were null -- 37%, which is the ordinary shape of
#: the data and not an edge case.
#:
#: `fetch_cdec_series` is the only place the field is read, and it drops these
#: rather than converting them. A missing reading and an empty reservoir are
#: different facts; ADR-056 already turns on that distinction.
CDEC_MISSING_VALUE = -9999


def _get_cdec_json(params: dict):
    """GET CDEC JSON with the same transient-failure policy as the others."""
    for attempt in range(RETRY_ATTEMPTS):
        try:
            resp = requests.get(CDEC_DATA_URL, params=params, timeout=60)
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.RequestException, ValueError):
            if attempt == RETRY_ATTEMPTS - 1:
                raise
            time.sleep(RETRY_BACKOFF_SECONDS * 2**attempt)
    raise AssertionError("unreachable")


def fetch_cdec_series(station_id: str, cadence: str,
                      start: str, end: str) -> pd.DataFrame:
    """Pull a CDEC storage series and normalize it to [date, storage_af].

    The same contract the other two providers answer with: a date-sorted frame
    with nulls dropped, duplicate dates collapsed to the last reading, and
    nothing dated after today.

    Two differences this service brings:

    **`-9999` means no reading** and is dropped here (`CDEC_MISSING_VALUE`).
    This is the only place `value` is read.

    **The dates are not ISO.** They arrive as `2026-8-10 00:00`, unpadded, and
    there are two of them -- `date` is the reading's own day and `obsDate` is
    when the service recorded it. The reading date is the one a storage series
    is indexed by, the same choice the other two providers' fetchers make.

    **A monthly reading is stamped at the start of the month it measures, and
    the water was measured at the end of it.** Verified against the same
    station's daily series: Oroville's monthly value dated `2026-6-1` is
    3,082,292 acre-feet, which is the daily reading for **30 June**; 1 June
    was 3,327,054. So the stamp names the month and the value is its last day,
    and the date is moved to the end of the month here -- the calendar is
    corrected, never the reading.

    It matters for more than tidiness. Every date this pipeline publishes
    means "when the water was measured": `days_stale` is computed from it and
    ADR-056 withdraws a record 60 days past it. Left at the month's start, all
    33 monthly California stations read 50 days late on the day they were
    admitted and would have been withdrawn as quiet feeds before September,
    while reporting perfectly normally. The month-end feed this project
    already had -- the Conservation Service's -- stamps the last day, so this
    also makes one convention of two.
    """
    payload = _get_cdec_json({
        "Stations": station_id,
        "SensorNums": str(CDEC_STORAGE_SENSOR),
        "dur_code": "M" if cadence == "monthly" else "D",
        "Start": dt.datetime.strptime(start, "%Y%m%d").date().isoformat(),
        "End": dt.datetime.strptime(end, "%Y%m%d").date().isoformat(),
    })
    rows = []
    for value in (payload if isinstance(payload, list) else []):
        reading = value.get("value")
        # Dropped, never converted: see CDEC_MISSING_VALUE.
        if not isinstance(reading, (int, float)):
            continue
        if reading == CDEC_MISSING_VALUE or reading < 0:
            continue
        rows.append({"date": value.get("date"), "storage_af": float(reading)})

    if not rows:
        return pd.DataFrame({"date": pd.Series(dtype="datetime64[ns]"),
                             "storage_af": pd.Series(dtype="float64")})
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.normalize()
    df["storage_af"] = pd.to_numeric(df["storage_af"], errors="coerce")
    df = df.dropna(subset=["date", "storage_af"])
    if cadence == "monthly":
        # See the docstring: the stamp names the month, the value is its last
        # day. `MonthEnd(0)` moves a date inside a month to that month's end
        # and leaves one already there alone, so this is idempotent if the
        # service ever changes its convention. The today filter below then
        # drops a month still in progress rather than publishing a date in
        # the future -- which costs at most the current month's row, and only
        # if the service ever begins stamping one before the month is over.
        df["date"] = df["date"] + pd.offsets.MonthEnd(0)
    df = df[df["date"] <= local_today()]
    return (df.sort_values("date").drop_duplicates(subset="date", keep="last")
              [["date", "storage_af"]].reset_index(drop=True))
