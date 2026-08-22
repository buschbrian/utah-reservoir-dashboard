"""One adapter per provider, and the retry policy they share.

Four providers answer with storage readings -- Reclamation, the Natural
Resources Conservation Service, the California Department of Water Resources,
and the Colorado Division of Water Resources -- and each has its own URL, its
own paging, its own idea of a missing value and its own date convention.
Everything specific to a provider belongs here, so that the rest of the
pipeline sees one shape: a frame of `date` and `storage_af`, cleaned, sorted
and deduplicated.
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


#: Colorado's own service. The telemetry `abbrev` is the identity (ADR-066);
#: storage is published in acre-feet and the daily endpoint folds each day's
#: readings behind one row (`measCount` says how many stood behind it).
CDSS_BASE_URL = "https://dwr.state.co.us/Rest/GET/api/v2"
CDSS_STATIONS_URL = f"{CDSS_BASE_URL}/telemetrystations/telemetrystation"
CDSS_SERIES_URL = f"{CDSS_BASE_URL}/telemetrystations/telemetrytimeseriesday"


def _get_cdss_json(url: str, params: dict):
    """GET a CDSS envelope, with the same transient-failure policy as the others.

    Two things are this service's own. The answer is always an *envelope* --
    `{PageNumber, PageCount, ResultCount, ResultList}` -- never a bare list,
    so the caller reads `ResultList`. And **a station or window with no rows
    is an HTTP 404 carrying a text body** ("returns zero records from CDSS"),
    which for every other service means a failure. Here it means "no data":
    a reservoir whose telemetry stopped in 2021 answers its whole recent
    history that way. A 404 whose body says zero records is therefore an
    empty answer, returned as `[]`; any other 404 is still raised, because a
    reshaped route is a failure and must look like one.

    The service also publishes its own quota -- 1,000 requests and 600,000
    rows per day, resetting at midnight Mountain -- on `x-rate-*` response
    headers. Nothing here reads them yet; the refresh's ~400k rows fit, and
    the audit tools that approach the limit report their own consumption.
    """
    for attempt in range(RETRY_ATTEMPTS):
        try:
            resp = requests.get(url, params=params, timeout=60)
            if resp.status_code == 404 and b"zero records" in resp.content:
                return []
            resp.raise_for_status()
            payload = resp.json()
            if isinstance(payload, dict) and "ResultList" in payload:
                return payload["ResultList"] or []
            return payload
        except (requests.exceptions.RequestException, ValueError):
            if attempt == RETRY_ATTEMPTS - 1:
                raise
            time.sleep(RETRY_BACKOFF_SECONDS * 2**attempt)
    raise AssertionError("unreachable")


def fetch_cdss_series(abbrev: str, start: str, end: str) -> pd.DataFrame:
    """Pull a CDSS daily storage series and normalize it to [date, storage_af].

    The same contract the other three providers answer with: a date-sorted
    frame with nulls dropped, duplicate dates collapsed to the last reading,
    and nothing dated after today.

    What this service adds:

    **Dates carry no time zone** (`2026-07-01T00:00:00`) and need no
    correction: unlike California's monthly stamp, the value behind a day's
    row is that day's reading (its own `measCount` readings folded together),
    so the date is kept as written. The calendar needs no repair here.

    **No sentinel has been observed** -- dead stations answer 404 rather than
    publishing a filler value -- but a negative or null `measValue` is dropped
    anyway, on the same principle as every other provider: no reading and an
    empty reservoir are different facts.
    """
    rows = _get_cdss_json(CDSS_SERIES_URL, {
        "abbrev": abbrev,
        "parameter": "STORAGE",
        "startDate": dt.datetime.strptime(start, "%Y%m%d").date().isoformat(),
        "endDate": dt.datetime.strptime(end, "%Y%m%d").date().isoformat(),
        "format": "json",
    })
    cleaned = []
    for value in rows if isinstance(rows, list) else []:
        reading = value.get("measValue")
        if not isinstance(reading, (int, float)) or reading < 0:
            continue
        cleaned.append({"date": value.get("measDate"), "storage_af": float(reading)})
    if not cleaned:
        return pd.DataFrame({"date": pd.Series(dtype="datetime64[ns]"),
                             "storage_af": pd.Series(dtype="float64")})
    df = pd.DataFrame(cleaned)
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.normalize()
    df["storage_af"] = pd.to_numeric(df["storage_af"], errors="coerce")
    df = df.dropna(subset=["date", "storage_af"])
    df = df[df["date"] <= local_today()]
    return (df.sort_values("date").drop_duplicates(subset="date", keep="last")
              [["date", "storage_af"]].reset_index(drop=True))


#: The U.S. Geological Survey's legacy daily-values service. Parameter 00054
#: is the agency's own code for reservoir storage in acre-feet; the service is
#: keyless until its documented early-2027 retirement, which ADR-080 accepts
#: as known debt with a date rather than a credential sought in a hurry.
USGS_DV_URL = "https://waterservices.usgs.gov/nwis/dv"


def _get_usgs_json(url: str, params: dict):
    """GET an NWIS reply with the shared transient-failure policy."""
    for attempt in range(RETRY_ATTEMPTS):
        try:
            resp = requests.get(url, params=params, timeout=60,
                                headers={"User-Agent":
                                         "western-water-dashboard/refresh "
                                         "(+https://github.com/buschbrian)"})
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.RequestException, ValueError):
            if attempt == RETRY_ATTEMPTS - 1:
                raise
            time.sleep(RETRY_BACKOFF_SECONDS * 2**attempt)
    raise AssertionError("unreachable")


def fetch_usgs_series(site_no: str, start: str, end: str) -> pd.DataFrame:
    """Pull a USGS daily 00054 series, normalized to [date, storage_af].

    The same contract every provider answers with. What this one adds:

    **The reply nests twice.** Each entry of `value.timeSeries` is one
    parameter-and-method series, and each carries a list of value *blocks*
    whose own `value` is the list of daily readings -- so a reading sits
    three levels deep where CDSS keeps it at one.

    **The calendar needs no repair.** Each reading is stamped with the day
    it belongs to (`dateTime` at midnight local), and the value behind that
    stamp is that day's figure, so dates are kept as written.

    **A quiet site answers with an empty series**, not an error: no blocks,
    no readings, an empty frame -- the same "no usable rows" state every
    other adapter produces.
    """
    cleaned = []
    payload = _get_usgs_json(USGS_DV_URL, {
        "sites": site_no, "parameterCd": "00054",
        "startDT": dt.datetime.strptime(start, "%Y%m%d").date().isoformat(),
        "endDT": dt.datetime.strptime(end, "%Y%m%d").date().isoformat(),
        "format": "json",
    })
    for series in payload.get("value", {}).get("timeSeries", []):
        for block in series.get("values", []):
            for reading in block.get("value", []):
                raw = reading.get("value")
                if raw in (None, ""):
                    continue
                try:
                    number = float(raw)
                except (TypeError, ValueError):
                    continue
                # Provisional or approved, a negative storage is a sentinel,
                # not a reading.
                if number >= 0:
                    cleaned.append({"date": reading.get("dateTime"),
                                    "storage_af": number})
    if not cleaned:
        return pd.DataFrame({"date": pd.Series(dtype="datetime64[ns]"),
                             "storage_af": pd.Series(dtype="float64")})
    df = pd.DataFrame(cleaned)
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.normalize()
    df["storage_af"] = pd.to_numeric(df["storage_af"], errors="coerce")
    df = df.dropna(subset=["date", "storage_af"])
    df = df[df["date"] <= local_today()]
    return (df.sort_values("date").drop_duplicates(subset="date", keep="last")
              [["date", "storage_af"]].reset_index(drop=True))
